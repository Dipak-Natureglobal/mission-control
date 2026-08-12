// React wrapper around FluidPay's Tokenizer iframe. Lifted from
// payment-processing-platform/efs-prototype/src/components/FluidPayHostedFields.jsx
// with EFS-specific bits trimmed (no ACH path here — protection-portal
// only does card capture in Phase 1).
//
// The two ugly bits inherited from EFS — kept on purpose because they
// are load-bearing in production:
//   1. setTimeout(0) before tk.submit(): React's synthetic event context
//      causes FluidPay's iframe to silently drop the submit; deferring
//      out of the event loop fixes it. Diagnosed in EFS 2026-04-25.
//   2. Patched tk.submit() that bypasses Guardian: FluidPay's stock
//      submit() awaits Guardian.getData() which can hang indefinitely
//      in some React contexts. We postMessage the submit event directly.
//
// Imperative API:
//   ref.current.tokenize() → Promise<{ one_time_token, card_last_four,
//                                       card_brand, exp_month, exp_year, dev }>
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { tokenizerEnv, devCardBrand, devMintToken } from '../lib/fluidpay.js';

const TOKENIZE_TIMEOUT_MS = 15_000;

const _loadedScript = new Set();
function loadTokenizerScript(url) {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.Tokenizer && _loadedScript.has(url)) {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[data-fluidpay-tokenizer="1"][src="${url}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('script_load_failed')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.setAttribute('data-fluidpay-tokenizer', '1');
    s.onload = () => { _loadedScript.add(url); resolve(); };
    s.onerror = () => reject(new Error('script_load_failed'));
    document.head.appendChild(s);
  });
}

export const FluidPayHostedFields = forwardRef(function FluidPayHostedFields(
  { amount = 1.0, onStatusChange, pubKey: propPubKey, tokenizerUrl: propTokenizerUrl },
  ref,
) {
  const env = tokenizerEnv();
  const callerManagesConfig = propPubKey !== undefined || propTokenizerUrl !== undefined;
  const pubKey = callerManagesConfig ? (propPubKey || null) : env.pubKey;
  const tokenizerUrl = callerManagesConfig ? (propTokenizerUrl || null) : env.tokenizerUrl;
  const { devAllowed } = env;

  const [mode, setMode] = useState(() => {
    if (!pubKey || !tokenizerUrl) return devAllowed ? 'dev' : 'error';
    return 'loading';
  });
  const [loadError, setLoadError] = useState(null);

  const containerRef = useRef(null);
  const tokenizerInstanceRef = useRef(null);
  const pendingRef = useRef(null);

  const [devPan, setDevPan] = useState('');
  const [devExp, setDevExp] = useState('');
  const [devCvv, setDevCvv] = useState('');

  useEffect(() => {
    if (mode !== 'loading') return;
    if (!pubKey || !tokenizerUrl) return;
    if (!containerRef.current) return;

    const existing = tokenizerInstanceRef.current;
    if (
      existing && existing.iframe && existing.iframe.isConnected &&
      existing.iframe.contentWindow && containerRef.current?.contains(existing.iframe)
    ) {
      setMode('live');
      return;
    }
    tokenizerInstanceRef.current = null;

    let cancelled = false;
    loadTokenizerScript(tokenizerUrl)
      .then(() => {
        if (cancelled) return;
        if (!window.Tokenizer) {
          setLoadError('fluidpay_tokenizer_global_missing');
          setMode(devAllowed ? 'dev' : 'error');
          onStatusChange?.({ mode: devAllowed ? 'dev' : 'error', reason: 'global_missing' });
          return;
        }
        let urlBase;
        try { const u = new URL(tokenizerUrl); urlBase = `${u.protocol}//${u.host}`; } catch (_) { urlBase = undefined; }
        try {
          tokenizerInstanceRef.current = new window.Tokenizer({
            apikey: pubKey,
            url: urlBase,
            container: containerRef.current,
            amount,
            settings: { payment: { types: ['card'] } },
            onLoad: () => console.info('[FluidPay] iframe mounted'),
            submission: (resp) => {
              const pending = pendingRef.current;
              pendingRef.current = null;
              if (!pending) return;
              if (resp && resp.status === 'success' && resp.token) {
                const card = resp.card || resp.payment_method?.card || {};
                pending.resolve({
                  one_time_token: resp.token,
                  card_last_four: card.last_four || card.last4 || null,
                  card_brand: (card.card_type || card.brand || '').toLowerCase() || null,
                  exp_month: card.expiration_month ? Number(card.expiration_month) : null,
                  exp_year: card.expiration_year ? Number(card.expiration_year) : null,
                  dev: false,
                });
              } else {
                const msg = (resp && (resp.msg || resp.message || resp.error)) || 'tokenize_failed';
                const err = new Error('tokenize_validation_failed');
                err.detail = String(msg);
                pending.reject(err);
              }
            },
          });
          // PATCH: bypass Guardian getData() so submit() doesn't hang in
          // certain React event contexts. See file header.
          try {
            const inst = tokenizerInstanceRef.current;
            inst.submit = function (amt) {
              try { inst.postMessage({ event: 'submit', data: { amount: amt } }); }
              catch (e) { console.warn('[FluidPay] postMessage threw', e); }
            };
          } catch (patchErr) {
            console.warn('[FluidPay] submit() patch failed', patchErr);
          }
          setMode('live');
          onStatusChange?.({ mode: 'live' });
        } catch (err) {
          console.warn('[FluidPay] Tokenizer constructor threw', err);
          setLoadError(String(err?.message || err));
          setMode(devAllowed ? 'dev' : 'error');
          onStatusChange?.({ mode: devAllowed ? 'dev' : 'error', reason: 'mount_failed' });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[FluidPay] script load failed', err);
        setLoadError(String(err?.message || err));
        setMode(devAllowed ? 'dev' : 'error');
        onStatusChange?.({ mode: devAllowed ? 'dev' : 'error', reason: 'script_load_failed' });
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pubKey, tokenizerUrl]);

  const tokenizeLive = useCallback(() => {
    return new Promise((resolve, reject) => {
      const tk = tokenizerInstanceRef.current;
      if (!tk) { reject(new Error('tokenizer_unavailable')); return; }
      if (!tk.iframe || !tk.iframe.isConnected || !tk.iframe.contentWindow) {
        reject(new Error('tokenizer_iframe_detached')); return;
      }
      if (pendingRef.current) { reject(new Error('tokenize_in_flight')); return; }
      const timeoutId = setTimeout(() => {
        if (pendingRef.current === handle) {
          pendingRef.current = null;
          reject(new Error('tokenize_timeout'));
        }
      }, TOKENIZE_TIMEOUT_MS);
      const handle = {
        resolve: (v) => { clearTimeout(timeoutId); resolve(v); },
        reject: (e) => { clearTimeout(timeoutId); reject(e); },
      };
      pendingRef.current = handle;
      // CRITICAL: defer out of React's synthetic event context. See header.
      setTimeout(() => {
        if (pendingRef.current !== handle) return;
        try { tk.submit(); }
        catch (err) {
          pendingRef.current = null;
          clearTimeout(timeoutId);
          reject(err);
        }
      }, 0);
    });
  }, []);

  const tokenizeDev = useCallback(() => {
    const digits = devPan.replace(/\D/g, '');
    if (digits.length < 13) {
      return Promise.reject(Object.assign(new Error('tokenize_validation_failed'), {
        detail: 'Enter a valid card number (13–19 digits).',
      }));
    }
    const [mm, yy] = devExp.split('/');
    const expMonth = mm ? Number(mm) : null;
    const expYear = yy ? 2000 + Number(yy) : null;
    if (!expMonth || expMonth < 1 || expMonth > 12) {
      return Promise.reject(Object.assign(new Error('tokenize_validation_failed'), {
        detail: 'Enter a valid expiration in MM/YY format.',
      }));
    }
    if (devCvv.replace(/\D/g, '').length < 3) {
      return Promise.reject(Object.assign(new Error('tokenize_validation_failed'), {
        detail: 'Enter a valid CVV.',
      }));
    }
    return Promise.resolve({
      one_time_token: devMintToken({ pan: digits, expMonth, expYear, cvv: devCvv }),
      card_last_four: digits.slice(-4),
      card_brand: devCardBrand(digits),
      exp_month: expMonth,
      exp_year: expYear,
      dev: true,
    });
  }, [devPan, devExp, devCvv]);

  useImperativeHandle(ref, () => ({
    mode,
    tokenize: () => {
      if (mode === 'live') return tokenizeLive();
      if (mode === 'dev') return tokenizeDev();
      return Promise.reject(new Error('tokenizer_unavailable'));
    },
    getDevFields: () => ({ pan: devPan, exp: devExp, cvv: devCvv }),
  }), [mode, tokenizeLive, tokenizeDev, devPan, devExp, devCvv]);

  if (mode === 'error') {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
        <div className="font-semibold mb-0.5">Tokenizer unavailable</div>
        {loadError
          ? <>Could not load FluidPay hosted fields ({loadError}). Set <code>VITE_FLUIDPAY_PUB_KEY</code> + <code>VITE_FLUIDPAY_TOKENIZER_URL</code>, or <code>VITE_ALLOW_DEV_VAULT_TOKEN=true</code>.</>
          : <>FluidPay pub_key or tokenizer URL not configured.</>}
      </div>
    );
  }

  if (mode === 'dev') {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 flex items-center gap-1.5">
          <span className="font-semibold">Dev tokenizer</span>
          <span className="opacity-70">— FluidPay iframe skipped (sandbox-friendly)</span>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1 font-semibold uppercase tracking-wide">Card number</label>
          <input
            value={devPan}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 19);
              setDevPan(digits.replace(/(.{4})/g, '$1 ').trim());
            }}
            placeholder="4111 1111 1111 1111"
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
            autoComplete="off"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1 font-semibold uppercase tracking-wide">Exp (MM/YY)</label>
            <input
              value={devExp}
              onChange={(e) => {
                const d = e.target.value.replace(/\D/g, '').slice(0, 4);
                setDevExp(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
              }}
              placeholder="12/30"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1 font-semibold uppercase tracking-wide">CVV</label>
            <input
              value={devCvv}
              onChange={(e) => setDevCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="123"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
              autoComplete="off"
            />
          </div>
        </div>
      </div>
    );
  }

  // mode === 'loading' or 'live' — FluidPay mounts the iframe inside this div.
  // The "Loading…" sibling stays in the JSX with visibility: hidden so React
  // doesn't reconcile it away and detach the iframe. See EFS file header.
  return (
    <div>
      <div
        className="text-xs text-slate-500 mb-1.5"
        style={{
          visibility: mode === 'loading' ? 'visible' : 'hidden',
          height: mode === 'loading' ? 'auto' : 0,
          marginBottom: mode === 'loading' ? undefined : 0,
        }}
        aria-hidden={mode !== 'loading'}
      >
        Loading secure card entry…
      </div>
      <div
        ref={containerRef}
        data-fluidpay-container="1"
        className="min-h-[140px] rounded-md border border-slate-300 bg-white px-3 py-2"
      />
      <div className="mt-1.5 text-[11px] text-slate-400">
        Card fields above are served from FluidPay — Blinker never sees the number.
      </div>
    </div>
  );
});
