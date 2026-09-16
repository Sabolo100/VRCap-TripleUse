/**
 * Web font readiness for canvas panels.
 *
 * DOM text re-renders by itself when a web font arrives; a canvas does not. A
 * panel drawn before its font has loaded keeps the fallback glyphs until
 * something else happens to invalidate it - and with Google Fonts the family
 * is split into unicode-range subsets, so the Latin subset can be present while
 * the Latin Extended one (Ő, Ű, ő, ű) is not: the title then renders with a
 * single foreign-looking glyph in an otherwise correct word.
 *
 * `ensureFonts` asks for every family/weight a panel can use, with a sample
 * string that forces the Latin Extended subset, and resolves when they are in
 * (or after a timeout, so a slow CDN cannot hold the test up). PanelManager
 * additionally redraws every panel on `document.fonts` `loadingdone`, which
 * covers faces that arrive later anyway.
 */

const SAMPLE = 'ŐŰőűÁÉÍÓÖÚÜáéíóöúü ÁRVÍZTŰRŐ TÜKÖRFÚRÓGÉP 0123456789';
const WEIGHTS = ['400', '500', '600', '700'];

export interface FontSet {
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
}

export async function ensureFonts(fonts: FontSet, timeoutMs = 3000): Promise<boolean> {
  const fs = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fs?.load) return false;
  const specs: string[] = [];
  for (const family of [fonts.fontDisplay, fonts.fontBody, fonts.fontMono]) {
    for (const w of WEIGHTS) specs.push(`${w} 32px ${family}`);
  }
  const all = Promise.all(specs.map((s) => fs.load(s, SAMPLE).catch(() => [])));
  const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs));
  const outcome = await Promise.race([all.then(() => 'ok' as const), timeout]);
  return outcome === 'ok';
}
