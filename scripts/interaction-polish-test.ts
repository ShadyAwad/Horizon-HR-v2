import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLanyardClickArbiter } from '../src/components/lanyard/lanyard-click';
import { normaliseCustomTheme, resolveLanyardColors, contrastRatio } from '../src/lib/custom-theme';
import { buildStanzaFrontBadgeSvg } from '../src/components/lanyard/stanzaBadgeArtwork';
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
assert.ok(css.includes('button.stanza-theme-primary.stanza-geo-clock-primary:not(:disabled):hover'));
const dashboard = readFileSync('src/pages/Dashboard.tsx', 'utf8');
assert.ok(dashboard.includes('void handleClockAction(event)'));
const attendance = readFileSync('src/components/attendance/AttendanceWorkspace.tsx', 'utf8');
assert.ok(attendance.includes("api('/api/break-requests'"));
assert.ok(attendance.includes('stanza-geo-action-content'));
assert.ok(attendance.includes('value={selection}'));
assert.ok(attendance.includes('stanza-theme-primary stanza-geo-break-primary'));
console.log('PASS click arbitration, cancellation, ID dialog contracts, lanyard color defaults/contrast and Geo business-handler wiring');
