import assert from 'node:assert/strict';
import {
  FEED_EDITOR_FORMAT,
  FEED_EDITOR_SCHEMA_VERSION,
  isSafeFeedLink,
  validateFeedEditorDocument,
} from '../src/lib/feed-editor-contract';

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

const paragraph = (text: string, extra: Record<string, unknown> = {}) => ({
  root: {
    type: 'root',
    version: 1,
    children: [{
      type: 'paragraph',
      version: 1,
      children: [{ type: 'text', version: 1, text, format: 0, style: '', ...extra }],
    }],
  },
});

test('editor contract has a stable format and schema version', () => {
  assert.equal(FEED_EDITOR_FORMAT, 'lexical-v1');
  assert.equal(FEED_EDITOR_SCHEMA_VERSION, 1);
});

test('valid Lexical JSON round trips with matching plain text', () => {
  const document = paragraph('Company update');
  const result = validateFeedEditorDocument(JSON.parse(JSON.stringify(document)), 'Company update');
  assert.equal(result.ok, true);
});

test('legacy root without root type remains compatible', () => {
  const document = { root: { children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Legacy post' }] }] } };
  assert.equal(validateFeedEditorDocument(document, 'Legacy post').ok, true);
});

test('malformed and unsupported nodes are rejected', () => {
  assert.equal(validateFeedEditorDocument(null).ok, false);
  assert.equal(validateFeedEditorDocument({ root: { type: 'root', children: [{ type: 'script', children: [] }] } }).ok, false);
});

test('unsupported text formats are rejected', () => {
  assert.equal(validateFeedEditorDocument(paragraph('Code', { format: 16 }), 'Code').ok, false);
  assert.equal(validateFeedEditorDocument(paragraph('Strike', { format: 4 }), 'Strike').ok, true);
});

test('font size and color styles use strict allowlists', () => {
  assert.equal(validateFeedEditorDocument(paragraph('Safe', { style: 'font-size: 16px; color: #34d399;' }), 'Safe').ok, true);
  assert.equal(validateFeedEditorDocument(paragraph('Unsafe', { style: 'background-image: url(javascript:alert(1))' }), 'Unsafe').ok, false);
  assert.equal(validateFeedEditorDocument(paragraph('Huge', { style: 'font-size: 500px' }), 'Huge').ok, false);
});

test('plain text must match structured content', () => {
  assert.equal(validateFeedEditorDocument(paragraph('Actual'), 'Different').ok, false);
});

test('link protocols are restricted', () => {
  assert.equal(isSafeFeedLink('https://stanza.example/help'), true);
  assert.equal(isSafeFeedLink('mailto:hr@stanza.example'), true);
  assert.equal(isSafeFeedLink('javascript:alert(1)'), false);
  assert.equal(isSafeFeedLink('data:text/html,test'), false);
  assert.equal(isSafeFeedLink('/relative-path'), false);
});

console.log(`Editor contract checks passed: ${passed}`);
