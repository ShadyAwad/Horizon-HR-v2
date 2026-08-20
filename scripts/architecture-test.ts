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
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;

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
  for (const match of read(path.relative(root, file)).matchAll(importPattern)) {
    const resolved = resolveImport(file, match[1]);
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

check('resignation routes are domain-owned and mounted once in order', () => {
  const server = read('server.ts');
  const routes = read('src/server/resignations/resignation-routes.ts');
  const attentionRouteIndex = server.search(/app\.get\(\s*['"]\/api\/dashboard\/attention-counts['"]/);
  const resignationRegistrationIndex = server.indexOf('registerResignationRoutes(app');
  const roleCreationRouteIndex = server.search(/app\.post\(\s*['"]\/api\/roles['"]/);
  assert.match(server, /registerResignationRoutes\(app, \{/);
  assert.doesNotMatch(server, /app\.(?:get|post|patch)\(['"]\/api\/resignations/);
  assert.equal((routes.match(/['"]\/api\/resignations/g) || []).length, 6);
  assert.ok(attentionRouteIndex >= 0 && attentionRouteIndex < resignationRegistrationIndex);
  assert.ok(resignationRegistrationIndex < roleCreationRouteIndex);
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
