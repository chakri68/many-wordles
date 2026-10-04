import { reducedMotion } from '../engine/settings';
import { haptic } from '../engine/haptics';
import { animate, h } from './dom';
import { ICONS } from './icons';

export interface ModalHandle {
  close(): Promise<void>;
  el: HTMLElement;
}

let openCount = 0;
const isSheet = () => matchMedia('(max-width: 639px)').matches;

/**
 * Bottom sheet on phones (drag the grabber down to dismiss), centred dialog on
 * wider screens. Built on <dialog> for the top layer, focus handling and Esc.
 */
export function openModal(
  title: string,
  body: Node,
  opts: { onClose?: () => void; className?: string } = {},
): ModalHandle {
  const dialog = h('dialog', { class: `modal ${opts.className ?? ''}`, 'aria-label': title });
  const backdrop = h('div', { class: 'modal-backdrop' });
  const grab = h('div', { class: 'sheet-grab', 'aria-hidden': 'true' });
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close', html: ICONS.close });
  const panel = h(
    'div',
    { class: 'modal-panel' },
    grab,
    h('header', { class: 'modal-head' }, h('h3', {}, title), closeBtn),
    h('div', { class: 'modal-body' }, body),
  );
  dialog.append(backdrop, panel);
  document.body.append(dialog);
  dialog.showModal();
  openCount++;
  document.documentElement.classList.add('modal-up');
  closeBtn.blur();
  panel.focus?.();

  const sheet = isSheet();
  animate(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  animate(
    panel,
    sheet
      ? [{ transform: 'translateY(100%)' }, { transform: 'none' }]
      : [
          { opacity: 0, transform: 'translateY(10px) scale(.97)' },
          { opacity: 1, transform: 'none' },
        ],
    { duration: sheet ? 320 : 190, easing: 'cubic-bezier(.2,.8,.2,1)' },
  );

  let closing: Promise<void> | null = null;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      const from = getComputedStyle(panel).transform;
      await Promise.all([
        animate(backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }),
        animate(
          panel,
          sheet
            ? [{ transform: from === 'none' ? 'none' : from }, { transform: 'translateY(100%)' }]
            : [{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px) scale(.98)' }],
          { duration: sheet ? 220 : 140, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' },
        ),
      ]);
      dialog.close();
      dialog.remove();
      if (--openCount <= 0) {
        openCount = 0;
        document.documentElement.classList.remove('modal-up');
      }
      opts.onClose?.();
    })();
    return closing;
  };

  closeBtn.addEventListener('click', () => close());
  backdrop.addEventListener('click', () => close());
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });

  // drag-to-dismiss (sheet only). Follows the finger with resistance upward.
  let startY = 0;
  let dy = 0;
  let t0 = 0;
  let dragging = false;
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    dy = e.clientY - startY;
    const y = dy < 0 ? dy / 6 : dy;
    panel.style.transform = `translateY(${y}px)`;
    backdrop.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / 400));
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('dragging');
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > 110 || (dy > 30 && v > 0.6)) {
      haptic('detent');
      close();
    } else if (!reducedMotion()) {
      const cur = panel.style.transform;
      panel.style.transform = '';
      backdrop.style.opacity = '';
      panel.animate([{ transform: cur }, { transform: 'none' }], {
        duration: 260,
        easing: 'cubic-bezier(.2,.9,.2,1.15)',
      });
    } else {
      panel.style.transform = '';
      backdrop.style.opacity = '';
    }
  };
  const startDrag = (e: PointerEvent) => {
    if (!isSheet()) return;
    dragging = true;
    startY = e.clientY;
    dy = 0;
    t0 = performance.now();
    panel.classList.add('dragging');
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  for (const handle of [grab, panel.querySelector('.modal-head')!]) {
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('button')) return;
      startDrag(e as PointerEvent);
    });
    handle.addEventListener('pointermove', (e) => onMove(e as PointerEvent));
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  return { close, el: dialog };
}

export function closeAllModals() {
  document.querySelectorAll('dialog.modal').forEach((d) => {
    (d as HTMLDialogElement).close();
    d.remove();
  });
  openCount = 0;
  document.documentElement.classList.remove('modal-up');
}
