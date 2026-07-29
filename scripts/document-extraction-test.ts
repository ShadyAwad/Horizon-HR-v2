import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { PoolClient } from 'pg';
import sharp from 'sharp';
import { presentAuditEvent, recordAuditEvent } from '../src/server/audit/audit-events';
import {
  FixtureExtractionProvider,
  createConfiguredExtractionProvider,
  type ExtractionProvider,
} from '../src/server/document-extraction/extraction-provider';
import { normalizeProviderExtraction } from '../src/server/document-extraction/extraction-normalisers';
import { registerDocumentExtractionRoutes } from '../src/server/document-extraction/extraction-routes';
import { extractWithTimeout, type DocumentExtractionService } from '../src/server/document-extraction/extraction-service';
import { PrivateExtractionStorage } from '../src/server/document-extraction/extraction-storage';
import {
  ExtractionError,
  MODE_PERMISSIONS,
  type ExtractionMode,
  type ExtractionResponse,
} from '../src/server/document-extraction/extraction-types';
import {
  EXTRACTION_MAX_BYTES,
  validateAndPrepareImage,
  validateUploadEnvelope,
} from '../src/server/document-extraction/extraction-validation';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const EMPLOYEE_A = '00000000-0000-4000-8000-000000000002';
const EMPLOYEE_B = '00000000-0000-4000-8000-000000000003';
const EXTRACTION_A = '00000000-0000-4000-8000-000000000004';
const EXTRACTION_OTHER = '00000000-0000-4000-8000-000000000005';
const passes: string[] = [];

function pass(label: string) {
  passes.push(label);
  console.log(`PASS  ${label}`);
}

async function expectExtractionError(task: Promise<unknown> | (() => unknown), code: string) {
  let caught: unknown;
  try {
    if (typeof task === 'function') await task();
    else await task;
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof ExtractionError, `Expected ExtractionError ${code}.`);
  assert.equal(caught.code, code);
  return caught;
}

function upload(buffer: Buffer, mimetype: string, originalname: string, size = buffer.length) {
  return { buffer, mimetype, originalname, size };
}

const [png, jpeg, webp] = await Promise.all([
  sharp({
    create: { width: 24, height: 24, channels: 4, background: { r: 0, g: 128, b: 80, alpha: 1 } },
  }).png().toBuffer(),
  sharp({
    create: { width: 24, height: 24, channels: 3, background: { r: 0, g: 128, b: 80 } },
  }).jpeg().toBuffer(),
  sharp({
    create: { width: 24, height: 24, channels: 3, background: { r: 0, g: 128, b: 80 } },
  }).webp().toBuffer(),
]);

const preparedPng = await validateAndPrepareImage(upload(png, 'image/png', 'receipt.png'));
const preparedJpeg = await validateAndPrepareImage(upload(jpeg, 'image/jpeg', 'receipt.jpg'));
const preparedWebp = await validateAndPrepareImage(upload(webp, 'image/webp', 'label.webp'));
assert.equal(preparedPng.mimeType, 'image/png');
assert.equal(preparedJpeg.mimeType, 'image/jpeg');
assert.equal(preparedWebp.mimeType, 'image/webp');
assert(preparedPng.width <= 4096 && preparedJpeg.height <= 4096);
pass('Valid JPEG and PNG images are decoded and normalized');

await expectExtractionError(
  Promise.resolve().then(() => validateUploadEnvelope(upload(Buffer.from('MZ executable'), 'application/octet-stream', 'payload.exe'))),
  'UNSUPPORTED_FILE_TYPE',
);
await expectExtractionError(
  Promise.resolve().then(() => validateUploadEnvelope(upload(Buffer.from('%PDF-1.7'), 'application/pdf', 'label.pdf'))),
  'UNSUPPORTED_FILE_TYPE',
);
await expectExtractionError(
  Promise.resolve().then(() => validateUploadEnvelope(upload(png, 'image/jpeg', 'receipt.jpg'))),
  'UNSUPPORTED_FILE_TYPE',
);
await expectExtractionError(
  Promise.resolve().then(() => validateUploadEnvelope(upload(png, 'image/png', 'receipt.jpg'))),
  'UNSUPPORTED_FILE_TYPE',
);
await expectExtractionError(
  Promise.resolve().then(() => validateUploadEnvelope(upload(Buffer.alloc(0), 'image/png', 'empty.png'))),
  'INVALID_IMAGE',
);
await expectExtractionError(
  Promise.resolve().then(() => validateUploadEnvelope(upload(png, 'image/png', 'large.png', EXTRACTION_MAX_BYTES + 1))),
  'FILE_TOO_LARGE',
);
await expectExtractionError(
  validateAndPrepareImage(upload(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('malformed')]),
    'image/png',
    'broken.png',
  )),
  'INVALID_IMAGE',
);
await validateAndPrepareImage(upload(png, 'image/png', 'إيصال-اختبار.png'));
pass('Upload envelopes reject empty, oversized, malformed, mismatched, and unsupported inputs');

const expense = normalizeProviderExtraction('expense_receipt', {
  fields: {
    merchantName: { value: ' Test Market ', confidence: 0.9 },
    transactionDate: { value: '07/08/2026', confidence: 0.5 },
    totalAmount: { value: '-50.00', confidence: 0.8 },
    currency: { value: 'egp', confidence: 0.9 },
  },
});
assert.deepEqual(Object.keys(expense.fields), ['merchantName', 'transactionDate', 'totalAmount', 'currency']);
assert.equal((expense.fields as any).totalAmount.value, null);
assert.equal((expense.fields as any).transactionDate.value, null);
assert(expense.warnings.some((warning) => warning.code === 'INVALID_AMOUNT'));
assert(expense.warnings.some((warning) => warning.code === 'AMBIGUOUS_DATE'));

const candidate = normalizeProviderExtraction('candidate_document', {
  fields: {
    fullName: { value: 'Amina Example', confidence: 0.8 },
    email: { value: 'not-an-email', confidence: 0.7 },
    phoneNumber: { value: '+20 100 000 0000', confidence: 0.7 },
  },
});
assert.deepEqual(Object.keys(candidate.fields), ['fullName', 'email', 'phoneNumber']);
assert.equal((candidate.fields as any).email.value, 'not-an-email');
assert.equal((candidate.fields as any).email.warning, 'INVALID_FORMAT');

const asset = normalizeProviderExtraction('asset_label', {
  fields: {
    serialNumber: { value: 'Serial: AbC-12-xY', confidence: 0.9 },
    modelNumber: { value: 'Model: STZ-4', confidence: 0.8 },
    manufacturer: { value: 'Stanza Test', confidence: 0.8 },
    barcodeText: { value: 'Barcode: 001-AbC', confidence: 0.8 },
  },
});
assert.deepEqual(Object.keys(asset.fields), ['serialNumber', 'modelNumber', 'manufacturer', 'barcodeText']);
assert.equal((asset.fields as any).serialNumber.value, 'AbC-12-xY');
pass('Strict mode schemas preserve editable candidates and flag ambiguous values');

const unconfiguredProvider = createConfiguredExtractionProvider({
  NODE_ENV: 'production',
  DOCUMENT_EXTRACTION_PROVIDER: 'fixture',
  ALLOW_DOCUMENT_EXTRACTION_FIXTURES: 'true',
});
assert.equal(unconfiguredProvider.id, 'unconfigured');
await expectExtractionError(
  unconfiguredProvider.extract({ mode: 'expense_receipt', mimeType: 'image/png', buffer: png }),
  'EXTRACTION_PROVIDER_UNAVAILABLE',
);
const fixtureProvider = createConfiguredExtractionProvider({
  NODE_ENV: 'test',
  DOCUMENT_EXTRACTION_PROVIDER: 'fixture',
  ALLOW_DOCUMENT_EXTRACTION_FIXTURES: 'true',
});
assert.equal(fixtureProvider.id, 'deterministic_fixture');
assert((await fixtureProvider.extract({ mode: 'asset_label', mimeType: 'image/png', buffer: png })).fields.serialNumber);
const slowProvider: ExtractionProvider = {
  id: 'slow-test',
  extract: () => new Promise(() => undefined),
};
await expectExtractionError(
  extractWithTimeout(slowProvider, { mode: 'asset_label', mimeType: 'image/png', buffer: png }, 5),
  'EXTRACTION_TIMEOUT',
);
pass('Provider configuration fails closed, fixtures are test-only, and timeouts are curated');

const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'stanza-extraction-test-'));
try {
  const storage = new PrivateExtractionStorage(storageRoot, 1);
  const key = await storage.write(png);
  assert.match(key, /^[0-9a-f-]{36}\.bin$/i);
  assert.deepEqual(await storage.read(key), png);
  await assert.rejects(() => storage.read('../private.bin'), /Invalid extraction storage key/);
  await new Promise((resolve) => setTimeout(resolve, 15));
  await storage.cleanupExpired();
  await assert.rejects(() => storage.read(key), /ENOENT/);
  const removeKey = await storage.write(jpeg);
  await storage.remove(removeKey);
  await storage.remove(removeKey);
} finally {
  await rm(storageRoot, { recursive: true, force: true });
}
pass('Private temporary storage uses random keys, blocks traversal, expires, and deletes idempotently');

type StubIdentity = { tenantId: string; employeeId: string };
const resultFor = (mode: ExtractionMode, extractionId = EXTRACTION_A): ExtractionResponse => {
  return {
    extractionId,
    mode,
    status: 'completed',
    fields: normalizeProviderExtraction(mode, {
      fields: mode === 'expense_receipt'
        ? { merchantName: { value: 'Test', confidence: 1 } }
        : mode === 'candidate_document'
          ? { fullName: { value: 'Test', confidence: 1 } }
          : { serialNumber: { value: 'TEST-1', confidence: 1 } },
    }).fields,
    warnings: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
};

const fakeService = {
  create: async (_identity: StubIdentity, mode: ExtractionMode) => resultFor(mode),
  getOwn: async (identity: StubIdentity, extractionId: string) => {
    if (identity.employeeId !== EMPLOYEE_A || extractionId === EXTRACTION_OTHER) {
      throw new ExtractionError('EXTRACTION_NOT_FOUND', 'Document extraction not found.', 404);
    }
    return resultFor('expense_receipt', extractionId);
  },
  deleteOwn: async (identity: StubIdentity, extractionId: string) => {
    if (identity.employeeId !== EMPLOYEE_A || extractionId === EXTRACTION_OTHER) {
      throw new ExtractionError('EXTRACTION_NOT_FOUND', 'Document extraction not found.', 404);
    }
    return { success: true };
  },
} as unknown as DocumentExtractionService;

const app = express();
const standardAuth: express.RequestHandler = (req, res, next) => {
  if (!req.header('x-test-auth')) return res.status(401).json({ success: false, error: 'Authentication required.' });
  req.authUser = {
    employeeId: req.header('x-test-employee') || EMPLOYEE_A,
    tenantId: TENANT_A,
    email: 'fixture@example.invalid',
    role: req.header('x-test-role') === 'hr_admin' ? 'hr_admin' : 'employee',
    permissions: (req.header('x-test-permissions') || '').split(',').filter(Boolean),
  };
  next();
};
const mutationGuard: express.RequestHandler = (req, res, next) => {
  if (req.header('origin') !== `http://${req.header('host')}`) {
    return res.status(403).json({ success: false, code: 'CSRF_REJECTED' });
  }
  next();
};
const rateLimiter: express.RequestHandler = (req, res, next) => {
  if (req.header('x-test-rate-limited') === 'true') {
    return res.status(429).json({ success: false, code: 'RATE_LIMITED' });
  }
  next();
};
registerDocumentExtractionRoutes(app, { standardAuth, mutationGuard, rateLimiter, service: fakeService });
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

async function request(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { response, body: await response.json().catch(() => ({})) as Record<string, any> };
}

function imageForm(mode: string, filename = 'receipt.png') {
  const form = new FormData();
  form.set('mode', mode);
  form.set('file', new Blob([png], { type: 'image/png' }), filename);
  return form;
}

try {
  const anonymous = await request(`/api/document-extractions/${EXTRACTION_A}`);
  assert.equal(anonymous.response.status, 401);

  const noCsrf = await request('/api/document-extractions', {
    method: 'POST',
    headers: { 'x-test-auth': 'true', 'x-test-permissions': MODE_PERMISSIONS.expense_receipt },
    body: imageForm('expense_receipt'),
  });
  assert.equal(noCsrf.response.status, 403);

  const hrWithoutPermission = await request('/api/document-extractions', {
    method: 'POST',
    headers: { Origin: baseUrl, 'x-test-auth': 'true', 'x-test-role': 'hr_admin' },
    body: imageForm('candidate_document'),
  });
  assert.equal(hrWithoutPermission.response.status, 403, JSON.stringify(hrWithoutPermission.body));
  const assetManagerWithoutExtractionPermission = await request('/api/document-extractions', {
    method: 'POST',
    headers: { Origin: baseUrl, 'x-test-auth': 'true', 'x-test-permissions': 'assets.manage' },
    body: imageForm('asset_label'),
  });
  assert.equal(assetManagerWithoutExtractionPermission.response.status, 403, JSON.stringify(assetManagerWithoutExtractionPermission.body));

  for (const mode of ['expense_receipt', 'candidate_document', 'asset_label'] as const) {
    const allowed = await request('/api/document-extractions', {
      method: 'POST',
      headers: { Origin: baseUrl, 'x-test-auth': 'true', 'x-test-permissions': MODE_PERMISSIONS[mode] },
      body: imageForm(mode, mode === 'candidate_document' ? 'سيرة-ذاتية.png' : 'image.png'),
    });
    assert.equal(allowed.response.status, 201);
    assert.equal(allowed.body.mode, mode);
    assert(!('storageKey' in allowed.body) && !('url' in allowed.body) && !('providerPayload' in allowed.body));
  }

  const unknownFieldForm = imageForm('expense_receipt');
  unknownFieldForm.set('tenantId', TENANT_A);
  const unknownField = await request('/api/document-extractions', {
    method: 'POST',
    headers: { Origin: baseUrl, 'x-test-auth': 'true', 'x-test-permissions': MODE_PERMISSIONS.expense_receipt },
    body: unknownFieldForm,
  });
  assert.equal(unknownField.response.status, 400);

  const twoFiles = imageForm('expense_receipt');
  twoFiles.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'second.jpg');
  const multiple = await request('/api/document-extractions', {
    method: 'POST',
    headers: { Origin: baseUrl, 'x-test-auth': 'true', 'x-test-permissions': MODE_PERMISSIONS.expense_receipt },
    body: twoFiles,
  });
  assert.equal(multiple.response.status, 400);

  const rateLimited = await request('/api/document-extractions', {
    method: 'POST',
    headers: {
      Origin: baseUrl,
      'x-test-auth': 'true',
      'x-test-permissions': MODE_PERMISSIONS.expense_receipt,
      'x-test-rate-limited': 'true',
    },
    body: imageForm('expense_receipt'),
  });
  assert.equal(rateLimited.response.status, 429);

  const own = await request(`/api/document-extractions/${EXTRACTION_A}`, {
    headers: { 'x-test-auth': 'true', 'x-test-permissions': MODE_PERMISSIONS.expense_receipt },
  });
  assert.equal(own.response.status, 200);
  const unrelated = await request(`/api/document-extractions/${EXTRACTION_A}`, {
    headers: {
      'x-test-auth': 'true',
      'x-test-employee': EMPLOYEE_B,
      'x-test-permissions': MODE_PERMISSIONS.expense_receipt,
    },
  });
  assert.equal(unrelated.response.status, 404);
  const crossTenantHidden = await request(`/api/document-extractions/${EXTRACTION_OTHER}`, {
    headers: { 'x-test-auth': 'true', 'x-test-permissions': MODE_PERMISSIONS.expense_receipt },
  });
  assert.equal(crossTenantHidden.response.status, 404);
  const deleted = await request(`/api/document-extractions/${EXTRACTION_A}`, {
    method: 'DELETE',
    headers: { Origin: baseUrl, 'x-test-auth': 'true', 'x-test-permissions': MODE_PERMISSIONS.expense_receipt },
  });
  assert.equal(deleted.response.status, 200);
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
pass('Actual routes enforce auth, CSRF, explicit mode permissions, strict multipart, limits, and ownership');

const migration = await readFile('src/db/migrations/20260729_add_document_extraction.sql', 'utf8');
const serviceSource = await readFile('src/server/document-extraction/extraction-service.ts', 'utf8');
const routesSource = await readFile('src/server/document-extraction/extraction-routes.ts', 'utf8');
const storageSource = await readFile('src/server/document-extraction/extraction-storage.ts', 'utf8');
const registrySource = await readFile('src/server/organisation/permission-registry.ts', 'utf8');
const candidateUiSource = await readFile('src/components/hiring/CandidateDocumentExtraction.tsx', 'utf8');
const candidateFormSource = await readFile('src/components/hiring/HiringPanel.tsx', 'utf8');
const candidateStateSource = await readFile('src/components/hiring/candidate-prefill-state.ts', 'utf8');
const assetUiSource = await readFile('src/components/assets/AssetLabelExtraction.tsx', 'utf8');
const assetFormSource = await readFile('src/components/assets/AssetFormDialog.tsx', 'utf8');
const assetStateSource = await readFile('src/components/assets/asset-prefill-state.ts', 'utf8');
const docs = await readFile('docs/document-extraction.md', 'utf8');
assert.match(migration, /UNIQUE \(id, tenant_id\)/);
assert.match(migration, /FOREIGN KEY \(requested_by_employee_id, tenant_id\)/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /current_setting\('app\.current_tenant'/);
assert.match(migration, /document_extraction_jobs_requester_created_idx/);
assert.match(migration, /document_extraction_jobs_status_created_idx/);
assert.match(migration, /document_extraction_jobs_expiry_idx/);
assert.match(serviceSource, /pg_advisory_xact_lock/);
assert.match(serviceSource, /requested_by_employee_id=\$3/);
assert.match(serviceSource, /EXTRACTION_EXPIRED/);
assert.match(serviceSource, /SET status='failed',result_json=NULL,storage_key=NULL/);
assert.match(serviceSource, /finally \{\s+await this\.storage\.remove\(storageKey\)/);
assert.doesNotMatch(serviceSource, /INSERT INTO (?:expense|applicants|assets)\b/i);
assert.doesNotMatch(routesSource, /requireRole|role === 'hr_admin'/);
assert.doesNotMatch(storageSource, /uploads[\\/]company-feed|express\.static/);
for (const permission of Object.values(MODE_PERMISSIONS)) assert(registrySource.includes(permission));
assert.match(docs, /disabled when no OCR\s+adapter is configured/);
pass('Migration, RLS, tenant ownership, abuse controls, and no-business-mutation contracts hold');

assert.match(candidateUiSource, /candidate_document/);
assert.match(candidateUiSource, /image\/jpeg,image\/png,image\/webp/);
assert.doesNotMatch(candidateUiSource, /application\/pdf|\.pdf/i);
assert.match(candidateUiSource, /CandidateExtractionUiError/);
assert.match(candidateUiSource, /extractionUnavailable/);
assert.match(candidateUiSource, /method: 'DELETE'/);
assert.match(candidateUiSource, /mountedRef/);
assert.match(candidateUiSource, /onApplySuggestion/);
assert.match(candidateUiSource, /onInitialSuggestions/);
assert.match(candidateStateSource, /document_extraction\.candidate\.manage/);
assert.match(candidateFormSource, /canUseCandidateDocumentExtraction\(user\.permissions\)/);
assert.match(candidateFormSource, /createHiringApplicant\(user, form\)/);
assert.doesNotMatch(candidateFormSource, /createHiringApplicant\(user,\s*\{[^}]*extraction/i);
for (const sensitiveField of ['birthDate', 'gender', 'ethnicity', 'religion', 'disability', 'maritalStatus', 'politicalBeliefs', 'sexualOrientation']) {
  assert(!candidateUiSource.includes(sensitiveField), `candidate UI must not consume ${sensitiveField}`);
}
assert.doesNotMatch(candidateUiSource, /\bage\s*[:=]/);
pass('Candidate UI offers image-only optional prefill without provider details, protected attributes, or automatic applicant mutation');

assert.match(assetUiSource, /asset_label/);
assert.match(assetUiSource, /image\/jpeg,image\/png,image\/webp/);
assert.doesNotMatch(assetUiSource, /application\/pdf|\.pdf/i);
assert.match(assetUiSource, /serialNumber/);
assert.match(assetUiSource, /model/);
assert.match(assetUiSource, /manufacturer/);
assert.match(assetUiSource, /barcodeText/);
assert.match(assetUiSource, /extractionUseAsSerial/);
assert.match(assetUiSource, /method: 'DELETE'/);
assert.match(assetUiSource, /mountedRef/);
assert.doesNotMatch(assetUiSource, /rawOcr|providerPayload|storageKey|temporaryUrl/);
assert.match(assetStateSource, /manually-cleared/);
assert.match(assetStateSource, /originAfterManualChange/);
assert.match(assetStateSource, /origins\[field\] !== 'untouched'/);
assert.match(assetStateSource, /assets\.manage/);
assert.match(assetStateSource, /document_extraction\.asset\.manage/);
assert.match(assetFormSource, /data-field-origin/);
assert.match(assetFormSource, /confirmSerialChange/);
assert.match(assetFormSource, /serial-availability/);
assert.doesNotMatch(assetFormSource, /extractionId|confidenceLevel|barcodeText|rawOcr|providerPayload|storageKey/);
pass('Asset UI keeps extraction private, permission-gated, editable, temporary, and separate from explicit asset persistence');

const projection = presentAuditEvent('document_extraction.completed', 'document_extraction_job', {
  extractionId: EXTRACTION_A,
  mode: 'candidate_document',
  provider: 'test',
  status: 'completed',
  fieldNames: ['fullName', 'email'],
  warningCount: 1,
  fullName: 'Private Candidate',
  email: 'private@example.com',
  rawOcrText: 'private document contents',
  storageKey: 'private/path',
});
assert.deepEqual(projection.metadata.fieldNames, ['fullName', 'email']);
assert(!('fullName' in projection.metadata));
assert(!('email' in projection.metadata));
assert(!('rawOcrText' in projection.metadata));
assert(!('storageKey' in projection.metadata));

const writes: unknown[][] = [];
const auditClient = {
  query: async (_query: string, values: unknown[]) => {
    writes.push(values);
    return { rows: [], rowCount: 1 };
  },
} as unknown as PoolClient;
await recordAuditEvent(auditClient, {
  tenantId: TENANT_A,
  actorId: EMPLOYEE_A,
  action: 'document_extraction.completed',
  targetType: 'document_extraction_job',
  targetId: EXTRACTION_A,
  metadata: {
    extractionId: EXTRACTION_A,
    mode: 'expense_receipt',
    provider: 'test',
    status: 'completed',
    fieldNames: ['merchantName'],
    warningCount: 0,
  },
});
await assert.rejects(() => recordAuditEvent(auditClient, {
  tenantId: TENANT_A,
  actorId: EMPLOYEE_A,
  action: 'document_extraction.completed',
  targetType: 'document_extraction_job',
  targetId: EXTRACTION_A,
  metadata: {
    extractionId: EXTRACTION_A,
    mode: 'expense_receipt',
    provider: 'test',
    status: 'completed',
    merchantName: 'Private Merchant',
  },
}));
assert.equal(writes.length, 1);
pass('Audit projection and writer exclude OCR text, extracted values, PII, and storage paths');

console.log(`\nDocument extraction contracts passed: ${passes.length}`);
