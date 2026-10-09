import {resolveLanyardAppearance} from '../src/lib/lanyard-appearance';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLanyardClickArbiter } from '../src/components/lanyard/lanyard-click';
import { normaliseCustomTheme, resolveLanyardColors, contrastRatio } from '../src/lib/custom-theme';
import { buildStanzaFrontBadgeSvg,buildStanzaBackBadgeSvg } from '../src/components/lanyard/stanzaBadgeArtwork';
const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
const pending = new Map<number, () => void>(); let serial = 0, flips = 0, expansions = 0;
try {
  globalThis.setTimeout = ((callback: () => void, delay: number) => { assert.equal(delay, 220); pending.set(++serial, callback); return serial; }) as any;
  globalThis.clearTimeout = ((id: number) => pending.delete(id)) as any;
  const clicks = createLanyardClickArbiter(() => flips++, () => expansions++);
  clicks.click(); assert.equal(flips, 0);
  const callback = [...pending.values()][0]; pending.clear(); callback(); assert.equal(flips, 1);
  clicks.click(); clicks.click(); assert.equal(expansions, 1); assert.equal(flips, 1); assert.equal(pending.size, 0);
  clicks.click(); clicks.cancel(); assert.equal(pending.size, 0, 'Drag/unmount cancels the pending single click');
} finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
const auto = normaliseCustomTheme({}).lanyardStyle;
assert.deepEqual(auto, { appearanceMode: 'theme', cardColor: null, accentColor: null, strapColor: null });
assert.deepEqual(normaliseCustomTheme({ lanyardStyle: { cardColor: 'url(bad)', accentColor: '#ff0000', strapColor: 9 } }).lanyardStyle,
  { appearanceMode: 'custom', cardColor: null, accentColor: '#FF0000', strapColor: null });
assert.equal(buildStanzaFrontBadgeSvg(), buildStanzaFrontBadgeSvg({ style: auto }), 'Auto preserves original artwork exactly');
for (const cardColor of ['#FFFFFF', '#000000', '#777777', '#FF00FF']) {
 const colors = resolveLanyardColors({ ...auto, cardColor, accentColor: cardColor });
 assert.ok(contrastRatio(colors.card, colors.text) >= 4.5);
 assert.ok(contrastRatio(colors.card, colors.accent) >= 4.5);
}
const dialog = readFileSync('src/components/lanyard/LanyardDetails.tsx', 'utf8');
assert.match(dialog, /showModal\(\)/); assert.match(dialog, /onCancel=/); assert.match(dialog, /(?:event|e)\.target\s*===\s*(?:event|e)\.currentTarget/); assert.match(dialog, /returnFocus(?:\?\.)?\.?focus/);
const css = readFileSync('src/index.css', 'utf8');
assert.ok(css.includes('button.attendance-terminal:not(:disabled):is(:hover,:active) { transform:none; scale:none; }'), 'Clock terminal keeps a stable outer hitbox');
const dashboard = readFileSync('src/pages/Dashboard.tsx', 'utf8');
assert.ok(dashboard.includes('void handleClockAction(event)'));
const attendance = readFileSync('src/components/attendance/AttendanceWorkspace.tsx', 'utf8');
assert.ok(attendance.includes("api('/api/break-requests'"));
assert.ok(attendance.includes('stanza-geo-action-content'));
assert.ok(attendance.includes('value={selection}'));
assert.ok(attendance.includes('stanza-theme-primary stanza-geo-break-primary'));
console.log('PASS click arbitration, cancellation, ID dialog contracts, lanyard color defaults/contrast and Geo business-handler wiring');

const themed=resolveLanyardAppearance(auto,{cardColor:'#FFFFFF',accentColor:'#A855F7',strapColor:'#A855F7'});
assert.equal(themed.cardColor,'#050807');assert.equal(themed.accentColor,'#A855F7');
const chosen={...auto,appearanceMode:'custom' as const,cardColor:'#FFFFFF',accentColor:'#123456'};
assert.equal(resolveLanyardAppearance(chosen,themed),chosen,'Explicit saved custom appearance remains intact');
for(const svg of [buildStanzaFrontBadgeSvg({style:themed}),buildStanzaBackBadgeSvg({name:'أحمد',email:'a@example.com'},{language:'ar',style:themed})]){
 assert(svg.includes('x="0.5" y="0.5" width="659" height="999"'));
 assert(!svg.includes('width="576" height="916"'),'No inset card frame');
 assert(!svg.includes('font-family="Inter,Segoe UI'),'No fixed legacy font');
}
const styled=buildStanzaFrontBadgeSvg({fontFamily:'Test & Family',fontCss:'@font-face{font-family:Test;src:url(data:font/woff2;base64,AAAA)}'});
assert(styled.includes('Test &amp; Family'));assert(styled.includes('<style>@font-face'));
console.log('PASS physical-edge artwork, near-black theme default, custom appearance preservation, Arabic and shared embedded typography');

const {loadCardTypography}=await import('../src/components/lanyard/card-typography');
const originalFetch=globalThis.fetch,originalReader=(globalThis as any).FileReader;let fontReads=0;
try{
 globalThis.fetch=(async(path:string)=>{fontReads++;return new Response(readFileSync('public'+path),{headers:{'Content-Type':path.endsWith('.woff2')?'font/woff2':'text/css'}});}) as any;
 (globalThis as any).FileReader=class{result='';onload?:()=>void;onerror?:()=>void;readAsDataURL(blob:Blob){void blob.arrayBuffer().then(bytes=>{this.result='data:font/woff2;base64,'+Buffer.from(bytes).toString('base64');this.onload?.();});}};
 const font=await loadCardTypography('modern');assert(font.fontCss.includes('data:font/woff2;base64,'));assert(font.fontFamily.includes('Inter'));
 const firstReads=fontReads;for(let i=0;i<100;i++)assert.equal(await loadCardTypography('modern'),font);assert.equal(fontReads,firstReads,'Repeated artwork consumers reuse fonts without continuing work');
 const technical=await loadCardTypography('technical');assert(technical.fontFamily.includes('IBM Plex Sans Arabic'));assert.equal(fontReads,firstReads+2,'Technical uses existing Latin and Arabic faces, sharing the stylesheet');
 await loadCardTypography('system');assert.equal(fontReads,firstReads+2,'System typography requires no font transport');
}finally{globalThis.fetch=originalFetch;(globalThis as any).FileReader=originalReader;}
console.log('PASS selected local fonts embedded once per profile, shared by repeated card consumers, with no System font requests');
