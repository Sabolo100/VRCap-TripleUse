import type { DomainCode } from './types.js';

/**
 * CROSS-MODULE CAPABILITY MAP.
 *
 * The same construct can be estimated from several modules. A profile axis
 * aggregates the normalised contributions of every module that touches it,
 * weighted by how directly that module measures it.
 */

export interface AxisDefinition {
  key: string;
  label: string;
  /** moduleCode -> weight (0-1). Weights are normalised over available runs. */
  sources: Record<string, number>;
  /** Which domains show this axis on the radar by default. */
  domains: DomainCode[];
}

export const PROFILE_AXES: AxisDefinition[] = [
  {
    key: 'reaction',
    label: 'Reakció',
    sources: { REACT: 1.0, SIGNAL: 0.4, WATCH: 0.3, HOLD: 0.4, PRESSURE: 0.3 },
    domains: ['A', 'B', 'C'],
  },
  {
    key: 'attention',
    label: 'Figyelem',
    sources: { SIGNAL: 1.0, WATCH: 0.9, MULTI: 0.6, FIELD: 0.7 },
    domains: ['A', 'B', 'C'],
  },
  {
    key: 'working_memory',
    label: 'Munkamemória',
    sources: { MEMORY: 1.0, MULTI: 0.5, NAV: 0.3, COMMAND: 0.3, PROTOCOL: 0.4 },
    domains: ['A', 'B', 'C'],
  },
  {
    key: 'spatial',
    label: 'Téri képesség',
    sources: { SPACE: 1.0, NAV: 0.8, SIGNAL: 0.2 },
    domains: ['A', 'B', 'C'],
  },
  {
    key: 'cognitive_control',
    label: 'Kognitív kontroll',
    sources: { PRESSURE: 1.0, HOLD: 0.9, MULTI: 0.5, COMMAND: 0.3 },
    domains: ['A', 'B', 'C'],
  },
  {
    key: 'psychomotor',
    label: 'Pszichomotorika',
    sources: { REACT: 0.9, HANDS: 1.0, STEADY: 0.7, ADAPT: 0.5, RHYTHM: 0.5 },
    domains: ['A', 'B', 'C'],
  },
  {
    key: 'timing',
    label: 'Időzítés & előrejelzés',
    sources: { ANTICIPATE: 1.0, RHYTHM: 0.7, INTENT: 0.6, REACT: 0.3 },
    domains: ['B', 'C'],
  },
  {
    key: 'workload',
    label: 'Terhelhetőség',
    sources: { MULTI: 1.0, PRESSURE: 0.7, WATCH: 0.6 },
    domains: ['A', 'B', 'C'],
  },
  {
    key: 'team',
    label: 'Csapat & vezetés',
    sources: { COMMAND: 1.0 },
    domains: ['A', 'B', 'C'],
  },
  {
    key: 'learning',
    label: 'Tanulási ráta',
    sources: { ADAPT: 1.0, HANDS: 0.3, NAV: 0.2 },
    domains: ['B', 'C'],
  },
  {
    key: 'decision_style',
    label: 'Döntési stílus',
    sources: { RISK: 1.0, PRESSURE: 0.4, COMMAND: 0.4 },
    domains: ['A', 'B', 'C'],
  },
  {
    key: 'discipline',
    label: 'Eljárásfegyelem',
    sources: { PROTOCOL: 1.0, HOLD: 0.4, MEMORY: 0.3 },
    domains: ['A', 'B'],
  },
];

export function axesForDomain(domain: DomainCode): AxisDefinition[] {
  return PROFILE_AXES.filter((a) => a.domains.includes(domain));
}
