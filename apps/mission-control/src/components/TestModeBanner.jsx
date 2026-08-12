// TestModeBanner — sticky-top yellow banner displayed on every screen of an
// org with test_mode === true. Per architecture/10-admin-console.md § test_mode
// preservation rules: every screen, never hide, never silent.
//
// Stickiness: the banner uses `sticky top-0` inside the scroll container the
// caller renders it in. AdminHome's flex column places this above the
// scrolling content area so it stays pinned even as the user scrolls a long
// integrations list / config form.
//
// Purposefully NOT dismissible. Test mode has too much blast radius to allow
// a user to hide the indicator.

import { AlertTriangle } from 'lucide-react';

export function TestModeBanner({ orgName }) {
  return (
    <div className="sticky top-0 z-20 bg-amber-100 border-b border-amber-300 px-4 py-2.5 flex items-start gap-2 shadow-sm">
      <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
      <div className="text-xs text-amber-900 leading-relaxed">
        <span className="font-semibold">TEST MODE</span>
        {orgName && <span className="font-semibold"> · {orgName}</span>} — every
        integration on this org is routing to sandbox. No real money moves and
        no real contracts get booked.
      </div>
    </div>
  );
}
