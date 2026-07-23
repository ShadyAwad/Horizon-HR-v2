import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FEED_EDITOR_FORMAT,
  FEED_EDITOR_SCHEMA_VERSION,
  isSafeFeedLink,
  normalizeFeedImageDimensions,
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

test('retained inline formats remain valid', () => {
  for (const format of [1, 2, 8, 1 | 2 | 8]) {
    assert.equal(validateFeedEditorDocument(paragraph('Formatted', { format }), 'Formatted').ok, true);
  }
});

test('headings, quotes, lists, and links round trip', () => {
  const document = {
    root: {
      type: 'root',
      version: 1,
      children: [
        { type: 'heading', tag: 'h2', version: 1, children: [{ type: 'text', text: 'Update', format: 0, style: '', version: 1 }] },
        { type: 'quote', version: 1, children: [{ type: 'text', text: 'People first', format: 0, style: '', version: 1 }] },
        {
          type: 'list',
          listType: 'bullet',
          tag: 'ul',
          version: 1,
          children: [{
            type: 'listitem',
            version: 1,
            children: [{
              type: 'link',
              url: 'https://stanza.example/policy',
              target: '_blank',
              rel: 'noopener noreferrer',
              version: 1,
              children: [{ type: 'text', text: 'Policy', format: 0, style: '', version: 1 }],
            }],
          }],
        },
      ],
    },
  };
  const result = validateFeedEditorDocument(document, 'Update People first Policy');
  assert.equal(result.ok, true);
});

test('unsupported heading levels and unsafe serialized links are rejected', () => {
  const heading = {
    root: {
      type: 'root',
      children: [{ type: 'heading', tag: 'h5', children: [{ type: 'text', text: 'Too deep' }] }],
    },
  };
  const link = {
    root: {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [{ type: 'link', url: 'file:///etc/passwd', children: [{ type: 'text', text: 'File' }] }],
      }],
    },
  };
  assert.equal(validateFeedEditorDocument(heading, 'Too deep').ok, false);
  assert.equal(validateFeedEditorDocument(link, 'File').ok, false);
});

test('editor source keeps explicit RTL, logical spacing, and accessible mobile controls', () => {
  const source = readFileSync(new URL('../src/components/RichTextEditor.tsx', import.meta.url), 'utf8');
  assert.match(source, /dir=\{isRtl \? 'rtl' : 'ltr'\}/);
  assert.match(source, /margin-inline-start/);
  assert.match(source, /padding-inline-start/);
  assert.match(source, /border-inline-start-width/);
  assert.match(source, /role="toolbar"/);
  assert.match(source, /aria-expanded=/);
  assert.match(source, /h-11 w-11/);
  assert.match(source, /max-w-\[calc\(100vw-2rem\)\]/);
});

test('feed image nodes accept only internal UUID URLs and bounded metadata', () => {
  const id = '53f746a3-77e8-4e33-a7ab-c1178d516bc1';
  const image = {
    root: {
      type: 'root',
      children: [{
        type: 'image',
        version: 1,
        uploadId: id,
        src: `/api/company-feed/images/${id}`,
        altText: 'Team workshop',
        width: 640,
        height: 360,
      }],
    },
  };
  assert.equal(validateFeedEditorDocument(image, 'Team workshop').ok, true);
  assert.equal(validateFeedEditorDocument({
    root: {
      type: 'root',
      children: [{ ...image.root.children[0], src: 'https://attacker.example/image.png' }],
    },
  }, 'Team workshop').ok, false);
  assert.equal(validateFeedEditorDocument({
    root: {
      type: 'root',
      children: [{ ...image.root.children[0], altText: 'x'.repeat(241) }],
    },
  }).ok, false);
});

test('image resize dimensions are clamped while preserving aspect ratio', () => {
  assert.deepEqual(normalizeFeedImageDimensions(40, 20), { width: 80, height: 40 });
  assert.deepEqual(normalizeFeedImageDimensions(2400, 1200), { width: 1200, height: 600 });
});

test('image editor registers upload, paste, drop, retry, and alt-text behavior', () => {
  const editorSource = readFileSync(new URL('../src/components/RichTextEditor.tsx', import.meta.url), 'utf8');
  const nodeSource = readFileSync(new URL('../src/components/lexical/FeedImageNode.tsx', import.meta.url), 'utf8');
  assert.match(editorSource, /PASTE_COMMAND/);
  assert.match(editorSource, /DROP_COMMAND/);
  assert.match(editorSource, /retryUpload/);
  assert.match(nodeSource, /imageAltText/);
  assert.match(nodeSource, /onPointerDown=\{startResize\}/);
  assert.doesNotMatch(nodeSource, /data:image\//);
});

console.log(`Editor contract checks passed: ${passed}`);
