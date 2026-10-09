import { attendanceDisplayState } from '../../lib/attendance-presentation';
import { MapPin, MapPinOff } from 'lucide-react';
import { useLanguage } from '../../lib/LanguageContext';

/** Presentation of the server snapshot; never determines attendance eligibility. */
export function AttendanceStatus({attendance,hasShift,onBreak,locationStatus}:{attendance:any;hasShift:boolean;onBreak:boolean;locationStatus:string}) {
 const {isRtl}=useLanguage(),text=(en:string,ar:string)=>isRtl?ar:en;
 const time=(value:string)=>new Date(value).toLocaleTimeString(isRtl?'ar':'en',{hour:'numeric',minute:'2-digit'});
 const title=({ready:text('Ready to clock in','جاهز لتسجيل الحضور'),working:text('Working','في العمل'),due:text('Break due now','حان موعد الاستراحة'),on_break:text('On break','في استراحة')})[attendanceDisplayState(attendance,hasShift,onBreak)];
 return <div className="attendance-status" role="status" aria-live="polite">
  <h3>{title}</h3>
  {hasShift&&attendance?.clockedIn&&<p className="attendance-muted">{text('Clocked in at','تم تسجيل الحضور في')} <bdi>{time(attendance.clockedIn)}</bdi></p>}
  {hasShift&&locationStatus&&<p className="attendance-location attendance-muted">{locationStatus==='verified'?<MapPin aria-hidden="true" size={16}/>:<MapPinOff aria-hidden="true" size={16}/>} {locationStatus==='verified'?text('Location verified','الموقع معتمد'):locationStatus==='outside'?text('Outside geofence — optional policy','خارج الموقع — مسموح اختيارياً'):locationStatus==='disabled'?text('Location disabled','الموقع معطل'):text('Clocked in without location','تم الحضور دون موقع')}</p>}
  {attendance?.scheduledEnd&&<dl className="attendance-schedule"><div><dt>{text('Scheduled end','نهاية الوردية')}</dt><dd><bdi>{time(attendance.scheduledEnd)}</bdi></dd></div>{attendance.approvedDeparture&&<div><dt>{text('Approved departure','الانصراف المعتمد')}</dt><dd><bdi>{time(attendance.approvedDeparture)}</bdi></dd></div>}</dl>}
 </div>;
}
