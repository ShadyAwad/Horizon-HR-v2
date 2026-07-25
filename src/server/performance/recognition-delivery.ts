import { withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';

export type RecognitionCelebration = {
  recognitionId: string;
  title: string;
  message: string | null;
  recognitionMonth: string | null;
};

// Claims exactly one pending delivery. This is deliberately separate from core
// login/attendance work so recognition faults never make those flows fail.
export async function claimPendingRecognitionDelivery(
  tenantId: string,
  employeeId: string,
  deliveredVia: 'login' | 'clock_in' | 'manual',
): Promise<RecognitionCelebration | null> {
  return withTenant(tenantId, async (client) => {
    const pending = (await client.query<{
      delivery_id: string;
      recognition_id: string;
      title: string;
      message: string | null;
      recognition_month: string | null;
    }>(`
      SELECT delivery.id AS delivery_id, recognition.id AS recognition_id,
        recognition.title, recognition.message, recognition.recognition_month::text
      FROM employee_recognition_deliveries delivery
      JOIN employee_recognitions recognition
        ON recognition.tenant_id = delivery.tenant_id
       AND recognition.id = delivery.recognition_id
       AND recognition.revoked_at IS NULL
      WHERE delivery.tenant_id = $1
        AND delivery.employee_id = $2
        AND delivery.delivery_status = 'pending'
      ORDER BY delivery.created_at ASC
      FOR UPDATE OF delivery SKIP LOCKED
      LIMIT 1
    `, [tenantId, employeeId])).rows[0];
    if (!pending) return null;

    const claimed = await client.query(
      `UPDATE employee_recognition_deliveries
       SET delivery_status = 'claimed', delivered_via = $3, claimed_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 AND delivery_status = 'pending'
       RETURNING id`,
      [tenantId, pending.delivery_id, deliveredVia],
    );
    if (!claimed.rowCount) return null;

    await recordAuditEvent(client, {
      tenantId,
      actorId: employeeId,
      action: 'performance.recognition.delivered',
      targetType: 'employee_recognition',
      targetId: pending.recognition_id,
      metadata: { deliveredVia },
    });
    return {
      recognitionId: pending.recognition_id,
      title: pending.title,
      message: pending.message,
      recognitionMonth: pending.recognition_month,
    };
  });
}
