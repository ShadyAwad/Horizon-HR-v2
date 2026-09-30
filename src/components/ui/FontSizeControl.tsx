import { useId } from 'react';
import { useStanzaPreferences } from '../../lib/StanzaPreferencesContext';
import { useLanguage } from '../../lib/LanguageContext';
import { FONT_SCALES } from '../../lib/typography';
import { Select } from './FormControls';

export function FontSizeControl() {
  const helpId = useId();
  const { fontScale, setFontScale } = useStanzaPreferences();
  const { isRtl } = useLanguage();
  const labels = isRtl ? ['صغير', 'افتراضي', 'كبير', 'كبير جداً'] : ['Small', 'Default', 'Large', 'Extra Large'];
  return <section className="stanza-font-settings" dir={isRtl ? 'rtl' : 'ltr'}>
    <label>{isRtl ? 'حجم الخط' : 'Font Size'}
      <Select aria-describedby={helpId} value={fontScale} onChange={event => setFontScale(Number(event.target.value))}>
        {FONT_SCALES.map((scale, index) => <option key={scale} value={scale}>
          {labels[index]} ({Math.round(scale * 100)}%)
        </option>)}
      </Select>
    </label>
    <p id={helpId}>{isRtl ? 'حجم النص مستقل عن حجم الواجهة.' : 'Text size is independent of Interface Size.'}</p>
    <div className="stanza-typography-preview">
      <h4>{isRtl ? 'عنوان المعاينة' : 'Preview heading'}</h4>
      <p>{isRtl ? 'نص أساسي واضح وسهل القراءة.' : 'Readable body text.'}</p>
      <p className="secondary">{isRtl ? 'نص ثانوي' : 'Secondary text'}</p>
      <small>{isRtl ? 'تسمية توضيحية' : 'Caption'}</small>
    </div>
  </section>;
}
