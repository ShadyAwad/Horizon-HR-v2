import type {RouterDataAnswer,RouterResult} from '../../lib/intelligent-router';
export function routerFeedback(result:RouterResult|null,busy:boolean,hasCommands:boolean,rtl:boolean):string {
  const text=(en:string,ar:string)=>rtl?ar:en;
  if(busy)return text('Finding a Stanza command…','جارٍ البحث عن أمر…');
  if(!result)return text('Ask Stanza… No approved command found yet.','اسأل Stanza… لم يتم العثور على أمر معتمد.');
  if(result.unsupported)return text('This request is not supported. Try a read-only Stanza command.','هذا الطلب غير مدعوم. جرّب أمرًا لعرض المعلومات في Stanza.');
  if(result.entityRoute&&result.entityRoute.status!=='resolved')return result.entityRoute.status==='ambiguous'?text('Clarification required. Choose an authorized match below.','يلزم التوضيح. اختر نتيجة مسموحًا بها أدناه.'):text('No authorized matching record is available. Check the entities and your access.','لا يوجد سجل مطابق متاح لك. تحقق من البيانات وصلاحياتك.');
  if(result.outcome==='unauthorized'||result.outcome==='matched'&&!hasCommands)return text('This capability is unavailable for your account.','هذه الإمكانية غير متاحة لحسابك.');
  if(result.outcome==='matched')return result.method==='semantic'?text('Suggested command (semantic). Review the destination below before opening.','أمر مقترح (مطابقة دلالية). راجع الوجهة أدناه قبل الفتح.'):result.method==='llm'?text('Suggested command (llm). Review before opening.','أمر مقترح (تفسير الذكاء الاصطناعي)؛ راجعه قبل الفتح.'):text('Suggested command. Review before opening.','أمر مقترح؛ راجعه قبل الفتح.');
  if(result.outcome==='ambiguous')return text('More than one interpretation fits. Review the suggested destinations.','يوجد أكثر من تفسير محتمل. راجع الوجهات المقترحة.');
  if(result.semanticStatus==='unavailable'||result.outcome==='provider_unavailable')return text('Semantic provider is unavailable. Try a known command.','مزود البحث الدلالي غير متاح. جرّب أمرًا معروفًا.');
  return text("I couldn't match that confidently.",'لم أتمكن من مطابقة الطلب بثقة.');
}
export function answerFeedback(answer:RouterDataAnswer,rtl:boolean):string {
  const text=(en:string,ar:string)=>rtl?ar:en;
  if(answer.kind==='profile')return answer.value||text('No assignment is recorded.','لا يوجد تعيين مسجل.');
  if(answer.kind==='payday')return text('No next payday is recorded. Open payroll for your payment records.','لا يوجد موعد مسجل للراتب القادم. افتح الرواتب لعرض سجلات الدفع.');
  if(answer.kind==='presence')return text(answer.total+' employee(s) clocked in now; '+answer.onBreak+' on break. Open Live Employees for details.',answer.total+' موظف مسجل الحضور الآن؛ '+answer.onBreak+' في استراحة. افتح الموظفين المتواجدين لعرض التفاصيل.');
  const date=(value:string,timeZone:string,full:boolean)=>new Intl.DateTimeFormat(rtl?'ar':'en',{...(full?{dateStyle:'medium' as const}:{}),timeStyle:'short',timeZone}).format(new Date(value));
  if(answer.kind==='shift')return answer.start&&answer.end?date(answer.start,answer.timeZone,true)+' – '+date(answer.end,answer.timeZone,false):text('No matching scheduled shift is recorded. Open the roster to review your schedule.','لا توجد مناوبة مجدولة مطابقة. افتح الجدول لمراجعة مواعيدك.');
  if(!answer.total)return text('No meetings are scheduled for you tomorrow.','لا توجد اجتماعات مقررة لك غدًا.');
  const summary=text(answer.total+' meeting(s) tomorrow: ',answer.total+' اجتماع غدًا: ');
  return summary+answer.items.map(item=>item.title+' — '+date(item.start,answer.timeZone,false)+' – '+date(item.end,answer.timeZone,false)).join('; ')+(answer.total>answer.items.length?text('. Open meetings to see all.','. افتح الاجتماعات لعرض الكل.'):'');
}
