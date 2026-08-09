/** Platform sniffs for the fullscreen story, which differs per OS. */

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
