import type { DomainCode } from './types.js';

/**
 * The three application domains. One engine, three skins.
 *
 * Everything a domain changes is declared here: palette, typography, wording,
 * the name of the headline score, and the identifier format. No module code
 * ever branches on the domain - it asks the DomainDefinition instead.
 */

export interface DomainPalette {
  /** Deep background of the 2D shell and the VR room. */
  bg: string;
  bgAlt: string;
  /** Surface / panel fill. */
  surface: string;
  surfaceAlt: string;
  /** Primary accent - buttons, active states, the room's key light. */
  accent: string;
  accentSoft: string;
  /** Secondary accent for charts / highlights. */
  accent2: string;
  text: string;
  textMuted: string;
  ok: string;
  warn: string;
  bad: string;
  /** Grid / floor line colour in the VR room. */
  grid: string;
  /** Hemisphere light colours in the VR room. */
  lightSky: string;
  lightGround: string;
  /** Fog colour + density for the VR room. */
  fog: string;
  fogDensity: number;
}

export interface DomainCopy {
  /** Product name as shown in this domain. */
  productName: string;
  /** One line under the product name. */
  tagline: string;
  /** 2-3 sentence description of the system on the landing space. */
  intro: string;
  /** What the identifier is called. */
  idLabel: string;
  /** Placeholder / example identifier. */
  idPlaceholder: string;
  /** Regex hint shown under the field. */
  idHint: string;
  /** The name of the 0-1000 gamification score in this domain. */
  scoreName: string;
  scoreShort: string;
  /** What a single module run is called. */
  runNoun: string;
  /**
   * Plural of `runNoun`, spelled out rather than derived.
   *
   * Hungarian plurals follow vowel harmony: "futás" takes -ok, "mérés" takes
   * -ek. Appending a fixed suffix produced "mérésok" and "modulek", so the
   * forms are written out instead of synthesised.
   */
  runNounPlural: string;
  /** What the collection of modules is called. */
  moduleNoun: string;
  /** Plural of `moduleNoun`. See `runNounPlural` for why it is explicit. */
  moduleNounPlural: string;
  /** Verb on the start button. */
  startCta: string;
  /** Label of the person being tested. */
  subjectNoun: string;
  /** Title of the aggregated profile view. */
  profileTitle: string;
  /** Short disclaimer shown on result screens. */
  disclaimer: string;
}

export interface DomainDefinition {
  code: DomainCode;
  /** Short key used in URLs: defence | work | sport */
  slug: string;
  label: string;
  shortLabel: string;
  palette: DomainPalette;
  copy: DomainCopy;
  /** Font stacks. */
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
  /** Visual signature of the 3D lobby. */
  room: {
    /** Floor style. */
    floor: 'grid' | 'panels' | 'track';
    /** Ambient particles / motes. */
    motes: number;
    /** Horizon ring radius. */
    horizon: number;
    /** Extra decoration hint consumed by HubScene. */
    signature: 'radar' | 'blueprint' | 'stadium';
  };
}

export const DOMAINS: Record<DomainCode, DomainDefinition> = {
  A: {
    code: 'A',
    slug: 'defence',
    label: 'Védelmi szektor',
    shortLabel: 'DEFENCE',
    fontDisplay: '"Barlow Condensed", "Oswald", Impact, sans-serif',
    fontBody: '"Barlow", "Inter", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    palette: {
      bg: '#070b10',
      bgAlt: '#0c131b',
      surface: 'rgba(18, 27, 38, 0.86)',
      surfaceAlt: 'rgba(28, 40, 54, 0.9)',
      accent: '#ff9e1b',
      accentSoft: 'rgba(255, 158, 27, 0.16)',
      accent2: '#4fc3f7',
      text: '#e8eef5',
      textMuted: '#8296ab',
      ok: '#4ade80',
      warn: '#fbbf24',
      bad: '#f87171',
      grid: '#1c3247',
      lightSky: '#2b4a68',
      lightGround: '#0a0f15',
      fog: '#070b10',
      fogDensity: 0.021,
    },
    room: { floor: 'grid', motes: 260, horizon: 26, signature: 'radar' },
    copy: {
      productName: 'VR COGNITIVE ASSESSMENT',
      tagline: 'Védelmi kognitív és pszichomotoros vizsgálati platform',
      intro:
        'Objektív, ismételhető kognitív, figyelmi, döntési és pszichomotoros mérés absztrakt VR környezetben. ' +
        'Nem kiképzési szimulátor: a cél a vizsgált emberi képesség lehető legtisztább, zajmentes mérése. ' +
        'Minden futás ugyanahhoz az azonosítóhoz kapcsolódik, így a teljesítmény időben követhető.',
      idLabel: 'Operator ID',
      idPlaceholder: 'HU-001572',
      idHint: 'Pszeudonim azonosító. Nevet nem tárolunk.',
      scoreName: 'OPS SCORE',
      scoreShort: 'OPS',
      runNoun: 'futás',
      runNounPlural: 'futások',
      moduleNoun: 'modul',
      moduleNounPlural: 'modulok',
      startCta: 'MISSZIÓ INDÍTÁSA',
      subjectNoun: 'operátor',
      profileTitle: 'Operational Performance Profile',
      disclaimer:
        'Teljesítménymutató, nem pszichológiai diagnózis. Kiválasztási döntés önmagában nem alapozható rá.',
    },
  },

  B: {
    code: 'B',
    slug: 'work',
    label: 'Munkaalkalmasság & pályaválasztás',
    shortLabel: 'WORK',
    fontDisplay: '"Inter Tight", "Inter", system-ui, sans-serif',
    fontBody: '"Inter", system-ui, -apple-system, sans-serif',
    fontMono: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
    palette: {
      bg: '#0d1418',
      bgAlt: '#132025',
      surface: 'rgba(21, 35, 41, 0.88)',
      surfaceAlt: 'rgba(30, 49, 57, 0.92)',
      accent: '#22d3c5',
      accentSoft: 'rgba(34, 211, 197, 0.14)',
      accent2: '#a78bfa',
      text: '#eaf4f4',
      textMuted: '#8aa5a8',
      ok: '#34d399',
      warn: '#fbbf24',
      bad: '#fb7185',
      grid: '#1d3a40',
      lightSky: '#2f6b70',
      lightGround: '#0d1418',
      fog: '#0d1418',
      fogDensity: 0.016,
    },
    room: { floor: 'panels', motes: 140, horizon: 30, signature: 'blueprint' },
    copy: {
      productName: 'VR ALKALMASSÁG & PÁLYAORIENTÁCIÓ',
      tagline: 'Munkaköri kognitív alkalmasság és pályaválasztási tanácsadás',
      intro:
        'Objektív képességmérés olyan munkakörökhöz, ahol a figyelem, a reakció, a többfeladatos terhelés ' +
        'és a döntési stabilitás közvetlen biztonsági tényező: gépjárművezető, légiirányító, sebész, ' +
        'műszakos operátor, mentő. Pályaorientációnál a mért profil erősség-térképet ad, nem minősítést.',
      idLabel: 'Vizsgálati azonosító',
      idPlaceholder: 'PRO-2026-0184',
      idHint: 'Pszeudonim azonosító. A rendszer nevet nem igényel.',
      scoreName: 'READINESS SCORE',
      scoreShort: 'RDY',
      runNoun: 'mérés',
      runNounPlural: 'mérések',
      moduleNoun: 'vizsgálat',
      moduleNounPlural: 'vizsgálatok',
      startCta: 'VIZSGÁLAT INDÍTÁSA',
      subjectNoun: 'vizsgált személy',
      profileTitle: 'Occupational Capability Profile',
      disclaimer:
        'Teljesítménymutató, nem munkaköri alkalmassági szakvélemény. Foglalkozás-egészségügyi döntés önmagában nem alapozható rá.',
    },
  },

  C: {
    code: 'C',
    slug: 'sport',
    label: 'Sportági tehetségazonosítás',
    shortLabel: 'SPORT',
    fontDisplay: '"Archivo Black", "Barlow Condensed", Impact, sans-serif',
    fontBody: '"Barlow", "Inter", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    palette: {
      bg: '#0a0910',
      bgAlt: '#141024',
      surface: 'rgba(26, 20, 44, 0.88)',
      surfaceAlt: 'rgba(40, 30, 66, 0.92)',
      accent: '#c6ff3d',
      accentSoft: 'rgba(198, 255, 61, 0.14)',
      accent2: '#ff2e93',
      text: '#f4f1ff',
      textMuted: '#9b93bb',
      ok: '#7cf59a',
      warn: '#ffd166',
      bad: '#ff5c7a',
      grid: '#2c2350',
      lightSky: '#4a3a86',
      lightGround: '#0a0910',
      fog: '#0a0910',
      fogDensity: 0.014,
    },
    room: { floor: 'track', motes: 320, horizon: 34, signature: 'stadium' },
    copy: {
      productName: 'VR SPORT TALENT LAB',
      tagline: 'Sportági tehetségazonosítás és percepciós-kognitív profil',
      intro:
        'Melyik sportághoz van érzéked? A rendszer nem az izmot méri, hanem azt, amit a pálya szélén nem látni: ' +
        'időzítést, előrejelzést, perifériás látást, döntési sebességet, mozgástanulási rátát. ' +
        'A profilból sportágcsoport-ajánlás készül - irány, nem ítélet.',
      idLabel: 'Sportoló ID',
      idPlaceholder: 'ATH-2026-041',
      idHint: 'Pszeudonim azonosító. Fiatalkorúaknál külön adatkezelési szabály él.',
      scoreName: 'PERFORMANCE INDEX',
      scoreShort: 'PERF',
      runNoun: 'gyakorlat',
      runNounPlural: 'gyakorlatok',
      moduleNoun: 'teszt',
      moduleNounPlural: 'tesztek',
      startCta: 'TESZT INDÍTÁSA',
      subjectNoun: 'sportoló',
      profileTitle: 'Athlete Perceptual-Cognitive Profile',
      disclaimer:
        'Teljesítménymutató, nem tehetségdiagnózis. Sportági javaslat tájékoztató, edzői és orvosi véleményt nem helyettesít.',
    },
  },
};

export function domainBySlug(slug: string): DomainDefinition | undefined {
  return Object.values(DOMAINS).find((d) => d.slug === slug);
}
