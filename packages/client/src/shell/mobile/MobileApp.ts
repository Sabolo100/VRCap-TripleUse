import {
  DOMAINS, DOMAIN_CODES, MODULES, modulesForDomain, axesForDomain,
  isRunnable, isRunnableOn, runnableVariants, supportsPlatform,
  type DomainCode, type ModuleManifest, type ModuleVariant, type RunSummary, type VariantId,
} from '@vrcap/shared';
import { el, clear, formatDate, toast } from '../dom.js';
import { deviceSync } from '../../engine/core/Device.js';
import { store } from '../../app/state.js';
import { api } from '../../app/api.js';
import { showSheet, closeSheet } from './sheet.js';

/**
 * THE PHONE APP.
 *
 * The flat shell was written for a laptop and reused on a phone, which is why
 * it read as a squeezed web page: a marketing hero, four stat tiles and a
 * disabled VR button occupied the whole first screen, and the modules - the
 * actual product - started somewhere below the third scroll.
 *
 * This is a different information architecture rather than a narrower
 * stylesheet:
 *
 *   ONE JOB PER SCREEN     four tabs, each answering one question: what can I
 *                          do, how am I doing, what have I done, who am I.
 *   THE LIST IS THE HOME   the module list is the first thing on screen, as
 *                          rows rather than cards. Prose moves into a sheet
 *                          that opens on tap.
 *   THUMB REACH            navigation sits at the bottom, inside the safe
 *                          area. Nothing important lives in a top corner.
 *   NO HOVER               every affordance is visible without pointing, and
 *                          state changes are driven by :active.
 *
 * The desktop and VR surfaces are untouched; this renders only when the device
 * reports the `mobile` platform.
 */

export interface MobileCallbacks {
  onStartModule: (m: ModuleManifest, variant?: VariantId) => void;
  onEnterVR: () => void;
  onPickDomain: (d: DomainCode) => void;
  onChangeDomain: () => void;
  onSignIn: (externalId: string) => Promise<void>;
  onSignOut: () => void;
}

type Tab = 'tests' | 'profile' | 'history' | 'account';

/** Tab survives re-renders; it is UI position, not application state. */
let currentTab: Tab = 'tests';
/** Filter on the tests tab. */
let showAllModules = false;

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'tests', label: 'Tesztek', icon: 'grid' },
  { id: 'profile', label: 'Profil', icon: 'radar' },
  { id: 'history', label: 'Előzmény', icon: 'clock' },
  { id: 'account', label: 'Fiók', icon: 'user' },
];

/* ==================================================== domain onboarding */

export function renderMobileLanding(host: HTMLElement, cb: MobileCallbacks): void {
  clear(host);
  const page = el('div', { class: 'm-app m-onboard' });

  page.appendChild(
    el('header', { class: 'm-onboard-head' }, [
      el('div', { class: 'm-logo' }),
      el('h1', {}, ['VR CAP']),
      el('p', {}, ['Kognitív, figyelmi és pszichomotoros mérés. Válaszd ki, melyik területen dolgozol.']),
    ])
  );

  const list = el('div', { class: 'm-domain-list' });
  for (const code of DOMAIN_CODES) {
    const d = DOMAINS[code];
    const mods = modulesForDomain(code);
    const runnable = mods.filter((m) => m.status === 'active' || m.status === 'external').length;
    list.appendChild(
      el('button', {
        class: 'm-domain',
        type: 'button',
        style: `--dc:${d.palette.accent};--dc2:${d.palette.accent2}`,
        onclick: () => cb.onPickDomain(code),
      }, [
        el('span', { class: 'm-domain-letter' }, [code]),
        el('span', { class: 'm-domain-text' }, [
          el('strong', {}, [d.label]),
          el('span', {}, [d.copy.tagline]),
          el('span', { class: 'm-domain-count' }, [`${runnable} indítható teszt`]),
        ]),
        chevron(),
      ])
    );
  }
  page.appendChild(list);

  page.appendChild(
    el('p', { class: 'm-fineprint' }, [
      'Fejlesztői demonstrátor. Teljesítménymutatót ad, nem validált pszichometriai szakvéleményt.',
    ])
  );

  host.appendChild(page);
}

/* ============================================================= main app */

export function renderMobileHub(host: HTMLElement, domain: DomainCode, cb: MobileCallbacks): void {
  clear(host);
  const d = DOMAINS[domain];
  const s = store.get();

  const page = el('div', { class: 'm-app' });

  /* --- header: small, and only what is true right now ---------------- */
  page.appendChild(
    el('header', { class: 'm-topbar' }, [
      el('div', { class: 'm-topbar-title' }, [
        el('span', { class: 'm-topbar-eyebrow' }, [d.shortLabel]),
        el('h1', {}, [tabTitle(currentTab, d.copy.moduleNounPlural)]),
      ]),
      s.offline ? el('span', { class: 'm-pill warn' }, ['offline']) : null,
      s.subject
        ? el('span', { class: 'm-pill id' }, [s.subject.externalId])
        : el('button', {
            class: 'm-pill ghost', type: 'button',
            onclick: () => { currentTab = 'account'; renderMobileHub(host, domain, cb); },
          }, ['Belépés']),
    ])
  );

  /* --- the tab body -------------------------------------------------- */
  const main = el('main', { class: 'm-main' });
  const rerender = () => renderMobileHub(host, domain, cb);
  switch (currentTab) {
    case 'tests': main.appendChild(testsView(domain, cb, rerender)); break;
    case 'profile': main.appendChild(profileView(domain)); break;
    case 'history': main.appendChild(historyView(domain, cb, rerender)); break;
    case 'account': main.appendChild(accountView(domain, cb, rerender)); break;
  }
  page.appendChild(main);

  /* --- bottom navigation --------------------------------------------- */
  const nav = el('nav', { class: 'm-tabbar', role: 'tablist' });
  for (const t of TABS) {
    nav.appendChild(
      el('button', {
        class: `m-tab${currentTab === t.id ? ' is-active' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': currentTab === t.id ? 'true' : 'false',
        onclick: () => {
          if (currentTab === t.id) { main.scrollTo({ top: 0, behavior: 'smooth' }); return; }
          currentTab = t.id;
          closeSheet();
          rerender();
        },
      }, [icon(t.icon), el('span', {}, [t.label])])
    );
  }
  page.appendChild(nav);

  host.appendChild(page);
}

function tabTitle(t: Tab, modulePlural: string): string {
  switch (t) {
    case 'tests': return modulePlural.charAt(0).toUpperCase() + modulePlural.slice(1);
    case 'profile': return 'Profil';
    case 'history': return 'Előzmény';
    case 'account': return 'Fiók';
  }
}

/* =============================================================== tests */

function testsView(domain: DomainCode, cb: MobileCallbacks, rerender: () => void): HTMLElement {
  const mods = modulesForDomain(domain);
  const here = deviceSync()?.platform ?? 'mobile';
  const runnable = mods.filter((m) => isRunnableOn(m, here));
  const rest = mods.filter((m) => !isRunnableOn(m, here));
  const view = el('div', { class: 'm-view' });

  // A segmented control rather than two long sections: on a phone, scrolling
  // past eleven unavailable modules to reach the catalogue is not browsing.
  view.appendChild(
    el('div', { class: 'm-segment' }, [
      el('button', {
        class: `m-seg${showAllModules ? '' : ' is-on'}`, type: 'button',
        onclick: () => { showAllModules = false; rerender(); },
      }, [`Indítható · ${runnable.length}`]),
      el('button', {
        class: `m-seg${showAllModules ? ' is-on' : ''}`, type: 'button',
        onclick: () => { showAllModules = true; rerender(); },
      }, [`Összes · ${mods.length}`]),
    ])
  );

  const list = el('div', { class: 'm-list' });
  const show = showAllModules ? [...runnable, ...rest] : runnable;
  for (const m of show) list.appendChild(moduleRow(m, domain, cb, isRunnableOn(m, here)));
  view.appendChild(list);

  if (!showAllModules && rest.length > 0) {
    view.appendChild(
      el('button', {
        class: 'm-linkrow', type: 'button',
        onclick: () => { showAllModules = true; rerender(); },
      }, [`További ${rest.length} modul a katalógusban`, chevron()])
    );
  }

  return view;
}

function moduleRow(
  m: ModuleManifest, domain: DomainCode, cb: MobileCallbacks, startable: boolean
): HTMLElement {
  const prof = m.domains[domain];
  const runs = relevantRuns(domain).filter((r) => r.moduleCode === m.code);
  const best = runs.length ? Math.max(...runs.map((r) => r.opsScore)) : null;
  const here = deviceSync()?.platform ?? 'mobile';
  const needsVr = m.status === 'active' && !supportsPlatform(m, here);

  const right = needsVr
    ? el('span', { class: 'm-row-tag vr' }, ['VR'])
    : !startable
      ? el('span', { class: 'm-row-tag' }, ['hamarosan'])
      : best !== null
        ? el('span', { class: 'm-row-score' }, [String(best)])
        : el('span', { class: 'm-row-go' }, [icon('play')]);

  return el('button', {
    class: `m-row${startable ? '' : ' is-off'}${prof.relevance === 'primary' ? ' is-primary' : ''}`,
    type: 'button',
    onclick: () => openModuleSheet(m, domain, cb, startable),
  }, [
    el('span', { class: 'm-row-ord' }, [m.ordinal]),
    el('span', { class: 'm-row-text' }, [
      el('strong', {}, [m.title]),
      el('span', {}, [prof.headline ?? m.subtitle]),
    ]),
    right,
  ]);
}

/** Everything that used to crowd the card, on its own screen. */
function openModuleSheet(
  m: ModuleManifest, domain: DomainCode, cb: MobileCallbacks, startable: boolean
): void {
  const prof = m.domains[domain];
  const here = deviceSync()?.platform ?? 'mobile';
  const needsVr = m.status === 'active' && !supportsPlatform(m, here);
  const mins = Math.round(m.duration / 60);

  showSheet(
    { title: m.title, eyebrow: `${m.ordinal} · ${prof.headline ?? m.subtitle}` },
    (close) => {
      const nodes: (Node | null)[] = [];

      nodes.push(
        el('div', { class: 'm-facts' }, [
          fact(`${mins}`, 'perc'),
          fact(String(m.constructs.length), 'képesség'),
          fact(prof.relevance === 'primary' ? 'Elsődleges' : 'Másodlagos', 'relevancia'),
        ])
      );

      nodes.push(el('p', { class: 'm-sheet-text' }, [prof.rationale ?? m.summary]));

      if (prof.examples?.length) {
        nodes.push(el('div', { class: 'm-chiprow' },
          prof.examples.slice(0, 5).map((x) => el('span', { class: 'm-chip' }, [x]))));
      }

      nodes.push(el('h3', { class: 'm-sheet-h' }, ['Mit mér']));
      nodes.push(el('ul', { class: 'm-bullets' },
        m.constructs.slice(0, 6).map((c) => el('li', {}, [c.label]))));

      if (needsVr) {
        nodes.push(el('div', { class: 'm-note' }, [
          'Ehhez a modulhoz VR headset kell: maga a mérés a fej és a kéz térbeli követéséből ' +
          'származik. Ujjal ugyanez a feladat egy másik képességet mérne, ezért nem kínálunk ' +
          'belőle leromlott változatot.',
        ]));
      } else if (!startable) {
        nodes.push(el('div', { class: 'm-note' }, [
          'Ez a modul specifikálva van, de még fejlesztés alatt áll.',
        ]));
      }

      if (startable && m.variants && m.variants.length > 1) {
        const usable = new Set(runnableVariants(m, here).map((v) => v.id));
        nodes.push(el('h3', { class: 'm-sheet-h' }, ['Válassz változatot']));
        for (const v of m.variants) {
          nodes.push(variantCard(m, v, usable.has(v.id), cb, close));
        }
      } else if (startable) {
        nodes.push(
          el('button', {
            class: 'm-cta', type: 'button',
            onclick: () => { close({ keepEntry: true }); cb.onStartModule(m); },
          }, [icon('play'), DOMAINS[domain].copy.startCta])
        );
      }

      return nodes.filter(Boolean) as Node[];
    }
  );
}

function variantCard(
  m: ModuleManifest, v: ModuleVariant, usable: boolean, cb: MobileCallbacks,
  close: (o?: { keepEntry?: boolean }) => void
): HTMLElement {
  return el('button', {
    class: `m-variant${v.spatial ? ' is-spatial' : ''}`,
    type: 'button',
    disabled: !usable,
    onclick: () => { close({ keepEntry: true }); cb.onStartModule(m, v.id); },
  }, [
    el('span', { class: 'm-variant-head' }, [
      el('span', { class: 'm-variant-id' }, [v.id]),
      el('strong', {}, [v.label]),
      v.spatial ? el('span', { class: 'm-variant-tag' }, ['3D']) : null,
    ]),
    el('span', { class: 'm-variant-sub' }, [v.subtitle]),
    el('span', { class: 'm-variant-body' }, [
      usable ? v.summary : `Ehhez a változathoz VR headset kell (${v.supports.join(', ')}).`,
    ]),
  ]);
}

/* ============================================================= profile */

function profileView(domain: DomainCode): HTMLElement {
  const d = DOMAINS[domain];
  const axes = axesForDomain(domain);
  const runs = relevantRuns(domain);
  const view = el('div', { class: 'm-view' });

  const bestByModule = new Map<string, number>();
  for (const r of runs) {
    bestByModule.set(r.moduleCode, Math.max(bestByModule.get(r.moduleCode) ?? 0, r.opsScore));
  }
  const values = axes.map((a) => {
    let num = 0;
    let den = 0;
    for (const [code, w] of Object.entries(a.sources)) {
      const b = bestByModule.get(code);
      if (b === undefined) continue;
      num += (b / 10) * w;
      den += w;
    }
    return { label: a.label, value: den > 0 ? num / den : null };
  });
  const measured = values.filter((v) => v.value !== null).length;
  const best = runs.length ? Math.max(...runs.map((r) => r.opsScore)) : null;

  view.appendChild(
    el('div', { class: 'm-hero' }, [
      el('div', { class: 'm-hero-score' }, [best !== null ? String(best) : '—']),
      el('div', { class: 'm-hero-label' }, [`legjobb ${d.copy.scoreShort}`]),
      el('div', { class: 'm-hero-meta' }, [
        `${runs.length} ${d.copy.runNoun} · ${bestByModule.size} modul`,
      ]),
    ])
  );

  if (measured === 0) {
    view.appendChild(
      el('div', { class: 'm-empty' }, [
        el('div', { class: 'm-empty-icon' }, [icon('radar')]),
        el('strong', {}, ['Még nincs profilod']),
        el('p', {}, ['A profil akkor rajzolódik ki, ha legalább egy tesztet befejeztél. Több teszt → megbízhatóbb kép.']),
      ])
    );
    return view;
  }

  const canvas = el('canvas', { class: 'm-radar', width: '760', height: '600' });
  queueMicrotask(() => drawRadar(canvas, values, d.palette.accent, d.palette.textMuted));
  view.appendChild(el('div', { class: 'm-card m-radar-card' }, [canvas]));

  view.appendChild(el('h3', { class: 'm-h' }, ['Tengelyek']));
  const bars = el('div', { class: 'm-card' });
  for (const v of values) {
    bars.appendChild(
      el('div', { class: 'm-bar-row' }, [
        el('span', { class: 'm-bar-label' }, [v.label]),
        el('span', { class: 'm-bar-track' }, [
          el('span', { class: 'm-bar-fill', style: `width:${v.value ?? 0}%` }),
        ]),
        el('span', { class: 'm-bar-value' }, [v.value === null ? '—' : String(Math.round(v.value))]),
      ])
    );
  }
  view.appendChild(bars);
  view.appendChild(
    el('p', { class: 'm-fineprint' }, [
      `${measured} / ${values.length} tengelyen van adat. A hiányzó tengelyekhez tartozó modulok még nem futottak le.`,
    ])
  );
  return view;
}

/* ============================================================= history */

function historyView(domain: DomainCode, cb: MobileCallbacks, rerender: () => void): HTMLElement {
  const runs = relevantRuns(domain);
  const view = el('div', { class: 'm-view' });

  if (runs.length === 0) {
    view.appendChild(
      el('div', { class: 'm-empty' }, [
        el('div', { class: 'm-empty-icon' }, [icon('clock')]),
        el('strong', {}, ['Még nincs eredményed']),
        el('p', {}, ['Indíts el egy tesztet — a REACT a leggyorsabb belépő, körülbelül hét perc.']),
        el('button', {
          class: 'm-cta', type: 'button',
          onclick: () => { currentTab = 'tests'; rerender(); },
        }, ['Tesztek megnyitása']),
      ])
    );
    return view;
  }

  // Grouped by day: a flat list of forty rows all showing "szept. 4." reads as
  // noise, and the day is the unit people actually recall.
  const groups = new Map<string, RunSummary[]>();
  for (const r of runs) {
    const key = new Date(r.finishedAt).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  for (const [day, rows] of groups) {
    view.appendChild(el('h3', { class: 'm-h' }, [day]));
    const card = el('div', { class: 'm-card' });
    for (const r of rows) {
      const m = MODULES.find((x) => x.code === r.moduleCode);
      const time = new Date(r.finishedAt).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
      card.appendChild(
        el('div', { class: 'm-run' }, [
          // The ordinal, not the code: the title next to it already says the
          // code, and printing it twice was just noise.
          el('span', { class: 'm-run-ord' }, [m?.ordinal ?? '··']),
          el('span', { class: 'm-run-text' }, [
            el('strong', {}, [m?.title ?? r.moduleCode]),
            el('span', {}, [
              time + (m ? ` · ${m.subtitle}` : '') + (r.mode !== 'assessment' ? ` · ${r.mode}` : ''),
            ]),
          ]),
          el('span', { class: 'm-run-score' }, [String(r.opsScore)]),
        ])
      );
    }
    view.appendChild(card);
  }
  void cb;
  return view;
}

/* ============================================================= account */

function accountView(domain: DomainCode, cb: MobileCallbacks, rerender: () => void): HTMLElement {
  const d = DOMAINS[domain];
  const s = store.get();
  const dev = deviceSync();
  const view = el('div', { class: 'm-view' });

  /* --- identity ------------------------------------------------------ */
  if (s.subject) {
    const runs = relevantRuns(domain);
    view.appendChild(
      el('div', { class: 'm-card m-idcard' }, [
        el('div', { class: 'm-avatar' }, [s.subject.externalId.slice(0, 2)]),
        el('div', { class: 'm-idtext' }, [
          el('strong', {}, [s.subject.externalId]),
          el('span', {}, [`${runs.length} ${d.copy.runNoun} ebben a területben`]),
        ]),
      ])
    );
    view.appendChild(
      el('div', { class: 'm-card m-rows' }, [
        el('button', { class: 'm-rowbtn', type: 'button', onclick: () => { cb.onSignOut(); rerender(); } }, [
          el('span', { class: 'm-rowbtn-text' }, [
            el('strong', {}, ['Kijelentkezés']),
            el('span', {}, ['A helyi eredmények megmaradnak ebben a böngészőben']),
          ]),
          chevron(),
        ]),
      ])
    );
  } else {
    const input = el('input', {
      class: 'm-input',
      type: 'text',
      inputmode: 'latin',
      placeholder: d.copy.idPlaceholder,
      'aria-label': d.copy.idLabel,
      maxlength: '24',
      autocapitalize: 'characters',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const submit = async () => {
      const v = input.value.trim().toUpperCase();
      if (v.length < 3) { toast('Az azonosító legalább 3 karakter legyen.'); return; }
      await cb.onSignIn(v);
    };
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void submit();
    });
    view.appendChild(
      el('div', { class: 'm-card' }, [
        el('h3', { class: 'm-card-h' }, [d.copy.idLabel]),
        el('p', { class: 'm-card-p' }, [
          'Belépés nélkül is kipróbálhatsz minden tesztet — az eredmény ilyenkor csak ebben a böngészőben marad meg.',
        ]),
        el('div', { class: 'm-inputrow' }, [
          input,
          el('button', { class: 'm-cta compact', type: 'button', onclick: () => void submit() }, ['Belépés']),
        ]),
        el('p', { class: 'm-fineprint' }, [d.copy.idHint]),
      ])
    );
  }

  /* --- settings ------------------------------------------------------ */
  view.appendChild(el('h3', { class: 'm-h' }, ['Beállítások']));
  const settings = el('div', { class: 'm-card m-rows' });
  settings.appendChild(
    el('button', { class: 'm-rowbtn', type: 'button', onclick: cb.onChangeDomain }, [
      el('span', { class: 'm-rowbtn-text' }, [
        el('strong', {}, ['Terület']),
        el('span', {}, [d.label]),
      ]),
      chevron(),
    ])
  );
  settings.appendChild(
    el('button', {
      class: 'm-rowbtn', type: 'button',
      disabled: !s.vrSupported,
      onclick: cb.onEnterVR,
    }, [
      el('span', { class: 'm-rowbtn-text' }, [
        el('strong', {}, ['VR mód']),
        el('span', {}, [
          s.vrSupported ? 'Belépés headsetbe'
            : dev?.blockedByInsecureContext ? 'HTTPS kell hozzá'
            : 'Ezen az eszközön nem elérhető',
        ]),
      ]),
      s.vrSupported ? chevron() : null,
    ])
  );
  view.appendChild(settings);

  /* --- status --------------------------------------------------------- */
  view.appendChild(el('h3', { class: 'm-h' }, ['Állapot']));
  view.appendChild(
    el('div', { class: 'm-card m-rows' }, [
      infoRow('Kapcsolat', s.offline ? 'Offline — az eredmények helyben várakoznak' : 'Online'),
      infoRow('Eszköz', dev ? `${dev.deviceClass} · ${dev.browser}` : '—'),
      infoRow('Eszközosztály', 'Az eredmények eszközosztályonként külön kezelendők'),
    ])
  );

  view.appendChild(
    el('p', { class: 'm-fineprint' }, [d.copy.disclaimer])
  );
  return view;
}

function infoRow(k: string, v: string): HTMLElement {
  return el('div', { class: 'm-inforow' }, [
    el('span', {}, [k]),
    el('strong', {}, [v]),
  ]);
}

/* =============================================================== bits */

function fact(v: string, k: string): HTMLElement {
  return el('div', { class: 'm-fact' }, [
    el('span', { class: 'm-fact-v' }, [v]),
    el('span', { class: 'm-fact-k' }, [k]),
  ]);
}

function chevron(): HTMLElement {
  return el('span', { class: 'm-chev', html: svg('M9 6l6 6-6 6') });
}

function icon(name: string): HTMLElement {
  const paths: Record<string, string> = {
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    radar: 'M12 3a9 9 0 109 9M12 12l6-6M12 8a4 4 0 104 4',
    clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
    user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
    play: 'M8 5l11 7-11 7z',
  };
  return el('span', { class: 'm-ico', html: svg(paths[name] ?? '') });
}

function svg(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

function relevantRuns(domain: DomainCode): RunSummary[] {
  const s = store.get();
  const fromProfile = s.profile?.runs ?? [];
  const local = api.localRuns();
  const seen = new Set(fromProfile.map((r) => r.id));
  return [...fromProfile, ...local.filter((r) => !seen.has(r.id))]
    .filter((r) => r.domain === domain)
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
}

function drawRadar(
  canvas: HTMLCanvasElement,
  axes: { label: string; value: number | null }[],
  accent: string,
  muted: string
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const n = axes.length;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '600 20px Inter, system-ui, sans-serif';

  // Derive the radius from the widest label rather than guessing a margin.
  // With a fixed inset the long axis names ran off the canvas and arrived on
  // screen as "si stílus" and "Munkam" - the labels are the only thing that
  // makes a radar chart readable, so they set the geometry.
  const LABEL_GAP = 14;
  const widest = Math.max(...axes.map((a) => ctx.measureText(a.label).width));
  const radius = Math.max(
    70,
    Math.min(
      // Horizontal: the side labels must fit beside the chart.
      w / 2 - widest - LABEL_GAP - 6,
      // Vertical: the top and bottom labels only need a line's height.
      h / 2 - 34
    )
  );

  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = ((i % n) / n) * Math.PI * 2 - Math.PI / 2;
      const r = (radius * ring) / 4;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = hexA(muted, ring === 4 ? 0.45 : 0.16);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  if (axes.some((a) => a.value !== null)) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const idx = i % n;
      const a = (idx / n) * Math.PI * 2 - Math.PI / 2;
      const r = ((axes[idx]!.value ?? 0) / 100) * radius;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = hexA(accent, 0.26);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  axes.forEach((axis, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * (radius + LABEL_GAP);
    const y = cy + Math.sin(a) * (radius + LABEL_GAP);
    ctx.fillStyle = axis.value === null ? hexA(muted, 0.5) : muted;
    ctx.textAlign = Math.abs(Math.cos(a)) < 0.3 ? 'center' : Math.cos(a) > 0 ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(axis.label, x, y);
  });
}

function hexA(hex: string, alpha: number): string {
  if (!hex.startsWith('#')) return hex;
  const h = hex.slice(1);
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
