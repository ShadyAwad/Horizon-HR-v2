/** Rounded up to a whole minute; callers supply server-derived remaining seconds. */
export function formatAttendanceDuration(seconds: number, locale: 'en'|'ar' = 'en') {
 const minutes = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds / 60)) : 0;
 const hours = Math.floor(minutes / 60), rest = minutes % 60;
 if (locale === 'en') return [hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '', rest || !hours ? `${rest} ${rest === 1 ? 'minute' : 'minutes'}` : ''].filter(Boolean).join(' ');
 const number = (n:number) => n.toLocaleString('ar',{numberingSystem:'arab'});
 const unit = (n:number, singular:string, dual:string, plural:string) => n===1?singular:n===2?dual:`${number(n)} ${n>=3&&n<=10?plural:singular}`;
 return [hours ? unit(hours,'ساعة','ساعتان','ساعات') : '', rest || !hours ? unit(rest,'دقيقة','دقيقتان','دقائق') : ''].filter(Boolean).join(' و');
}
