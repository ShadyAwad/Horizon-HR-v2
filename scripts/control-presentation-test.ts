import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { AttendanceTerminal } from '../src/components/attendance/AttendanceTerminal';
import { PasskeyAction } from '../src/components/ui/PasskeyAction';

for (const state of ['idle','locating','verifying','success','clocked_out','open_shift_conflict','failed','outside_geofence']) {
  const busy = state === 'locating' || state === 'verifying';
  const html = renderToStaticMarkup(createElement(AttendanceTerminal, {state,label:'تسجيل الحضور',disabled:busy,onClick:()=>{}}));
  assert(html.includes('data-geo-interaction="clock"'));
  assert(html.includes(`data-state="${state}"`));
  assert(html.includes(`aria-busy="${busy}"`));
  assert.equal(html.includes('disabled=""'),busy);
  assert(html.includes('تسجيل الحضور'));
  assert.equal((html.match(/<button/g)||[]).length,1,'One native keyboard control');
  assert(!html.includes('animate-'),'State changes need no continuous animation');
}
for (const busy of [false,true]) {
  const html = renderToStaticMarkup(createElement(PasskeyAction,{label:'Add passkey',busyLabel:'Opening…',busy,disabled:busy,onClick:()=>{}}));
  assert(html.includes(`aria-label="${busy?'Opening…':'Add passkey'}"`));
  assert(html.includes(`aria-busy="${busy}"`));
  assert.equal(html.includes('disabled=""'),busy);
  assert(html.includes('Add passkey')&&html.includes('Opening…'),'Both states reserve the same label geometry');
  assert(!html.includes('stanza-theme-primary'),'Security action does not inherit gradient-to-solid CTA paint');
}
const css=readFileSync('src/index.css','utf8');
const terminalCss=css.slice(css.indexOf('/* Attendance access puck'),css.indexOf('button.passkey-action {'));
assert(!terminalCss.includes('conic-gradient'), 'Continuous rim has no lit segments or progress arcs');
assert(terminalCss.includes('border:2px solid color-mix(in srgb,var(--terminal-tone) 30%,var(--stanza-border-default))'), 'Quiet continuous theme-aware rim');
assert(!css.includes('transparent 2deg 15deg'), 'Retired hairline ticks are removed');
assert(css.includes('font-size:var(--text-base); font-weight:850'), 'The primary action owns the central hierarchy');
assert(css.includes('max-inline-size:34rem'),'Bound status/action distance on ultrawide');
assert(css.includes('.attendance-primary .attendance-terminal { justify-self:center; }'));
assert(!css.includes('stanza-geo-clock')&&!css.includes('attendance-radial'),'Obsolete radial CSS removed');
for(const selector of ['button.attendance-terminal','button.passkey-action'])assert(css.includes(`${selector}:not(:disabled):is(:hover,:active) { transform:none; scale:none; }`));
for(const file of ['src/components/attendance/AttendanceTerminal.tsx','src/components/ui/PasskeyAction.tsx'])assert.doesNotMatch(readFileSync(file,'utf8'),/requestAnimationFrame|setTimeout|setInterval|onPointerMove/);
const dashboard=readFileSync('src/pages/Dashboard.tsx','utf8');
assert(dashboard.includes('void handleClockAction(event)'));
assert(dashboard.includes('<PasskeyAction onClick={addPasskey} disabled={isOffline || passkeySaving}'));
const region=dashboard.slice(dashboard.indexOf('<div data-tutorial-target="geo-clock"'),dashboard.indexOf('{earlyClockOut&&<EarlyClockOutDialog'));
assert(region.includes('<AttendanceActions'),'No-location flow remains inside the primary region');
console.log('PASS native terminal/passkey state labels, loading/disabled, Arabic, stable geometry contracts, bounded composition, no loops, existing handler wiring');
