import { useStanzaPreferences } from '../../lib/StanzaPreferencesContext';
import { useLanguage } from '../../lib/LanguageContext';
import { LanyardDetails } from './LanyardDetails';
import { Component, useEffect, useMemo, useState, useRef, type ErrorInfo, type ReactNode } from 'react';
import type { AuthUser } from '../../auth/auth-contract';
import { apiFetch, apiUrl } from '../../lib/api';
import Lanyard from './Lanyard';
import { buildStanzaBackBadgeSvg, buildStanzaFrontBadgeSvg, type StanzaBadgeLanguage } from './stanzaBadgeArtwork';

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

class LanyardRuntimeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.warn('[Stanza Lanyard] Rendering disabled.', error, info.componentStack);
    }
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function StanzaDashboardLanyard({
  anchorNdc,
  eventSource,
  interactionEnabled,
  paused,
  language,
  direction,
  anchorSide,
  user,
}: {
  anchorNdc: { x: number; y: number };
  eventSource?: HTMLElement | null;
  interactionEnabled: boolean;
  paused: boolean;
  language: StanzaBadgeLanguage;
  direction: 'ltr' | 'rtl';
  anchorSide: 'left' | 'right';
  user: AuthUser;
}) {
  const { customTheme, lanyardPreview } = useStanzaPreferences();
  const { t } = useLanguage();
  const style = lanyardPreview ?? customTheme.lanyardStyle;
  const [expanded, setExpanded] = useState(false);
  const viewButton = useRef<HTMLButtonElement>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const expand = (point?: { x: number; y: number }) => { setOrigin(point ?? null); setExpanded(true); };
  const [profileImageDataUrl, setProfileImageDataUrl] = useState<string | null>(null);
  const stanzaFrontImage = useMemo(() => buildStanzaFrontBadgeSvg({ language, direction, style }), [direction, language, style]);

  useEffect(() => {
    const controller = new AbortController();
    if (!user.profileImageUrl) {
      setProfileImageDataUrl(null);
      return () => controller.abort();
    }

    void apiFetch(apiUrl(user.profileImageUrl), { signal: controller.signal, cache: 'force-cache' })
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load badge portrait.');
        return response.blob();
      })
      .then(blobToDataUrl)
      .then((dataUrl) => setProfileImageDataUrl(dataUrl))
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') setProfileImageDataUrl(null);
      });

    return () => controller.abort();
  }, [user.profileImageUrl]);

  const stanzaBackImage = useMemo(
    () => buildStanzaBackBadgeSvg({ ...user, profileImageDataUrl }, { language, direction, style }),
    [style, direction, language, profileImageDataUrl, user.email, user.id, user.jobTitle, user.name, user.role, user.tenant, user.tenantId]
  );

  useEffect(() => {
    if (import.meta.env.DEV) console.debug('[lanyard] artwork changed', language);
  }, [language]);

  return (
    <div
      aria-label="Flip employee identification badge"
      role="group"
      aria-hidden={!interactionEnabled}
      data-anchor-side={anchorSide}
      className="stanza-dashboard-lanyard pointer-events-none absolute inset-0 z-10 h-full w-full overflow-hidden bg-transparent"
    >
      <LanyardRuntimeBoundary>
        <Lanyard
          position={[0, 0, 24]}
          gravity={[0, -40, 0]}
          fov={20}
          anchorNdc={anchorNdc}
          eventSource={eventSource}
          paused={paused || expanded}
          onExpand={expand}
          strapColor={style.strapColor}
          interactionEnabled={interactionEnabled && !expanded}
          artworkLanguage={language}
          frontImage={stanzaFrontImage}
          backImage={stanzaBackImage}
          imageFit="cover"
          transparent
        />
      </LanyardRuntimeBoundary>
      {interactionEnabled && <button ref={viewButton} type="button" className="stanza-lanyard-view pointer-events-auto" onClick={() => expand()}>{t('lanyard.view')}</button>}
      {expanded && <LanyardDetails origin={origin} user={user} portrait={profileImageDataUrl} style={style} returnFocus={viewButton.current} onClose={() => setExpanded(false)} />}
    </div>
  );
}
