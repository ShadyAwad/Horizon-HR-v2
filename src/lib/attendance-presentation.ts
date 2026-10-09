/** Display-only state precedence. Action eligibility remains server-authoritative. */
export function attendanceDisplayState(attendance:any,hasShift:boolean,onBreak:boolean):'ready'|'working'|'due'|'on_break' {
 if(!hasShift)return 'ready';
 if(onBreak||attendance?.activeBreak)return 'on_break';
 if(attendance?.plannedBreaks?.some((b:any)=>b.state==='due'))return 'due';
 return 'working';
}
