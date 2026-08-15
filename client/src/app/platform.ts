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

function probe(): CSSStyleDeclaration | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!safeAreaProbe) {
    safeAreaProbe = document.createElement('div');
    safeAreaProbe.style.cssText =
      'position:fixed;top:-1px;left:-1px;width:0;height:0;visibility:hidden;' +
      'pointer-events:none;padding-right:env(safe-area-inset-right);' +
      'padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(safeAreaProbe);
  }
  return getComputedStyle(safeAreaProbe);
}

/** Current env(safe-area-inset-right) in px, measured via a hidden probe. */
function safeAreaInsetRight(): number {
  return parseFloat(probe()?.paddingRight ?? '') || 0;
}

function safeAreaInsetBottom(): number {
  return parseFloat(probe()?.paddingBottom ?? '') || 0;
}

/**
 * Screen px the camera keeps clear of the battlefield's right edge so tanks
 * never hide behind the touch HUD column. Mirrors MobileControls' layout:
 * the column hugs the wall at max(0.25rem, a quarter of the safe-area inset)
 * and its widest widget (the fire button) is 64px, plus breathing room.
 */
export function touchHudRightReserve(): number {
  if (!IS_COARSE_POINTER) return 0;
  return Math.max(4, safeAreaInsetRight() / 4) + 72;
}

/**
 * Screen px of the bottom HUD band (weapon tray + angle/power readouts) the
 * camera keeps the lowest tank above, so a unit in a deep valley can never
 * hide behind the controls.
 */
export function hudBottomReserve(): number {
  return (IS_COARSE_POINTER ? 128 : 150) + safeAreaInsetBottom();
}
