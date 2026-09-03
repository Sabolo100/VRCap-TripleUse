import { DOMAINS, type DomainCode } from '@vrcap/shared';

/** Push a domain palette into the 2D shell's custom properties. */
export function applyDomainTheme(domain: DomainCode | null): void {
  const root = document.documentElement;
  if (!domain) {
    root.removeAttribute('data-domain');
    return;
  }
  const d = DOMAINS[domain];
  const p = d.palette;
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  set('--bg', p.bg);
  set('--bg-alt', p.bgAlt);
  set('--surface', p.surface);
  set('--surface-alt', p.surfaceAlt);
  set('--accent', p.accent);
  set('--accent-soft', p.accentSoft);
  set('--accent-2', p.accent2);
  set('--text', p.text);
  set('--muted', p.textMuted);
  set('--ok', p.ok);
  set('--warn', p.warn);
  set('--bad', p.bad);
  set('--grid', p.grid);
  set('--font-display', d.fontDisplay);
  set('--font-body', d.fontBody);
  set('--font-mono', d.fontMono);
  root.setAttribute('data-domain', d.slug);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', p.bg);
}
