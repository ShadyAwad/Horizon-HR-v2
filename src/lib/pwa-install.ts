export type PwaInstallPlatform = 'android' | 'ios' | 'chromium' | 'firefox' | 'other';
export type PwaInstallMode = 'installed' | 'direct' | 'ios-manual' | 'firefox-manual' | 'browser-manual';

type NavigatorLike = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>;

export function detectPwaInstallPlatform(navigatorLike: NavigatorLike): PwaInstallPlatform {
  const userAgent = navigatorLike.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(userAgent) ||
    (navigatorLike.platform === 'MacIntel' && navigatorLike.maxTouchPoints > 1);

  if (isIos) return 'ios';
  if (/android/i.test(userAgent)) return 'android';
  if (/firefox\//i.test(userAgent)) return 'firefox';
  if (/(chrome|chromium|edg)\//i.test(userAgent)) return 'chromium';
  return 'other';
}

export function getPwaInstallMode({
  platform,
  hasDeferredPrompt,
  isStandalone,
}: {
  platform: PwaInstallPlatform;
  hasDeferredPrompt: boolean;
  isStandalone: boolean;
}): PwaInstallMode {
  if (isStandalone) return 'installed';
  if (hasDeferredPrompt) return 'direct';
  if (platform === 'ios') return 'ios-manual';
  if (platform === 'firefox') return 'firefox-manual';
  return 'browser-manual';
}
