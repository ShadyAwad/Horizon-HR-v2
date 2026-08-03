import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  detectPwaInstallPlatform,
  getPwaInstallMode,
} from '../src/lib/pwa-install';

const [manifestText, indexHtml, main, prompt, dashboard, translations, viteConfig, packageJson, productionHtml] = await Promise.all([
  readFile('public/manifest.webmanifest', 'utf8'),
  readFile('index.html', 'utf8'),
  readFile('src/main.tsx', 'utf8'),
  readFile('src/components/PwaInstallPrompt.tsx', 'utf8'),
  readFile('src/pages/Dashboard.tsx', 'utf8'),
  readFile('src/lib/LanguageContext.tsx', 'utf8'),
  readFile('vite.config.ts', 'utf8'),
  readFile('package.json', 'utf8'),
  readFile('dist/index.html', 'utf8'),
]);

const manifest = JSON.parse(manifestText) as { name: string; display: string; icons: Array<{ sizes: string; purpose?: string }> };
assert.equal(manifest.name, 'Stanza');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose?.includes('maskable')));
assert.match(indexHtml, /rel="manifest"/);
assert.match(main, /navigator\.serviceWorker\.register\('\/service-worker\.js'\)/);
assert.match(viteConfig, /mode === 'production'/);
assert.match(viteConfig, /minify: 'esbuild'/);
assert.match(viteConfig, /sourcemap: false/);
assert.match(packageJson, /"start": "node -e/);
assert.match(packageJson, /NODE_ENV='production'/);
assert.doesNotMatch(packageJson, /"start": "vite dev/);
assert.doesNotMatch(productionHtml, /@vite\/client|@react-refresh|\/src\/main\.tsx|\.tsx(?:["'])/i);
assert.match(productionHtml, /\/assets\/index-[A-Za-z0-9_-]+\.js/);
assert.match(main, /if \(!import\.meta\.env\.PROD\)/);
assert.match(main, /navigator\.serviceWorker\.getRegistrations\(\)/);
assert.match(main, /registration\.unregister\(\)/);

assert.equal(detectPwaInstallPlatform({ userAgent: 'Mozilla/5.0 Firefox/140.0', platform: 'Win32', maxTouchPoints: 0 }), 'firefox');
assert.equal(detectPwaInstallPlatform({ userAgent: 'Mozilla/5.0 Chrome/138.0', platform: 'Win32', maxTouchPoints: 0 }), 'chromium');
assert.equal(detectPwaInstallPlatform({ userAgent: 'Mozilla/5.0 (iPhone)', platform: 'iPhone', maxTouchPoints: 1 }), 'ios');
assert.equal(getPwaInstallMode({ platform: 'chromium', hasDeferredPrompt: true, isStandalone: false }), 'direct');
assert.equal(getPwaInstallMode({ platform: 'firefox', hasDeferredPrompt: false, isStandalone: false }), 'firefox-manual');
assert.equal(getPwaInstallMode({ platform: 'ios', hasDeferredPrompt: false, isStandalone: false }), 'ios-manual');
assert.equal(getPwaInstallMode({ platform: 'chromium', hasDeferredPrompt: false, isStandalone: true }), 'installed');

assert.match(prompt, /beforeinstallprompt/);
assert.match(prompt, /installMode === 'direct'/);
assert.match(prompt, /installFirefoxStep1/);
assert.match(prompt, /aria-live="polite"/);
assert.match(dashboard, /pwaInstallMode === 'firefox-manual'/);
assert.match(dashboard, /dash\.firefoxInstallHint/);
for (const key of ['login.installGuide', 'login.installFirefoxTitle', 'login.installFirefoxStep1', 'login.installFirefoxStep2', 'dash.firefoxInstallHint', 'dash.browserInstallHint']) {
  assert.equal((translations.match(new RegExp(`'${key}':`, 'g')) || []).length, 2, `${key} must be translated in English and Arabic`);
}

console.log('PWA install capability, Firefox guidance, and manifest contracts passed');
