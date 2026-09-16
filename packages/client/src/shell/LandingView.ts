import { DOMAINS, DOMAIN_CODES, MODULES, modulesForDomain, type DomainCode } from '@vrcap/shared';
import { el, clear } from './dom.js';

/**
 * DOMAIN SELECTION - the first thing anyone sees.
 *
 * One platform, three products. Choosing here decides the palette, the wording,
 * the name of the headline score and, most importantly, which modules are shown:
 * each module declares its relevance per domain, so a sport user never has to
 * scroll past checkpoint-discipline tasks to find what applies to them.
 */
export function renderLanding(host: HTMLElement, onPick: (d: DomainCode) => void): void {
  clear(host);

  const activeCount = MODULES.filter((m) => m.status === 'active' || m.status === 'external').length;

  host.appendChild(
    el('div', { class: 'topbar' }, [
      el('div', { class: 'brand' }, [
        el('div', { class: 'mark' }),
        el('h1', {}, ['VR CAP · KOGNITÍV MÉRÉSI PLATFORM']),
      ]),
      el('div', { class: 'spacer' }),
      el('span', { class: 'chip muted' }, [`${MODULES.length} modul`]),
      el('span', { class: 'chip' }, ['WebXR']),
    ])
  );

  const wrap = el('div', { class: 'wrap' });

  wrap.appendChild(
    el('section', { class: 'hero' }, [
      el('div', { class: 'eyebrow' }, ['Három terület · Meta Quest 3 · böngésző']),
      el('h2', {}, ['Egy motor. Három terület.']),
      el('p', {}, [
        'Absztrakt ingerekre épülő, ismételhető kognitív, figyelmi, döntési és pszichomotoros mérés ' +
          'VR-ban, asztali böngészőben és mobilon. Ugyanaz a mérési rendszer három területen használható: ' +
          'védelem, munka és pályaorientáció, valamint sport. Válaszd ki a számodra megfelelő területet.',
      ]),
    ])
  );

  const grid = el('div', { class: 'domain-grid' });
  for (const code of DOMAIN_CODES) {
    const d = DOMAINS[code];
    const mods = modulesForDomain(code);
    const primary = mods.filter((m) => m.domains[code].relevance === 'primary').length;
    const runnable = mods.filter((m) => m.status === 'active' || m.status === 'external').length;

    const card = el(
      'button',
      {
        class: 'domain-card',
        type: 'button',
        style: `--dc-accent:${d.palette.accent};--dc-accent-2:${d.palette.accent2};background:${d.palette.surface}`,
        onclick: () => onPick(code),
        'aria-label': `${d.label} terület kiválasztása`,
      },
      [
        el('div', { class: 'letter' }, [code]),
        el('h3', {}, [d.label]),
        el('p', {}, [d.copy.tagline + '. ' + firstSentence(d.copy.intro)]),
        el('div', { class: 'meta' }, [
          el('span', { class: 'tag' }, [`${mods.length} modul`]),
          el('span', { class: 'tag' }, [`${primary} elsődleges`]),
          el('span', { class: 'tag' }, [`${runnable} indítható`]),
        ]),
      ]
    );
    grid.appendChild(card);
  }
  wrap.appendChild(grid);

  wrap.appendChild(
    el('div', { class: 'footer' }, [
      el('p', {}, [
        el('strong', {}, ['Állapot: ']),
        `fejlesztői demonstrátor. ${activeCount} modul futtatható, a többi a katalógusban látszik, de még nem indítható. `,
        'A rendszer prototípus: teljesítménymutatót ad, nem validált pszichometriai szakvéleményt.',
      ]),
      el('p', {}, [
        'Elsődleges cél-hardver Meta Quest 3 (WebXR, két kontroller). Ugyanez a build fut asztali böngészőben ' +
          'egérrel és billentyűzettel, valamint mobilon érintéssel — az eredmények eszközosztályonként külön kezelendők.',
      ]),
    ])
  );

  host.appendChild(wrap);
}

function firstSentence(s: string): string {
  const i = s.indexOf('.');
  return i > 0 ? s.slice(0, i + 1) : s;
}
