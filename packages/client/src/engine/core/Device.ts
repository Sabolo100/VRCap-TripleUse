import type { DeviceProfile, PlatformMode } from '@vrcap/shared';

/**
 * Device detection. Every run stores this verbatim: a 380 ms reaction time on a
 * Quest 3 controller and a 380 ms reaction time on a trackpad are different
 * measurements, and the platform must never quietly compare them.
 */

let cached: DeviceProfile | null = null;

function parseBrowser(ua: string): { name: string; version: string } {
  const tests: [string, RegExp][] = [
    ['OculusBrowser', /OculusBrowser\/([\d.]+)/],
    ['Wolvic', /Wolvic\/([\d.]+)/],
    ['SamsungBrowser', /SamsungBrowser\/([\d.]+)/],
    ['Edge', /Edg\/([\d.]+)/],
    ['Chrome', /Chrome\/([\d.]+)/],
    ['Firefox', /Firefox\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
  ];
  for (const [name, re] of tests) {
    const m = ua.match(re);
    if (m) return { name, version: m[1] ?? '' };
  }
  return { name: 'unknown', version: '' };
}

function deviceClass(ua: string, xr: boolean): string {
  if (/Quest 3S/i.test(ua)) return 'quest3s';
  if (/Quest 3/i.test(ua)) return 'quest3';
  if (/Quest 2/i.test(ua)) return 'quest2';
  if (/Quest Pro/i.test(ua)) return 'questpro';
  if (/OculusBrowser/i.test(ua)) return 'quest-unknown';
  if (/Pico/i.test(ua)) return 'pico';
  if (xr && /Android/i.test(ua) && !/Mobile/i.test(ua)) return 'unknown-hmd';
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  return 'desktop';
}

export async function detectDevice(): Promise<DeviceProfile> {
  if (cached) return cached;
  const ua = navigator.userAgent;
  const browser = parseBrowser(ua);

  let xrSupported = false;
  let immersive = false;
  // WebXR is gated on a secure context, so over plain HTTP `navigator.xr` is
  // simply absent - on a headset that looks identical to "this device has no
  // VR". It is not the same problem and does not have the same fix, so the
  // two are distinguished here and the hub says which one it is.
  const secure = window.isSecureContext;
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (xr) {
    xrSupported = true;
    try {
      immersive = await xr.isSessionSupported('immersive-vr');
    } catch {
      immersive = false;
    }
  }

  const klass = deviceClass(ua, immersive);
  const isHmd = klass.startsWith('quest') || klass === 'pico' || klass === 'unknown-hmd';
  const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  // Platform is what the app is running as *right now*: a Quest browser in a
  // flat tab is still "desktop-like" until an immersive session starts. The
  // engine updates this field when the session actually begins.
  const platform: PlatformMode = isHmd && immersive ? 'vr' : touch && klass !== 'desktop' ? 'mobile' : 'desktop';

  cached = {
    platform,
    deviceClass: klass,
    browser: browser.name,
    browserVersion: browser.version,
    userAgent: ua,
    xrSupported,
    immersiveVrSupported: immersive,
    secureContext: secure,
    /** WebXR is missing only because the page is not on HTTPS. */
    blockedByInsecureContext: !secure && !xr,
    handTracking: false,
    refreshRate: null,
    screen: {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
      dpr: Math.round(window.devicePixelRatio * 100) / 100,
    },
    inputMode: platform === 'vr' ? 'controller' : platform === 'mobile' ? 'touch' : 'mouse',
    locale: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  return cached;
}

/** Called by the engine once a session starts / ends so runs record reality. */
export function updateDeviceRuntime(patch: Partial<DeviceProfile>): void {
  if (cached) cached = { ...cached, ...patch };
}

export function deviceSync(): DeviceProfile | null {
  return cached;
}

/**
 * Device class compatibility for leaderboards. Two runs may only be compared
 * when they land in the same bucket: input latency and control precision differ
 * by far more than the effects we are trying to measure.
 */
export function comparabilityClass(d: DeviceProfile): string {
  if (d.platform === 'vr') return `vr:${d.deviceClass}:${d.inputMode}`;
  if (d.platform === 'mobile') return 'flat:touch';
  return 'flat:mouse';
}
