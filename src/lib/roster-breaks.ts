export type PlannedBreak = { startTime: string; endTime: string };
export function validatePlannedBreaks(value: unknown, shiftStart: Date, shiftEnd: Date): PlannedBreak[] {
 if (!Array.isArray(value) || value.length > 8) throw new Error('Use up to eight planned breaks.');
 const breaks = value.map(raw => {
  if (!raw || typeof raw !== 'object' || typeof raw.startTime !== 'string' || typeof raw.endTime !== 'string') throw new Error('Break start and end are required.');
  const start = new Date(raw.startTime), end = new Date(raw.endTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start < shiftStart || end > shiftEnd || end <= start) throw new Error('Breaks must fall inside the shift, with end after start.');
  return {startTime:start.toISOString(),endTime:end.toISOString()};
 }).sort((a,b)=>a.startTime.localeCompare(b.startTime));
 for (let i=1;i<breaks.length;i++) if (breaks[i].startTime < breaks[i-1].endTime) throw new Error('Planned breaks must not overlap.');
 return breaks;
}
