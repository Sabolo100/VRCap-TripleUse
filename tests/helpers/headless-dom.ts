/**
 * Just enough DOM for a Panel to be constructed off-screen.
 *
 * The panel geometry audit has to build real modules - the placement bugs it
 * looks for live in the module code, not in a table of numbers someone typed
 * into a test. Panels need a canvas for their texture, so this provides one
 * that has a size and a 2D context and does nothing else. Nothing is ever
 * drawn: the audit measures where panels ARE, not what is on them.
 */

interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): unknown;
}

function make2d(canvas: FakeCanvas): unknown {
  const store: Record<string | symbol, unknown> = { canvas };
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'measureText') return (s: unknown) => ({ width: String(s).length * 9 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient'
        || prop === 'createConicGradient') {
        return () => ({ addColorStop: () => undefined });
      }
      if (prop === 'createPattern') return () => null;
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop in target) return target[prop];
      // Everything else is a drawing call the audit does not care about.
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
    has() {
      return true;
    },
  });
}

function makeElement(tag: string): unknown {
  if (tag === 'canvas') {
    const c: FakeCanvas = { width: 1, height: 1, getContext: () => null };
    c.getContext = (kind: string) => (kind === '2d' ? make2d(c) : null);
    return c;
  }
  return {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    hidden: false,
    className: '',
    children: [] as unknown[],
    appendChild(n: unknown) { (this.children as unknown[]).push(n); return n; },
    append(...n: unknown[]) { (this.children as unknown[]).push(...n); },
    replaceChildren() { this.children = []; },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    querySelector: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }),
    getClientRects: () => [],
  };
}

export function installHeadlessDom(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.document) return;
  g.document = {
    createElement: (tag: string) => makeElement(tag),
    body: makeElement('body'),
    readyState: 'complete',
    addEventListener() {},
  };
  g.window = {
    innerWidth: 1600,
    innerHeight: 900,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
  };
}
