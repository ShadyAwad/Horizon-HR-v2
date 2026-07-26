import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFeedEditorDocument } from '../src/lib/feed-editor-contract';
import { hasMeaningfulContent, normaliseCompanyFeedDraft, normaliseText } from '../src/lib/company-feed-draft-normalization';

let passed = 0;

function test(name: string, run: () => void) {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const root = (text: string) => ({
  root: {
    type: 'root', version: 1, children: [{
      type: 'paragraph', version: 1, children: [{ type: 'text', version: 1, text, format: 0, style: '' }],
    }],
  },
});

const migration = readFileSync(new URL('../src/db/migrations/20260726_add_company_feed_drafts.sql', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/hooks/useCompanyFeedDraft.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');

test('draft table is tenant-scoped, author-owned, versioned, and RLS protected', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS company_feed_drafts/);
  assert.match(migration, /FOREIGN KEY \(author_employee_id, tenant_id\)\s+REFERENCES employees\(id, tenant_id\)/);
  assert.match(migration, /company_feed_drafts_one_active_author_idx/);
  assert.match(migration, /WHERE status = 'active'/);
  assert.match(migration, /ALTER TABLE company_feed_drafts ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /current_setting\('app\.current_tenant', true\)/);
});

test('draft APIs are self-service and use same-origin cookie mutation protection', () => {
  assert.match(server, /'\/api\/me\/company-feed\/draft'/);
  assert.match(server, /author_employee_id = \$2/);
  assert.match(server, /requirePermission\('feed\.publish'\),\s+isSameOriginSessionMutation/);
  assert.doesNotMatch(server, /\/api\/hr\/company-feed\/draft/);
});

test('stale versions return a conflict instead of overwriting the newer draft', () => {
  assert.match(server, /DRAFT_VERSION_CONFLICT/);
  assert.match(server, /Number\(current\.version\) !== expectedVersion/);
  assert.match(server, /LIMIT 1 FOR UPDATE/);
  assert.match(server, /pg_advisory_xact_lock/);
});

test('drafts preserve the lexical-v1 contract and reject unsafe documents', () => {
  assert.equal(validateFeedEditorDocument(root('Private draft'), 'Private draft').ok, true);
  assert.equal(validateFeedEditorDocument({ root: { type: 'root', children: [{ type: 'script', children: [] }] } }).ok, false);
  assert.match(server, /serializedContentJson\.length > 50000/);
  assert.match(server, /validateFeedEditorDocument\(body\.contentJson, contentText\)/);
});

test('restoration normalises undefined and null text fields without calling trim on them', () => {
  const document = root('Recovered content');
  assert.equal(normaliseText(undefined), '');
  assert.equal(normaliseText(null), '');
  const missingTitle = normaliseCompanyFeedDraft({ id: 'draft-1', version: 1, updatedAt: new Date().toISOString(), contentJson: document });
  const nullTitle = normaliseCompanyFeedDraft({ id: 'draft-2', version: 1, updatedAt: new Date().toISOString(), title: null, contentJson: document });
  assert.equal(missingTitle?.title, '');
  assert.equal(nullTitle?.title, '');
  assert.equal(missingTitle?.contentText, 'Recovered content');
});

test('missing or malformed restored documents are ignored while valid titleless drafts remain usable', () => {
  assert.equal(normaliseCompanyFeedDraft({ id: 'draft-3', version: 1, updatedAt: new Date().toISOString(), title: 'Only title' }), null);
  assert.equal(normaliseCompanyFeedDraft({ id: 'draft-4', version: 1, updatedAt: new Date().toISOString(), contentJson: { root: { type: 'script', children: [] } } }), null);
  assert.equal(hasMeaningfulContent(undefined, root('Titleless document')), true);
  assert.equal(hasMeaningfulContent(null, null), false);
});

test('attachments stay as internal UUID references and are checked against the author', () => {
  assert.match(server, /const imageIds = collectFeedImageIds\(body\.contentJson\)/);
  assert.match(server, /uploaded_by = \$2 AND status = 'pending' AND post_id IS NULL/);
  assert.match(server, /attachment_references @> jsonb_build_object/);
  assert.doesNotMatch(hook, /data:image/);
});

test('autosave is debounced, aborts obsolete requests, and keeps a bounded local recovery buffer', () => {
  assert.match(hook, /const AUTOSAVE_DELAY_MS = 1_000/);
  assert.match(hook, /requestRef\.current\?\.abort\(\)/);
  assert.match(hook, /const MAX_RETRIES = 2/);
  assert.match(hook, /const DRAFT_MAX_BYTES = 60_000/);
  assert.match(hook, /stanza\.company-feed\.recovery\.v1/);
  assert.match(hook, /tenantId, employeeId/);
});

test('server draft finalization makes a retried publish return the existing post', () => {
  assert.match(server, /draft\.status === 'published' && draft\.published_post_id/);
  assert.match(server, /SET status = 'published', published_post_id = \$4/);
  assert.match(server, /company_feed\.draft\.published/);
});

test('dashboard exposes stable accessible draft status and recovery controls', () => {
  assert.match(dashboard, /role="status" aria-live="polite"/);
  assert.match(dashboard, /feedDraftContinue/);
  assert.match(dashboard, /feedDraftDiscard/);
  assert.match(dashboard, /feedDraftRetry/);
  assert.match(dashboard, /min-h-10 flex-wrap/);
  assert.match(dashboard, /class CompanyFeedBoundary/);
  assert.match(dashboard, /Company Feed could not be loaded\./);
  assert.match(dashboard, /Discard local recovery data/);
  assert.match(dashboard, /<CompanyFeedBoundary onDiscardLocal=\{feedDraft\.clearLocal\}>/);
});

test('server returns one restored-draft shape with derived lexical text', () => {
  assert.match(server, /function presentCompanyFeedDraft/);
  assert.match(server, /contentText: validation\.extractedText/);
  assert.match(server, /draft: presentCompanyFeedDraft\(draft\)/);
  assert.match(hook, /normaliseCompanyFeedDraft\(body\.draft\)/);
  assert.doesNotMatch(hook, /storage\?\.removeItem\(key\)/);
});

console.log(`Company Feed draft checks passed: ${passed}`);
