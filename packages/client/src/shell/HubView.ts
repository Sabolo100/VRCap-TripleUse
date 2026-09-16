import {
  DOMAINS, MODULES, modulesForDomain, axesForDomain, isRunnable, isRunnableOn, runnableVariants, supportsPlatform,
  type DomainCode, type ModuleManifest, type ModuleVariant, type RunSummary, type VariantId,
} from '@vrcap/shared';
import { el, clear, formatDate, toast } from './dom.js';
import { deviceSync } from '../engine/core/Device.js';
import { store } from '../app/state.js';
import { api } from '../app/api.js';

/**
 * THE ARRIVAL SPACE (flat version).
 *
 * What the user must be able to do here, without reading a manual:
 *   - understand what the system is and what it will do to them,
 *   - see every module that exists in this domain and which ones they can start,
 *   - identify themselves (optional) and see their own history,
 *   - start a module, or step into VR and do all of the above in the headset.
 *
 * Identity is optional on purpose. Anyone can try a module without signing in;
 * the result is simply not attached to a profile, and the UI says so plainly
 * rather than silently discarding the run.
 */

export interface HubCallbacks {
  onStartModule: (m: ModuleManifest, variant?: VariantId) => void;
  onEnterVR: () => void;
  onChangeDomain: () => void;
  onSignIn: (externalId: string) => Promise<void>;
  onSignOut: () => void;
}

export function renderHub(host: HTMLElement, domain: DomainCode, cb: HubCallbacks): void {
  clear(host);
  const d = DOMAINS[domain];
  const s = store.get();
  const mods = modulesForDomain(domain);
  const dev = deviceSync();
  const here = dev?.platform ?? 'desktop';
  // A headset on an http:// link reports no WebXR at all; saying "this device
  // does not support VR" there would send the user looking for the wrong fix.
  const insecure = dev?.blockedByInsecureContext ?? false;
  const runnable = mods.filter((m) => isRunnableOn(m, here));
  // Implemented, relevant here, but needs a headset - named explicitly rather
  // than covered by a blanket "everything runs flat" claim.
  const vrOnlyHere = mods.filter((m) => isRunnable(m) && !supportsPlatform(m, here));

  /* ------------------------------------------------------------ topbar */

  host.appendChild(
    el('div', { class: 'topbar' }, [
      // The mark is the way home: the tester's first note was that the icon
      // in the corner did nothing.
      el('a', { class: 'brand', href: '#/', title: 'Kezdőoldal', 'aria-label': 'Kezdőoldal' }, [
        el('div', { class: 'mark' }),
        el('h1', {}, [d.copy.productName]),
      ]),
      el('div', { class: 'spacer' }),
      s.offline ? el('span', { class: 'chip warn' }, [el('span', { class: 'dot' }), 'offline']) : null,
      s.vrSupported
        ? el('span', { class: 'chip ok' }, [el('span', { class: 'dot' }), 'VR elérhető'])
        : el('span', { class: 'chip muted' }, ['Böngészős mód']),
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: cb.onChangeDomain }, ['Területváltás']),
    ])
  );

  const wrap = el('div', { class: 'wrap hub' });

  /* ------------------------------------------------------- head panels */

  const head = el('div', { class: 'hub-head' });

  // --- what this is
  head.appendChild(
    el('div', { class: 'panel' }, [
      el('h3', {}, [`${d.shortLabel} · ${d.label}`]),
      el('p', { class: 'lead' }, [d.copy.tagline]),
      el('p', { class: 'body' }, [d.copy.intro]),
      el('div', { class: 'stats' }, [
        stat(String(mods.length), 'elérhető modul'),
        stat(String(runnable.length), 'most indítható'),
        stat(String(new Set(mods.flatMap((m) => m.constructs.map((c) => c.id))).size), 'mért terület'),
        stat(d.copy.scoreShort, 'pontszám'),
      ]),
      el('div', { class: 'cta-row' }, [
        el(
          'button',
          {
            class: 'btn btn-primary btn-lg',
            type: 'button',
            disabled: !s.vrSupported,
            onclick: cb.onEnterVR,
            title: s.vrSupported
              ? ''
              : insecure
                ? 'A WebXR biztonságos kontextust igényel. Nyisd meg az oldalt HTTPS-en.'
                : 'Ez az eszköz nem támogatja a VR módot',
          },
          [s.vrSupported
            ? '⟶  BELÉPÉS VR-BE'
            : insecure
              ? 'VR-hez HTTPS kell'
              : 'VR nem elérhető ezen az eszközön']
        ),
        el('a', { class: 'btn btn-ghost', href: '#modules' }, ['Modulok megtekintése']),
      ]),
      el('p', { class: 'hint' }, [
        s.vrSupported
          ? 'A böngésző csak kattintás után engedi elindítani a VR módot. A headsetben ugyanez a kezdőtér ' +
            'jelenik meg, ahonnan elindíthatod a támogatott modulokat.'
          : insecure
          ? 'A VR mód biztonságos HTTPS-kapcsolatot igényel. A címsorban a http:// helyett https:// kezdetű ' +
            'címet nyiss meg. A támogatott modulokat addig asztali vagy mobil módban is használhatod.'
          : vrOnlyHere.length === 0
            ? 'Headset nélkül a sík platformokat támogató modulok egérrel vagy érintéssel futnak. Az ' +
              'eredményeket a rendszer eszközosztályonként külön kezeli.'
            : `Nincs headset? A modulok egérrel és érintéssel is futnak, ${vrOnlyHere.map((m) => m.code).join(' és a ')} kivételével — ` +
              `${vrOnlyHere.length === 1 ? 'annál' : 'azoknál'} maga a mérés a térbeli követés. ` +
              'Az eredményeket a rendszer külön eszközosztályként kezeli, nem keveri a VR mérésekkel.',
      ]),
    ])
  );

  // --- identity
  head.appendChild(renderIdentityPanel(domain, cb));

  wrap.appendChild(head);

  /* -------------------------------------------------------- module grid */

  const active = mods.filter((m) => m.status === 'active');
  const external = mods.filter((m) => m.status === 'external');
  const planned = mods.filter((m) => m.status === 'planned');

  wrap.appendChild(
    el('div', { class: 'section-title', id: 'modules' }, [
      el('h3', {}, ['Most indítható']),
      el('span', { class: 'sub' }, [`${runnable.length} · ${d.copy.moduleNounPlural}`]),
    ])
  );
  const g1 = el('div', { class: 'module-grid' });
  [...active, ...external].forEach((m) => g1.appendChild(moduleCard(m, domain, cb, isRunnableOn(m, here))));
  wrap.appendChild(g1);

  wrap.appendChild(
    el('div', { class: 'section-title' }, [
      el('h3', {}, ['Katalógus']),
      el('span', { class: 'sub' }, [
        `${planned.length} további modul specifikálva, fejlesztés alatt · ` +
          'a relevanciajelölés azt mutatja, mennyire kapcsolódik a modul ehhez a területhez',
      ]),
    ])
  );
  const g2 = el('div', { class: 'module-grid' });
  planned.forEach((m) => g2.appendChild(moduleCard(m, domain, cb, false)));
  wrap.appendChild(g2);

  /* ------------------------------------------------------------ results */

  wrap.appendChild(
    el('div', { class: 'section-title' }, [
      el('h3', {}, ['Eredmények']),
      el('span', { class: 'sub' }, [
        s.subject ? `${s.subject.externalId} · profil` : 'Nincs bejelentkezve — csak ebben a böngészőben tárolt próbák láthatók',
      ]),
    ])
  );

  const resultsRow = el('div', { class: 'hub-head' });
  resultsRow.appendChild(renderRunsPanel(domain));
  resultsRow.appendChild(renderProfilePanel(domain));
  wrap.appendChild(resultsRow);

  /* ------------------------------------------------- phase 2 placeholder */

  wrap.appendChild(
    el('div', { class: 'panel', style: 'margin-top:22px' }, [
      el('h3', {}, ['Vizsgálatvezető · 2. fázis']),
      el('p', { class: 'body' }, [
        'A tervezett AI-vizsgálatvezető a modulok között segít az instrukciók értelmezésében, javaslatot ' +
          'adhat a következő modulra, és a mérés végén szöveges összefoglalót készíthet. Ez a beszélgetési ' +
          'funkció a második fejlesztési fázisban készül el.',
      ]),
      el('button', { class: 'btn btn-ghost', type: 'button', disabled: true }, ['Beszélgetés indítása (hamarosan)']),
    ])
  );

  /* ------------------------------------------------------------- footer */

  wrap.appendChild(
    el('div', { class: 'footer' }, [
      el('p', {}, [el('strong', {}, ['Fontos: ']), d.copy.disclaimer]),
      el('p', {}, [
        'Minden futás rögzíti az eszközt, a böngészőt, a modulverziót és a konfigurációt. ' +
          'Összehasonlítás csak azonos eszközosztályon belül készül, mert a Quest 3 ravasza és az ' +
          'egérkattintás nem azonos mérés.',
      ]),
    ])
  );

  host.appendChild(wrap);
}

/* ------------------------------------------------------------------ */

function stat(v: string, k: string): HTMLElement {
  return el('div', { class: 'stat' }, [el('div', { class: 'v' }, [v]), el('div', { class: 'k' }, [k])]);
}

function renderIdentityPanel(domain: DomainCode, cb: HubCallbacks): HTMLElement {
  const d = DOMAINS[domain];
  const s = store.get();

  if (s.subject) {
    const runs = relevantRuns(domain);
    const best = runs.length ? Math.max(...runs.map((r) => r.opsScore)) : 0;
    return el('div', { class: 'panel' }, [
      el('h3', {}, ['Azonosítva']),
      el('p', { class: 'lead' }, [s.subject.externalId]),
      el('p', { class: 'body' }, [
        `Az eredményeid ehhez az azonosítóhoz kerülnek, így a fejlődés időben követhető. ` +
          `Eddig ${runs.length} ${d.copy.runNoun} ebben a területben.`,
      ]),
      el('div', { class: 'stats' }, [
        stat(String(runs.length), d.copy.runNoun),
        stat(best ? String(best) : '—', `legjobb ${d.copy.scoreShort}`),
        stat(String(new Set(runs.map((r) => r.moduleCode)).size), 'modul kipróbálva'),
      ]),
      el('div', { class: 'cta-row' }, [
        el('button', { class: 'btn btn-quiet', type: 'button', onclick: cb.onSignOut }, ['Kijelentkezés']),
      ]),
    ]);
  }

  const input = el('input', {
    type: 'text',
    placeholder: d.copy.idPlaceholder,
    'aria-label': d.copy.idLabel,
    maxlength: '24',
    autocapitalize: 'characters',
    spellcheck: 'false',
  });
  const submit = async () => {
    const v = input.value.trim().toUpperCase();
    if (v.length < 3) {
      toast('Az azonosító legalább 3 karakter legyen.');
      return;
    }
    await cb.onSignIn(v);
  };
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void submit();
  });

  return el('div', { class: 'panel' }, [
    el('h3', {}, [d.copy.idLabel]),
    el('p', { class: 'body' }, [
      'Add meg az azonosítódat, ha menteni és időben követni szeretnéd az eredményeidet. Belépés ' +
        'nélkül is kipróbálhatod az aktív modulokat; az eredmény ilyenkor nem kapcsolódik profilhoz.',
    ]),
    el('div', { class: 'idform' }, [
      input,
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => void submit() }, ['Belépés']),
    ]),
    el('p', { class: 'hint' }, [d.copy.idHint]),
  ]);
}

function moduleCard(m: ModuleManifest, domain: DomainCode, cb: HubCallbacks, startable: boolean): HTMLElement {
  const prof = m.domains[domain];
  const runs = relevantRuns(domain).filter((r) => r.moduleCode === m.code);
  const best = runs.length ? Math.max(...runs.map((r) => r.opsScore)) : null;

  const statusBadge =
    m.status === 'active' && !supportsPlatform(m, deviceSync()?.platform ?? 'desktop')
      ? el('span', { class: 'badge planned', title: `Ehhez a modulhoz VR headset kell (${m.supports.join(', ')}).` }, ['VR kell'])
      : m.status === 'active'
      ? el('span', { class: 'badge active' }, ['indítható'])
      : m.status === 'external'
        ? el('span', { class: 'badge external' }, ['külső modul'])
        : el('span', { class: 'badge planned' }, ['fejlesztés alatt']);

  const relBadge =
    prof.relevance === 'primary'
      ? el('span', { class: 'badge primary' }, ['elsődleges'])
      : el('span', { class: 'badge secondary' }, ['másodlagos']);

  const children: (HTMLElement | string | null)[] = [
    el('div', { class: 'row' }, [
      el('span', { class: 'ord' }, [m.ordinal]),
      el('h4', {}, [m.title]),
      best !== null ? el('span', { class: 'best' }, [String(best)]) : null,
    ]),
    el('p', { class: 'sub' }, [prof.headline ?? m.subtitle]),
    el('p', {}, [prof.rationale ?? m.summary]),
    el('div', { class: 'foot' }, [
      statusBadge,
      relBadge,
      m.multiuser ? el('span', { class: 'badge multi' }, [`${m.multiuser.min}-${m.multiuser.max} fő`]) : null,
    ]),
  ];

  const cls = `module-card${startable ? '' : ' is-locked'}`;
  if (!startable) return el('div', { class: cls }, children);

  // Modules with two forms get their own A / B buttons instead of the card
  // being one big button: the choice is between two different tasks, and it
  // should not be possible to start one by accident.
  if (m.variants && m.variants.length > 1) {
    const platform = store.get().vrSupported ? 'vr' : 'desktop';
    const usable = new Set(runnableVariants(m, platform).map((v) => v.id));
    children.push(
      el('div', { class: 'variant-row' },
        m.variants.map((v) => variantButton(m, v, usable.has(v.id), cb)))
    );
    return el('div', { class: cls + ' has-variants' }, children);
  }

  return el(
    'button',
    { class: cls, type: 'button', onclick: () => cb.onStartModule(m) },
    children
  );
}

function variantButton(m: ModuleManifest, v: ModuleVariant, usable: boolean, cb: HubCallbacks): HTMLElement {
  const why = usable
    ? `${v.subtitle} — ${v.summary}`
    : `${v.subtitle}. Ehhez a változathoz VR headset kell (${v.supports.join(', ')}).`;
  return el(
    'button',
    {
      class: `variant-btn${v.spatial ? ' is-spatial' : ''}${usable ? '' : ' is-unavailable'}`,
      type: 'button',
      disabled: !usable,
      title: why,
      onclick: (e: Event) => { e.stopPropagation(); cb.onStartModule(m, v.id); },
    },
    [
      el('span', { class: 'variant-id' }, [v.id]),
      el('span', { class: 'variant-label' }, [v.label]),
      v.spatial ? el('span', { class: 'variant-tag' }, ['3D']) : null,
    ]
  );
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

function renderRunsPanel(domain: DomainCode): HTMLElement {
  const runs = relevantRuns(domain).slice(0, 8);
  const d = DOMAINS[domain];
  const body = el('div', { class: 'runs' });
  if (runs.length === 0) {
    body.appendChild(
      el('p', { class: 'empty' }, [
        'Még nincs eredmény ezen a területen. Elsőként a körülbelül hétperces REACT modult érdemes ' +
          'elindítani; ez reakció- és követési alapértékeket ad.',
      ])
    );
  } else {
    for (const r of runs) {
      body.appendChild(
        el('div', { class: 'run-row' }, [
          el('span', { class: 'm' }, [r.moduleCode]),
          el('span', { class: 'd' }, [formatDate(r.finishedAt)]),
          r.mode !== 'assessment' ? el('span', { class: 'badge planned' }, [r.mode]) : null,
          el('span', { class: 's' }, [String(r.opsScore)]),
        ])
      );
    }
  }
  return el('div', { class: 'panel' }, [el('h3', {}, [`Utolsó ${d.copy.runNounPlural}`]), body]);
}

function renderProfilePanel(domain: DomainCode): HTMLElement {
  const axes = axesForDomain(domain);
  const runs = relevantRuns(domain);
  const d = DOMAINS[domain];

  // Axis value: mean of the contributing modules' best scores, weighted by how
  // directly each module measures that axis. Missing modules simply do not
  // contribute - an axis with no data stays null rather than being guessed at.
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

  const canvas = el('canvas', { class: 'radar', width: '760', height: '640' });
  queueMicrotask(() => drawRadar(canvas, values, d.palette.accent, d.palette.textMuted));

  const measured = values.filter((v) => v.value !== null).length;
  return el('div', { class: 'panel' }, [
    el('h3', {}, [d.copy.profileTitle]),
    el('div', { class: 'radar-wrap' }, [canvas]),
    el('p', { class: 'hint' }, [
      measured === 0
        ? 'A profil legalább egy befejezett modul után jelenik meg. Több modul több megfigyelt eredményt ad.'
        : `${measured} / ${values.length} tengelyen van adat. A ki nem töltött tengelyekhez tartozó modulok még nem futottak le.`,
    ]),
  ]);
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
  const radius = Math.min(w, h) / 2 - 104;
  const n = axes.length;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '600 17px Inter, system-ui, sans-serif';
  const lineH = 20;
  // Labels are wrapped to whatever width is left between the ring and the
  // canvas edge on their side; "Munkamemória" and "Döntés & vezetés" were
  // being cut mid-word at the old fixed width.
  const wrap = (text: string, maxW: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const wd of words) {
      const next = cur ? `${cur} ${wd}` : wd;
      if (cur && ctx.measureText(next).width > maxW) { lines.push(cur); cur = wd; }
      else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  };

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
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  const any = axes.some((a) => a.value !== null);
  if (any) {
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
    ctx.fillStyle = hexA(accent, 0.24);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }

  axes.forEach((axis, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const c = Math.cos(a);
    const x = cx + c * (radius + 34);
    const y = cy + Math.sin(a) * (radius + 30);
    ctx.fillStyle = axis.value === null ? hexA(muted, 0.5) : muted;
    const centered = Math.abs(c) < 0.3;
    ctx.textAlign = centered ? 'center' : c > 0 ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    const maxW = centered ? 240 : (c > 0 ? w - x : x) - 10;
    const lines = wrap(axis.label, maxW);
    const y0 = y - ((lines.length - 1) * lineH) / 2;
    lines.forEach((ln, k) => ctx.fillText(ln, x, y0 + k * lineH));
  });
}

function hexA(hex: string, alpha: number): string {
  if (!hex.startsWith('#')) return hex;
  const h = hex.slice(1);
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
