import { FontSizeControl } from './ui/FontSizeControl';
import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { useStanzaPreferences } from '../lib/StanzaPreferencesContext';
import { useTheme } from '../lib/ThemeContext';
import { useLanguage } from '../lib/LanguageContext';
import { DEFAULT_CUSTOM_THEME, deriveCustomTheme, normaliseCustomAccent, normaliseCustomTheme, type CustomThemeConfig } from '../lib/custom-theme';
import PointerStudio from './PointerStudio';

const COLOR_FIELDS = ['accent', 'primaryAction', 'secondaryAction', 'surfaceTint', 'backgroundTint', 'textColor', 'hoverHighlight'] as const;

export default function CustomThemeEditor() {
  const { customTheme, setCustomTheme, setLanyardPreview } = useStanzaPreferences();
  const { theme } = useTheme();
  const { t, isRtl } = useLanguage();
  const id = useId();
  const [draft, setDraft] = useState(customTheme);
  useEffect(() => setDraft(customTheme), [customTheme]);
  const valid = [...COLOR_FIELDS, 'cursorColor', 'pointerColor'].every((field) => draft[field] === null || normaliseCustomAccent(draft[field]) !== null)
    && Object.values(draft.lanyardStyle).every((value) => value === null || normaliseCustomAccent(value) !== null);
  const normalized = useMemo(() => normaliseCustomTheme(draft, customTheme.accent), [draft, customTheme.accent]);
  useEffect(() => { setLanyardPreview(normalized.lanyardStyle); return () => setLanyardPreview(null); }, [normalized.lanyardStyle, setLanyardPreview]);
  const palette = useMemo(() => deriveCustomTheme(normalized, theme), [normalized, theme]);
  const previewStyle = useMemo(() => ({ ...Object.fromEntries(Object.entries(palette.tokens).map(([key, value]) => [`--stanza-${key}`, value])), '--stanza-surface-hover': palette.tokens['hover-surface'] }) as CSSProperties, [palette]);
  const changed = JSON.stringify(normalized) !== JSON.stringify(customTheme);
  const update = <K extends keyof CustomThemeConfig>(field: K, value: CustomThemeConfig[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const commit = () => { if (valid) setCustomTheme(normalized); };
  const colorControl = (field: typeof COLOR_FIELDS[number]) => {
    const value = draft[field];
    const derived = field === 'textColor' ? palette.tokens['text-primary'] : field === 'hoverHighlight' ? palette.tokens['hover-surface'] : normalized.accent;
    const swatch = normaliseCustomAccent(value) ?? derived;
    const invalid = value !== null && normaliseCustomAccent(value) === null;
    return <div className="stanza-studio-color" key={field}>
      <label htmlFor={`${id}-${field}`}>{t(`studio.${field}`)}<small>{value === null ? t(field === 'textColor' ? 'studio.auto' : 'studio.derived') : t('studio.custom')}</small></label>
      <input type="color" aria-label={`${t(`studio.${field}`)} — ${t('background.colorPicker')}`} value={swatch} onChange={(event) => update(field, event.target.value)} />
      <input id={`${id}-${field}`} type="text" dir="ltr" value={value ?? ''} placeholder={derived} spellCheck={false} maxLength={7}
        aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => update(field, event.target.value === '' && field !== 'accent' ? null : event.target.value)}
        onBlur={() => { const color = normaliseCustomAccent(value); if (color) update(field, color); }} />
      {field !== 'accent' && <button type="button" className="stanza-studio-derived" disabled={value === null} aria-label={`${t('studio.auto')}: ${t(`studio.${field}`)}`} onClick={() => update(field, null)}>{t('studio.auto')}</button>}
    </div>;
  };

  return <section className="stanza-custom-editor" dir={isRtl ? 'rtl' : 'ltr'} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{t('studio.title')}</h3>
    <p>{t('studio.help')}</p>
    <FontSizeControl />
    <details className="stanza-studio-section" open>
      <summary>{t('studio.colors')}</summary>
      <div className="stanza-studio-fields">{COLOR_FIELDS.map(colorControl)}</div>
    </details>
    <details className="stanza-studio-section">
      <summary>{t('studio.lanyard')}</summary>
      <p>{t('studio.lanyardHelp')}</p>
      <div className="stanza-studio-fields">{(['cardColor', 'accentColor', 'strapColor'] as const).map((field) => <div className="stanza-studio-color" key={field}>
        <label htmlFor={`${id}-lanyard-hex-${field}`}>{t(`studio.${field}`)}</label>
        <input id={`${id}-lanyard-${field}`} type="color" aria-label={`${t(`studio.${field}`)} — ${t('background.colorPicker')}`} value={normaliseCustomAccent(draft.lanyardStyle[field]) ?? (field === 'cardColor' ? '#061b13' : field === 'strapColor' ? '#d7f5e9' : '#18c98b')}
          onChange={(event) => update('lanyardStyle', { ...draft.lanyardStyle, [field]: event.target.value })} />
        <input id={`${id}-lanyard-hex-${field}`} type="text" dir="ltr" maxLength={7} spellCheck={false} value={draft.lanyardStyle[field] ?? ''} placeholder={t('studio.auto')}
          aria-invalid={draft.lanyardStyle[field] !== null && !normaliseCustomAccent(draft.lanyardStyle[field])}
          onChange={(event) => update('lanyardStyle', { ...draft.lanyardStyle, [field]: event.target.value || null })} />
        <button type="button" className="stanza-studio-derived" disabled={draft.lanyardStyle[field] === null}
          aria-label={`${t('studio.auto')}: ${t(`studio.${field}`)}`} onClick={() => update('lanyardStyle', { ...draft.lanyardStyle, [field]: null })}>{t('studio.auto')}</button>
      </div>)}</div>
    </details>
    <PointerStudio draft={draft} onChange={setDraft} />
    {!valid && <p id={`${id}-error`} role="alert">{t('background.invalidColor')}</p>}
    {valid && palette.hoverAdjusted && <p role="status">{isRtl ? 'عُدّل تظليل المرور لضمان ظهوره ووضوح النص. يُحفظ اللون الأصلي.' : 'Hover highlight adjusted for visibility and readable text. Your original color is saved.'}</p>}
    {valid && palette.adjusted && <p role="status">{t('background.contrastAdjusted')}</p>}
    <h4>{t('background.preview')}</h4>
    <div className="stanza-custom-preview" style={previewStyle} aria-label={t('background.preview')}>
      <button type="button" className="stanza-interactive-control rounded-lg px-3 py-2">{isRtl ? 'معاينة التظليل عند المرور' : 'Hover highlight preview'}</button>
      <div className="stanza-custom-preview-nav">{t('background.previewSelected')}</div>
      <div className="stanza-custom-preview-content"><strong>{t('background.previewText')}</strong><p>{t('background.previewBody')}</p><p style={{color:'var(--stanza-text-secondary)'}}>{isRtl ? 'نص ثانوي' : 'Secondary text'}</p><small style={{color:'var(--stanza-text-muted)'}}>{isRtl ? 'تسمية توضيحية' : 'Caption'}</small>
        <div className="stanza-studio-preview-actions"><button type="button" className="stanza-custom-preview-primary">{t('background.previewButton')}</button>
          <button type="button" className="stanza-custom-preview-secondary">{t('studio.secondaryAction')}</button></div>
        <label className="stanza-studio-preview-input">{t('studio.focusPreview')}<input readOnly value={t('studio.sampleInput')} /></label>
      </div>
    </div>
    <p>{t('studio.previewHelp')}</p>
    <div className="stanza-studio-actions">
      <button type="button" className="stanza-primary-action stanza-theme-primary" disabled={!valid || !changed} onClick={commit}>{t('studio.apply')}</button>
      <button type="button" className="stanza-secondary-action" disabled={!changed && valid} onClick={() => setDraft(customTheme)}>{t('studio.discard')}</button>
      <button type="button" className="stanza-secondary-action" onClick={() => { setDraft({ ...DEFAULT_CUSTOM_THEME }); setCustomTheme({ ...DEFAULT_CUSTOM_THEME }); }}>{t('studio.reset')}</button>
    </div>
  </section>;
}
