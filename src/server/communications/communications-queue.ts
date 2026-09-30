import type { CommunicationMessage } from '../../lib/communications-contract';
import { Queue, Worker, UnrecoverableError, type Job } from 'bullmq';
import { redisConnection, withTenant } from '../../lib/hr-background';
import { deliverEmail, type ProviderResult } from '../../lib/email';
import { recordAuditEvent } from '../audit/audit-events';
import { resolveScopedPermission } from '../organisation/scoped-permissions';
import { escapeHtml } from './communications-rules';
const QUEUE = 'stanza-communications';
let queue: Queue | undefined;
export type CommunicationJob = {
    tenantId: string;
    messageId: string;
};
export function communicationsQueue() { if (!queue) {
    queue = new Queue(QUEUE, { connection: { ...redisConnection, enableOfflineQueue: false, maxRetriesPerRequest: 1 }, defaultJobOptions: { attempts: 4, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 1000 } });
    queue.on('error', () => console.error('[Communications] Dispatch connection unavailable.'));
} return queue; }
export async function enqueueMessage(tenantId: string, messageId: string, scheduledAt?: string | null) {
    return communicationsQueue().add('send', { tenantId, messageId }, { jobId: `message-${messageId}`, delay: Math.max(0, new Date(scheduledAt || 0).getTime() - Date.now()) });
}
export function classifyDelivery(result: ProviderResult, attempt: number): {
    status: 'sent' | 'queued' | 'failed';
    retry: boolean;
    code: string | null;
} {
    if (result.ok === true)
        return { status: 'sent', retry: false, code: null };
    return { status: result.kind === 'transient' && attempt < 4 ? 'queued' : 'failed', retry: result.kind === 'transient' && attempt < 4, code: result.code };
}
export async function processMessage(job: Pick<Job<CommunicationJob>, 'data' | 'attemptsMade'>, send = deliverEmail) {
    const { tenantId, messageId } = job.data;
    const row = await withTenant(tenantId, async (client) => {
        const current = (await client.query<CommunicationMessage>('SELECT * FROM communication_messages WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, messageId])).rows[0];
        if (!current || !['queued', 'sending'].includes(current.status))
            return null;
        if (!current.first_attempt_at) {
            const actor = (await client.query("SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active AND employment_status='active'", [tenantId, current.sender_id])).rows[0];
            const categoryKey: Record<string, string> = { payroll_notice: 'payroll.view_all', grievance_update: 'grievances.review', hiring: 'hiring.view', leave_status: 'leave.view.scoped' };
            const domainKey = categoryKey[current.category] || (current.related_candidate_id ? 'hiring.view' : null);
            const domainAllowed = !domainKey || (await resolveScopedPermission(client, { tenantId, actorEmployeeId: current.sender_id, permissionKey: domainKey })).allowed;
            const allowed = domainAllowed && actor && (await resolveScopedPermission(client, { tenantId, actorEmployeeId: current.sender_id, permissionKey: 'communications.send' })).allowed;
            if (!allowed) {
                await client.query("UPDATE communication_messages SET status='failed',failure_code='SEND_PERMISSION_REVOKED',failure_reason='Sender is inactive or no longer authorized.',updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenantId, messageId]);
                await client.query("INSERT INTO communication_message_events(tenant_id,message_id,status,code) VALUES($1,$2,'failed','SEND_PERMISSION_REVOKED')", [tenantId, messageId]);
                await recordAuditEvent(client, { tenantId, actorId: current.sender_id, action: 'communications.email.failed', targetType: 'communication_message', targetId: messageId, metadata: { status: 'failed', code: 'SEND_PERMISSION_REVOKED' } });
                return null;
            }
        }
        if (current.first_attempt_at && Date.now() - +new Date(current.first_attempt_at) > 20 * 3600000) {
            await client.query("UPDATE communication_messages SET status='failed',failure_code='RECONCILIATION_REQUIRED',failure_reason='Delivery outcome requires provider reconciliation before any new send.',updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenantId, messageId]);
            await client.query("INSERT INTO communication_message_events(tenant_id,message_id,status,code) VALUES($1,$2,'failed','RECONCILIATION_REQUIRED')", [tenantId, messageId]);
            await recordAuditEvent(client, { tenantId, actorId: current.sender_id, action: 'communications.email.failed', targetType: 'communication_message', targetId: messageId, metadata: { status: 'failed', code: 'RECONCILIATION_REQUIRED' } });
            return null;
        }
        const updated = (await client.query<CommunicationMessage>("UPDATE communication_messages SET status='sending',attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,now()),failure_code=NULL,failure_reason=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *", [tenantId, messageId])).rows[0];
        await client.query("INSERT INTO communication_message_events(tenant_id,message_id,status) VALUES($1,$2,'sending')", [tenantId, messageId]);
        return updated;
    });
    if (!row)
        return;
    const result = await send({ to: row.recipients, subject: row.subject, text: row.body, html: `<div style="white-space:pre-wrap">${escapeHtml(row.body)}</div>`, ...(row.invitation_ics ? { attachments: [{ filename: 'invitation.ics', content: Buffer.from(row.invitation_ics) }] } : {}) }, `stanza-message-${row.id}`);
    const outcome = classifyDelivery(result, row.attempts);
    await withTenant(tenantId, async (client) => {
        await client.query('UPDATE communication_messages SET status=$3,provider_id=$4,failure_code=$5,failure_reason=$6,sent_at=CASE WHEN $3=\'sent\' THEN now() ELSE NULL END,updated_at=now() WHERE tenant_id=$1 AND id=$2', [tenantId, messageId, outcome.status, result.ok ? result.id : null, outcome.code, outcome.code ? (outcome.retry ? 'Temporary provider error; retry scheduled.' : 'Message was not confirmed sent. Review the failure code.') : null]);
        await client.query('INSERT INTO communication_message_events(tenant_id,message_id,status,code) VALUES($1,$2,$3,$4)', [tenantId, messageId, outcome.status, outcome.code]);
        if (!outcome.retry) {
            await recordAuditEvent(client, { tenantId, actorId: row.sender_id, action: result.ok ? 'communications.email.sent' : 'communications.email.failed', targetType: 'communication_message', targetId: messageId, metadata: { status: outcome.status, code: outcome.code } });
            if (!result.ok)
                await client.query("INSERT INTO outbox_events(tenant_id,event_type,payload) VALUES($1,'notification.communication_failed',$2::jsonb)", [tenantId, JSON.stringify({ employeeId: row.sender_id, messageId, notificationKey: 'system_alerts', idempotencyKey: `communication-failed-${messageId}` })]);
        }
    });
    if (outcome.retry)
        throw new Error(outcome.code!);
    if (!result.ok)
        throw new UnrecoverableError(outcome.code!);
}
/** A terminal BullMQ failure must not leave the persisted message saying it is sending. */
export async function reconcileFailedJob(job: Pick<Job<CommunicationJob>, 'data' | 'attemptsMade' | 'opts' | 'failedReason'>) {
    if (job.attemptsMade < (job.opts.attempts || 1) && !job.failedReason?.includes('stalled'))
        return;
    const { tenantId, messageId } = job.data;
    await withTenant(tenantId, async (client) => {
        const row = (await client.query<CommunicationMessage>("SELECT * FROM communication_messages WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','sending') FOR UPDATE", [tenantId, messageId])).rows[0];
        if (!row)
            return;
        const code = row.first_attempt_at ? 'RECONCILIATION_REQUIRED' : 'QUEUE_RETRY_EXHAUSTED';
        await client.query("UPDATE communication_messages SET status='failed',failure_code=$3,failure_reason='Worker stopped before a confirmed outcome. Review delivery before creating another message.',updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenantId, messageId, code]);
        await client.query("INSERT INTO communication_message_events(tenant_id,message_id,status,code) VALUES($1,$2,'failed',$3)", [tenantId, messageId, code]);
        await recordAuditEvent(client, { tenantId, actorId: row.sender_id, action: 'communications.email.failed', targetType: 'communication_message', targetId: messageId, metadata: { status: 'failed', code } });
    });
}
export function startCommunicationsWorker() {
    const worker = new Worker(QUEUE, job => processMessage(job), { connection: redisConnection, concurrency: 1, limiter: { max: 1, duration: 1000 } });
    worker.on('error', () => console.error('[Communications] Queue connection unavailable.'));
    worker.on('active', job => console.info('[Communications] Processing job', job.id));
    worker.on('ready', () => console.info('[Communications] Worker ready.'));
    worker.on('completed', job => console.info('[Communications] Job completed', job.id));
    worker.on('failed', job => { console.warn('[Communications] Job failed', job?.id); if (job)
        void reconcileFailedJob(job).catch(() => console.error('[Communications] Failed-job reconciliation unavailable.')); });
    return worker;
}
