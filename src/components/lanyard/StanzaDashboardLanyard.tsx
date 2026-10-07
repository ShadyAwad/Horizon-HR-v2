import {useStanzaCardArtwork} from './useStanzaCardArtwork';
import { useLanguage } from '../../lib/LanguageContext';
import { LanyardDetails } from './LanyardDetails';
import { Component, useState, useRef, type ErrorInfo, type ReactNode } from 'react';
import type { AuthUser } from '../../auth/auth-contract';
import Lanyard from './Lanyard';
import { type StanzaBadgeLanguage } from './stanzaBadgeArtwork';

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
  const {frontImage:stanzaFrontImage,backImage:stanzaBackImage,style}=useStanzaCardArtwork(user);
  const {t}=useLanguage();
  const [expanded, setExpanded] = useState(false);
  const viewButton = useRef<HTMLButtonElement>(null);
  const expand = () => setExpanded(true);
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
      {expanded && <LanyardDetails user={user} frontImage={stanzaFrontImage} backImage={stanzaBackImage} returnFocus={viewButton.current} onClose={() => setExpanded(false)} />}
    </div>
  );
}
