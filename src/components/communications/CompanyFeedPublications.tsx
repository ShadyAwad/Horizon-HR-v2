import { lazy, memo, Suspense, useState } from 'react';
import { useLanguage } from '../../lib/LanguageContext';
import { ComposerDialog } from '../workspace-composer/ComposerDialog';
import './company-feed.css';

const Content = lazy(() => import('../FeedDocumentRenderer').then(m => ({default: m.RichFeedContent})));
export function publicationPreview(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 300 ? `${clean.slice(0, 300).trimEnd()}…` : clean;
}

type Publication = {
  id: string; title: string; content_text: string; content_json?: unknown; contentJson?: unknown;
  author_name?: string; post_type: string; published_at?: string; updated_at: string;
  event_starts_at?: string; event_ends_at?: string;
};

export const CompanyFeedPublications = memo(function CompanyFeedPublications({posts, loading, failed = false}: {
  posts: Publication[]; loading: boolean; failed?: boolean;
}) {
  const {isRtl, t} = useLanguage();
  const typeLabels: Record<string,string> = {announcement:t('enum.announcement'),event:t('enum.event'),policy_update:t('enum.policyUpdate'),general:t('enum.general')};
  const formatter = new Intl.DateTimeFormat(isRtl ? 'ar' : 'en', {dateStyle:'medium',timeStyle:'short'});
  const text = (en: string, ar: string) => isRtl ? ar : en;
  const [readingId, setReadingId] = useState<string | null>(null);
  const reading = posts.find(post => post.id === readingId);
  const date = (value?: string) => value && Number.isFinite(Date.parse(value))
    ? formatter.format(new Date(value)) : '—';
  const metadata = (post: Publication) => <p className="company-feed-byline">
    <span>{post.author_name || text('Company author', 'كاتب من الشركة')}</span><span aria-hidden="true">·</span>
    <time dateTime={post.published_at} title={date(post.published_at)}>{date(post.published_at)}</time>
    {post.published_at && Date.parse(post.updated_at) > Date.parse(post.published_at) + 1000 &&
      <span title={date(post.updated_at)}>{text('Edited', 'تم التحرير')}</span>}
  </p>;
  const event = (post: Publication) => post.post_type === 'event' && (post.event_starts_at || post.event_ends_at)
    ? <p className="company-feed-event">{text('Event', 'فعالية')}: {date(post.event_starts_at)}{post.event_ends_at ? ` — ${date(post.event_ends_at)}` : ''}</p> : null;
  return <section className="company-feed-publications" dir={isRtl ? 'rtl' : 'ltr'} aria-label={text('Published company posts', 'منشورات الشركة المنشورة')} aria-busy={loading}>
    <h3 className="company-feed-section-title">{text('Published updates', 'التحديثات المنشورة')}</h3>
    {loading && <p role="status">{text('Refreshing company posts…', 'جار تحديث منشورات الشركة…')}</p>}
    {!loading && !failed && !posts.length && <p className="company-feed-empty">{text('No company posts yet.', 'لا توجد منشورات للشركة بعد.')}</p>}
    {posts.map(post => <article className="company-feed-item" key={post.id}>
      <div className="company-feed-heading"><h3>{post.title || text('Company update', 'تحديث الشركة')}</h3><span className="company-feed-kind">{typeLabels[post.post_type] || post.post_type}</span></div>
      {metadata(post)}{event(post)}
      <p className="company-feed-preview">{publicationPreview(post.content_text) || text('Open to read this publication.', 'افتح لقراءة هذا المنشور.')}</p>
      <button type="button" className="company-feed-open" aria-haspopup="dialog" onClick={() => setReadingId(post.id)} aria-label={`${text('Read', 'قراءة')}: ${post.title}`}>
        {text('Read post', 'قراءة المنشور')} <span aria-hidden="true">{isRtl ? '←' : '→'}</span>
      </button>
    </article>)}
    {reading && <ComposerDialog title={reading.title || text('Company update', 'تحديث الشركة')} onClose={() => setReadingId(null)}>
      <article className="company-feed-reader">{metadata(reading)}{event(reading)}
        <Suspense fallback={<p role="status">{text('Opening publication…', 'جار فتح المنشور…')}</p>}>
          <Content contentJson={reading.content_json ?? reading.contentJson} contentText={reading.content_text}/>
        </Suspense>
      </article>
    </ComposerDialog>}
  </section>;
});
