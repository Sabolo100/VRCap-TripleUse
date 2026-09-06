import { el } from '../dom.js';

/**
 * BOTTOM SHEET.
 *
 * The mobile equivalent of "open the detail without leaving the list". A phone
 * has no room for a card that carries a title, a subtitle, three sentences of
 * rationale, two badges and two start buttons - so the list row stays a row,
 * and everything else lives here, one tap away.
 *
 * The hardware back gesture closes it. That is not decoration: on Android,
 * back is how people dismiss things, and a sheet that ignores it exits the
 * whole app instead.
 */

let openSheet: { close: () => void } | null = null;

export interface SheetOptions {
  title: string;
  eyebrow?: string;
  /** Called after the sheet has fully closed. */
  onClose?: () => void;
}

export function showSheet(opts: SheetOptions, body: (close: () => void) => Node[]): void {
  openSheet?.close();

  const scrim = el('div', { class: 'm-scrim' });
  const panel = el('div', { class: 'm-sheet', role: 'dialog', 'aria-modal': 'true' });

  let closed = false;
  const close = (fromPop = false) => {
    if (closed) return;
    closed = true;
    openSheet = null;
    scrim.classList.remove('is-open');
    panel.classList.remove('is-open');
    // Let the transition finish before the nodes go, or the sheet vanishes
    // instead of sliding away.
    window.setTimeout(() => {
      scrim.remove();
      panel.remove();
      opts.onClose?.();
    }, 220);
    window.removeEventListener('popstate', onPop);
    // Consume the history entry we pushed, unless the pop is what closed us.
    if (!fromPop && history.state?.sheet) history.back();
  };
  const onPop = () => close(true);

  history.pushState({ sheet: true }, '');
  window.addEventListener('popstate', onPop);

  scrim.addEventListener('click', () => close());

  panel.appendChild(el('div', { class: 'm-sheet-grip' }));
  panel.appendChild(
    el('div', { class: 'm-sheet-head' }, [
      opts.eyebrow ? el('div', { class: 'm-eyebrow' }, [opts.eyebrow]) : null,
      el('h2', {}, [opts.title]),
    ])
  );
  const scroll = el('div', { class: 'm-sheet-body' }, body(() => close()));
  panel.appendChild(scroll);

  document.body.appendChild(scrim);
  document.body.appendChild(panel);
  // One frame so the opening transition has a starting state to animate from.
  requestAnimationFrame(() => {
    scrim.classList.add('is-open');
    panel.classList.add('is-open');
  });

  // Drag down to dismiss - the gesture people actually try first.
  let startY = 0;
  let dragging = false;
  panel.addEventListener('touchstart', (e) => {
    // Only from the top of the sheet, so the body can still scroll.
    if (scroll.scrollTop > 0) return;
    startY = e.touches[0]!.clientY;
    dragging = true;
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dy = e.touches[0]!.clientY - startY;
    if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    const dy = parseFloat((panel.style.transform.match(/([\d.]+)px/) ?? ['', '0'])[1]!);
    panel.style.transform = '';
    if (dy > 110) close();
  });

  openSheet = { close: () => close() };
}

export function closeSheet(): void {
  openSheet?.close();
}
