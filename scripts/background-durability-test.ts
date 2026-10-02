import 'dotenv/config';
import assert from 'node:assert/strict';
import { getDbPool, enqueueAuditLog, closeHrResources } from '../src/lib/hr-background';
import { assertDatabaseMutationSafety } from './mutation-safety';
assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Background durability probe');
try {
    const pool = getDbPool();
    const tenant = (await pool.query("SELECT id FROM tenants WHERE slug='migration-control'")).rows[0];
    assert(tenant);
    const started = Date.now();
    const job = await enqueueAuditLog({ tenantId: tenant.id, action: 'operations_recovery_probe', entityType: 'operations_probe' });
    assert(job.id);
    assert(Date.now() - started < 5000);
    const rows = (await pool.query("SELECT id FROM outbox_events WHERE tenant_id=$1 AND event_type='background.hr' AND processed_at IS NULL", [tenant.id])).rows;
    assert.equal(rows.length, 1);
    console.log('PASS unavailable Redis preserves pending PostgreSQL dispatch with bounded producer failure');
}
finally {
    await closeHrResources();
}
