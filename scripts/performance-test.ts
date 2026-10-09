import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const sourceFiles = (directory: string): string[] => readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
  const path = `${directory}/${entry.name}`;
  return entry.isDirectory() ? sourceFiles(path) : [path];
});
const checks: Array<[string, boolean]> = [];
const check = (name: string, value: boolean) => checks.push([name, value]);

const migration = read('src/db/migrations/20260725_add_performance_management.sql');
const routes = read('src/server/performance/performance-routes.ts');
const delivery = read('src/server/performance/recognition-delivery.ts');
const server = read('server.ts');
const attendanceRoutes = read('src/server/attendance/attendance-routes.ts');
const dashboard = read('src/pages/Dashboard.tsx');
const app = read('src/App.tsx');
const navigation = read('src/components/navigation/DashboardNavigation.tsx');
const attentionCounts = read('src/hooks/useDashboardAttentionCounts.ts');
const languageContext = read('src/lib/LanguageContext.tsx');
const renderDiagnostics = read('src/lib/render-diagnostics.ts');
const devPerformance = read('src/lib/dev-performance.ts');
const styles = read('src/index.css');
const lanyard = read('src/components/lanyard/Lanyard.tsx');
const dashboardLanyard = read('src/components/lanyard/StanzaDashboardLanyard.tsx');
const lanyardAssetExperiment = read('scripts/lanyard-asset-experiment.mjs');
const lanyardAssetReport = JSON.parse(read('src/components/lanyard/candidates/asset-report.json')) as {
  production: { bytes: number; sha256: string };
  candidates: Array<{
    path: string;
    bytes: number;
    sha256: string;
    extensionsRequired: string[];
    images: Array<{ mimeType: string; width: number; height: number }>;
    contract: {
      requiredNodes: Record<string, { present: boolean; transformMatches: boolean; meshPresent: boolean }>;
      requiredMaterials: Record<string, boolean>;
      nodeCountMatches: boolean;
      meshCountMatches: boolean;
      materialCountMatches: boolean;
      primitiveCountMatches: boolean;
      triangleCountMatches: boolean;
    };
    decodedGeometry: Record<string, {
      attributesMatch: boolean;
      topologyMatches: boolean;
      maxAbsoluteDifference: number;
    }>;
  }>;
};
const promotedLanyardCandidate = lanyardAssetReport.candidates.find((candidate) => candidate.path.endsWith('card.meshopt-webp-1024.glb'));
const liveLanyardAssetPath = resolve(root, 'src/components/lanyard/card.glb');
const originalLanyardAssetPath = resolve(root, 'src/components/lanyard/card.original.glb');
const hashFile = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const builtGlbAssets = readdirSync(resolve(root, 'dist/assets')).filter((file) => file.endsWith('.glb'));
const serviceWorker = read('public/service-worker.js');
const indexHtml = read('index.html');
const main = read('src/main.tsx');
const viteConfig = read('vite.config.ts');
const performanceIsolation = read('src/components/dev/PerformanceIsolationPanel.tsx');
const performanceIsolationStyles = read('src/components/dev/performance-isolation.css');
const guidedChromeBenchmark = read('src/components/dev/GuidedChromeBenchmark.tsx');
const loginFlickerBenchmark = read('src/components/dev/LoginFlickerBenchmark.tsx');
const loginFlickerStyles = read('src/components/dev/login-flicker-benchmark.css');
const login = read('src/pages/Login.tsx');
const interactionMicrobenchmark = read('src/components/dev/InteractionMicrobenchmark.tsx');
const performanceIsolationState = read('src/lib/performance-isolation.ts');
const frontendSourceFiles = sourceFiles('src').filter((path) => /\.(?:css|ts|tsx)$/.test(path));
const frontendAnimationSources = frontendSourceFiles
  .map((path) => ({ path, source: read(path) }))
  .filter(({ source }) => /animate-(?:pulse|spin|bounce)|animation\s*:[^;{}]*\binfinite\b/.test(source));
const pulseSourceFiles = frontendAnimationSources.filter(({ source }) => source.includes('animate-pulse')).map(({ path }) => path);
const spinnerSourceFiles = frontendAnimationSources.filter(({ source }) => /animate-spin(?:-slow)?/.test(source)).map(({ path }) => path);
const permittedPulseFiles = new Set([
  'src/pages/Dashboard.tsx',
  'src/pages/PublicAssetVerification.tsx',
  'src/pages/PublicEmployeeVerification.tsx',
  'src/components/qr/DigitalBadgePanel.tsx',
  'src/components/live-employees/LiveEmployeesPanel.tsx',
  'src/components/hiring/HiringPanel.tsx',
  'src/components/locations/LocationsPanel.tsx',
]);
const permittedSpinnerFiles = new Set([
  'src/pages/Dashboard.tsx',
  'src/components/audit/AuditTrailPanel.tsx',
  'src/components/assets/AssetFormDialog.tsx',
  'src/components/assets/AssetLabelExtraction.tsx',
  'src/components/assets/AssetQrLabelPanel.tsx',
  'src/components/assets/AssetsPanel.tsx',
  'src/components/assets/MyEquipmentPanel.tsx',
  'src/components/expenses/ExpensesPanel.tsx',
  'src/components/hiring/CandidateDocumentExtraction.tsx',
  'src/components/hiring/HiringPanel.tsx',
  'src/components/live-employees/LiveEmployeesPanel.tsx',
  'src/components/organisation/OrganisationPanel.tsx',
  'src/components/performance/PerformancePanel.tsx',
  'src/components/qr/DigitalBadgePanel.tsx',
  'src/components/roster/LeaveWorkspace.tsx',
  'src/components/roster/RosterGoalsPanel.tsx',
  'src/components/sessions/SessionCenterPanel.tsx',
  'src/components/sessions/SessionManagementPanel.tsx',
]);
const interactionStyles = styles.slice(
  styles.indexOf('/* Shared interaction states'),
  styles.indexOf('.stanza-settings-overlay'),
);
const builtJavaScript = readdirSync(resolve(root, 'dist/assets'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => read(`dist/assets/${file}`))
  .join('\n');
const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  icons: Array<{ src: string; type: string; sizes: string }>;
};
const lanyardFrameBody = lanyard.slice(
  lanyard.indexOf('useFrame((state, delta) => {'),
  lanyard.indexOf("curve.curveType = 'centripetal';"),
);
const settingsDrawerMarkup = dashboard.slice(
  dashboard.indexOf('stanza-control-center-panel stanza-settings-drawer'),
  dashboard.indexOf('stanza-control-center-panel stanza-settings-drawer') + 900,
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
check('recognition failures do not block clock-in', attendanceRoutes.includes('Clock-in delivery lookup failed'));
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
check('attention refresh is visibility-gated, removes listeners and has no polling interval', attentionCounts.includes("document.visibilityState === 'visible'") && attentionCounts.includes("removeEventListener('visibilitychange'") && !attentionCounts.includes('setInterval('));
check('idle attendance readiness indicator is static rather than an infinite compositor animation',
  dashboard.includes('bg-emerald-500/60 ring-2 ring-emerald-500/15') &&
  !dashboard.includes('bg-emerald-500/60 animate-pulse'));
check('CSS infinite animation is restricted to the authentication loading fingerprint',
  (styles.match(/animation\s*:[^;{}]*\binfinite\b/g) || []).length === 2 &&
  styles.includes('.stanza-fingerprint-loader-loading') &&
  styles.includes('.stanza-fingerprint-groove'));
check('signed-in pulse animations remain confined to explicit loading and attendance-transition surfaces',
  pulseSourceFiles.every((path) => permittedPulseFiles.has(path)) &&
  dashboard.split(/\r?\n/).filter((line) => line.includes('animate-pulse')).every((line) => (
    line.includes('Suspense fallback=') ||
    line.includes("clockInState === 'success'") ||
    line.includes("clockInState === 'locating' || clockInState === 'verifying'")
  )));
check('spinner animations remain confined to request, extraction, refresh, and attendance progress components',
  spinnerSourceFiles.every((path) => permittedSpinnerFiles.has(path)));
check('signed-in frontend has no bounce animation', !frontendAnimationSources.some(({ source }) => source.includes('animate-bounce')));
check('shared Dashboard interactions use lightweight property transitions', styles.includes('transition: background-color var(--stanza-interaction-normal) ease, border-color var(--stanza-interaction-normal) ease, color var(--stanza-interaction-normal) ease, box-shadow var(--stanza-interaction-normal) ease, transform var(--stanza-interaction-fast) ease, opacity var(--stanza-interaction-normal) ease'));
check('shared hover styling preserves selected and active controls',
  interactionStyles.includes('@media (hover: hover) and (pointer: fine)') &&
  interactionStyles.includes(':not([data-selected="true"]):not([aria-current="page"]):not([aria-selected="true"]):not([aria-pressed="true"]):not([aria-checked="true"])') &&
  styles.includes('[role="radio"][aria-checked="true"]') &&
  interactionStyles.includes('background-color: var(--stanza-surface-selected);') &&
  interactionStyles.includes('color-mix(in srgb, var(--stanza-surface-selected) 82%, var(--stanza-accent) 18%)') &&
  !interactionStyles.includes('!important'));
check('interaction state system covers press, focus, disabled, destructive, and semantic tab controls',
  interactionStyles.includes('transform: scale(.98)') &&
  interactionStyles.includes('outline: 2px solid var(--stanza-focus-ring)') &&
  interactionStyles.includes('cursor: not-allowed') &&
  interactionStyles.includes('.stanza-destructive-action:not(:disabled):hover') &&
  interactionStyles.includes('[role="tab"]'));
check('physical toggle tracks retain token-owned on/off colors without fighting selected-card hover',
  interactionStyles.includes('.stanza-toggle-track[aria-checked="true"]') &&
  interactionStyles.includes('background-color: var(--stanza-control-selected);') &&
  interactionStyles.includes(':not(.stanza-toggle-track):hover'));
check('interaction transitions never use transition all', !/transition\s*:\s*all/i.test(interactionStyles));
check('Settings lazy mounting retains a short compositor-safe entry transition', dashboard.includes('stanza-accordion-content') && styles.includes('@keyframes stanza-accordion-enter'));
check('Dashboard local entry transitions do not eagerly load Motion', !dashboard.includes("from 'motion/react'") && dashboard.includes('stanza-workspace-enter') && dashboard.includes('stanza-state-enter'));
check('interaction polish respects reduced motion', styles.includes('.stanza-accordion-content { animation: none; }') && styles.includes('.stanza-workspace-enter,') && styles.includes('transition-duration: 1ms'));
check('MapLibre manual chunk does not capture entry dependencies', viteConfig.includes('onlyExplicitManualChunks: true'));
check('lanyard uses one explicitly advanced Canvas', (lanyard.match(/<Canvas/g) || []).length === 1 && lanyard.includes('frameloop="never"'));
check('live lanyard imports the promoted production GLB without candidate branching',
  lanyard.includes("import cardGLB from './card.glb'") &&
  !lanyard.includes('card.meshopt-webp') &&
  !lanyard.includes('card.original.glb'));
check('preserved original and promoted production asset have explicit provenance',
  existsSync(originalLanyardAssetPath) &&
  statSync(originalLanyardAssetPath).size === lanyardAssetReport.production.bytes &&
  hashFile(originalLanyardAssetPath) === lanyardAssetReport.production.sha256 &&
  Boolean(promotedLanyardCandidate) &&
  statSync(liveLanyardAssetPath).size === promotedLanyardCandidate?.bytes &&
  hashFile(liveLanyardAssetPath) === promotedLanyardCandidate?.sha256);
check('validated candidate contract preserves the production runtime graph and decoded geometry',
  lanyardAssetReport.candidates.length === 3 &&
  lanyardAssetReport.candidates.every((candidate) => (
    ['card', 'clip', 'clamp'].every((name) => (
      candidate.contract.requiredNodes[name]?.present &&
      candidate.contract.requiredNodes[name]?.meshPresent &&
      candidate.contract.requiredNodes[name]?.transformMatches
    )) &&
    ['base', 'metal'].every((name) => candidate.contract.requiredMaterials[name]) &&
    candidate.contract.nodeCountMatches &&
    candidate.contract.meshCountMatches &&
    candidate.contract.materialCountMatches &&
    candidate.contract.primitiveCountMatches &&
    candidate.contract.triangleCountMatches &&
    Object.values(candidate.decodedGeometry).every((geometry) => (
      geometry.attributesMatch && geometry.topologyMatches && geometry.maxAbsoluteDifference === 0
    ))
  )));
check('asset provenance records the requested WebP resolution ladder and transfer reduction',
  lanyardAssetReport.candidates.map((candidate) => [candidate.images[0]?.width, candidate.images[0]?.height])
    .every(([width, height], index) => (
      [[1678, 1677], [1280, 1279], [1024, 1023]][index]?.[0] === width &&
      [[1678, 1677], [1280, 1279], [1024, 1023]][index]?.[1] === height
  )) &&
  lanyardAssetReport.candidates.every((candidate) => (
    candidate.images.length === 1 &&
    candidate.images[0]?.mimeType === 'image/webp' &&
    candidate.extensionsRequired.includes('EXT_meshopt_compression') &&
    candidate.extensionsRequired.includes('EXT_texture_webp') &&
    candidate.bytes < lanyardAssetReport.production.bytes * 0.2
  )));
check('asset experiment avoids graph-destructive and geometry-quantizing transforms',
  !lanyardAssetExperiment.includes('@gltf-transform/functions') &&
  !lanyardAssetExperiment.includes('.transform('));
check('temporary lanyard comparison UI is removed from the application source',
  !existsSync(resolve(root, 'src/components/dev/LanyardAssetComparison.tsx')) &&
  !read('src/App.tsx').includes('LanyardAssetComparison'));
check('lanyard caps device pixel ratio', lanyard.includes('dpr={import.meta.env.DEV ? experiment.dpr : 1}'));
check('lanyard uses a settled-scene scheduler with visibility cleanup',
lanyard.includes("document.visibilityState !== 'visible'") &&
read('src/components/lanyard/lanyard-frame-scheduler.ts').includes("tier === 'settled'") &&
read('src/components/lanyard/lanyard-frame-scheduler.ts').includes('host.clearTimeout(timer)'));
check('lanyard reserves high-rate frames for interaction and settling',
lanyard.includes("? 'active'") &&
lanyard.includes(": 'passive'") &&
lanyard.includes("? 'settled'"));
check('lanyard waits for a stable sleep window before stopping frames',
lanyard.includes('SETTLED_STABLE_DURATION_SECONDS') &&
lanyard.includes('settledElapsed.current'));
check('lanyard reports readiness before it can enter the settled frame tier',
lanyard.includes('readyFrames.current >= 2') &&
/!readyReported\.current\s*\? 'active'/.test(lanyard) &&
lanyard.includes("? 'settled'"));
check('lanyard visibility does not pause its initial demand frames',
!dashboardLanyard.includes('hidden: boolean') &&
!dashboardLanyard.includes('paused={hidden || paused}') &&
dashboardLanyard.includes('paused={paused || expanded}'));
const lanyardCapabilitySource = dashboard.slice(dashboard.indexOf('const reducedMotionQuery'), dashboard.indexOf('const shouldMountLanyard'));
check('desktop lanyard capability uses WebGL without browser, CPU, memory, or pointer heuristics',
lanyardCapabilitySource.includes("window.matchMedia('(min-width: 1024px)')") &&
lanyardCapabilitySource.includes("canvas.getContext('webgl2') || canvas.getContext('webgl')") &&
!/(effectiveType|deviceMemory|hardwareConcurrency|pointer: fine|userAgent)/.test(lanyardCapabilitySource));
check('settled lanyard retains its mounted canvas without visual hiding',
read('src/components/lanyard/lanyard-frame-scheduler.ts').includes("tier === 'settled'") &&
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
const staticCacheVersion = Number(serviceWorker.match(/stanza-static-v(\d+)/)?.[1]);
const runtimeCacheVersion = Number(serviceWorker.match(/stanza-runtime-v(\d+)/)?.[1]);
check('service worker cache version was advanced', staticCacheVersion >= 9 && runtimeCacheVersion === staticCacheVersion);
check('manifest icon files exist', manifest.icons.every((icon) => icon.src.startsWith('/icons/') && existsSync(resolve(root, 'public', icon.src.slice(1)))));
check('development unregisters only the Stanza service worker', main.includes("if (!import.meta.env.PROD)") && main.includes('navigator.serviceWorker.getRegistrations()') && main.includes("'/service-worker.js'"));
check('production service worker registration remains production-only', main.includes('import.meta.env.PROD') && main.includes("navigator.serviceWorker.register('/service-worker.js')"));
check('production source has no React development imports', !/react(?:-dom)?\/cjs\/react(?:-dom)?\.development/.test(`${main}\n${viteConfig}`) && !/react-refresh|@vite\/client/.test(main));
check('production build remains minified and source-module free', !/\/(?:src|@vite)\//.test(read('dist/index.html')) && /react\.production\.js/.test(read('dist/assets/' + read('dist/index.html').match(/\/assets\/(index-[^"']+\.js)/)?.[1]!)));
check('production server enables compressible response compression', server.includes("import compression from 'compression'") && server.includes('app.use(compression({'));
check('Settings accordion expansion is locally owned instead of rerendering Dashboard root',
  dashboard.includes('function ControlCenterAccordion(') &&
  dashboard.includes('const [isOpen, setIsOpen] = useState(false);') &&
  !dashboard.includes('controlCenterSections'));
check('Settings defers passkey and notification requests until their respective accordions are opened',
  dashboard.includes('if (hasAuthenticatedDashboardUser) void loadPasskeys(false);') &&
  dashboard.includes('if (hasAuthenticatedDashboardUser) void loadNotificationSettings(false);') &&
  !dashboard.includes('if (showControlCenter && hasAuthenticatedDashboardUser)'));
check('Settings heavy accordion content starts collapsed and remains lazily mounted',
  dashboard.includes('const [isOpen, setIsOpen] = useState(false);') &&
  dashboard.includes('isOpen && <div className="stanza-accordion-content pb-3 pt-1">{renderContent()}</div>'));
check('Settings backdrop uses cheap static dimming without blur filters',
  styles.includes('.stanza-modal-backdrop {\n  background-color: rgb(0 0 0 / 0.52);\n}') &&
  !styles.includes('.stanza-modal-backdrop {\n  background-color: rgb(0 0 0 / 0.35);\n  -webkit-backdrop-filter') &&
  !styles.includes('.stanza-modal-backdrop {\n  background-color: rgb(0 0 0 / 0.35);\n  backdrop-filter'));
check('Settings drawer remains a themed opaque surface without Tailwind blur',
  dashboard.includes('stanza-control-center-panel stanza-settings-drawer') &&
  !settingsDrawerMarkup.includes('backdrop-blur') &&
  styles.includes('.stanza-settings-drawer {\n  background-color: var(--stanza-surface-panel) !important;') &&
  styles.includes('-webkit-backdrop-filter: none;') && styles.includes('backdrop-filter: none;'));
check('Settings keeps one primary drawer scroll container without scroll-driven Dashboard state',
  (settingsDrawerMarkup.match(/overflow-y-auto/g) || []).length === 1 &&
  settingsDrawerMarkup.includes('overscroll-contain') &&
  !settingsDrawerMarkup.includes('onScroll='));
check('mobile Settings inherits the no-filter backdrop policy without user-agent branching',
  !styles.includes('@media (max-width: 767px) {\n  .stanza-modal-backdrop') &&
  !/(?:navigator\.userAgent|userAgentData)/.test(`${dashboard}\n${styles}`));
check('Settings pauses the already-mounted lanyard scheduler without changing readiness eligibility',
  dashboard.includes('const isLanyardSchedulerPaused = !isDashboardVisible || showControlCenter;') &&
  dashboard.includes('paused={isLanyardSchedulerPaused}') &&
  dashboard.includes('shouldMountLanyard && isLanyardIdleReady && lanyardAnchorNdc') &&
  !dashboard.includes('shouldMountLanyard && !showControlCenter'));
check('Settings lanyard pause keeps the explicitly scheduled canvas mounted without a permanent animation loop',
  lanyard.includes('frameloop="never"') &&
  lanyard.includes('schedulerRef.current?.setPaused(blocked)') &&
  !lanyard.includes('window.setInterval') &&
  !dashboardLanyard.includes('opacity: 0'));
check('performance isolation diagnostics are dev-only and lazy', dashboard.includes('import.meta.env.DEV ? lazy(() => import(\'../components/dev/PerformanceIsolationPanel\')) : null'));
check('development render diagnostics cover shell boundaries without adding a timer',
  ['Dashboard', 'Settings', 'Navigation', 'ActiveModule', 'TutorialProvider'].every((name) => renderDiagnostics.includes(`'${name}'`)) &&
  renderDiagnostics.includes('resetDevRenderDiagnostics') &&
  !/(?:setInterval|setTimeout|requestAnimationFrame)/.test(renderDiagnostics));
check('development render diagnostics are absent from every production JavaScript chunk',
  !builtJavaScript.includes('__STANZA_RENDER_DIAGNOSTICS__') &&
  !builtJavaScript.includes('__STANZA_PERFORMANCE_DIAGNOSTICS__') &&
  !builtJavaScript.includes('Performance isolation (DEV)'));
check('visual isolation controls stay development-only and default to normal presentation',
  ['atmosphericGlows', 'cssFilters', 'backdropFilters', 'largeShadows', 'hoverTransforms', 'pressedTransforms', 'translucentNavigationSurfaces', 'tutorialEffects', 'decorativeGradients'].every((key) => performanceIsolationState.includes(`${key}: true`)) &&
  performanceIsolation.includes('MINIMAL COMPOSITOR') &&
  performanceIsolation.includes('NO TRANSFORMS') &&
  performanceIsolationStyles.includes('data-stanza-perf-no-pressed-transforms') &&
  performanceIsolationStyles.includes('data-stanza-perf-opaque-navigation') &&
  !styles.includes('data-stanza-perf-no-pressed-transforms') &&
  !builtJavaScript.includes('data-stanza-perf-no-pressed-transforms'));
check('guided Chrome benchmark contains the eight requested transient visual modes',
  ['NORMAL', 'NO ATMOSPHERE', 'NO TOPOGRAPHY', 'NO BACKDROP FILTERS', 'OPAQUE SHELL', 'NO TRANSFORMS', 'NO LANYARD', 'MINIMAL COMPOSITOR'].every((mode) => guidedChromeBenchmark.includes(`label: '${mode}'`)) &&
  guidedChromeBenchmark.includes('Run button-only benchmark') &&
  guidedChromeBenchmark.includes('defaultPerformanceIsolation') &&
  guidedChromeBenchmark.includes('onApplyIsolation(baselineRef.current)'));
check('guided benchmark uses bounded capture observers and never persists diagnostic choices',
  guidedChromeBenchmark.includes('beginDevGuidedBenchmarkCapture') &&
  guidedChromeBenchmark.includes('finishDevGuidedBenchmarkCapture') &&
  guidedChromeBenchmark.includes('cancelDevGuidedBenchmarkCapture') &&
  guidedChromeBenchmark.includes('window.clearTimeout(timer)') &&
  devPerformance.includes('cancelDevGuidedBenchmarkCapture') &&
  devPerformance.includes('mutations.disconnect()') &&
  !guidedChromeBenchmark.includes('localStorage') &&
  !guidedChromeBenchmark.includes('sessionStorage'));
check('login flicker benchmark compares the requested transition modes only in development',
  login.includes('const LoginFlickerBenchmark = import.meta.env.DEV') &&
  ['CURRENT ANIMATION', 'NO ANIMATION', 'NO GRID TRANSITION', 'NO OPACITY TRANSITION'].every((mode) => loginFlickerBenchmark.includes(`label: '${mode}'`)) &&
  loginFlickerBenchmark.includes('twoFramePaintMs') &&
  loginFlickerBenchmark.includes('flicker') &&
  loginFlickerStyles.includes('data-stanza-login-benchmark'));
check('benchmark UI and its observers are absent from production bundles',
  !builtJavaScript.includes('Guided Chrome A/B benchmark') &&
  !builtJavaScript.includes('Login flicker benchmark') &&
  !builtJavaScript.includes('lanyardTotals') &&
  !builtJavaScript.includes('stanza-lanyard-quality') &&
  !builtJavaScript.includes('Start lanyard capture') &&
  !builtJavaScript.includes('Copy lanyard comparison') &&
  !builtJavaScript.includes('manual-lanyard:') &&
  !builtJavaScript.includes('Opaque WebGL2 diagnostic context unavailable') &&
  !builtJavaScript.includes('stanza-gpu-experiment') &&
  !builtJavaScript.includes('Inspect actual context and ancestors') &&
  !builtJavaScript.includes('VERY LIGHT 30/15') &&
  !builtJavaScript.includes('Geo surface experiment') &&
  !builtJavaScript.includes('Capture real Geo control styles') &&
  !builtJavaScript.includes('guided-benchmark:capture-start'));
check('interaction microbenchmark is development-only and has no background scheduler',
  app.includes('const InteractionMicrobenchmark = import.meta.env.DEV') &&
  performanceIsolation.includes('Open interaction lab') &&
  interactionMicrobenchmark.includes('Dense opaque baseline') &&
  interactionMicrobenchmark.includes('recordDevInteraction') &&
  !/(?:setInterval|setTimeout|requestAnimationFrame)/.test(interactionMicrobenchmark) &&
  !builtJavaScript.includes('Interaction microbenchmark'));
check('production bundle ships only the promoted lanyard asset, not the original or lab candidates',
  builtGlbAssets.length === 1 &&
  statSync(resolve(root, 'dist/assets', builtGlbAssets[0]!)).size === promotedLanyardCandidate?.bytes &&
  !builtJavaScript.includes('Lanyard asset comparison') &&
  !builtJavaScript.includes('card.meshopt-webp-original') &&
  !builtJavaScript.includes('card.meshopt-webp-1280') &&
  !builtJavaScript.includes('card.meshopt-webp-1024'));
check('development performance diagnostics cover startup, lazy modules, interactions, and settle snapshots',
  devPerformance.includes('performance.mark') &&
  devPerformance.includes('performance.measure') &&
  devPerformance.includes('interaction-settle') &&
  devPerformance.includes('runningAnimations') &&
  devPerformance.includes('renderDelta') &&
  devPerformance.includes('resourceDelta') &&
  dashboard.includes('startup:dashboard-mounted') &&
  dashboard.includes('startup:navigation-registry-ready') &&
  dashboard.includes('startup:lanyard-dynamic-import') &&
  attentionCounts.includes('startup:attention-count-request') &&
  main.includes('startup:service-worker-initialization'));
check('performance markers are development-only and do not install a permanent scheduler',
  devPerformance.includes('if (!import.meta.env.DEV') &&
  !devPerformance.includes('setInterval') &&
  !devPerformance.includes('requestAnimationFrame =') &&
  !devPerformance.includes('cancelAnimationFrame =') &&
  devPerformance.includes('}, 2000);'));
check('optional lanyard idle scheduling terminates and keeps one dynamic import',
  (dashboard.match(/startup:lanyard-dynamic-import/g) || []).length === 1 &&
  dashboard.includes('cancelIdleCallback?.(idleHandle)') &&
  dashboard.includes('window.clearTimeout(timeoutHandle)'));
check('representative lazy module boundaries remain measured and lazy',
  ['hiring', 'organisation', 'locations', 'expenses', 'help-center'].every((module) => dashboard.includes(`lazy-module:${module}:import`)) &&
  !dashboard.includes('import { HiringPanel }') &&
  !dashboard.includes('import { OrganisationPanel }'));
check('lanyard lifecycle diagnostics report resource, first frame, and settled tier without React state',
  lanyard.includes('startup:lanyard-glb-request') &&
  lanyard.includes('startup:lanyard-glb-parse-decode-complete') &&
  lanyard.includes('startup:lanyard-first-frame') &&
  lanyard.includes('startup:lanyard-settled') &&
  lanyard.includes('setDevLanyardFrameTier(schedulerRef.current?.snapshot().paused'));
check('performance diagnostics use session-only state', performanceIsolationState.includes('sessionStorage') === false && performanceIsolationState.includes('PERFORMANCE_ISOLATION_STORAGE_KEY') && dashboard.includes('window.sessionStorage.setItem') && !performanceIsolation.includes('localStorage'));
check('performance diagnostics have no closed-panel background timer', !performanceIsolation.includes('setInterval') && performanceIsolation.includes('if (!open) return') && performanceIsolation.includes('cancelAnimationFrame'));
check('visual isolation uses root attributes without animation or application-state loops',
  dashboard.includes("'data-stanza-perf-no-pressed-transforms'") &&
  dashboard.includes('if (!import.meta.env.DEV) return;') &&
  !performanceIsolation.includes('setInterval') &&
  !performanceIsolation.includes('setTimeout'));
check('performance sampler stops after ten seconds', performanceIsolation.includes('now - start >= 10000') && performanceIsolation.includes('raf.current = undefined'));
check('development interaction benchmark is explicitly armed and remains development-only',
  devPerformance.includes('export function armDevInteractionBenchmark') &&
  devPerformance.includes("if (!import.meta.env.DEV || typeof window === 'undefined') return;") &&
  performanceIsolation.includes('Arm next action') &&
  performanceIsolation.includes('interactionScenarios'));
check('interaction diagnostics bound observers and frame sampling to the short settle window',
  devPerformance.includes('const isBenchmarkSample = Boolean(benchmark);') &&
  devPerformance.includes('isBenchmarkSample ? collectInteractionWindow(start) : null') &&
  devPerformance.includes('windowMetrics?.finish()') &&
  devPerformance.includes('cancelAnimationFrame(frameHandle)') &&
  devPerformance.includes('mutations.disconnect()'));
check('interaction diagnostics record browser work categories without a persistent application loop',
  devPerformance.includes("observeEntries('longtask'") &&
  devPerformance.includes("observeEntries('event'") &&
  devPerformance.includes('domMutationCount') &&
  devPerformance.includes('heapDeltaBytes') &&
  !devPerformance.includes('setInterval('));
check('lanyard isolation removes its mount condition without changing saved preferences', dashboard.includes('lanyardEnabled && performanceIsolation.lanyard') && !dashboard.includes('setLanyardEnabled(false)'));
check('atmosphere isolation gates only atmosphere and topography layers', dashboard.includes('performanceIsolation.atmosphere') && dashboard.includes('performanceIsolation.topography'));
check('disabled tutorials unmount their provider instead of retaining idle eligibility work', dashboard.includes('{tutorialsEnabled && performanceIsolation.tutorials && <TutorialProvider'));
check('tutorial eligibility remains stable across active-item and attention-badge changes', dashboard.includes("const tutorialAvailableModulesKey = navigationItems.map((item) => item.id).join('|');") && dashboard.includes('[isLanyardCapable, isMobileNavigationLayout, lanyardEnabled, tutorialAvailableModulesKey, user.permissions]'));
check('mobile dashboard removes oversized filtered glows while preserving its base atmosphere', styles.includes('.stanza-light-glow-top,') && styles.includes('.stanza-dark-glow-soft') && styles.includes('display: none !important;') && !styles.includes('.stanza-light-atmosphere,\n    .stanza-light-glow-top'));
check('mobile opaque workspace chrome does not retain backdrop sampling', styles.includes('.stanza-navigation-shell,\n    .dashboard-workspace-content') && styles.includes('-webkit-backdrop-filter: none !important;'));
check('retired contextual tabs are absent from the live DOM', dashboard.includes('{false && <div className="hidden">'));
check('desktop Launcher mode does not retain the CSS-hidden mobile navigation tree', read('src/components/navigation/DashboardNavigation.tsx').includes("desktopMode === 'rail' || (isMobileLayout && showMobileNavigation)"));
check('launcher open state remains local to Navigation and is not mirrored through Dashboard',
  navigation.includes('const [open, setOpenState] = useState(false);') &&
  navigation.includes("recordDevInteraction(name, () => setOpenState(next))") &&
  !navigation.includes('onOpenChange') &&
  !dashboard.includes('isNavigationOpen'));
check('language provider stabilizes its high-fan-out context value',
  languageContext.includes('const t = useCallback(') &&
  languageContext.includes('const value = useMemo<LanguageContextType>') &&
  languageContext.includes('<LanguageContext.Provider value={value}>'));

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
