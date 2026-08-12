import { useCallback, useEffect, useRef, useState } from 'react';

// useInfiniteScroll — IntersectionObserver-based pagination for client-
// side row lists. Wave 26a (Phase 1 of v.3.0.7 PDF). Default page size:
// 25; tunable.
//
// API:
//   const {
//     visibleRows,      // sliced rows (length: page * pageSize, clamped)
//     sentinelRef,      // attach to a small <div /> at the END of the list
//     scrollerRef,      // attach to the SCROLLABLE ancestor (the element
//                       //   with overflow:auto). The observer's `root` is
//                       //   set to this element so it works inside a
//                       //   constrained-height scroller (e.g. an inbox
//                       //   table body) AND in document scroll mode.
//                       //   Pass null/omit-the-ref for document scroll.
//     hasMore,          // bool — true while more rows are available
//     reset,            // call when the underlying rows change shape OR
//                       //   the filter set changes; resets to first page.
//   } = useInfiniteScroll(rows, { pageSize: 25 });
//
// Reset behavior:
//   The hook auto-resets when the `rows.length` changes (most filter
//   updates shrink/grow the array length, which is enough). For caller-
//   driven resets that keep the same length (sort changes, etc.), call
//   `reset()` explicitly.

export function useInfiniteScroll(rows, { pageSize = 25 } = {}) {
  const [page, setPage] = useState(1);
  const sentinelRef = useRef(null);
  const scrollerRef = useRef(null);
  const lastLenRef = useRef(rows?.length || 0);

  // Auto-reset when the underlying length changes (filter / search /
  // type-pivot churn). Falls back to length-based heuristic because we
  // can't reasonably deep-compare arbitrary row arrays here.
  useEffect(() => {
    const len = rows?.length || 0;
    if (len !== lastLenRef.current) {
      lastLenRef.current = len;
      setPage(1);
    }
  }, [rows]);

  const reset = useCallback(() => setPage(1), []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const root = scrollerRef.current || null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setPage((p) => {
              const max = Math.ceil((rows?.length || 0) / pageSize);
              return p < max ? p + 1 : p;
            });
          }
        }
      },
      { root, rootMargin: '120px', threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // pageSize is configured at mount; rows.length is the only thing
    // that matters here (we recreate the observer to capture the new
    // length-clamp).
  }, [rows?.length, pageSize]);

  const visibleRows = (rows || []).slice(0, page * pageSize);
  const hasMore = (rows?.length || 0) > visibleRows.length;

  return { visibleRows, sentinelRef, scrollerRef, hasMore, reset };
}
