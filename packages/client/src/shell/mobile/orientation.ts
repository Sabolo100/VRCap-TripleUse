import { el } from '../dom.js';

/**
 * LANDSCAPE FOR MODULES.
 *
 * The module runner draws its instructions and buttons on a 1.5 m wide panel
 * in 3D. In landscape a phone has about 3 m of width available at that
 * distance and it fits comfortably; in portrait it has 1 m, so the panel is
 * cut off at both edges and the start button is off-screen.
 *
 * Fixing that properly means a portrait layout for the in-module UI, which is
 * a redesign of the test surface rather than of the shell. Asking the phone to
 * turn costs nothing, matches how every other game on the device behaves, and
 * leaves the modules themselves untouched.
 *
 * The lock only works in an installed or fullscreen PWA; in a normal tab the
 * promise rejects and the prompt does the work instead.
 */

let overlay: HTMLElement | null = null;
let mediaQuery: MediaQueryList | null = null;

function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth;
}

export function requestLandscape(): void {
  const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  so?.lock?.('landscape').catch(() => {
    /* Not allowed outside fullscreen / standalone. The prompt covers it. */
  });
  update();
  if (!mediaQuery) {
    mediaQuery = window.matchMedia('(orientation: portrait)');
    mediaQuery.addEventListener('change', update);
    // The orientation media query is not reliable everywhere - on several
    // Android browsers it lags a rotation, and it does not fire at all when
    // the address bar collapses and changes the aspect ratio. Resize does.
    window.addEventListener('resize', update);
  }
}

export function releaseLandscape(): void {
  const so = screen.orientation as ScreenOrientation & { unlock?: () => void };
  try { so?.unlock?.(); } catch { /* ignore */ }
  mediaQuery?.removeEventListener('change', update);
  window.removeEventListener('resize', update);
  mediaQuery = null;
  overlay?.remove();
  overlay = null;
}

function update(): void {
  if (!isPortrait()) {
    overlay?.remove();
    overlay = null;
    return;
  }
  if (overlay) return;
  overlay = el('div', { class: 'm-rotate' }, [
    el('div', { class: 'm-rotate-icon', html:
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2.5"/>
        <path d="M9 19h6"/></svg>` }),
    el('strong', {}, ['Fordítsd el a telefont']),
    el('p', {}, ['A teszt fekvő nézetben fut — így fér ki az utasítás és a válaszgomb.']),
  ]);
  document.body.appendChild(overlay);
}
