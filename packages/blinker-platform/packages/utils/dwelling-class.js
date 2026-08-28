// Dwelling class (home type × square footage) classifier — ADR 30 D1.
//
// The Omega home agreement PDF prints a five-way dwelling checkbox:
//
//   Single-Family < 5,000 sq ft   Single-Family 5,000–8,000
//   Townhome      < 5,000 sq ft   Single-Family 8,001–12,000
//   Condominium   < 5,000 sq ft
//
// This resolves (home_type, square_feet) to exactly one of those buckets, or
// to null when the home falls outside every one of them.
//
// null means INELIGIBLE, not "unknown". A home over its type's square-foot
// ceiling has no checkbox to tick on the agreement, so the wizard must stop
// at home_add rather than quote a plan it cannot paper. The conservative
// default mirrors classifyVehicle's 'used' fallback: never guess a bucket —
// a wrong guess ticks the wrong box on a SIGNED agreement.
//
// NOTE (ADR 30 R2): the ineligibility rule is INFERRED from the PDF's printed
// bucket list, not stated by Omega. Confirm with product.
//
// Bounds are INCLUSIVE at both ends (min_sqft <= sqft <= max_sqft), matching
// the vehicle_class_rule convention locked in Wave 38.

/**
 * @param {object|null} home
 * @param {string} home.home_type          'single_family' | 'townhome' | 'condominium'
 * @param {number|string} home.square_feet heated/finished square footage
 * @param {object} canonBlock              canon/plan-mappings.json#home_dwelling_classes
 * @returns {{ id: string, label: string, docuseal_field: string } | null}
 *          null = ineligible (no bucket matches)
 */
export function classifyDwelling(home, canonBlock) {
  if (!canonBlock || !Array.isArray(canonBlock.buckets)) {
    throw new Error(
      'classifyDwelling: canonBlock is required (pass plan-mappings.json#home_dwelling_classes)',
    );
  }

  const homeType = home?.home_type;
  // Form inputs arrive as strings; Number() handles both, and the <= 0 guard
  // rejects '', null, NaN and nonsense in one pass.
  const sqft = Number(home?.square_feet);
  if (!homeType || !Number.isFinite(sqft) || sqft <= 0) return null;

  const match = canonBlock.buckets.find(
    (b) => b.home_type === homeType
      && sqft >= Number(b.min_sqft)
      && sqft <= Number(b.max_sqft),
  );
  if (!match) return null;

  return { id: match.id, label: match.label, docuseal_field: match.docuseal_field };
}

/**
 * @param {object|null} home
 * @param {object} canonBlock
 * @returns {boolean} false when the home cannot be covered
 */
export function isHomeEligible(home, canonBlock) {
  return classifyDwelling(home, canonBlock) !== null;
}

/**
 * Home-type options for the Add home select. Canon-driven so adding a covered
 * dwelling type is a canon edit, not a code change.
 *
 * @param {object} canonBlock
 * @returns {Array<{ id: string, label: string }>}
 */
export function listHomeTypes(canonBlock) {
  if (!canonBlock || !Array.isArray(canonBlock.home_types)) return [];
  return canonBlock.home_types.map((t) => ({ id: t.id, label: t.label }));
}

export default classifyDwelling;
