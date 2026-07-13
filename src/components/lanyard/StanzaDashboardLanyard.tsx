import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import type { AuthUser } from '../../App';
import { apiUrl } from '../../lib/api';
import Lanyard from './Lanyard';
import { buildStanzaBackBadgeSvg, buildStanzaFrontBadgeSvg } from './stanzaBadgeArtwork';

const stanzaFrontImage = buildStanzaFrontBadgeSvg();

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
  hidden,
  onReady,
  user,
}: {
  anchorNdc: { x: number; y: number };
  eventSource?: HTMLElement | null;
  hidden: boolean;
  onReady?: () => void;
  user: AuthUser;
}) {
  const [profileImageDataUrl, setProfileImageDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    if (!user.profileImageUrl) {
      setProfileImageDataUrl(null);
      return () => controller.abort();
    }

    void fetch(apiUrl(user.profileImageUrl), { signal: controller.signal, cache: 'force-cache' })
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
    () => buildStanzaBackBadgeSvg({ ...user, profileImageDataUrl }),
    [profileImageDataUrl, user.email, user.id, user.jobTitle, user.name, user.role, user.tenant, user.tenantId]
  );

  return (
    <div
      aria-label="Flip employee identification badge"
      role="group"
      className="stanza-dashboard-lanyard pointer-events-none fixed inset-0 z-[15] h-[100dvh] w-screen overflow-hidden bg-transparent transition-opacity duration-200"
      style={{ opacity: hidden ? 0 : 1 }}
    >
      <LanyardRuntimeBoundary>
        <Lanyard
          position={[0, 0, 24]}
          gravity={[0, -40, 0]}
          fov={20}
          anchorNdc={anchorNdc}
          eventSource={eventSource}
          paused={hidden}
          frontImage={stanzaFrontImage}
          backImage={stanzaBackImage}
          imageFit="cover"
          onReady={onReady}
          transparent
        />
      </LanyardRuntimeBoundary>
    </div>
  );
}
