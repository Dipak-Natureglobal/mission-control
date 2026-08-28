// signing — e-signature providers.
//
// Category facade, mirroring product_admin/index.js. Today there is exactly
// one provider (DocuSeal); the indirection exists so a second signer can be
// added per-org without touching call sites.
//
// Consumed by home-protection-portal DocuSeal.jsx (ADR 30 D8) and, when the
// auto workflow's placeholder step is replaced, by protection-portal.

export {
  resolveTemplateId,
  buildHomeSubmissionFields,
  createSubmission,
  resolveSigningMode,
  addMonthsIso,
} from './docuseal.js';

export { default as docuseal } from './docuseal.js';
