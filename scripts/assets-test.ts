import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyUntouchedAssetSuggestions,
  canUseAssetLabelExtraction,
  createAssetFieldOrigins,
  originAfterManualChange,
} from '../src/components/assets/asset-prefill-state';
import { normalizeAssetSerial } from '../src/server/assets/asset-routes';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('src/db/migrations/20260725_add_assets.sql');
const serialMigration = read('src/db/migrations/20260729_add_asset_serial_uniqueness.sql');
const routes = read('src/server/assets/asset-routes.ts');
const dashboard = read('src/pages/Dashboard.tsx');
const assetsPanel = read('src/components/assets/AssetsPanel.tsx');
const equipmentPanel = read('src/components/assets/MyEquipmentPanel.tsx');
const server = read('server.ts');
const evidenceStorage = read('src/lib/asset-evidence-storage.ts');
const assetForm = read('src/components/assets/AssetFormDialog.tsx');
const extractionUi = read('src/components/assets/AssetLabelExtraction.tsx');

const blankIdentifiers = { serialNumber: '', model: '', manufacturer: '' };
const firstPrefill = applyUntouchedAssetSuggestions(
  blankIdentifiers,
  createAssetFieldOrigins(false),
  { serialNumber: 'AbC-12-xY', model: 'STZ-4', manufacturer: 'Stanza Test' },
);
assert.equal(firstPrefill.values.serialNumber, 'AbC-12-xY');
assert.equal(firstPrefill.origins.serialNumber, 'extraction-prefilled');
const protectedOrigins = {
  ...firstPrefill.origins,
  serialNumber: originAfterManualChange('MANUAL-1'),
  model: originAfterManualChange(''),
};
const secondPrefill = applyUntouchedAssetSuggestions(
  { ...firstPrefill.values, serialNumber: 'MANUAL-1', model: '' },
  protectedOrigins,
  { serialNumber: 'NEW-SERIAL', model: 'NEW-MODEL', manufacturer: 'NEW-MAKER' },
);
assert.equal(secondPrefill.values.serialNumber, 'MANUAL-1');
assert.equal(secondPrefill.values.model, '');
assert.equal(secondPrefill.values.manufacturer, 'Stanza Test');
assert.equal(originAfterManualChange(''), 'manually-cleared');
assert.equal(normalizeAssetSerial(' S/N: AbC-12/xY '), 'AbC-12/xY');
assert.equal(normalizeAssetSerial('O0-I1-B8'), 'O0-I1-B8');
assert.throws(() => normalizeAssetSerial('SERIAL\u0000VALUE'), /unsupported characters/);

const extractionRoleMatrix = [
  ['asset administrator', ['assets.manage', 'document_extraction.asset.manage'], true],
  ['operations administrator with explicit authority', ['assets.manage', 'document_extraction.asset.manage'], true],
  ['delegated asset user', ['assets.manage', 'document_extraction.asset.manage'], true],
  ['HR Admin without extraction authority', ['assets.manage'], false],
  ['Manager without asset authority', ['document_extraction.asset.manage'], false],
  ['Employee', [], false],
] as const;
for (const [role, permissions, expected] of extractionRoleMatrix) {
  assert.equal(canUseAssetLabelExtraction(permissions), expected, role);
}

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
  ['evidence upload uses authenticated tenant-scoped endpoint', /\/api\/assets\/:assetId\/evidence/.test(server) && /tenant_id=\$1 AND asset_id=\$2 AND employee_id=\$3/.test(server)],
  ['evidence validates decoded image data and re-encodes WebP', /sharp\(file\.buffer/.test(server) && /\['jpeg', 'png', 'webp'\]/.test(server) && /\.webp\(/.test(server)],
  ['evidence storage is UUID-owned and isolated from Company Feed', /uploads\/assets/.test(evidenceStorage) && !/company-feed/.test(evidenceStorage)],
  ['evidence retrieval is private and nosniff', /\/api\/assets\/evidence\/:reportId/.test(server) && /X-Content-Type-Options/.test(server)],
  ['offboarding count is derived from active tenant assignments', /outstanding_asset_count/.test(server) && /asset_assignment\.status = 'active'/.test(server)],
  ['offboarding warning is visible and opens assets', /assets-warning-/.test(dashboard) && /setActiveTab\('assets'\)/.test(dashboard)],
  ['offboarding completion audits retained assets safely', /offboarding\.completed_with_assets/.test(server) && /outstandingAssetCount/.test(server)],
  ['asset label extraction is permission based rather than role named', /canUseAssetLabelExtraction\(user\.permissions\)/.test(assetsPanel) && !/hr_admin/.test(assetForm)],
  ['asset form remains explicit save authority', /method: asset \? 'PATCH' : 'POST'/.test(assetForm) && /type="submit"/.test(assetForm)],
  ['asset extraction accepts only image formats and not PDF', /image\/jpeg,image\/png,image\/webp/.test(extractionUi) && !/application\/pdf|\.pdf/i.test(extractionUi)],
  ['asset extraction supports drop and keyboard file selection', /onDrop=/.test(extractionUi) && /type="file"/.test(extractionUi) && /inputRef\.current\?\.click/.test(extractionUi)],
  ['asset extraction supports replace remove retry and manual recovery', /extractionReplace/.test(extractionUi) && /extractionRemove/.test(extractionUi) && /extractionRetry/.test(extractionUi) && /extractionContinueManual/.test(extractionUi)],
  ['barcode remains separate and requires explicit serial application', /'barcodeText'/.test(extractionUi) && /extractionUseAsSerial/.test(extractionUi) && /onApply\('serialNumber', draft\)/.test(extractionUi)],
  ['temporary extraction is cleaned on remove close and save', /await cleanup\(\)/.test(extractionUi) && /saveCompleted/.test(extractionUi) && /return \(\) => \{[\s\S]*void cleanup\(\)/.test(extractionUi)],
  ['extraction payload cannot create update or assign assets', !/\/api\/hr\/assets/.test(extractionUi) && !/assign/.test(extractionUi)],
  ['asset save payload excludes OCR and provider metadata', !/rawOcr|providerPayload|storageKey|confidence/.test(assetForm)],
  ['tenant serial uniqueness includes retired assets', /UNIQUE INDEX IF NOT EXISTS assets_tenant_serial_unique[\s\S]*tenant_id, serial_number/.test(serialMigration) && !/status/.test(serialMigration)],
  ['serial availability is tenant scoped and minimal', /\/api\/hr\/assets\/serial-availability/.test(routes) && /WHERE tenant_id=\$1[\s\S]*serial_number=\$2/.test(routes) && /conflictType/.test(routes)],
  ['serial availability excludes only the edited asset', /id<>\$3/.test(routes) && /assetId/.test(assetForm)],
  ['database uniqueness returns a safe serial conflict', /assets_tenant_serial_unique/.test(routes) && /ASSET_SERIAL_EXISTS/.test(routes) && /Serial number already exists/.test(routes)],
  ['dialog is portal based responsive RTL and scroll safe', /createPortal/.test(assetForm) && /dir=\{isRtl/.test(assetForm) && /100dvh/.test(assetForm) && /overflow-x-hidden/.test(assetForm)],
];

let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  failed ||= !passed;
}
if (failed) process.exitCode = 1;
