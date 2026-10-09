import { useEffect, useState } from 'react';
import { hiringRequest } from '../../api/hiring-workflow';
import { useLanguage } from '../../lib/LanguageContext';
import { hiringDate } from '../../lib/hiring-presentation';
type Summary = {
  openRoles: number;
  offersPending: number | null;
  interviews: Array<{ id: string; title: string; starts_at: string }>;
};
export function HiringOverview({revision=0}:{revision?:number}) {
  const { isRtl } = useLanguage(), text = (en: string, ar: string) => isRtl ? ar : en;
  const [data, setData] = useState<Summary | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    hiringRequest('/summary').then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [revision]);
  return <section className="hiring-overview" aria-label={text('Hiring overview', 'نظرة عامة على التوظيف')}>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">{text('Loading hiring overview…', 'جار تحميل ملخص التوظيف…')}</p>}
    {data && <>
      <dl className="hiring-overview-counts">
        <div><dt>{text('Open roles', 'الوظائف المفتوحة')}</dt><dd>{data.openRoles}</dd></div>
        {data.offersPending !== null && <div><dt>{text('Pending offers', 'العروض المعلقة')}</dt><dd>{data.offersPending}</dd></div>}
      </dl>
      <div><h3>{text('Next interviews', 'المقابلات القادمة')}</h3>
        {data.interviews.length ? <ul>{data.interviews.map(i => <li key={i.id}>
          <strong>{i.title}</strong><time dateTime={i.starts_at}>{hiringDate(i.starts_at, isRtl)}</time>
        </li>)}</ul> : <p className="hiring-secondary">{text('No interviews scheduled.', 'لا توجد مقابلات مجدولة.')}</p>}
      </div>
    </>}
  </section>;
}
