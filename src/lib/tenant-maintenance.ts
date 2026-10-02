import { getDbPool } from './background-connections';
export async function eachTenant(callback: (tenantId: string) => Promise<void>) { let cursor = '00000000-0000-0000-0000-000000000000'; for (;;) {
    const rows = (await getDbPool().query('SELECT id FROM tenants WHERE id>$1 ORDER BY id LIMIT 100', [cursor])).rows;
    if (!rows.length)
        return;
    for (const row of rows)
        await callback(row.id);
    cursor = rows[rows.length - 1].id;
} }
