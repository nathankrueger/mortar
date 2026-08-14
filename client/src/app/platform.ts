/** Platform sniffs for the fullscreen story, which differs per OS. */

export const IS_COARSE_POINTER =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS masquerades as macOS but has touch.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Launched from the home-screen icon (chromeless PWA mode)? */
export function isStandalone(): boolean {
  return (
    (navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  );
}

/** Element fullscreen API exists (Android Chrome, desktop — not iPhone). */
export const CAN_FULLSCREEN =
  typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;

let safeAreaProbe: HTMLDivElement | null = null;

/** Current env(safe-area-inset-right) in px, measured via a hidden probe. */
function safeAreaInsetRight(): number {
  if (typeof document === 'undefined' || !document.body) return 0;
  if (!safeAreaProbe) {
    safeAreaProbe = document.createElement('div');
    safeAreaProbe.style.cssText =
      'position:fixed;top:-1px;left:-1px;width:0;height:0;visibility:hidden;' +
      'pointer-events:none;padding-right:env(safe-area-inset-right)';
    document.body.appendChild(safeAreaProbe);
  }
  return parseFloat(getComputedStyle(safeAreaProbe).paddingRight) || 0;
}

/**
 * Screen px the camera keeps clear of the battlefield's right edge so tanks
 * never hide behind the touch HUD column. Mirrors MobileControls' layout:
 * the column hugs the wall at max(0.5rem, half the safe-area inset) and its
 * widest widget (the fire button) is 64px, plus a little breathing room.
 */
export function touchHudRightReserve(): number {
  if (!IS_COARSE_POINTER) return 0;
  return Math.max(8, safeAreaInsetRight() / 2) + 72;
}
