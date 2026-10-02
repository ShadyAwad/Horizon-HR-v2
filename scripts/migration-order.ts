import fs from 'node:fs';
import type { Pool } from 'pg';
// Preserve dated history while resolving explicit same-day dependencies.
const dependencies: Record<string, string[]> = {
    '20260728_add_shift_swap_approval_context.sql': ['20260728_add_shift_swap_requests.sql'],
    '20260728_apply_shift_swaps.sql': ['20260728_add_shift_swap_approval_context.sql'],
};
export function migrationOrder(directory = 'src/db/migrations') {
    const files = fs.readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
    const result: string[] = [], pending = new Set(files), visiting = new Set<string>();
    function visit(file: string) {
        if (!pending.has(file))
            return;
        if (visiting.has(file))
            throw new Error('Cyclic migration dependency: ' + file);
        visiting.add(file);
        for (const dependency of dependencies[file] ?? []) {
            if (!files.includes(dependency))
                throw new Error('Missing migration dependency: ' + dependency);
            visit(dependency);
        }
        visiting.delete(file);
        pending.delete(file);
        result.push(file);
    }
    for (const file of files)
        visit(file);
    return result;
}
export async function applyMigrations(pool: Pool, directory = 'src/db/migrations') {
    const client = await pool.connect();
    try {
        for (const file of migrationOrder(directory)) {
            await client.query(fs.readFileSync(directory + '/' + file, 'utf8'));
            console.log('Applied migration:', file);
        }
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
