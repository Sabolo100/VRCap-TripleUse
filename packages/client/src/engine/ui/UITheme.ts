import { DOMAINS, type DomainCode } from '@vrcap/shared';

export interface UITheme {
  bg: string;
  surface: string;
  surfaceAlt: string;
  accent: string;
  accentSoft: string;
  accent2: string;
  text: string;
  textMuted: string;
  ok: string;
  warn: string;
  bad: string;
  line: string;
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
  radius: number;
}

/** Panel themes are opaque: a translucent panel in VR reads as dirty glass. */
export function themeForDomain(code: DomainCode): UITheme {
  const d = DOMAINS[code];
  const p = d.palette;
  return {
    bg: solidify(p.bg),
    surface: solidify(p.surface, p.bg),
    surfaceAlt: solidify(p.surfaceAlt, p.bg),
    accent: p.accent,
    accentSoft: p.accentSoft,
    accent2: p.accent2,
    text: p.text,
    textMuted: p.textMuted,
    ok: p.ok,
    warn: p.warn,
    bad: p.bad,
    line: p.grid,
    fontDisplay: stripQuotesForCanvas(d.fontDisplay),
    fontBody: stripQuotesForCanvas(d.fontBody),
    fontMono: stripQuotesForCanvas(d.fontMono),
    radius: 14,
  };
}

/** Flatten rgba() over a base colour - canvas panels must be fully opaque. */
function solidify(color: string, base = '#0a0d12'): string {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return color;
  const parts = m[1]!.split(',').map((s) => parseFloat(s.trim()));
  const [r = 0, g = 0, b = 0, a = 1] = parts;
  const bb = hexToRgb(base);
  const mix = (c: number, d: number) => Math.round(c * a + d * (1 - a));
  return `rgb(${mix(r, bb[0])}, ${mix(g, bb[1])}, ${mix(b, bb[2])})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function stripQuotesForCanvas(stack: string): string {
  return stack;
}

export function withAlpha(hex: string, alpha: number): string {
  if (hex.startsWith('rgb')) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
