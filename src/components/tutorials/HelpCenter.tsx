import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Play, RotateCcw, Search } from 'lucide-react';
import { useLanguage } from '../../lib/LanguageContext';
import { cn } from '../../lib/utils';
import { recordDevInteraction } from '../../lib/dev-performance';
import { getEligibleHelpArticles, searchHelpArticles, type HelpArticle, type HelpGroup } from './help-registry';
import type { TutorialContext, TutorialDefinition } from './tutorial-types';

type Props = {
  context: TutorialContext;
  tutorials: readonly TutorialDefinition[];
  completedTutorials: Record<string, number>;
  requestedArticleId?: string | null;
  requestVersion?: number;
  onStartTutorial: (tutorialId: string) => void;
  onOpenModule: (moduleId: string) => void;
};

const GROUP_ORDER: readonly HelpGroup[] = ['getting_started', 'workspaces', 'account_app'];

export function HelpCenter({ context, tutorials, completedTutorials, requestedArticleId, requestVersion, onStartTutorial, onOpenModule }: Props) {
  const { t, lang, isRtl } = useLanguage();
  const locale = lang === 'ar' ? 'ar' : 'en';
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const articleReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const articles = useMemo(() => getEligibleHelpArticles(context), [context]);
  const visibleArticles = useMemo(() => searchHelpArticles(articles, query, locale), [articles, locale, query]);
  const selected = selectedId ? articles.find((article) => article.id === selectedId) || null : null;
  const tutorialById = useMemo(() => new Map(tutorials.map((tutorial) => [tutorial.id, tutorial])), [tutorials]);

  useEffect(() => {
    if (!requestedArticleId || !articles.some((article) => article.id === requestedArticleId)) return;
    setSelectedId(requestedArticleId);
  }, [articles, requestVersion, requestedArticleId]);

  const openArticle = (article: HelpArticle, trigger: HTMLButtonElement) => {
    recordDevInteraction('help-article-switch', () => {
      articleReturnFocusRef.current = trigger;
      setSelectedId(article.id);
    });
  };

  const closeArticle = () => {
    setSelectedId(null);
    window.requestAnimationFrame(() => articleReturnFocusRef.current?.focus());
  };

  if (selected) {
    const tutorial = selected.tutorialId ? tutorialById.get(selected.tutorialId) : null;
    const completed = Boolean(tutorial && completedTutorials[tutorial.id] === tutorial.version);
    return <article data-help-article-body={selected.id} className="rounded-xl border border-[var(--stanza-border-subtle)] bg-[var(--stanza-surface-raised)] p-4" dir={isRtl ? 'rtl' : 'ltr'}>
      <button type="button" onClick={closeArticle} className="stanza-secondary-action inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--stanza-border-subtle)] px-3 text-xs font-bold">
        {isRtl ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}{t('help.back')}
      </button>
      <div className="mt-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">{t(`help.group.${selected.group}` as never)}</p>
        <h3 className="mt-1 text-lg font-black text-[color:var(--stanza-text-primary)]">{selected.title[locale]}</h3>
        <p className="mt-2 text-sm leading-6 text-[color:var(--stanza-text-muted)]">{selected.summary[locale]}</p>
      </div>
      <div className="mt-5 space-y-4">
        {selected.sections.map((item) => <section key={item.heading.en}>
          <h4 className="text-sm font-bold text-[color:var(--stanza-text-primary)]">{item.heading[locale]}</h4>
          <p className="mt-1 text-xs leading-6 text-[color:var(--stanza-text-muted)]">{item.body[locale]}</p>
        </section>)}
      </div>
      <div className="mt-5 flex flex-col gap-2 border-t border-[var(--stanza-border-subtle)] pt-4 sm:flex-row">
        {selected.moduleId && <button type="button" onClick={() => onOpenModule(selected.moduleId!)} className="stanza-secondary-action min-h-11 flex-1 rounded-md border border-[var(--stanza-border-subtle)] px-3 text-sm font-bold">{t('help.openModule')}</button>}
        {tutorial && <button type="button" onClick={() => onStartTutorial(tutorial.id)} className="stanza-primary-action inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-emerald-500 px-3 text-sm font-bold text-[#02110b]">{completed ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}{completed ? t('help.replayTour') : t('help.startTour')}</button>}
      </div>
    </article>;
  }

  return <section data-help-center className="min-w-0" dir={isRtl ? 'rtl' : 'ltr'}>
    <div>
      <h3 className="flex items-center gap-2 text-base font-black text-[color:var(--stanza-text-primary)]"><BookOpen className="h-5 w-5 text-emerald-500" />{t('help.center')}</h3>
      <p className="mt-1 text-xs leading-5 text-[color:var(--stanza-text-muted)]">{t('help.description')}</p>
    </div>
    <label className="mt-4 block text-xs font-bold" htmlFor="stanza-help-search">{t('help.search')}</label>
    <div className="relative mt-1">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--stanza-text-muted)]" />
      <input id="stanza-help-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('help.searchPlaceholder')} className="w-full rounded-md border border-[var(--stanza-border-subtle)] bg-[var(--stanza-input-bg)] py-2.5 ps-9 pe-3 text-sm text-[color:var(--stanza-text-primary)] outline-none transition-colors focus:border-[var(--stanza-border-accent)] focus-visible:ring-2 focus-visible:ring-emerald-400" />
    </div>
    {visibleArticles.length === 0 ? <div className="mt-4 rounded-lg border border-dashed border-[var(--stanza-border-subtle)] p-6 text-center text-sm text-[color:var(--stanza-text-muted)]">{t('help.noResults')}</div> : <div className="mt-4 space-y-5">
      {GROUP_ORDER.map((group) => {
        const groupArticles = visibleArticles.filter((article) => article.group === group);
        if (groupArticles.length === 0) return null;
        return <section key={group} aria-labelledby={`help-group-${group}`}>
          <h4 id={`help-group-${group}`} className="text-xs font-black uppercase tracking-widest text-[color:var(--stanza-text-muted)]">{t(`help.group.${group}` as never)}</h4>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {groupArticles.map((article) => <button key={article.id} type="button" onClick={(event) => openArticle(article, event.currentTarget)} className={cn('stanza-help-article-link min-w-0 rounded-lg border border-[var(--stanza-border-subtle)] bg-[var(--stanza-surface-raised)] p-3 text-start outline-none', 'focus-visible:ring-2 focus-visible:ring-emerald-400')}>
              <span className="block break-words text-sm font-bold text-[color:var(--stanza-text-primary)]">{article.title[locale]}</span>
              <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[color:var(--stanza-text-muted)]">{article.summary[locale]}</span>
            </button>)}
          </div>
        </section>;
      })}
    </div>}
  </section>;
}
