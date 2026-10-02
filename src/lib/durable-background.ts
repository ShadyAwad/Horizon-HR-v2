import { eachTenant } from './tenant-maintenance';
import { requestContext } from './request-context';
import { boundedQueueOperation } from './queue-bounds';
import { getHrQueue, withTenant, getDbPool } from './background-connections';
import { logServerError } from './server-logging';
export async function durableEnqueue(name: string, data: {
    tenantId: string;
}, options: object = {}) {
    const row = await withTenant(data.tenantId, async (client) => (await client.query("INSERT INTO outbox_events(tenant_id,event_type,payload) VALUES($1,'background.hr',$2::jsonb) RETURNING id", [data.tenantId, JSON.stringify({ name, data: { ...data, requestId: requestContext.getStore()?.requestId }, options })])).rows[0]);
    try {
        return await boundedQueueOperation(getHrQueue().add(name, { ...data, requestId: requestContext.getStore()?.requestId, dispatchId: row.id }, { ...options, jobId: 'dispatch-' + row.id }));
    }
    catch (error) {
        logServerError('background_dispatch_pending', error);
        return { id: 'dispatch-' + row.id };
    }
}
export async function dispatchPendingBackground() {
    await eachTenant(tenantId => withTenant(tenantId, async (client) => {
        const rows = (await client.query("SELECT id,payload FROM outbox_events WHERE tenant_id=$1 AND event_type='background.hr' AND processed_at IS NULL ORDER BY created_at LIMIT 100", [tenantId])).rows;
        for (const row of rows)
            await boundedQueueOperation(getHrQueue().add(row.payload.name, { ...row.payload.data, dispatchId: row.id }, { ...row.payload.options, jobId: 'dispatch-' + row.id }));
    }));
}
export async function completeBackground(tenantId: string, dispatchId?: string) { if (dispatchId)
    await withTenant(tenantId, client => client.query("UPDATE outbox_events SET processed_at=now() WHERE tenant_id=$1 AND id=$2 AND event_type='background.hr'", [tenantId, dispatchId])); }
