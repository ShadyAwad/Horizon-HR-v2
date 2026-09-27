import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useStanzaPreferences } from '../lib/StanzaPreferencesContext';
import { useTheme } from '../lib/ThemeContext';
import { useLanguage } from '../lib/LanguageContext';
import { CURSOR_EFFECTS, DEFAULT_CUSTOM_THEME, deriveCustomTheme, normaliseCustomAccent, normaliseCustomTheme, type CustomThemeConfig } from '../lib/custom-theme';
import CustomCursorEffect from './CustomCursorEffect';

const COLOR_FIELDS = ['accent', 'primaryAction', 'secondaryAction', 'surfaceTint', 'backgroundTint', 'cursorColor'] as const;

export default function CustomThemeEditor() {
  const { customTheme, setCustomTheme } = useStanzaPreferences();
  const { theme } = useTheme();
  const { t, isRtl } = useLanguage();
  const id = useId();
  const preview = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(customTheme);
  useEffect(() => setDraft(customTheme), [customTheme]);
  const valid = COLOR_FIELDS.every((field) => draft[field] === null || normaliseCustomAccent(draft[field]) !== null);
  const normalized = useMemo(() => normaliseCustomTheme(draft, customTheme.accent), [draft, customTheme.accent]);
  const palette = useMemo(() => deriveCustomTheme(normalized, theme), [normalized, theme]);
  const previewStyle = useMemo(() => Object.fromEntries(Object.entries(palette.tokens).map(([key, value]) => [`--stanza-${key}`, value])) as CSSProperties, [palette]);
  const changed = JSON.stringify(normalized) !== JSON.stringify(customTheme);
  const update = <K extends keyof CustomThemeConfig>(field: K, value: CustomThemeConfig[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const commit = () => { if (valid) setCustomTheme(normalized); };
  const colorControl = (field: typeof COLOR_FIELDS[number]) => {
    const value = draft[field];
    const swatch = normaliseCustomAccent(value) ?? normalized.accent;
    const invalid = value !== null && normaliseCustomAccent(value) === null;
    return <div className="stanza-studio-color" key={field}>
      <label htmlFor={`${id}-${field}`}>{t(`studio.${field}`)}<small>{value === null ? t('studio.derived') : t('studio.custom')}</small></label>
      <input type="color" aria-label={`${t(`studio.${field}`)} — ${t('background.colorPicker')}`} value={swatch} onChange={(event) => update(field, event.target.value)} />
      <input id={`${id}-${field}`} type="text" dir="ltr" value={value ?? ''} placeholder={normalized.accent} spellCheck={false} maxLength={7}
        aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => update(field, event.target.value === '' && field !== 'accent' ? null : event.target.value)}
        onBlur={() => { const color = normaliseCustomAccent(value); if (color) update(field, color); }} />
      {field !== 'accent' && <button type="button" className="stanza-studio-derived" disabled={value === null} aria-label={`${t('studio.useAccent')}: ${t(`studio.${field}`)}`} onClick={() => update(field, null)}>{t('studio.auto')}</button>}
    </div>;
  };

  return <section className="stanza-custom-editor" dir={isRtl ? 'rtl' : 'ltr'} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{t('studio.title')}</h3>
    <p>{t('studio.help')}</p>
    <details className="stanza-studio-section" open>
      <summary>{t('studio.colors')}</summary>
      <div className="stanza-studio-fields">{COLOR_FIELDS.filter((field) => field !== 'cursorColor').map(colorControl)}</div>
    </details>
    <details className="stanza-studio-section">
      <summary>{t('studio.pointer')}</summary>
      <div className="stanza-studio-fields">
        <label className="stanza-studio-setting">{t('studio.effect')}<select value={draft.cursorEffect} onChange={(event) => update('cursorEffect', event.target.value as CustomThemeConfig['cursorEffect'])}>
          {CURSOR_EFFECTS.map((effect) => <option key={effect} value={effect}>{t(`studio.${effect}`)}</option>)}
        </select></label>
        <p>{t('studio.pointerHelp')}</p>
        {draft.cursorEffect !== 'none' && <>
          {colorControl('cursorColor')}
          <label className="stanza-studio-setting" htmlFor={`${id}-intensity`}>{t('studio.intensity')}<output>{draft.cursorTrailIntensity}%</output><input id={`${id}-intensity`} type="range" min="10" max="80" step="1" value={draft.cursorTrailIntensity} onChange={(event) => update('cursorTrailIntensity', Number(event.target.value))} /></label>
          <label className="stanza-studio-setting" htmlFor={`${id}-length`}>{t('studio.length')}<output>{draft.cursorTrailLength}</output><input id={`${id}-length`} type="range" min="3" max="12" step="1" disabled={draft.cursorEffect === 'glow'} value={draft.cursorTrailLength} onChange={(event) => update('cursorTrailLength', Number(event.target.value))} /></label>
        </>}
      </div>
    </details>
    {!valid && <p id={`${id}-error`} role="alert">{t('background.invalidColor')}</p>}
    {valid && palette.adjusted && <p role="status">{t('background.contrastAdjusted')}</p>}
    <h4>{t('background.preview')}</h4>
    <div ref={preview} data-custom-cursor-preview className="stanza-custom-preview" style={previewStyle} aria-label={t('background.preview')}>
      <div className="stanza-custom-preview-nav">{t('background.previewSelected')}</div>
      <div className="stanza-custom-preview-content"><strong>{t('background.previewText')}</strong><p>{t('background.previewBody')}</p>
        <div className="stanza-studio-preview-actions"><button type="button" className="stanza-custom-preview-primary">{t('background.previewButton')}</button>
          <button type="button" className="stanza-custom-preview-secondary">{t('studio.secondaryAction')}</button></div>
        <label className="stanza-studio-preview-input">{t('studio.focusPreview')}<input readOnly value={t('studio.sampleInput')} /></label>
      </div>
      {draft.cursorEffect !== 'none' && <CustomCursorEffect config={normalized} previewTarget={preview} />}
    </div>
    <p>{t('studio.previewHelp')}</p>
    <div className="stanza-studio-actions">
      <button type="button" className="stanza-primary-action stanza-theme-primary" disabled={!valid || !changed} onClick={commit}>{t('studio.apply')}</button>
      <button type="button" className="stanza-secondary-action" disabled={!changed && valid} onClick={() => setDraft(customTheme)}>{t('studio.discard')}</button>
      <button type="button" className="stanza-secondary-action" onClick={() => { setDraft({ ...DEFAULT_CUSTOM_THEME }); setCustomTheme({ ...DEFAULT_CUSTOM_THEME }); }}>{t('studio.reset')}</button>
    </div>
  </section>;
}
