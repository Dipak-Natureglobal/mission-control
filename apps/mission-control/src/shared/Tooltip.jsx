import { useRef, useState } from 'react';

// Tooltip — shared instant-show, fixed-positioned, keyboard-accessible
// tooltip component. Lifted in Wave 26a fu1 from protection-portal's
// MonthlyTooltip pattern (PlanCard.jsx).
//
// ANY tooltip in mission-control uses this component. Native `title=`
// attributes are BANNED for hover-disclosure surfaces per project memory
// `feedback_tooltip_pattern.md` — the native attribute has ~700ms OS-level
// delay, is non-styleable, and can't escape `overflow:hidden` ancestors
// (a problem when this app gets embedded inside a mc CoPilot iframe).
// The `position: fixed` style + viewport-relative coords from
// `getBoundingClientRect()` is what lets the tooltip escape overflow
// clipping. Do NOT refactor to `position: absolute`.
//
// API:
//   <Tooltip
//     content={<>...JSX or string...</>}
//     placement="bottom-right" | "bottom-left" | "top-right" | "top-left"
//     maxWidth={260}
//     delay={0}
//     ariaLabel="text alt for screen readers if content is non-text"
//   >
//     <SomeTriggerNode />   {/* children = visible trigger element */}
//   </Tooltip>
//
// Behavior:
//   - Trigger is wrapped in a focusable `<span tabIndex={0}>` (display:
//     inline-block, cursor-help). Avoids cloneElement edge cases.
//   - On mouseEnter/focus: capture trigger viewport rect → compute coords
//     from placement → set open=true. Tooltip transitions opacity.
//   - On mouseLeave/blur: open=false (tooltip stays mounted for transition).
//   - When `content` is falsy, returns the trigger bare (no wrapper at all
//     beyond a pass-through span). This lets call sites conditionally pass
//     content without branching at the caller.
//   - Multi-line strings (containing \n) render as one <div> per line.
//
// Placement math (rect = trigger.getBoundingClientRect()):
//   bottom-right: top=rect.bottom+4, left=rect.right,  translateX(-100%)
//   bottom-left:  top=rect.bottom+4, left=rect.left,   none
//   top-right:    top=rect.top-4,    left=rect.right,  translate(-100%,-100%)
//   top-left:     top=rect.top-4,    left=rect.left,   translateY(-100%)

const PLACEMENT_TRANSFORM = {
  'bottom-right': 'translateX(-100%)',
  'bottom-left': 'none',
  'top-right': 'translate(-100%, -100%)',
  'top-left': 'translateY(-100%)',
};

function computeCoords(rect, placement) {
  if (!rect) return { top: 0, left: 0 };
  if (placement === 'bottom-left') return { top: rect.bottom + 4, left: rect.left };
  if (placement === 'top-right') return { top: rect.top - 4, left: rect.right };
  if (placement === 'top-left') return { top: rect.top - 4, left: rect.left };
  // bottom-right (default)
  return { top: rect.bottom + 4, left: rect.right };
}

function renderContent(content) {
  if (content == null) return null;
  if (typeof content === 'string' && content.includes('\n')) {
    return content.split('\n').map((line, i) => <div key={i}>{line}</div>);
  }
  return content;
}

export function Tooltip({
  content,
  placement = 'bottom-right',
  maxWidth = 260,
  delay = 0,
  ariaLabel,
  children,
}) {
  const triggerRef = useRef(null);
  const timerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  // No content → render trigger bare (still wrapped in an inline span for
  // consistent layout). Avoids forcing call sites to branch.
  if (!content) {
    return <span className="inline-block">{children}</span>;
  }

  function show() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setCoords(computeCoords(r, placement));
    if (delay > 0) {
      timerRef.current = setTimeout(() => setOpen(true), delay);
    } else {
      setOpen(true);
    }
  }
  function hide() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  }

  return (
    <span className="inline-block">
      <span
        ref={triggerRef}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-label={ariaLabel}
        className="inline-block cursor-help"
      >
        {children}
      </span>
      <span
        role="tooltip"
        style={{
          position: 'fixed',
          top: coords.top,
          left: coords.left,
          transform: PLACEMENT_TRANSFORM[placement] ?? PLACEMENT_TRANSFORM['bottom-right'],
          maxWidth: `${maxWidth}px`,
        }}
        className={
          'z-[60] w-max px-2.5 py-1.5 rounded-md border border-slate-300 bg-white shadow-md text-[11px] text-slate-900 leading-snug transition-opacity ' +
          (open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
        }
      >
        {renderContent(content)}
      </span>
    </span>
  );
}
