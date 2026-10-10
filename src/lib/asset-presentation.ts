/** Presentation only. Lifecycle and condition transitions remain server-authoritative. */
const labels:Record<string,[string,string]>={
 available:['Available','متاح'],assigned:['Assigned','مسند'],maintenance:['Maintenance','صيانة'],
 lost:['Lost','مفقود'],retired:['Retired','مستبعد'],active:['Active assignment','عهدة حالية'],returned:['Returned','تم الإرجاع'],
 new:['New','جديد'],good:['Good','جيد'],fair:['Fair','مقبول'],damaged:['Damaged','تالف'],unusable:['Unusable','غير صالح للاستخدام'],
 open:['Open','مفتوح'],in_progress:['In progress','قيد التنفيذ'],waiting_requester:['Waiting for requester','بانتظار مقدم الطلب'],
 resolved:['Resolved','تم الحل'],closed:['Closed','مغلق'],
 laptop:['Laptop','حاسوب محمول'],desktop:['Desktop','حاسوب مكتبي'],monitor:['Monitor','شاشة'],
 phone:['Phone','هاتف'],tablet:['Tablet','جهاز لوحي'],accessory:['Accessory','ملحق'],badge:['Badge','بطاقة'],
 furniture:['Furniture','أثاث'],other:['Other','أخرى'],
};
export const ASSET_STATUSES=['available','assigned','maintenance','lost','retired'] as const;
export const ASSET_CONDITIONS=['new','good','fair','damaged','unusable'] as const;
export function assetLabel(value:string|null|undefined,rtl=false){return value?labels[value]?.[rtl?1:0]||value.replaceAll('_',' '):'—';}
export function assetDate(value:string|null|undefined,rtl=false){
 if(!value)return '—';
 const day=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
 const date=day?new Date(Number(day[1]),Number(day[2])-1,Number(day[3])):new Date(value);
 return Number.isFinite(date.getTime())?date.toLocaleDateString(rtl?'ar-EG':'en',{dateStyle:'medium'}):'—';
}
export function assetAttention(asset:{status:string;condition:string}){
 return ['maintenance','lost'].includes(asset.status)||['damaged','unusable'].includes(asset.condition);
}
export function assetActions(status:string,permissions:readonly string[]=[]){
 return {assign:status==='available'&&permissions.includes('assets.assign'),
 return:status==='assigned'&&permissions.includes('assets.return'),
 condition:!['lost','retired'].includes(status)&&permissions.includes('assets.manage'),
 final:!['assigned','lost','retired'].includes(status)&&permissions.includes('assets.manage'),
 edit:permissions.includes('assets.manage')};
}
