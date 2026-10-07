import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qrEncryptionConfigured} from '../src/server/qr/qr-token-crypto';
import {buildStanzaFrontBadgeSvg,buildStanzaBackBadgeSvg} from '../src/components/lanyard/stanzaBadgeArtwork';
import {DEFAULT_CUSTOM_THEME} from '../src/lib/custom-theme';
const read=(p:string)=>readFileSync(p,'utf8');const compact=read('src/components/lanyard/StanzaDashboardLanyard.tsx'),expanded=read('src/components/lanyard/LanyardDetails.tsx'),mobile=read('src/components/lanyard/DigitalCardPreviewButton.tsx');
assert(compact.includes('useStanzaCardArtwork(user)')&&mobile.includes('useStanzaCardArtwork(user)'));assert(compact.includes('frontImage={stanzaFrontImage} backImage={stanzaBackImage}'));assert(expanded.includes('encodeURIComponent(frontImage)')&&expanded.includes('encodeURIComponent(backImage)'));assert(expanded.includes('showModal()')&&expanded.includes('returnFocus.focus')&&expanded.includes('onCancel='));
const style=DEFAULT_CUSTOM_THEME.lanyardStyle;for(const language of ['en','ar'] as const){for(const builder of [buildStanzaFrontBadgeSvg,(o:any)=>buildStanzaBackBadgeSvg({name:'Example',email:'example@example.invalid'},o)]){const plain=builder({style,language});assert(plain.includes('<svg'));const changed=builder({style:{...style,accentColor:'#336699'},language});/* Artwork uses the same validated appearance resolver. */assert(changed.includes('<svg'));assert.notEqual(plain,changed,'custom appearance affects both artwork faces');}}
const logout=read('src/components/ui/LogoutControl.tsx');assert(logout.includes('StanzaFingerprintMark')&&logout.includes('stanza-destructive-action'));for(const p of ['src/pages/Dashboard.tsx','src/components/navigation/DashboardNavigation.tsx'])assert(read(p).includes('<LogoutControl onClick={onLogout}'));assert(!read('src/components/assets/MyEquipmentPanel.tsx').includes('window.prompt'));assert(read('src/components/support/SupportPanel.tsx').includes('ComposerDialog'));assert(read('src/components/ui/SurfaceSelector.tsx').includes('aria-pressed={value===id}'));assert(read('src/components/ui/HistoryControls.tsx').includes('disabled={!canBack}'));
assert(!qrEncryptionConfigured({}));assert(!qrEncryptionConfigured({QR_TOKEN_ENCRYPTION_KEY:'invalid'}));assert(qrEncryptionConfigured({QR_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')}));assert(read('src/components/qr/DigitalBadgePanel.tsx').includes('does not sign you in or clock you in'));console.log('PASS shared artwork/appearance source, expanded native dialog/focus, shared destructive logout, preserved history controls, structured support dialog, accessible surface selection and honest badge configuration states.');

for (const file of ['src/components/support/SupportPanel.tsx','src/components/workspace-composer/SummaryWidget.tsx']) assert.match(read(file), /'Content-Type':'application\/json'/, 'JSON mutations require an explicit content type');

const rtlBack=buildStanzaBackBadgeSvg({name:'Mixed Example',email:'example@example.invalid'},{language:'ar',direction:'rtl'});
assert.match(rtlBack, /x="586" y="310" text-anchor="start"/);
assert.match(rtlBack, /x="586" y="614" text-anchor="end" direction="ltr"/);
assert.match(rtlBack, /x="486" y="113"/);
