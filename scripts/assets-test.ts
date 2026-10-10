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
const resignationsPanel = read('src/components/resignations/ResignationsPanel.tsx');
const resignationRoutes = read('src/server/resignations/resignation-routes.ts');
const assetsPanel = read('src/components/assets/AssetsPanel.tsx');
const equipmentPanel = read('src/components/assets/MyEquipmentPanel.tsx');
const evidenceRoutes = read('src/server/assets/asset-evidence-routes.ts');
const evidenceStorage = read('src/lib/asset-evidence-storage.ts');
const assetForm = read('src/components/assets/AssetFormDialog.tsx');
const extractionUi = read('src/components/assets/AssetLabelExtraction.tsx');
const assetQrRoutes = read('src/server/qr/asset-qr-label-routes.ts');
const qrService = read('src/server/qr/qr-token-service.ts');
const qrPermissions = read('src/server/qr/qr-token-permissions.ts');
const qrPanel = read('src/components/assets/AssetQrLabelPanel.tsx');
const publicAssetPage = read('src/pages/PublicAssetVerification.tsx');
const assetDisclosureMigration = read('src/db/migrations/20260731_add_asset_qr_label_disclosure.sql');

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
  ['mobile-aware asset and equipment panels', /assets-row/.test(assetsPanel) && /@media\(max-width:600px\)/.test(read('src/index.css')) && equipmentPanel.includes('SupportRequestButton')],
  ['employee damage report does not expose return action', equipmentPanel.includes('SupportRequestButton') && !equipmentPanel.includes('/return')],
  ['evidence upload uses authenticated tenant-scoped endpoint', /\/api\/assets\/:assetId\/evidence/.test(evidenceRoutes) && /tenant_id=\$1 AND asset_id=\$2 AND employee_id=\$3/.test(evidenceRoutes)],
  ['evidence validates decoded image data and re-encodes WebP', /sharp\(file\.buffer/.test(evidenceRoutes) && /\['jpeg', 'png', 'webp'\]/.test(evidenceRoutes) && /\.webp\(/.test(evidenceRoutes)],
  ['evidence storage is UUID-owned and isolated from Company Feed', /uploads\/assets/.test(evidenceStorage) && !/company-feed/.test(evidenceStorage)],
  ['evidence retrieval is private and nosniff', /\/api\/assets\/evidence\/:reportId/.test(evidenceRoutes) && /X-Content-Type-Options/.test(evidenceRoutes)],
  ['offboarding count is derived from active tenant assignments', /outstanding_asset_count/.test(resignationRoutes) && /asset_assignment\.status = 'active'/.test(resignationRoutes)],
  ['offboarding warning is visible and opens assets', /assets-warning-/.test(resignationsPanel) && /onViewAssets/.test(resignationsPanel) && /setActiveTab\('assets'\)/.test(dashboard)],
  ['offboarding completion audits retained assets safely', /offboarding\.completed_with_assets/.test(resignationRoutes) && /outstandingAssetCount/.test(resignationRoutes)],
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
  ['dialog reuses native modal focus containment and responsive RTL', /ComposerDialog/.test(assetForm) && /dir=\{isRtl/.test(assetForm) && /showModal\(\)/.test(read('src/components/workspace-composer/ComposerDialog.tsx'))],
  ['asset QR labels use dedicated tenant-scoped routes', /\/api\/hr\/assets\/:assetId\/qr-label/.test(assetQrRoutes) && /requireUuid/.test(assetQrRoutes) && /issuanceRateLimiter/.test(assetQrRoutes)],
  ['asset QR authority is permission and scope based', /assets\.manage/.test(qrPermissions) && /qr\.asset_label\.manage/.test(qrPermissions) && !/hr_admin/.test(assetQrRoutes)],
  ['asset public disclosure defaults to label only and excludes private fields', /asset_label_disclosure_level/.test(assetDisclosureMigration) && /serial_number/.test(qrService) === false && /assignment history/i.test(qrService) === false],
  ['asset verification is purpose-bound and has generic invalid handling', /verify\/asset/.test(publicAssetPage) && /Asset label could not be verified/.test(read('src/lib/LanguageContext.tsx'))],
  ['asset QR rendering uses only server URL with a white quiet zone', /QRCodeSVG/.test(qrPanel) && /value=\{label\.verificationUrl\}/.test(qrPanel) && /bgColor="#ffffff"/.test(qrPanel) && !/APP_BASE_URL|window\.location/.test(qrPanel)],
  ['asset QR panel supports issue rotate revoke print download and confirmation', /action\('issue'\)/.test(qrPanel) && /setConfirm\('rotate'\)/.test(qrPanel) && /setConfirm\('revoke'\)/.test(qrPanel) && /window\.print/.test(qrPanel) && /XMLSerializer/.test(qrPanel) && /ComposerDialog/.test(qrPanel)],
];

let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  failed ||= !passed;
}
if (failed) process.exitCode = 1;

const {assetActions,assetAttention,assetDate,assetLabel}=await import('../src/lib/asset-presentation');
assert.equal(assetActions('available',['assets.assign']).assign,true);
assert.equal(assetActions('assigned',['assets.assign']).assign,false);
assert.equal(assetActions('assigned',[]).return,false);
assert.equal(assetActions('assigned',['assets.return']).return,true);
assert.equal(assetActions('assigned',['assets.manage']).final,false);
assert.equal(assetActions('retired',['assets.manage']).condition,false);
assert.equal(assetActions('maintenance',['assets.manage']).condition,true);
assert.equal(assetAttention({status:'available',condition:'damaged'}),true);
assert.equal(assetAttention({status:'assigned',condition:'good'}),false);
assert.equal(assetLabel('maintenance',true),'صيانة');
assert.equal(assetLabel('damaged'),'Damaged');
assert.equal(assetDate('invalid'),'—');
console.log('PASS state-specific asset controls, independent condition/status labels, attention and date presentation.');
