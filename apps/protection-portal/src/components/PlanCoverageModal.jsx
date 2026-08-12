// Wave 27 v3.0.8 Task 1 — "See what's covered" modal for PlanCard.
//
// Props:
//   open              — boolean; controls visibility
//   onClose           — () => void; called on Escape, backdrop click, or X button
//   title             — string; the plan title shown in the modal header
//   coverageHtml      — string; sanitized HTML from resolvePlanPresentation().coverageHtml
//                       ({{SAMPLE_AGREEMENT_URL}} placeholder already interpolated by resolver)
//   sampleAgreementUrl — string|null; null → shows the "not yet published" note
//   tpaCode / planCode / planDescription — agent lookup line (Wave 27-fu1):
//     rendered above the "not yet published" note as
//     "{TpaCode} · {PlanCode} · {PlanDescription}" so agents can find the
//     plan in the rater's admin tool when no sample-agreement URL is wired.
//
// Security: DOMPurify sanitizes coverageHtml client-side. The after-sanitize
// hook further strips any <a href> that doesn't start with https://, mailto:,
// or # to prevent javascript: injection even through allowed attr patterns.
// ALLOWED_TAGS/ATTRS are intentionally conservative — no <script>, no
// event handlers.

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import DOMPurify from 'dompurify';

const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'div', 'h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li',
    'span', 'a', 'br', 'strong', 'em', 'b', 'i', 'small',
  ],
  ALLOWED_ATTR: ['style', 'href', 'target', 'rel'],
};

// DOMPurify after-sanitize hook: strip <a href> that doesn't match safe schemes.
// We register it once at module level and guard against double-registration.
let hookRegistered = false;
function ensureAfterSanitizeHook() {
  if (hookRegistered) return;
  hookRegistered = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      const href = node.getAttribute('href') || '';
      const safe =
        href.startsWith('https://') ||
        href.startsWith('mailto:') ||
        href === '#' ||
        href.startsWith('#');
      if (!safe) {
        node.removeAttribute('href');
      }
    }
  });
}

function getSafeHtml(html) {
  ensureAfterSanitizeHook();
  return DOMPurify.sanitize(html || '', DOMPURIFY_CONFIG);
}

export function PlanCoverageModal({
  open,
  onClose,
  title,
  coverageHtml,
  sampleAgreementUrl,
  tpaCode = null,
  planCode = null,
  planDescription = null,
}) {
  const dialogRef = useRef(null);

  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  // Detect if the resolved HTML has no real sample agreement link (placeholder
  // was substituted with '#' by the resolver when sample_agreement_url is null).
  const hasRealAgreementUrl =
    sampleAgreementUrl != null &&
    sampleAgreementUrl !== '' &&
    sampleAgreementUrl !== '#';

  const safeHtml = getSafeHtml(coverageHtml);
  const modalId = 'plan-coverage-modal-title';

  return (
    // Full-screen overlay — closes on backdrop click but NOT on modal-body click.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.4)' }}
      onClick={onClose}
      aria-hidden="true"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={modalId}
        className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-white rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white">
          <h2 id={modalId} className="text-base font-semibold text-slate-900">
            {title || 'Coverage Details'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close coverage details"
            className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Coverage HTML body */}
        <div className="px-6 py-4">
          {safeHtml ? (
            <div
              className="prose prose-sm max-w-none text-slate-700"
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            <p className="text-sm text-slate-500">No coverage details available for this plan.</p>
          )}

          {/* Agent lookup line — TpaCode · PlanCode · PlanDescription. Lets
              agents pivot to the rater's admin tool when needed. Rendered above
              the "not yet published" note in the same muted style. */}
          {(tpaCode || planCode || planDescription) && (
            <p className="mt-4 text-xs text-slate-400 italic">
              {[tpaCode, planCode, planDescription].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* Note when sample agreement URL is absent */}
          {!hasRealAgreementUrl && (
            <p className={
              (tpaCode || planCode || planDescription ? 'mt-1' : 'mt-4') +
              ' text-xs text-slate-400 italic'
            }>
              Sample agreement not yet published for this plan.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
