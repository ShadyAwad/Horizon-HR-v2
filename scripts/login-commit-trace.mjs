import fs from 'node:fs';

// Read-only analysis of the supplied optimized-scheduler capture. Times are
// relative to its recording start; nested elapsed slices are not additive.
const events = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).traceEvents;
const origin = 23536188783;
const main = events.filter(e => e.pid === 13348 && e.tid === 20524).sort((a,b) => a.ts-b.ts);
const begins = main.filter(e => e.name === 'BeginMainThreadFrame');
const pending = new Map();
const animations = [];
for (const e of main.filter(e => e.name === 'Animation')) {
  const id = JSON.stringify(e.id2 ?? e.id);
  if (e.ph === 'b') {
    const a = { start: (e.ts-origin)/1e6, end: null, ...e.args?.data, notes: [] };
    pending.set(id,a); animations.push(a);
  } else if (e.ph === 'e' && pending.has(id)) {
    pending.get(id).end = (e.ts-origin)/1e6; pending.delete(id);
  } else if (e.ph === 'n' && pending.has(id) && e.args?.data?.unsupportedProperties) {
    pending.get(id).notes.push(e.args.data);
  }
}
const windows = [[11,13],[26,27],[2,35]];
const result = windows.map(([from,to]) => {
  const groups = { raf: [], noRaf: [] };
  for (let i=0;i<begins.length-1;i++) {
    const begin=begins[i].ts,end=begins[i+1].ts;
    if (begin<origin+from*1e6 || end>origin+to*1e6) continue;
    const es=main.filter(e=>e.ts>=begin && e.ts<end);
    const count=name=>es.filter(e=>e.name===name).length;
    const duration=name=>es.filter(e=>e.name===name && e.ph==='X').reduce((s,e)=>s+(e.dur||0),0)/1000;
    const paints=es.filter(e=>e.name==='Paint').map(e=>e.args?.data);
    groups[count('FireAnimationFrame')?'raf':'noRaf'].push({at:(begin-origin)/1e6,intervalMs:(end-begin)/1000,
      commits:count('Commit'),commitMs:duration('Commit'),paintCount:count('Paint'),paintMs:duration('Paint'),
      styleMs:duration('UpdateLayoutTree'),jsMs:duration('FunctionCall'),
      schedules:es.filter(e=>e.name==='ScheduleStyleRecalculation').map(e=>e.args?.data),paints});
  }
  const summarize=rows=>({cycles:rows.length,...Object.fromEntries(['commits','commitMs','paintCount','paintMs','styleMs','jsMs'].map(k=>[k,+rows.reduce((s,r)=>s+r[k],0).toFixed(3)])),
    medianIntervalMs:rows.map(r=>r.intervalMs).sort((a,b)=>a-b)[Math.floor(rows.length/2)],
    maxCommitMs:Math.max(...rows.map(r=>r.commitMs)),
    paintTargets:[...new Set(rows.flatMap(r=>r.paints.map(p=>p?.nodeName)))]});
  return {from,to,raf:summarize(groups.raf),noRaf:summarize(groups.noRaf),sampleNoRaf:groups.noRaf.slice(0,2),
    overlappingAnimations: from===2 ? undefined : animations.filter(a=>a.start<to&&(a.end===null||a.end>from))};
});
const propertyGroups={};
for (const a of animations) {const key=a.name || a.displayName; const g=propertyGroups[key]??={count:0,longestObservedSeconds:0,unsupported:[]}; g.count++;g.longestObservedSeconds=Math.max(g.longestObservedSeconds,(a.end??35.001003)-a.start);for(const n of a.notes)g.unsupported.push(...n.unsupportedProperties);g.unsupported=[...new Set(g.unsupported)];}
console.log(JSON.stringify({windows:result,animations:propertyGroups,
  detailedInvalidationEvents:events.filter(e=>/InvalidationTracking|PaintInvalidation/.test(e.name)).length,
  compositorSamples:events.filter(e=>['RequestMainThreadFrame','NeedsBeginFrameChanged','Layer:created'].includes(e.name)).slice(0,5)},null,2));
