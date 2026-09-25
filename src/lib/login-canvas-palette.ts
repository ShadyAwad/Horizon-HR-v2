export function resolveLoginCanvasPalette(root: HTMLElement) {
  const styles = getComputedStyle(root);
  const isDark = root.classList.contains('dark');
  const authBackground = styles.getPropertyValue('--stanza-auth-background').trim() || (isDark ? '#020604' : '#f7fbf8');
  const authRingRgb = styles.getPropertyValue('--stanza-auth-ring-rgb').trim() || '16, 185, 129';
  const authPulseRgb = styles.getPropertyValue('--stanza-auth-pulse-rgb').trim() || '52, 211, 153';
  const [baseRed = 16, baseGreen = 185, baseBlue = 129] = authRingRgb.split(',').map((value) => Number.parseInt(value.trim(), 10));
  const [pulseRed = 52, pulseGreen = 211, pulseBlue = 153] = authPulseRgb.split(',').map((value) => Number.parseInt(value.trim(), 10));
  return { isDark, authBackground, authRingRgb, baseRed, baseGreen, baseBlue, pulseRed, pulseGreen, pulseBlue };
}
