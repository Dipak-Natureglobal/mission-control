import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// usePopoverPlacement — viewport-aware fixed-position placement for
// dropdowns / popovers anchored to a trigger element. Lifted in Wave 29b
// fu (Bug B) from the AgentPicker CoPilot-rail clipping bug, where the
// previous `position: absolute` dropdown inherited the rail's
// `overflow-hidden` and spilled left off-screen.
//
// Same architectural principle as src/shared/Tooltip.jsx — see memory
// `feedback_tooltip_pattern.md`: any floating layer inside an
// overflow-hidden ancestor MUST render as `position: fixed` with
// viewport-relative coordinates from getBoundingClientRect, otherwise it
// gets clipped by the ancestor.
//
// API:
//   const { triggerRef, panelRef, style, ready } = usePopoverPlacement({
//     open: boolean,             // controls whether placement runs
//     placement: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end',
//     preferredWidth: number,    // px; clamped to viewport minus margin
//     maxHeightVh: number,       // 0..100; computed as fraction of innerHeight
//     viewportMargin: number,    // px gap from viewport edges (default 8)
//     offset: number,            // px gap between trigger and panel (default 4)
//   });
//
//   - Attach `triggerRef` to the trigger button.
//   - Attach `panelRef` to the floating panel element.
//   - Spread `style` onto the panel. It will be `{ position: 'fixed', top, left,
//     width, maxHeight }`; consumers MAY add `right` themselves but
//     usually shouldn't need to.
//   - `ready === true` after the first layout pass (panel measured). On
//     first render the panel is positioned at 0,0 with opacity 0; toggle
//     opacity once `ready === true` for the same fade-in pattern Tooltip uses.
//
// Behavior:
//   - On open / resize / scroll: re-measures the trigger rect + panel
//     scrollHeight, then clamps placement so it never overflows.
//   - Vertical flip: if `bottom-*` would go below viewport bottom, flip to
//     above the trigger; same in reverse for `top-*`.
//   - Horizontal clamp: if right edge goes past viewport, slide left so
//     the panel still fits with viewportMargin. If left edge < margin,
//     pin to margin.
//   - The panel's `width` is `min(preferredWidth, viewport - 2*margin)`.

const DEFAULTS = {
  placement: 'bottom-start',
  preferredWidth: 320,
  maxHeightVh: 70,
  viewportMargin: 8,
  offset: 4,
};

export function usePopoverPlacement(opts = {}) {
  const {
    open,
    placement = DEFAULTS.placement,
    preferredWidth = DEFAULTS.preferredWidth,
    maxHeightVh = DEFAULTS.maxHeightVh,
    viewportMargin = DEFAULTS.viewportMargin,
    offset = DEFAULTS.offset,
  } = opts;

  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [style, setStyle] = useState({
    position: 'fixed',
    top: 0,
    left: 0,
    width: preferredWidth,
    maxHeight: `${maxHeightVh}vh`,
  });
  const [ready, setReady] = useState(false);

  function compute() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxH = Math.max(120, Math.floor((vh * maxHeightVh) / 100));
    const width = Math.min(preferredWidth, vw - 2 * viewportMargin);

    // Measure intended panel height (use scrollHeight when available; fall
    // back to maxH for first paint).
    const panel = panelRef.current;
    const panelH = panel
      ? Math.min(panel.scrollHeight || maxH, maxH)
      : maxH;

    const prefersBottom = placement.startsWith('bottom');
    const prefersEnd = placement.endsWith('-end');

    let top;
    const wantBottom = rect.bottom + offset + panelH <= vh - viewportMargin;
    const wantTop = rect.top - offset - panelH >= viewportMargin;
    if (prefersBottom) {
      top = wantBottom || !wantTop ? rect.bottom + offset : rect.top - offset - panelH;
    } else {
      top = wantTop || !wantBottom ? rect.top - offset - panelH : rect.bottom + offset;
    }
    if (top < viewportMargin) top = viewportMargin;
    if (top + panelH > vh - viewportMargin) {
      top = Math.max(viewportMargin, vh - viewportMargin - panelH);
    }

    let left;
    if (prefersEnd) {
      left = rect.right - width;
    } else {
      left = rect.left;
    }
    if (left + width > vw - viewportMargin) {
      left = vw - viewportMargin - width;
    }
    if (left < viewportMargin) left = viewportMargin;

    setStyle({
      position: 'fixed',
      top,
      left,
      width,
      maxHeight: maxH,
    });
    setReady(true);
  }

  useLayoutEffect(() => {
    if (!open) {
      setReady(false);
      return undefined;
    }
    compute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placement, preferredWidth, maxHeightVh, viewportMargin, offset]);

  useEffect(() => {
    if (!open) return undefined;
    function onMove() {
      compute();
    }
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { triggerRef, panelRef, style, ready, recompute: compute };
}

export default usePopoverPlacement;
