import { useEffect, type RefObject } from 'react';
import { installCustomCursor } from '../lib/custom-cursor';
import type { CustomThemeConfig } from '../lib/custom-theme';

export default function CustomCursorEffect({ config, previewTarget }: {
  config: CustomThemeConfig;
  previewTarget?: RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    if (config.cursorEffect === 'none') return;
    const target = previewTarget ? previewTarget.current : document.body;
    if (target) return installCustomCursor(config, target, Boolean(previewTarget));
  }, [config, previewTarget]);
  return null;
}
