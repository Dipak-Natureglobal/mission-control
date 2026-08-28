// Lifted from payment-processing-platform/efs-prototype/src/lib/fluidpayTokenizer.js
// (load + tokenizerEnv + dev fallback helpers). Shape preserved so the
// hosted-fields component below mirrors EFS's working pattern.
//
// FluidPay's tokenizer.js exposes a `Tokenizer` global once loaded. The
// global mounts hosted-fields iframes inside a container, captures PAN /
// exp / CVV (PCI-isolated inside the iframe), and emits a short-lived
// (~2 min) one-time token back to the browser. We never see raw card data.
//
// In Phase 1 the protection-portal sandbox connects to FluidPay's sandbox
// gateway. If pubKey + tokenizerUrl env vars aren't set, a dev fallback
// renders raw inputs and mints a synthetic `tok_dev_*` token — useful in
// the Cowork sandbox where loading external scripts may be CORS-blocked.

let _scriptPromise = null;
let _loadedUrl = null;

export function loadFluidPayTokenizer({ tokenizerUrl } = {}) {
  if (!tokenizerUrl) return Promise.reject(new Error('fluidpay_tokenizer_url_missing'));
  if (_scriptPromise && _loadedUrl === tokenizerUrl) return _scriptPromise;

  // URL changed since last load — drop any cached script tag(s) + global
  // before reloading. Mirrors EFS's host-switch teardown.
  if (typeof document !== 'undefined') {
    document.querySelectorAll('script[data-fluidpay-tokenizer="1"]').forEach((el) => el.parentNode?.removeChild(el));
  }
  if (typeof window !== 'undefined') {
    try { delete window.Tokenizer; } catch (_) { window.Tokenizer = undefined; }
  }

  _loadedUrl = tokenizerUrl;
  _scriptPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('fluidpay_tokenizer_no_dom'));
      return;
    }
    const s = document.createElement('script');
    s.src = tokenizerUrl;
    s.async = true;
    s.setAttribute('data-fluidpay-tokenizer', '1');
    s.onload = () => {
      if (!window.Tokenizer) {
        reject(new Error('fluidpay_tokenizer_global_missing'));
        return;
      }
      resolve(window.Tokenizer);
    };
    s.onerror = () => reject(new Error('fluidpay_tokenizer_load_failed'));
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

// Reads VITE_* env vars. VITE_FLUIDPAY_PUB_KEY + VITE_FLUIDPAY_TOKENIZER_URL
// drive the live tokenizer; VITE_ALLOW_DEV_VAULT_TOKEN=true switches to
// raw-input dev mode. In the Cowork sandbox the env is empty by default
// → dev mode kicks in automatically (allowDevByDefault is true in Phase 1).
export function tokenizerEnv() {
  const env = typeof import.meta !== 'undefined' ? (import.meta.env || {}) : {};
  return {
    pubKey: env.VITE_FLUIDPAY_PUB_KEY || '',
    tokenizerUrl: env.VITE_FLUIDPAY_TOKENIZER_URL || 'https://sandbox.fluidpay.com/tokenizer/tokenizer.js',
    devAllowed: String(env.VITE_ALLOW_DEV_VAULT_TOKEN || 'true').toLowerCase() === 'true',
  };
}

export function devCardBrand(pan) {
  const digits = String(pan || '').replace(/\D/g, '');
  if (!digits) return null;
  if (/^4/.test(digits)) return 'visa';
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^6(?:011|5)/.test(digits)) return 'discover';
  return 'unknown';
}

export function devMintToken({ pan, expMonth, expYear, cvv }) {
  const digits = String(pan || '').replace(/\D/g, '');
  const last4 = digits.slice(-4).padStart(4, '0');
  const ts = Date.now().toString(36);
  const suffix = `${expMonth || '00'}${expYear || '00'}${cvv ? 'c' : ''}`.slice(0, 6);
  return `tok_dev_${last4}_${ts}_${suffix}`;
}

// FluidPay sandbox happy-path test cards (lifted from
// efs-prototype/src/lib/fluidpay/testCards.js — sandbox-only, rejected
// in production). Exposed for DEV CONTROLS / Phase 1 manual QA.
export const SANDBOX_TEST_CARDS = {
  visa_debit:        { number: '4111111111111111', exp: '12/30', cvv: '123', note: 'Visa debit, no surcharge' },
  visa_credit_std:   { number: '4012000033330026', exp: '12/30', cvv: '123', note: 'Visa credit, USA std' },
  mc_debit_prepaid:  { number: '5555555555554444', exp: '12/30', cvv: '123', note: 'Mastercard debit, prepaid' },
  amex_corporate:    { number: '378282246310005',  exp: '12/30', cvv: '1234', note: 'Amex corporate' },
  discover:          { number: '6011111111111117', exp: '12/30', cvv: '123', note: 'Discover credit' },
  generic_decline:   { number: '4000000000000002', exp: '12/30', cvv: '123', note: 'Generic decline (declines server-side)' },
};
