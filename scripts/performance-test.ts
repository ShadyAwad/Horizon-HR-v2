import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const checks: Array<[string, boolean]> = [];
const check = (name: string, value: boolean) => checks.push([name, value]);

const migration = read('src/db/migrations/20260725_add_performance_management.sql');
const routes = read('src/server/performance/performance-routes.ts');
const delivery = read('src/server/performance/recognition-delivery.ts');
const server = read('server.ts');
const dashboard = read('src/pages/Dashboard.tsx');

check('creates tenant-scoped review cycles', migration.includes('CREATE TABLE IF NOT EXISTS performance_review_cycles'));
check('creates tenant-scoped review assignments', migration.includes('CREATE TABLE IF NOT EXISTS performance_review_assignments'));
check('creates goals and history', migration.includes('CREATE TABLE IF NOT EXISTS performance_goals') && migration.includes('CREATE TABLE IF NOT EXISTS performance_goal_updates'));
check('enforces one active monthly winner', migration.includes('employee_recognitions_one_active_month_idx'));
check('enables RLS for performance tables', migration.includes("'performance_review_cycles'"));
check('seeds dedicated permissions', migration.includes("'performance.manage_recognition'"));
check('uses standardAuth dependency, not a demo-specific route dependency', routes.includes('standardAuth: Middleware') && !routes.includes('demoAuth: Middleware'));
check('requires peer assignments to be unique', routes.includes('PERFORMANCE_DUPLICATE_PEER') && migration.includes('performance_assignments_unique_reviewer'));
check('prevents peer self-assignment', routes.includes('PERFORMANCE_PEER_SELF_ASSIGNMENT'));
check('keeps peer reviewer identity server-side', routes.includes('confidential_to_subject') && routes.includes('submittedCount>=3'));
check('locks submitted assignment updates', routes.includes("['submitted','cancelled']"));
check('calculates score server-side', routes.includes('calculateScore(client'));
check('uses atomic recognition delivery claim', delivery.includes('FOR UPDATE OF delivery SKIP LOCKED') && delivery.includes("delivery_status = 'pending'"));
check('recognition failures do not block login', server.includes('claimRecognitionAfterSuccessfulAuth') && server.includes('Login delivery lookup failed'));
check('recognition failures do not block clock-in', server.includes('Clock-in delivery lookup failed'));
check('dashboard lazy-loads performance panel', dashboard.includes("const PerformancePanel = lazy"));
check('dashboard accepts recognition payload', dashboard.includes('initialRecognition'));

let failures = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} performance: ${name}`);
  if (!passed) failures += 1;
}
if (failures) {
  console.error(`Performance checks failed: ${failures}/${checks.length}`);
  process.exit(1);
}
console.log(`Performance checks passed: ${checks.length}/${checks.length}`);
