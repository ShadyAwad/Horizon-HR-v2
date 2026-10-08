import ts from 'typescript';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HELP_ARTICLES } from '../src/components/tutorials/help-registry';
import { tutorialRegistry } from '../src/components/tutorials/tutorial-registry';
import { WORKSPACE_REGISTRY } from '../src/navigation/workspace-registry';

const root = process.cwd();
const sourceRoot = path.join(root, 'src');
let passed = 0;

function check(name: string, assertion: () => void) {
  assertion();
  passed += 1;
  console.log(`PASS ${name}`);
}

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

const sourceFiles = walk(sourceRoot).filter((file) => /\.(?:ts|tsx)$/.test(file));
const sourceFileSet = new Set(sourceFiles.map((file) => path.normalize(file)));

function resolveImport(importer: string, specifier: string) {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  return candidates.find((candidate) => sourceFileSet.has(path.normalize(candidate)));
}

const importGraph = new Map<string, string[]>();
for (const file of sourceFiles) {
  const dependencies: string[] = [];
  const parsed=ts.createSourceFile(file,read(path.relative(root,file)),ts.ScriptTarget.Latest,true);
  for (const statement of parsed.statements) {
    if(!ts.isImportDeclaration(statement)&&!ts.isExportDeclaration(statement))continue;
    if(!statement.moduleSpecifier||!ts.isStringLiteral(statement.moduleSpecifier))continue;
    if(ts.isImportDeclaration(statement)&&statement.importClause?.isTypeOnly)continue;
    if(ts.isExportDeclaration(statement)&&statement.isTypeOnly)continue;
    const resolved = resolveImport(file, statement.moduleSpecifier.text);
    if (resolved) dependencies.push(path.normalize(resolved));
  }
  importGraph.set(path.normalize(file), dependencies);
}

function findImportCycles() {
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];

  const visit = (file: string) => {
    state.set(file, 'visiting');
    stack.push(file);
    for (const dependency of importGraph.get(file) || []) {
      if (state.get(dependency) === 'visiting') {
        const start = stack.indexOf(dependency);
        cycles.push(stack.slice(start).concat(dependency));
      } else if (!state.has(dependency)) {
        visit(dependency);
      }
    }
    stack.pop();
    state.set(file, 'visited');
  };

  for (const file of sourceFiles) {
    const normalized = path.normalize(file);
    if (!state.has(normalized)) visit(normalized);
  }
  return cycles;
}

check('workspace registry ids are unique and static', () => {
  assert.equal(new Set(WORKSPACE_REGISTRY.map((workspace) => workspace.id)).size, WORKSPACE_REGISTRY.length);
  const registrySource = read('src/navigation/workspace-registry.ts');
  assert.doesNotMatch(registrySource, /\b(?:lazy|import)\s*\(/);
  assert.doesNotMatch(registrySource, /components\//);
});

check('every visible workspace maps to Help and tutorial metadata', () => {
  for (const workspace of WORKSPACE_REGISTRY) {
    const article = HELP_ARTICLES.find((candidate) => candidate.id === workspace.helpArticleId);
    assert.ok(article, `${workspace.id} is missing Help article ${workspace.helpArticleId}`);
    assert.equal(article.moduleId, workspace.id, `${workspace.id} Help module mismatch`);
    const tutorial = tutorialRegistry.find((candidate) => candidate.id === workspace.tutorialId);
    assert.ok(tutorial, `${workspace.id} is missing tutorial ${workspace.tutorialId}`);
    assert.equal(tutorial.module, workspace.id, `${workspace.id} tutorial module mismatch`);
  }
});

check('source import graph has no circular dependencies', () => {
  const cycles = findImportCycles().map((cycle) => cycle.map((file) => path.relative(root, file)).join(' -> '));
  assert.deepEqual(cycles, []);
});

check('client modules do not import server implementations', () => {
  const serverInfrastructureRoots = ['server', 'workers', 'db'].map((name) =>
    path.join(sourceRoot, name),
  );
  const offenders: string[] = [];
  for (const [file, dependencies] of importGraph) {
    if (serverInfrastructureRoots.some((serverRoot) => file.startsWith(serverRoot))) continue;
    for (const dependency of dependencies) {
      if (dependency.startsWith(path.join(sourceRoot, 'server'))) {
        offenders.push(`${path.relative(root, file)} -> ${path.relative(root, dependency)}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

check('server domains do not import browser UI implementations', () => {
  const browserRoots = ['components', 'pages', 'hooks', 'navigation'].map((name) => path.join(sourceRoot, name));
  const offenders: string[] = [];
  for (const [file, dependencies] of importGraph) {
    if (!file.startsWith(path.join(sourceRoot, 'server'))) continue;
    for (const dependency of dependencies) {
      if (browserRoots.some((browserRoot) => dependency.startsWith(browserRoot))) {
        offenders.push(`${path.relative(root, file)} -> ${path.relative(root, dependency)}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

check('auth contracts are not owned by App or AuthShell', () => {
  const app = read('src/App.tsx');
  const authShell = read('src/components/AuthShell.tsx');
  const source = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(app, /export type AuthUser\s*=\s*\{/);
  assert.doesNotMatch(authShell, /export type AuthVisualState\s*=\s*['"]/);
  assert.doesNotMatch(source, /import type \{ AuthUser \} from ['"][^'"]*App['"]/);
});

check('heavy Dashboard features remain dynamic imports', () => {
  const dashboard = read('src/pages/Dashboard.tsx');
  for (const modulePath of [
    '../components/lanyard/StanzaDashboardLanyard',
    '../components/locations/LocationsPanel',
    '../components/hiring/HiringPanel',
    '../components/expenses/ExpensesPanel',
    '../components/resignations/ResignationsPanel',
  ]) {
    assert.match(dashboard, new RegExp(`lazy\\(\\(\\) => [^\\n]*import\\(['\"]${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]\\)`));
  }
  assert.doesNotMatch(read('src/navigation/workspace-registry.ts'), /three|rapier|maplibre|\.glb/i);
});

check('extracted server domains remain domain-owned', () => {
  const server = read('server.ts');
  const extractedRoutes = [
    ['/api/dashboard/attention-counts', 'src/server/dashboard/attention-routes.ts'],
    ['/api/notification-settings', 'src/server/notifications/notification-settings-routes.ts'],
    ['/api/grievances', 'src/server/grievances/grievance-routes.ts'],
    ['/api/company-feed', 'src/server/feed/company-feed-routes.ts'],
    ['/api/clock-in', 'src/server/attendance/attendance-routes.ts'],
    ['/api/break-requests', 'src/server/breaks/break-request-routes.ts'],
    ['/api/roster/shifts', 'src/server/roster/roster-shift-routes.ts'],
    ['/api/compensation', 'src/server/payroll/compensation-routes.ts'],
    ['/api/employee-loans', 'src/server/payroll/loan-routes.ts'],
    ['/api/payroll', 'src/server/payroll/payroll-routes.ts'],
    ['/api/assets/:assetId/evidence', 'src/server/assets/asset-evidence-routes.ts'],
    ['/api/map-tiles/:z/:x/:y.png', 'src/server/system/map-tile-routes.ts'],
  ] as const;
  for (const [routePath, owner] of extractedRoutes) {
    assert.doesNotMatch(server, new RegExp(`app\\.(?:get|post|put|patch|delete)\\(\\s*['"]${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`));
    assert.match(read(owner), new RegExp(routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(server, /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/roles/);
  assert.doesNotMatch(server, /app\.(?:get|post|put|patch|delete)\(\s*['"]\/api\/employees\/:employeeId\/(?:roles|title)/);
});

check('meaningful server route and fallback ordering is preserved', () => {
  const server = read('server.ts');
  const attentionRegistrationIndex = server.indexOf('registerDashboardAttentionRoutes(app');
  const resignationRegistrationIndex = server.indexOf('registerResignationRoutes(app');
  const roleMutationRegistrationIndex = server.indexOf('registerLegacyRoleMutationRoutes(app');
  const clockInIndex = server.indexOf('registerAttendanceClockInRoute(app');
  const compatibilityLocationsIndex = server.indexOf('registerCompanyLocationCompatibilityRoutes(app');
  const attendanceStatusIndex = server.indexOf('registerAttendanceStatusRoutes(app');
  const payrollIndex = server.indexOf('registerPayrollRoutes(app');
  const grievanceIndex = server.indexOf('registerGrievanceRoutes(app');
  const payrollExportIndex = server.indexOf('registerPayrollExportRoute(app');
  const feedIndex = server.indexOf('registerCompanyFeedRoutes(app');
  const apiErrorIndex = server.indexOf("app.use('/api', apiErrorHandler)");
  const staticIndex = server.indexOf('app.use(express.static(distPath');
  const spaFallbackIndex = server.indexOf("app.get('*'");
  assert.match(server, /registerResignationRoutes\(app, \{/);
  assert.doesNotMatch(server, /app\.(?:get|post|patch)\(['"]\/api\/resignations/);
  assert.ok(attentionRegistrationIndex >= 0 && attentionRegistrationIndex < resignationRegistrationIndex);
  assert.ok(resignationRegistrationIndex < roleMutationRegistrationIndex);
  assert.ok(clockInIndex < compatibilityLocationsIndex && compatibilityLocationsIndex < attendanceStatusIndex);
  assert.ok(payrollIndex < grievanceIndex && grievanceIndex < payrollExportIndex && payrollExportIndex < feedIndex);
  assert.ok(feedIndex < apiErrorIndex && apiErrorIndex < staticIndex && staticIndex < spaFallbackIndex);
});

check('simple permission claims use one server helper', () => {
  const server = read('server.ts');
  const hiring = read('src/server/hiring/hiring-routes.ts');
  const performance = read('src/server/performance/performance-routes.ts');
  assert.match(server, /hasPermissionClaim/);
  assert.match(hiring, /hasPermissionClaim/);
  assert.match(performance, /hasPermissionClaim/);
  assert.doesNotMatch(hiring, /role === 'hr_admin' \|\| Boolean\([^\n]*permissions/);
  assert.doesNotMatch(performance, /role === 'hr_admin' \|\| Boolean\([^\n]*permissions/);
});

check('architecture documentation and accidental-artifact cleanup are present', () => {
  assert.ok(fs.existsSync(path.join(root, 'docs', 'architecture.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'architecture-walkthrough.md')));
  assert.equal(fs.existsSync(path.join(root, 'tatus --short')), false);
});

console.log(`Architecture contracts passed: ${passed}`);
