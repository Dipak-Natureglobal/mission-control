// Tooltip — the platform's standard pattern, and the ONLY sanctioned way to
// render a tooltip anywhere in this repo.
//
// Native `title=` is banned: it has a browser-controlled delay you cannot
// tune, it cannot be styled, it gives no keyboard affordance, and — the
// reason it keeps biting us — it is invisible inside an `overflow-hidden`
// ancestor, which is most of our card chrome.
//
// The mechanics that make it work:
//   1. A ref on the trigger.
//   2. getBoundingClientRect() read BEFORE opening, so the panel is
//      positioned from the trigger's live viewport coordinates.
//   3. position: fixed on the panel, which takes it out of every clipping
//      ancestor. Moving overflow-hidden between parent and child does NOT
//      fix clipping — only escaping the flow does.
//   4. An opacity transition rather than mount/unmount, so there is no
//      layout thrash and the panel can be measured while hidden.
//
// Lifted in spirit from protection-portal/src/components/PlanCard.jsx's
// MonthlyTooltip, generalized so every call site in this repo shares it.
import { useRef, useState } from 'react';

/**
 * @param {object} props
 * @param {React.ReactNode} props.children  the trigger content
 * @param {React.ReactNode} props.content   the tooltip body
 * @param {'left'|'right'} [props.align]    which edge of the trigger the
 *                                          panel is anchored to
 * @param {() => void} [props.onFirstShow]  fired once, on first open
 * @param {string} [props.className]        extra classes on the trigger
 */
export function Tooltip({ children, content, align = 'right', onFirstShow, className = '' }) {
  const triggerRef = useRef(null);
  const firedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  function show() {
    if (open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 4, left: align === 'right' ? r.right : r.left });
    setOpen(true);
    if (!firedRef.current) {
      firedRef.current = true;
      onFirstShow?.();
    }
  }
  function hide() {
    setOpen(false);
  }
  function toggle(e) {
    // Stop propagation so a tooltip inside a clickable card does not also
    // fire the card's onClick.
    e.stopPropagation();
    e.preventDefault();
    if (open) hide();
    else show();
  }

  return (
    <span className="inline-block">
      <span
        ref={triggerRef}
        tabIndex={0}
        role="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Escape') hide();
        }}
        className={
          'cursor-help underline decoration-dotted decoration-slate-300 underline-offset-2 ' + className
        }
      >
        {children}
      </span>
      <span
        role="tooltip"
        style={{
          position: 'fixed',
          top: coords.top,
          left: coords.left,
          transform: align === 'right' ? 'translateX(-100%)' : 'none',
        }}
        className={
          'z-[60] w-max max-w-[240px] px-2.5 py-1.5 rounded-md border border-slate-300 bg-white shadow-md text-[11px] text-slate-900 leading-snug transition-opacity ' +
          (open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
        }
      >
        {content}
      </span>
    </span>
  );
}
