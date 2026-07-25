import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('src/db/migrations/20260725_add_assets.sql');
const routes = read('src/server/assets/asset-routes.ts');
const dashboard = read('src/pages/Dashboard.tsx');
const assetsPanel = read('src/components/assets/AssetsPanel.tsx');
const equipmentPanel = read('src/components/assets/MyEquipmentPanel.tsx');
const checks: Array<[string, boolean]> = [
  ['tenant-scoped asset tables and RLS', /CREATE TABLE IF NOT EXISTS assets/.test(migration) && /ENABLE ROW LEVEL SECURITY/.test(migration)],
  ['single active asset assignment index', /asset_assignments_one_active_asset/.test(migration)],
  ['software seat constraint', /seats_used <= seat_count/.test(migration)],
  ['hardware lifecycle endpoints', ['/api/hr/assets/:assetId', 'report-condition', 'mark-lost', 'retire'].every((value) => routes.includes(value))],
  ['software lifecycle endpoints', ['/api/hr/software-licenses', '/assign', '/revoke'].every((value) => routes.includes(value))],
  ['employee equipment is self scoped', /assignment\.employee_id=\$2/.test(routes) && /employee_id=\$3/.test(routes)],
  ['license values use only masked or vault references', !/license[_ ]?key/i.test(routes) && /license_reference_masked/.test(migration)],
  ['lazy dashboard Assets tab', /const AssetsPanel = lazy/.test(dashboard) && /activeTab === 'assets'/.test(dashboard)],
  ['mobile-aware asset and equipment panels', /md:hidden/.test(assetsPanel) && /report-condition/.test(equipmentPanel)],
  ['employee damage report does not expose return action', /report-condition/.test(equipmentPanel) && !/\/return/.test(equipmentPanel)],
];

let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  failed ||= !passed;
}
if (failed) process.exitCode = 1;
