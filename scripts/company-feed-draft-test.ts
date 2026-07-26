import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFeedEditorDocument } from '../src/lib/feed-editor-contract';

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
});

console.log(`Company Feed draft checks passed: ${passed}`);
