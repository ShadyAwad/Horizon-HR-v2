import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {STANZA_FINGERPRINT_GROOVES} from '../src/components/stanzaFingerprintGeometry';
import {iconSvg} from './generate-pwa-icons.mjs';
import {
  detectPwaInstallPlatform,
  getPwaInstallMode,
} from '../src/lib/pwa-install';

const [manifestText, indexHtml, main, prompt, dashboard, installPromptStore, translations, viteConfig, packageJson, productionHtml] = await Promise.all([
  readFile('public/manifest.webmanifest', 'utf8'),
  readFile('index.html', 'utf8'),
  readFile('src/main.tsx', 'utf8'),
  readFile('src/components/PwaInstallPrompt.tsx', 'utf8'),
  readFile('src/pages/Dashboard.tsx', 'utf8'),
  readFile('src/lib/pwa-install-prompt.ts', 'utf8'),
  readFile('src/lib/LanguageContext.tsx', 'utf8'),
  readFile('vite.config.ts', 'utf8'),
  readFile('package.json', 'utf8'),
  readFile('dist/index.html', 'utf8'),
]);

const manifest = JSON.parse(manifestText) as { name: string; display: string; icons: Array<{ src: string; sizes: string; purpose?: string }> };
assert.equal(manifest.name, 'Stanza');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose?.includes('maskable')));
assert.ok(manifest.icons.filter((icon) => icon.purpose === 'any').every((icon) => !icon.src.includes('maskable')));
assert.ok(manifest.icons.filter((icon) => icon.purpose === 'maskable').every((icon) => icon.src.includes('maskable')));
const standardIcon = await sharp(resolve('public/icons/stanza-512.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
assert.equal(standardIcon.data[3], 0, 'standard PWA icon must retain transparent outer pixels');
for(const [variant,name] of [['standard','standard-icon'],['app','app-icon'],['favicon','favicon']]){
 const svg=await readFile(`public/icons/stanza-${name}.svg`,'utf8');
 assert.equal(svg.replace(/\r\n/g,'\n'),iconSvg(variant),'Checked-in vector must match the deterministic generator');
 const paths=[...svg.matchAll(/<path d="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual([...new Set(paths)], [...STANZA_FINGERPRINT_GROOVES],`${variant} uses the Login/launcher geometry`);
}
for(const icon of manifest.icons){
 const image=await sharp(resolve('public'+icon.src)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const size=Number(icon.sizes.split('x')[0]);assert.equal(image.info.width,size);assert.equal(image.info.height,size);
 if(icon.purpose==='maskable')for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=(y*size+x)*4;assert.equal(image.data[i+3],255,'Maskable background must be opaque to the edges');
  if(image.data[i+1]>70)assert(Math.hypot(x+.5-size/2,y+.5-size/2)<=size*.4,'Essential foreground stays inside the maskable safe circle');
 }
}
for(const [file,size] of [['stanza-apple-touch-icon.png',180],['stanza-favicon-32.png',32],['stanza-favicon-16.png',16]] as const){
 const image=await sharp(`public/icons/${file}`).metadata();assert.equal(image.width,size);assert.equal(image.height,size);
}
for(const match of indexHtml.matchAll(/(?:property="og:image"|name="twitter:image") content="([^"]+)"/g)){
 const asset=new URL(match[1]).pathname;assert((await readFile('public'+asset)).length>0,'Social metadata must resolve to a real local icon');
}
console.log('PASS canonical icon geometry, generated SVG parity, required dimensions, opaque maskable safe zone and social image paths');
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
assert.equal(detectPwaInstallPlatform({ userAgent: 'Mozilla/5.0 Edg/138.0', platform: 'Win32', maxTouchPoints: 0 }), 'edge');
assert.equal(detectPwaInstallPlatform({ userAgent: 'Mozilla/5.0 (iPhone)', platform: 'iPhone', maxTouchPoints: 1 }), 'ios');
assert.equal(getPwaInstallMode({ platform: 'chromium', hasDeferredPrompt: true, isStandalone: false }), 'direct');
assert.equal(getPwaInstallMode({ platform: 'firefox', hasDeferredPrompt: false, isStandalone: false }), 'firefox-manual');
assert.equal(getPwaInstallMode({ platform: 'ios', hasDeferredPrompt: false, isStandalone: false }), 'ios-manual');
assert.equal(getPwaInstallMode({ platform: 'chromium', hasDeferredPrompt: false, isStandalone: true }), 'installed');

assert.match(installPromptStore, /beforeinstallprompt/);
assert.equal((`${prompt}\n${dashboard}\n${installPromptStore}`.match(/window\.addEventListener\('beforeinstallprompt'/g) || []).length, 1, 'PWA install prompt must register one shared listener.');
assert.match(installPromptStore, /export async function requestDeferredInstall\(\) \{[\s\S]*publish\(\{ \.\.\.snapshot, installPrompt: null \}\);[\s\S]*await deferred\.prompt\(\);[\s\S]*return deferred\.userChoice;/);
assert.match(prompt, /installMode === 'direct'/);
assert.match(prompt, /installFirefoxStep1/);
assert.match(prompt, /aria-live="polite"/);
assert.match(prompt, /aria-expanded/);
assert.match(prompt, /login\.installExplanation/);
assert.match(prompt, /login\.installInstalled/);
assert.match(prompt, /login\.installEdgeStep1/);
assert.match(prompt, /login\.installUnsupportedStep1/);
assert.match(prompt, /login\.installAccountNote/);
assert.match(prompt, /login\.installRemoveDesktop/);
assert.match(prompt, /login\.installRemoveAndroid/);
assert.match(prompt, /login\.installRemoveIos/);
assert.match(prompt, /login\.installRemoveFirefox/);
assert.match(prompt, /login\.installRemoveChromeStep1/);
assert.match(prompt, /login\.installRemoveEdgeStep1/);
assert.match(dashboard, /pwaInstallMode === 'firefox-manual'/);
assert.match(dashboard, /dash\.firefoxInstallHint/);
assert.match(dashboard, /login\.installHelpTitle/);
assert.match(dashboard, /login\.installHelpDetails/);
assert.match(dashboard, /login\.installTroubleshooting/);
for (const key of ['login.installGuide', 'login.installFirefoxTitle', 'login.installFirefoxStep1', 'login.installFirefoxStep2', 'login.installExplanation', 'login.installInstalled', 'login.installEdgeTitle', 'login.installUnsupportedTitle', 'login.installAccountNote', 'login.installRemoveDesktop', 'login.installRemoveAndroid', 'login.installRemoveIos', 'login.installRemoveFirefox', 'login.installRemoveChromeStep1', 'login.installRemoveChromeStep2', 'login.installRemoveEdgeStep1', 'login.installRemoveEdgeStep2', 'login.installHelpTitle', 'login.installHelpDetails', 'login.installTroubleshooting', 'dash.firefoxInstallHint', 'dash.browserInstallHint']) {
  assert.equal((translations.match(new RegExp(`'${key}':`, 'g')) || []).length, 2, `${key} must be translated in English and Arabic`);
}

console.log('PWA install capability, Firefox guidance, and manifest contracts passed');
