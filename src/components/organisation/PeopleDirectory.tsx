import {useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {useLanguage} from '../../lib/LanguageContext';
import {ComposerDialog} from '../workspace-composer/ComposerDialog';
import type {Employee} from './OrganisationPanel';
import './people.css';

type Props = {
  people: Employee[]; teams: {id:string; locationId:string|null}[]; locations:{id:string; name:string}[];
  search:string; page:number; total:number; loading:boolean; canEdit:boolean;
  onSearch:(value:string)=>void; onPage:(value:number)=>void;
  onPlacement:(employee:Employee)=>void; onManager:(employee:Employee)=>void;
};
export function PeopleDirectory({people, teams, locations, search, page, total, loading, canEdit, onSearch, onPage, onPlacement, onManager}:Props) {
  const {isRtl,t}=useLanguage();
  const tr=(en:string,ar:string)=>isRtl?ar:en;
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const selected=people.find(employee=>employee.id===selectedId);
  const title=(employee:Employee)=>employee.jobTitle || employee.legacyJobTitle || tr('No job title assigned','لم يُحدد المسمى الوظيفي');
  const status=(employee:Employee)=>employee.employmentStatus==='terminated'?tr('Terminated','انتهت الخدمة'):employee.employmentStatus==='archived'?tr('Archived','مؤرشف'):employee.isActive?t('organisation.active'):t('organisation.inactive');
  const location=(employee:Employee)=>locations.find(item=>item.id===teams.find(team=>team.id===employee.teamId)?.locationId)?.name;
  const edit=(employee:Employee, manager=false)=>{setSelectedId(null);if(manager)onManager(employee);else onPlacement(employee);};
  return <section className="people-directory" aria-label={tr('Employee directory','دليل الموظفين')} aria-busy={loading}>
    <div className="people-search"><label>{t('organisation.searchPeople')}<input type="search" value={search} onChange={event=>onSearch(event.target.value)} placeholder={tr('Name or email','الاسم أو البريد الإلكتروني')} /></label>{search&&<button type="button" onClick={()=>onSearch('')}>{tr('Clear search','مسح البحث')}</button>}</div>
    <div className="people-list">{people.map(employee=><article className="people-row" key={employee.id}>
      <button type="button" className="people-open" disabled={loading} aria-expanded={selectedId===employee.id} aria-haspopup="dialog" aria-label={`${tr('Open employee','فتح الموظف')}: ${employee.fullName}`} onClick={()=>setSelectedId(employee.id)}>
        <span className="people-identity"><strong>{employee.fullName}</strong><span>{title(employee)}</span><span className="people-secondary">{[employee.department,employee.team].filter(Boolean).join(' · ') || tr('No organizational placement','لا يوجد تعيين تنظيمي')}{employee.managerName&&<> · {tr('Manager','المدير')}: {employee.managerName}</>}</span></span>
        <span className="people-row-status">{status(employee)}<ArrowRight aria-hidden="true" /></span>
      </button>
      {canEdit&&<div className="people-row-actions"><button type="button" disabled={loading} onClick={()=>edit(employee)}>{t('organisation.editPlacement')}</button><button type="button" disabled={loading} onClick={()=>edit(employee,true)}>{t('organisation.changeManager')}</button></div>}
    </article>)}</div>
    {!loading&&!people.length&&<p role="status" className="people-empty">{search?tr('No employees match this search.','لا يوجد موظفون يطابقون هذا البحث.'):tr('No employees found.','لا يوجد موظفون.')}</p>}
    <nav className="people-pagination" aria-label={tr('Directory pages','صفحات الدليل')}><button type="button" disabled={page===1||loading} onClick={()=>onPage(page-1)}>{t('organisation.previous')}</button><span role="status">{total?`${(page-1)*25+1}–${Math.min(page*25,total)} / ${total}`:'0'} · {tr('Page','صفحة')} {page}</span><button type="button" disabled={page*25>=total||loading} onClick={()=>onPage(page+1)}>{t('organisation.next')}</button></nav>
    {selected&&<ComposerDialog title={tr('Employee profile','ملف الموظف')} onClose={()=>setSelectedId(null)}><div className="people-profile">
      <header><h3>{selected.fullName}</h3><p>{title(selected)}</p><span>{status(selected)}</span><p><bdi dir="ltr">{selected.email}</bdi></p></header>
      <section><h4>{tr('Organization','التنظيم')}</h4><dl><dt>{t('organisation.department')}</dt><dd>{selected.department||tr('No department assigned','لم يُحدد القسم')}</dd><dt>{tr('Team','الفريق')}</dt><dd>{selected.team||tr('No team assigned','لم يُحدد الفريق')}</dd><dt>{t('organisation.manager')}</dt><dd>{selected.managerName||tr('No manager assigned','لم يُحدد المدير')}</dd></dl></section>
      <section><h4>{tr('Work assignment','تعيين العمل')}</h4><dl><dt>{tr('Team work location','موقع عمل الفريق')}</dt><dd>{location(selected)||tr('No team work location assigned','لم يُحدد موقع عمل للفريق')}</dd></dl></section>
      {canEdit&&<footer><button type="button" onClick={()=>edit(selected)}>{t('organisation.editPlacement')}</button><button type="button" onClick={()=>edit(selected,true)}>{t('organisation.changeManager')}</button></footer>}
    </div></ComposerDialog>}
  </section>;
}
