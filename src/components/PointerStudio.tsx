import { useId, useMemo, useRef } from 'react';
import { useLanguage } from '../lib/LanguageContext';
import { applyPointerPreset, CURSOR_APPEARANCES, CURSOR_EFFECTS, hasCustomCursor, normaliseCustomAccent, normaliseCustomTheme, POINTER_PRESETS, type CustomThemeConfig } from '../lib/custom-theme';
import CustomCursorEffect from './CustomCursorEffect';

type NumericSetting = { [K in keyof CustomThemeConfig]: CustomThemeConfig[K] extends number ? K : never }[keyof CustomThemeConfig];
export default function PointerStudio({ draft, onChange, onColorInput, flushColors }: { draft: CustomThemeConfig; onChange: (config: CustomThemeConfig) => void; onColorInput?: (field: 'pointerColor' | 'cursorColor', value: string) => void; flushColors?: () => void }) {
  const { t } = useLanguage();
  const id = useId();
  const preview = useRef<HTMLDivElement>(null);
  const config = useMemo(() => normaliseCustomTheme(draft), [draft]);
  const update = <K extends keyof CustomThemeConfig>(field: K, value: CustomThemeConfig[K]) => onChange({ ...draft, [field]: value });
  const range = (field: NumericSetting, label: 'size' | 'opacity' | 'outline' | 'glow' | 'length' | 'width' | 'brightness' | 'smoothness' | 'fade' | 'motion', min: number, max: number) => <label className="stanza-studio-setting" htmlFor={`${id}-${field}`}>
    {t(`pointer.${label}`)}<output>{draft[field]}</output><input id={`${id}-${field}`} type="range" min={min} max={max} value={draft[field]} onChange={(event) => update(field, Number(event.target.value))} />
  </label>;
  const color = (field: 'pointerColor' | 'cursorColor', label: 'pointerColor' | 'trailColor') => {
    const valid = draft[field] === null || Boolean(normaliseCustomAccent(draft[field]));
    return <div className="stanza-studio-color">
      <label htmlFor={`${id}-${field}`}>{t(`pointer.${label}`)}<small>{t(draft[field] === null ? 'studio.derived' : 'studio.custom')}</small></label>
      <input type="color" aria-label={t(`pointer.${label}`)} value={normaliseCustomAccent(draft[field]) ?? config.accent} onInput={event=>onColorInput ? onColorInput(field,event.currentTarget.value) : update(field,event.currentTarget.value)} onChange={event=>{if(event.nativeEvent.type==='change')flushColors?.();}} onBlur={flushColors} onKeyUp={flushColors} />
      <input id={`${id}-${field}`} type="text" dir="ltr" maxLength={7} spellCheck={false} value={draft[field] ?? ''} placeholder={config.accent} aria-invalid={!valid} aria-describedby={!valid ? `${id}-color-error` : undefined} onChange={(event) => update(field, event.target.value || null)} onBlur={event=>{const color=normaliseCustomAccent(event.currentTarget.value);if(color && onColorInput){onColorInput(field,color);flushColors?.();}}} />
      <button type="button" className="stanza-studio-derived" disabled={draft[field] === null} aria-label={`${t('studio.useAccent')}: ${t(`pointer.${label}`)}`} onClick={() => update(field, null)}>{t('studio.auto')}</button>
    </div>;
  };
  const pointer = draft.cursorAppearance !== 'system';
  const trail = draft.cursorEffect !== 'none';
  const chained = ['lerp-trail', 'portfolio-trail', 'comet', 'ribbon'].includes(draft.cursorEffect);
  return <details className="stanza-studio-section">
    <summary>{t('studio.pointer')}</summary>
    <div className="stanza-studio-fields">
      <p>{t('pointer.help')}</p>
      <div className="stanza-pointer-presets" role="group" aria-label={t('pointer.presets')}>
        {POINTER_PRESETS.map((preset) => <button key={preset} type="button" onClick={() => onChange(applyPointerPreset(draft, preset))}>{t(`pointer.preset.${preset}`)}</button>)}
      </div>
      <label className="stanza-studio-setting">{t('pointer.appearance')}<select value={draft.cursorAppearance} onChange={(event) => update('cursorAppearance', event.target.value as CustomThemeConfig['cursorAppearance'])}>
        {CURSOR_APPEARANCES.map((appearance) => <option key={appearance} value={appearance}>{t(`pointer.appearance.${appearance}`)}</option>)}
      </select></label>
      {pointer && <>
        {color('pointerColor', 'pointerColor')}
        <div className="stanza-pointer-ranges">
          {range('pointerSize', 'size', 6, 32)}{range('pointerOpacity', 'opacity', 35, 100)}
          {['ring', 'dot-ring', 'crosshair'].includes(draft.cursorAppearance) && range('pointerOutline', 'outline', 1, 4)}
          {draft.cursorAppearance !== 'minimal-arrow' && range('pointerGlow', 'glow', 0, 80)}
        </div>
      </>}
      <label className="stanza-studio-setting">{t('studio.effect')}<select value={draft.cursorEffect} onChange={(event) => update('cursorEffect', event.target.value as CustomThemeConfig['cursorEffect'])}>
        {CURSOR_EFFECTS.map((effect) => <option key={effect} value={effect}>{t(`studio.${effect}`)}</option>)}
      </select></label>
      {trail && <>
        {color('cursorColor', 'trailColor')}
        <details className="stanza-pointer-tuning"><summary>{t('pointer.tuning')}</summary><div className="stanza-pointer-ranges">
          {draft.cursorEffect !== 'glow' && range('cursorTrailLength', 'length', 3, 12)}
          {range('cursorTrailSize', 'width', 2, 14)}{range('cursorTrailIntensity', 'brightness', 10, 80)}
          {draft.cursorEffect !== 'glow' && range('cursorTrailGlow', 'glow', 0, 80)}
          {chained && range('cursorSmoothness', 'smoothness', 0, 100)}
          {range('cursorFadeSpeed', 'fade', 0, 100)}
          {(chained || ['orbit', 'sparks'].includes(draft.cursorEffect)) && range('cursorVelocityResponse', 'motion', 0, 100)}
        </div></details>
      </>}
      {(['pointerColor', 'cursorColor'] as const).some((field) => draft[field] !== null && !normaliseCustomAccent(draft[field])) && <p role="alert" id={`${id}-color-error`}>{t('background.invalidColor')}</p>}
      <div ref={preview} data-custom-cursor-preview className="stanza-pointer-preview" aria-label={t('pointer.preview')}>
        <p>{t('pointer.try')}</p>
        <button type="button">{t('pointer.button')}</button>
        <a href="#pointer-preview" onClick={(event) => event.preventDefault()}>{t('pointer.link')}</a>
        <label>{t('pointer.text')}<input placeholder={t('pointer.placeholder')} /></label>
        {hasCustomCursor(config) && <CustomCursorEffect config={config} previewTarget={preview} />}
      </div>
    </div>
  </details>;
}
