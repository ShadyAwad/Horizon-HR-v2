import type { SemanticHit } from '../src/server/intelligent-router/router';
export type Fixture = { query:string; language:'English'|'Arabic'|'Egyptian'|'Mixed'|'Abbreviation'|'Typo'|'Negative'; expected:string; layer:string; hits?:SemanticHit[]; reasoning?:string };
export const ROUTER_FIXTURES: Fixture[] = [
  {query:'request leave',language:'English',expected:'request_leave',layer:'exact'},
  {query:'I need time off next Thursday',language:'English',expected:'request_leave',layer:'rule'},
  {query:'طلب إجازة',language:'Arabic',expected:'request_leave',layer:'exact'},
  {query:'عايز أجازة',language:'Egyptian',expected:'request_leave',layer:'exact'},
  {query:'فاضلي كام يوم اجازه',language:'Egyptian',expected:'leave_balance',layer:'exact'},
  {query:'PTO balance',language:'Abbreviation',expected:'leave_balance',layer:'exact'},
  {query:'عايز PTO بكرة',language:'Mixed',expected:'request_leave',layer:'semantic',hits:[{intentKey:'request_leave',score:.93},{intentKey:'request_leave',score:.91},{intentKey:'leave_balance',score:.67}]},
  {query:'leev balnce',language:'Typo',expected:'leave_balance',layer:'semantic',hits:[{intentKey:'leave_balance',score:.94},{intentKey:'request_leave',score:.50}]},
  {query:'هل يمكنني الحصول على عطلة غدا',language:'Arabic',expected:'request_leave',layer:'semantic',hits:[{intentKey:'request_leave',score:.92},{intentKey:'leave_balance',score:.60}]},
  {query:'نفسي اريح يوم من الشغل',language:'Egyptian',expected:'request_leave',layer:'llm',hits:[{intentKey:'request_leave',score:.55}],reasoning:'request_leave'},
  {query:'time away options',language:'English',expected:'ambiguous',layer:'semantic',hits:[{intentKey:'request_leave',score:.90},{intentKey:'leave_balance',score:.86}]},
  {query:'cancel leave',language:'Negative',expected:'no_match',layer:'none'},
  {query:'modify salary',language:'Negative',expected:'no_match',layer:'none'},
  {query:'close grievance',language:'Negative',expected:'no_match',layer:'none'},
  {query:'الغاء الاجازة',language:'Negative',expected:'no_match',layer:'none'},
  {query:'show payslip',language:'English',expected:'payslips',layer:'exact'},
  {query:'clock in',language:'English',expected:'clock_in_help',layer:'exact'},
  {query:'view attendance history',language:'English',expected:'attendance',layer:'semantic',hits:[{intentKey:'attendance',score:.96},{intentKey:'clock_in_help',score:.70}]},
  {query:'submit grievance',language:'English',expected:'my_grievances',layer:'exact'},
  {query:'recommend a pizza',language:'English',expected:'no_match',layer:'semantic',hits:[{intentKey:'company_feed',score:.2}]},
];
