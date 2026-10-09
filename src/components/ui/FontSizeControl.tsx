import { useId } from 'react';
import { useStanzaPreferences } from '../../lib/StanzaPreferencesContext';
import { useLanguage } from '../../lib/LanguageContext';
import { FONT_SCALES, FONT_PROFILES, type FontProfileId } from '../../lib/typography';
import { Select } from './FormControls';

export function FontSizeControl() {
  const helpId = useId();
  const familyId = useId();
  const sizeId = useId();
  const { fontScale, setFontScale, fontProfile, setFontProfile } = useStanzaPreferences();
  const { isRtl } = useLanguage();
  const labels = isRtl ? ['صغير', 'افتراضي', 'كبير', 'كبير جداً'] : ['Small', 'Default', 'Large', 'Extra Large'];
  return <section className="stanza-font-settings" dir={isRtl ? 'rtl' : 'ltr'}>
    <label htmlFor={familyId}>{isRtl ? 'نوع الخط' : 'Font family'}</label>
    <Select id={familyId} aria-describedby={familyId+"-help"} value={fontProfile} onChange={event => setFontProfile(event.target.value as FontProfileId)}>
        {FONT_PROFILES.map(profile => <option key={profile.id} value={profile.id}>{isRtl ? profile.labelAr : profile.label}</option>)}
    </Select>
    <p id={familyId+"-help"}>{FONT_PROFILES.find(profile => profile.id === fontProfile)?.latin} · {FONT_PROFILES.find(profile => profile.id === fontProfile)?.arabic}</p>
    <label htmlFor={sizeId}>{isRtl ? 'حجم الخط' : 'Font Size'}</label>
    <Select id={sizeId} aria-describedby={helpId} value={fontScale} onChange={event => setFontScale(Number(event.target.value))}>
        {FONT_SCALES.map((scale, index) => <option key={scale} value={scale}>
          {labels[index]} ({Math.round(scale * 100)}%)
        </option>)}
    </Select>
    <p id={helpId}>{isRtl ? 'حجم النص مستقل عن حجم الواجهة.' : 'Text size is independent of Interface Size.'}</p>
    <div className="stanza-typography-preview">
      <h4>{isRtl ? 'مساحة عمل Stanza' : 'Stanza workspace'}</h4>
      <p lang="en">Employee attendance</p>
      <p lang="ar" dir="rtl">حضور الموظفين · مساحة عمل واضحة</p>
      <p className="stanza-type-metric" dir="ltr">123,456.78 · ١٢٣٬٤٥٦٫٧٨</p>
      <p className="secondary">{isRtl ? 'نص ثانوي' : 'Secondary text'}</p>
      <small>{isRtl ? 'تسمية توضيحية' : 'Caption'}</small>
    </div>
  </section>;
}
