import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useStanzaPreferences } from '../lib/StanzaPreferencesContext';
import { useTheme } from '../lib/ThemeContext';
import { useLanguage } from '../lib/LanguageContext';
import { DEFAULT_CUSTOM_ACCENT, deriveCustomTheme, normaliseCustomAccent } from '../lib/custom-theme';

export default function CustomThemeEditor() {
  const { customAccent, setCustomAccent } = useStanzaPreferences();
  const { theme } = useTheme();
  const { t, isRtl } = useLanguage();
  const [draft, setDraft] = useState(customAccent);
  useEffect(() => setDraft(customAccent), [customAccent]);
  const valid = normaliseCustomAccent(draft);
  const palette = useMemo(() => deriveCustomTheme(valid ?? customAccent, theme), [valid, customAccent, theme]);
  const previewStyle = useMemo(() => Object.fromEntries(Object.entries(palette.tokens).map(([key, value]) => [`--stanza-${key}`, value])) as CSSProperties, [palette]);
  const commit = () => { if (valid) setCustomAccent(valid); };

  return <section className="stanza-custom-editor" dir={isRtl ? 'rtl' : 'ltr'} aria-labelledby="custom-color-title">
    <h3 id="custom-color-title">{t('background.customColor')}</h3>
    <p>{t('background.customHelp')}</p>
    <div className="stanza-custom-inputs">
      <label>{t('background.accentColor')}<input type="color" aria-label={t('background.colorPicker')} value={valid ?? customAccent} onChange={(event) => setDraft(event.target.value)} onBlur={commit} /></label>
      <label>{t('background.hexColor')}<input type="text" dir="ltr" value={draft} spellCheck={false} maxLength={7} aria-invalid={!valid} aria-describedby={!valid ? 'custom-color-error' : undefined} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') commit(); }} /></label>
      <button type="button" className="stanza-secondary-action" disabled={!valid || valid === customAccent} onClick={commit}>{t('background.applyColor')}</button>
    </div>
    {!valid && <p id="custom-color-error" role="alert">{t('background.invalidColor')}</p>}
    {valid && palette.adjusted && <p role="status">{t('background.contrastAdjusted')}</p>}
    <div className="stanza-custom-preview" style={previewStyle} aria-label={t('background.preview')}>
      <div className="stanza-custom-preview-nav">{t('background.previewSelected')}</div>
      <div className="stanza-custom-preview-content"><strong>{t('background.previewText')}</strong><p>{t('background.previewBody')}</p><button type="button" className="stanza-custom-preview-primary">{t('background.previewButton')}</button></div>
    </div>
    <button type="button" className="stanza-secondary-action" onClick={() => { setDraft(DEFAULT_CUSTOM_ACCENT); setCustomAccent(DEFAULT_CUSTOM_ACCENT); }}>{t('background.resetCustom')}</button>
  </section>;
}
