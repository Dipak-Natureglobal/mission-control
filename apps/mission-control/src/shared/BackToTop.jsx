import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

// BackToTop — floating button that scrolls a configurable scroll
// container back to the top. Wave 26a (Phase 1 of v.3.0.7 PDF).
//
// API:
//   <BackToTop scrollerRef={ref} threshold={600} />
//     - scrollerRef: ref of the scrollable element. If omitted, falls
//                    back to window scrollY.
//     - threshold:   px scrollTop above which the button appears
//                    (default 600).
//
// Visual: floats fixed bottom-right of the viewport, blue circle with
// an up-arrow. Hides at zero/low scroll. Smooth-scrolls back on click.

export function BackToTop({ scrollerRef, threshold = 600 }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = scrollerRef?.current || null;
    function onScroll() {
      const top = el ? el.scrollTop : window.scrollY;
      setVisible(top > threshold);
    }
    onScroll();
    if (el) {
      el.addEventListener('scroll', onScroll, { passive: true });
      return () => el.removeEventListener('scroll', onScroll);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [scrollerRef, threshold]);

  function handleClick() {
    const el = scrollerRef?.current || null;
    if (el && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Back to top"
      className="fixed bottom-6 right-6 z-40 w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center transition-opacity"
    >
      <ArrowUp className="w-4 h-4" />
    </button>
  );
}
