import type { PlatformMode } from '@vrcap/shared';

/**
 * TEXT THAT KNOWS WHAT DEVICE IT IS ON.
 *
 * "Húzd meg a ravaszt" is the right instruction in a headset and nonsense on a
 * laptop, where there is no trigger, and misleading on a phone, where the
 * answer is a named button along the bottom of the screen. A participant who
 * reads an instruction written for another device does not know what to do -
 * and in an unsupervised measurement, not knowing what to do is data loss.
 *
 * So an instruction is either one string, when the task genuinely reads the
 * same everywhere, or one string per platform. The runner resolves it for the
 * device the module is actually running on.
 */
export type PlatformText = string | Record<PlatformMode, string>;

export function resolveText(text: PlatformText, platform: PlatformMode): string {
  return typeof text === 'string' ? text : text[platform];
}

/**
 * The words that differ between devices, for building instructions that share
 * their structure but not their verbs.
 *
 * Capitalised forms start a sentence; lower-case forms sit inside one. The
 * mobile forms name the button on the control bar rather than "tap", because
 * a bare tap on the scene is rarely the answer - a stray touch while shifting
 * grip must not land as a response.
 */
export interface DeviceWords {
  /** "Húzd meg a ravaszt" / "Nyomd meg a SZÓKÖZT" / "Nyomd meg a gombot" */
  Press: string;
  press: string;
  /** The single-response device, as a noun: "a ravasz" / "a SZÓKÖZ" / "a gomb" */
  trigger: string;
  /** Two-sided responses. */
  leftKey: string;
  rightKey: string;
  /** "Mutass rá a sugárral és húzd meg a ravaszt" / "Kattints rá" / "Koppints rá" */
  Select: string;
  select: string;
  /** "Tartsd rajta a sugarat" / "Tartsd rajta az egeret" / "Tartsd rajta az ujjad" */
  Hold: string;
  /** What moves the aim: "a kontroller sugara" / "az egérkurzor" / "az ujjad" */
  pointer: string;
  /** "Fordulj körbe" / "Nézz körül az egér húzásával" / "Nézz körül a képernyő húzásával" */
  Turn: string;
}

export function deviceWords(platform: PlatformMode): DeviceWords {
  switch (platform) {
    case 'vr':
      return {
        Press: 'Húzd meg a ravaszt',
        press: 'húzd meg a ravaszt',
        trigger: 'a ravasz',
        leftKey: 'a BAL ravasz',
        rightKey: 'a JOBB ravasz',
        Select: 'Mutass rá a kontroller sugarával, és húzd meg a ravaszt',
        select: 'mutass rá a sugárral, és húzd meg a ravaszt',
        Hold: 'Tartsd rajta a kontroller sugarát',
        pointer: 'a kontroller sugara',
        Turn: 'Fordulj körbe',
      };
    case 'mobile':
      return {
        Press: 'Nyomd meg a gombot a képernyő alján',
        press: 'nyomd meg a gombot a képernyő alján',
        trigger: 'a gomb',
        leftKey: 'a BAL gomb',
        rightKey: 'a JOBB gomb',
        Select: 'Koppints rá',
        select: 'koppints rá',
        Hold: 'Tartsd rajta az ujjad',
        pointer: 'az ujjad',
        Turn: 'Nézz körül a képernyő húzásával',
      };
    default:
      return {
        Press: 'Nyomd meg a SZÓKÖZT vagy kattints',
        press: 'nyomd meg a SZÓKÖZT vagy kattints',
        trigger: 'a SZÓKÖZ',
        leftKey: 'az F billentyű (vagy a balra nyíl)',
        rightKey: 'a J billentyű (vagy a jobbra nyíl)',
        Select: 'Kattints rá',
        select: 'kattints rá',
        Hold: 'Tartsd rajta az egérkurzort',
        pointer: 'az egérkurzor',
        Turn: 'Nézz körül az egér húzásával',
      };
  }
}
