import { Component, type ErrorInfo, type ReactNode } from 'react';
import Lanyard from './Lanyard';

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
}: {
  anchorNdc: { x: number; y: number };
  eventSource?: HTMLElement | null;
  hidden: boolean;
  onReady?: () => void;
}) {
  return (
    <div
      aria-hidden="true"
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
          onReady={onReady}
          transparent
        />
      </LanyardRuntimeBoundary>
    </div>
  );
}
