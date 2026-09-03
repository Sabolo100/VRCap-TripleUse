import type { DeviceProfile } from '@vrcap/shared';

/**
 * COMPARABILITY CLASS.
 *
 * Two runs may only be ranked against each other when this string matches.
 * A Quest 3 controller trigger, a mouse click and a screen tap differ by more
 * end-to-end latency than most of the effects the platform is trying to detect,
 * so mixing them would produce a leaderboard that ranks hardware.
 */
export function comparabilityKey(d: Partial<DeviceProfile> | undefined): string {
  if (!d) return 'unknown';
  if (d.platform === 'vr') return `vr:${d.deviceClass ?? 'unknown'}:${d.inputMode ?? 'controller'}`;
  if (d.platform === 'mobile') return 'flat:touch';
  return 'flat:mouse';
}
