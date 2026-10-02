import { eachTenant } from './tenant-maintenance';
import { getDbPool, withTenant } from './hr-background';
export async function cleanupSessions() {
    await eachTenant(async (tenantId) => { await withTenant(tenantId, client => client.query("DELETE FROM auth_sessions WHERE id IN (SELECT id FROM auth_sessions WHERE tenant_id=$1 AND (expires_at<now()-interval '30 days' OR revoked_at<now()-interval '30 days') ORDER BY expires_at LIMIT 1000)", [tenantId])); });
}
