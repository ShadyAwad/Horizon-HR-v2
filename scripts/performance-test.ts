import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
const attentionCounts = read('src/hooks/useDashboardAttentionCounts.ts');
const styles = read('src/index.css');
const lanyard = read('src/components/lanyard/Lanyard.tsx');
const dashboardLanyard = read('src/components/lanyard/StanzaDashboardLanyard.tsx');
const serviceWorker = read('public/service-worker.js');
const indexHtml = read('index.html');
const main = read('src/main.tsx');
const viteConfig = read('vite.config.ts');
const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  icons: Array<{ src: string; type: string; sizes: string }>;
};
const lanyardFrameBody = lanyard.slice(
  lanyard.indexOf('useFrame((state, delta) => {'),
  lanyard.indexOf("curve.curveType = 'centripetal';"),
);

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
check('tutorial inputs are memoized outside JSX', dashboard.includes('const tutorialContext = useMemo') && dashboard.includes('context={tutorialContext}') && !dashboard.includes('context={{'));
check('dashboard heavy modules retain lazy boundaries', [
  'HiringPanel',
  'OrganisationPanel',
  'ExpensesPanel',
  'RichTextEditor',
  'StanzaDashboardLanyard',
].every((name) => dashboard.includes(`const ${name} = lazy`)));
check('collapsed Settings sections defer their content trees until expansion', dashboard.includes('renderContent: () => ReactNode') && dashboard.includes('isOpen && <div className="stanza-accordion-content pb-3 pt-1">{renderContent()}</div>'));
check('Dashboard conditionally mounts major feature panels instead of CSS-hiding them', [
  "{activeTab === 'hiring' && canViewHiring && (",
  "{activeTab === 'performance' && canViewPerformance && (",
  "{activeTab === 'organisation' && canViewOrganisation && (",
  "{activeTab === 'assets' && canViewAssets && (",
  "{activeTab === 'roster' && (",
].every((pattern) => dashboard.includes(pattern)));
check('attention-count polling does not rerender Dashboard for identical results', attentionCounts.includes('function areCountsEqual') && attentionCounts.includes('areCountsEqual(current, nextCounts) ? current : nextCounts'));
check('attention-count polling pauses while the document is hidden', attentionCounts.includes("document.visibilityState === 'visible'") && attentionCounts.includes("window.clearInterval(intervalId)"));
check('shared Dashboard interactions use lightweight property transitions', styles.includes('transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease, transform 110ms ease, opacity 140ms ease'));
check('Settings lazy mounting retains a short compositor-safe entry transition', dashboard.includes('stanza-accordion-content') && styles.includes('@keyframes stanza-accordion-enter'));
check('Dashboard local entry transitions do not eagerly load Motion', !dashboard.includes("from 'motion/react'") && dashboard.includes('stanza-workspace-enter') && dashboard.includes('stanza-state-enter'));
check('interaction polish respects reduced motion', styles.includes('.stanza-accordion-content { animation: none; }') && styles.includes('.stanza-workspace-enter,') && styles.includes('transition-duration: 1ms'));
check('MapLibre manual chunk does not capture entry dependencies', viteConfig.includes('onlyExplicitManualChunks: true'));
check('lanyard uses one demand-driven Canvas', (lanyard.match(/<Canvas/g) || []).length === 1 && lanyard.includes('frameloop="demand"'));
check('lanyard caps device pixel ratio', lanyard.includes('dpr={1}'));
check('lanyard uses a settled-scene scheduler with visibility cleanup',
lanyard.includes("document.visibilityState !== 'visible'") &&
lanyard.includes("requestedTier === 'settled'") &&
lanyard.includes('window.clearTimeout(frameTimer)'));
check('lanyard reserves high-rate frames for interaction and settling',
lanyard.includes("? 'active'") &&
lanyard.includes(": 'passive'") &&
lanyard.includes("? 'settled'"));
check('lanyard waits for a stable sleep window before stopping frames',
lanyard.includes('SETTLED_STABLE_DURATION_SECONDS') &&
lanyard.includes('settledElapsed.current'));
check('lanyard reports readiness before it can enter the settled frame tier',
lanyard.includes('readyFrames.current >= 2') &&
lanyard.includes("!readyReported.current\n        ? 'active'") &&
lanyard.includes("? 'settled'"));
check('lanyard visibility does not pause its initial demand frames',
!dashboardLanyard.includes('hidden: boolean') &&
!dashboardLanyard.includes('paused={hidden || paused}') &&
dashboardLanyard.includes('paused={paused}'));
const lanyardCapabilitySource = dashboard.slice(dashboard.indexOf('const reducedMotionQuery'), dashboard.indexOf('const shouldMountLanyard'));
check('desktop lanyard capability uses WebGL without browser, CPU, memory, or pointer heuristics',
lanyardCapabilitySource.includes("window.matchMedia('(min-width: 1024px)')") &&
lanyardCapabilitySource.includes("canvas.getContext('webgl2') || canvas.getContext('webgl')") &&
!/(effectiveType|deviceMemory|hardwareConcurrency|pointer: fine|userAgent)/.test(lanyardCapabilitySource));
check('settled lanyard retains its mounted canvas without visual hiding',
lanyard.includes('requestedTier === \'settled\'') &&
!dashboardLanyard.includes('opacity: 0') &&
!dashboardLanyard.includes('display: \'none\'') &&
!dashboardLanyard.includes('visibility: \'hidden\''));
check('lanyard has no permanent interval or per-frame layout read',
!lanyard.includes('window.setInterval') &&
!lanyardFrameBody.includes('getBoundingClientRect'));
check('lanyard does not wake rigid bodies from its frame callback',
!lanyardFrameBody.includes('.wakeUp()'));
check('lanyard has no browser-specific runtime branch',
!/(?:navigator\.userAgent|userAgentData)/.test(lanyard));
check('lanyard frame work does not update React state', !/\b(?:drag|hover|setTexture)\(/.test(lanyardFrameBody));
check('app source has no deprecated Three Clock construction', !read('src/components/lanyard/Lanyard.tsx').includes('new THREE.Clock'));
check('production assets have an explicit 404 boundary', server.includes("app.use('/assets', (_req, res)") && server.includes("send('Asset not found')"));
check('hashed production assets are immutable', server.includes("immutable: true") && server.includes("maxAge: '1y'"));
check('SPA fallback excludes file requests', server.includes('path.extname(req.path)'));
check('CSP-compatible external bootstrap is used', indexHtml.includes('<script src="/stanza-bootstrap.js"></script>') && !/<script>(?![\s\S]*type=["']application\/ld\+json)/.test(indexHtml));
check('service worker refreshes navigation HTML', serviceWorker.includes("fetch(request, { cache: 'no-store' })"));
check('service worker cache version was advanced', serviceWorker.includes('stanza-static-v9') && serviceWorker.includes('stanza-runtime-v9'));
check('manifest icon files exist', manifest.icons.every((icon) => icon.src.startsWith('/icons/') && existsSync(resolve(root, 'public', icon.src.slice(1)))));
check('development unregisters only the Stanza service worker', main.includes("if (!import.meta.env.PROD)") && main.includes('navigator.serviceWorker.getRegistrations()') && main.includes("'/service-worker.js'"));
check('production service worker registration remains production-only', main.includes('import.meta.env.PROD') && main.includes("navigator.serviceWorker.register('/service-worker.js')"));
check('production source has no React development imports', !/react(?:-dom)?\/cjs\/react(?:-dom)?\.development/.test(`${main}\n${viteConfig}`) && !/react-refresh|@vite\/client/.test(main));
check('production build remains minified and source-module free', !/\/(?:src|@vite)\//.test(read('dist/index.html')) && /react\.production\.js/.test(read('dist/assets/' + read('dist/index.html').match(/\/assets\/(index-[^"']+\.js)/)?.[1]!)));
check('production server enables compressible response compression', server.includes("import compression from 'compression'") && server.includes('app.use(compression({'));
check('Settings defers passkey and notification requests until their respective accordions are open', dashboard.includes('controlCenterSections.notifications') && dashboard.includes('controlCenterSections.passkeys') && !dashboard.includes('if (showControlCenter && hasAuthenticatedDashboardUser)'));
check('Settings starts with all heavy accordions collapsed', dashboard.includes('personalization: false') && dashboard.includes('settings: false') && dashboard.includes('passkeys: false') && dashboard.includes('notifications: false'));

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

const liveBaseUrl = process.env.PERFORMANCE_TEST_BASE_URL?.replace(/\/$/, '');
if (liveBaseUrl) {
  const servedHtml = await fetch(`${liveBaseUrl}/`, { headers: { Accept: 'text/html' } });
  assert.equal(servedHtml.status, 200);
  const servedHtmlText = await servedHtml.text();
  assert.doesNotMatch(servedHtmlText, /@vite\/client|@react-refresh|\/src\/main\.tsx|\.tsx(?:["'])/i);
  assert.match(servedHtmlText, /\/assets\/index-[A-Za-z0-9_-]+\.js/);

  const productionHtml = read('dist/index.html');
  const chunkPath = productionHtml.match(/(?:src|href)="(\/assets\/[^"']+\.js)"/)?.[1];
  assert.ok(chunkPath, 'production HTML must reference a generated JavaScript chunk');

  const realChunk = await fetch(`${liveBaseUrl}${chunkPath}`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(realChunk.status, 200);
  assert.match(realChunk.headers.get('content-type') || '', /javascript/);
  assert.match(realChunk.headers.get('content-encoding') || '', /gzip|br/);
  assert.match(realChunk.headers.get('vary') || '', /Accept-Encoding/i);

  const missingChunk = await fetch(`${liveBaseUrl}/assets/missing-performance-contract.js`);
  assert.equal(missingChunk.status, 404);
  assert.doesNotMatch(missingChunk.headers.get('content-type') || '', /text\/html/);

  const applicationRoute = await fetch(`${liveBaseUrl}/performance-contract-route`, {
    headers: { Accept: 'text/html' },
  });
  assert.equal(applicationRoute.status, 200);
  assert.match(applicationRoute.headers.get('content-type') || '', /text\/html/);
  console.log('PASS performance: production static asset and SPA fallback integration');
}
