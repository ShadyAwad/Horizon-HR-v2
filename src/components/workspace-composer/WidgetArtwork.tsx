import type {WidgetId} from './widget-catalog';
// Owned Workspace-only glyphs. No live content, filters or external artwork.
const paths:Record<WidgetId,string>={
 attendance:'M12 4a8 8 0 1 0 8 8 M12 8v5l3 2 M17 4l2 2 3-3',
 equipment:'M4 4h16v11H4z M8 19h8 M12 15v4 M8 8h8',
 inventory:'M3 8l9-5 9 5v11l-9 3-9-3z M3 8l9 4 9-4 M12 12v10 M8 5l9 5v4',
 support:'M4 9V8a8 8 0 0 1 16 0v9l-4 3h-4 M4 9H2v7h4V9z M20 9h2v7h-4V9z',
 communications:'M3 5h18v14H3z M3 5l9 8 9-8 M7 16h4',
 meetings:'M3 5h15v15H3z M6 3v4 M14 3v4 M3 10h9 M16 12a5 5 0 1 0 5 5 M17 14v4h3',
 breaks:'M5 7h12v7a6 6 0 0 1-12 0z M17 8h2a3 3 0 0 1 0 6h-2 M4 22h14 M8 2v2 M13 2v2',
 leave:'M3 5h18v15H3z M7 3v4 M17 3v4 M3 10h18 M8 15h8 M13 12l3 3-3 3',
 expenses:'M6 2h12v20l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h3',
 goals:'M12 3a9 9 0 1 0 9 9 M12 7a5 5 0 1 0 5 5 M12 12l9-9 M17 3h4v4',
 grievances:'M4 3h16v14H9l-5 4z M8 7h8 M8 11h5 M17 19v3',
 hiring:'M3 4h5v5H3z M10 4h5v9h-5z M17 4h5v14h-5z M3 18h10 M10 15l3 3-3 3',
 openRoles:'M3 7h18v14H3z M8 7V3h8v4 M3 12h18 M10 12v3h4v-3',
 hiringInterviews:'M3 3h18v17H3z M3 8h18 M7 1v4 M17 1v4 M12 11a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M8 19v-1q4-5 8 0v1',
 pendingOffers:'M5 2h14v20H5z M8 6h8 M8 10h8 M9 16l2 2 5-5',
 newHires:'M9 3a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M3 21v-5q6-7 12 0v5 M19 9v8 M15 13h8',
 onboardingRisk:'M12 3L2 21h20z M12 9v5 M12 17v1',
 equipmentPending:'M3 3h18v13H3z M9 20h6 M12 16v4 M8 9h8 M12 6v6',
 accessPending:'M8 11V7a4 4 0 0 1 8 0v4 M5 11h14v11H5z M12 15v3',
 firstDayReadiness:'M4 3h16v19H4z M8 3V1 M16 3V1 M8 10l2 2 5-5 M8 17h8',
 feed:'M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h4 M8 18h8',
};
export function WidgetIcon({id}:{id:WidgetId}){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[id]}/></svg>;}
export function WidgetPreview({id}:{id:WidgetId}){
 const metric=['attendance','pendingOffers','firstDayReadiness'].includes(id);
 return <div className="composer-preview" aria-hidden="true"><div className="composer-preview-heading"><WidgetIcon id={id}/><i/></div>{metric?<><b className="composer-preview-metric"/><div className="composer-preview-line"/></>:<div className="composer-preview-list">{[0,1,2].map(n=><div key={n}><i/><span><b/><b/></span></div>)}</div>}<div className="composer-preview-foot"><i/><i/></div></div>;
}
