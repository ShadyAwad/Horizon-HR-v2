import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateFeedEditorDocument } from '../src/lib/feed-editor-contract';
import {
  createFeedSubmissionController,
  executeFeedSubmission,
  getFeedPublishInteractionState,
  hasValidFeedSubmissionContent,
} from '../src/lib/feed-submission';

const imageId = '53f746a3-77e8-4e33-a7ab-c1178d516bc1';
const richDocument = {
  root: {
    type: 'root',
    version: 1,
    direction: 'rtl',
    children: [
      { type: 'heading', tag: 'h1', version: 1, children: [{ type: 'text', version: 1, text: 'Main heading', format: 1, style: '' }] },
      { type: 'heading', tag: 'h2', version: 1, children: [{ type: 'text', version: 1, text: 'Subheading', format: 0, style: '' }] },
      { type: 'paragraph', version: 1, children: [{ type: 'text', version: 1, text: 'Styled paragraph', format: 8, style: 'color: #34d399; font-size: 16px' }] },
      {
        type: 'list',
        listType: 'bullet',
        tag: 'ul',
        version: 1,
        children: [{ type: 'listitem', version: 1, children: [{ type: 'text', version: 1, text: 'List item', format: 0, style: '' }] }],
      },
      { type: 'quote', version: 1, children: [{ type: 'text', version: 1, text: 'Quoted text', format: 0, style: '' }] },
      {
        type: 'paragraph',
        version: 1,
        children: [{
          type: 'link',
          version: 1,
          url: 'https://stanza.example/policy',
          children: [{ type: 'text', version: 1, text: 'Safe link', format: 0, style: '' }],
        }],
      },
      {
        type: 'image',
        version: 1,
        uploadId: imageId,
        src: `/api/company-feed/images/${imageId}`,
        altText: 'Team workshop',
        width: 640,
        height: 360,
      },
    ],
  },
};
const richText = 'Main heading Subheading Styled paragraph List item Quoted text Safe link Team workshop';

async function run() {
  assert.equal(validateFeedEditorDocument(richDocument, richText).ok, true);

  const readyState = getFeedPublishInteractionState({
    submitting: false,
    imageUploadPending: false,
  });
  assert.equal(hasValidFeedSubmissionContent('Valid title', 'Valid content'), true);
  assert.deepEqual(readyState, {
    disabled: false,
    showSpinner: false,
    cursor: 'pointer',
  });
  console.log('PASS valid content starts enabled and hover does not look busy');

  const validationController = createFeedSubmissionController(() => undefined);
  assert.equal(hasValidFeedSubmissionContent('', 'Valid content'), false);
  assert.equal(validationController.isPending(), false);
  console.log('PASS validation failure leaves submission state unlocked');

  let submitted = 0;
  const pendingChanges: boolean[] = [];
  const successController = createFeedSubmissionController((pending) => pendingChanges.push(pending));
  const successRun = await successController.run(() => executeFeedSubmission<{ id: string }>(async () => {
      submitted += 1;
      return new Response(JSON.stringify({ success: true, post: { id: 'post-1' } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }, {
      fallbackError: 'Unable to publish.',
      timeoutError: 'Publishing timed out.',
    }));
  assert.equal(successRun.started, true);
  if (!successRun.started) throw new Error('Expected submission to start.');
  assert.deepEqual(successRun.result, { ok: true, status: 201, post: { id: 'post-1' } });
  assert.equal(submitted, 1);
  assert.equal(successController.isPending(), false);
  assert.deepEqual(pendingChanges, [true, false]);
  console.log('PASS rich Company Feed document publishes once and settles');

  const rejectedController = createFeedSubmissionController(() => undefined);
  const rejectedRun = await rejectedController.run(() => executeFeedSubmission(async () => new Response(JSON.stringify({
      success: false,
      error: 'contentText does not match the editor document.',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }), {
      fallbackError: 'Unable to publish.',
      timeoutError: 'Publishing timed out.',
    }));
  assert.equal(rejectedRun.started, true);
  if (!rejectedRun.started) throw new Error('Expected rejected submission to start.');
  assert.deepEqual(rejectedRun.result, {
      ok: false,
      status: 400,
      error: 'contentText does not match the editor document.',
  });
  assert.equal(rejectedController.isPending(), false);
  console.log('PASS rejected Company Feed document exposes safe error and settles');

  const fetchFailureController = createFeedSubmissionController(() => undefined);
  const fetchFailureRun = await fetchFailureController.run(() => executeFeedSubmission(async () => {
    throw new TypeError('fetch failed');
  }, {
    fallbackError: 'Unable to publish.',
    timeoutError: 'Publishing timed out.',
  }));
  assert.equal(fetchFailureRun.started, true);
  assert.equal(fetchFailureController.isPending(), false);
  if (!fetchFailureRun.started) throw new Error('Expected failed fetch to start.');
  assert.deepEqual(fetchFailureRun.result, {
    ok: false,
    status: null,
    error: 'Unable to publish.',
  });
  console.log('PASS fetch rejection clears pending state');

  const synchronousFailureController = createFeedSubmissionController(() => undefined);
  await assert.rejects(
    synchronousFailureController.run(() => {
      throw new Error('Synchronous setup failure');
    }),
    /Synchronous setup failure/,
  );
  assert.equal(synchronousFailureController.isPending(), false);
  console.log('PASS synchronous exception clears pending state');

  const timeoutController = createFeedSubmissionController(() => undefined);
  const timeoutRun = await timeoutController.run(() => executeFeedSubmission(
    (signal) => new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
    {
      fallbackError: 'Unable to publish.',
      timeoutError: 'Publishing timed out.',
      timeoutMs: 5,
    },
  ));
  assert.equal(timeoutRun.started, true);
  assert.equal(timeoutController.isPending(), false);
  if (!timeoutRun.started) throw new Error('Expected timed-out submission to start.');
  assert.deepEqual(timeoutRun.result, {
    ok: false,
    status: null,
    error: 'Publishing timed out.',
  });
  console.log('PASS timeout abort clears pending state');

  let releaseFirstRequest = () => undefined;
  const duplicateController = createFeedSubmissionController(() => undefined);
  const firstRun = duplicateController.run(() => new Promise<string>((resolve) => {
    releaseFirstRequest = () => resolve('published');
  }));
  const duplicateRun = await duplicateController.run(async () => 'duplicate');
  assert.deepEqual(duplicateRun, { started: false });
  releaseFirstRequest();
  const completedFirstRun = await firstRun;
  assert.deepEqual(completedFirstRun, { started: true, result: 'published' });
  assert.equal(duplicateController.isPending(), false);
  console.log('PASS double-click starts exactly one request');

  const uploadInProgressState = getFeedPublishInteractionState({
    submitting: false,
    imageUploadPending: true,
  });
  const uploadFailedState = getFeedPublishInteractionState({
    submitting: false,
    imageUploadPending: false,
  });
  assert.deepEqual(uploadInProgressState, {
    disabled: true,
    showSpinner: false,
    cursor: 'progress',
  });
  assert.deepEqual(uploadFailedState, readyState);
  console.log('PASS image-upload failure cannot permanently disable publishing');

  const staleController = createFeedSubmissionController(() => undefined);
  const staleRun = staleController.run((signal) => new Promise<string>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  staleController.dispose();
  await Promise.allSettled([staleRun]);
  const remountedController = createFeedSubmissionController(() => undefined);
  assert.equal(remountedController.isPending(), false);
  assert.deepEqual(getFeedPublishInteractionState({
    submitting: remountedController.isPending(),
    imageUploadPending: false,
  }), readyState);
  console.log('PASS remount starts with a clean submission state');

  const serviceWorkerSource = await readFile(
    new URL('../public/service-worker.js', import.meta.url),
    'utf8',
  );
  assert.match(serviceWorkerSource, /url\.pathname\.startsWith\('\/src\/'\)/);
  assert.match(serviceWorkerSource, /const cachedResponse = await cache\.match\(request\)/);
  assert.doesNotMatch(serviceWorkerSource, /stanza-icon-(?:192|512)\.png/);
  console.log('PASS service worker cannot replay stale Vite source modules');
}

await run();
