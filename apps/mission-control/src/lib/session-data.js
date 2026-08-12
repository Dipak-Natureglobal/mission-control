import { useCallback, useEffect, useState } from 'react';
import { formatVehicleLabel } from 'blinker-platform/utils';
import {
  contacts as contactsApi,
  opportunities as opportunitiesApi,
  registerOpportunityWriter,
} from 'blinker-platform/api';

// Session-state container for runtime-mutable opportunities + contacts.
//
// Phase 1 fixtures are read-only on disk; this hook seeds React state from
// them and exposes appenders so the agent shell can mint new opportunities
// and add vehicles to existing contacts without round-tripping through the
// fixture JSON. Mutations are session-only — refreshing the page resets
// state to the fixture seed.
//
// Single source of truth: AgentInbox + ContactProfile + CoPilotPane all
// read from this hook (via prop drilling — small tree, no provider needed).
// Don't import the fixture JSONs directly from those components; the hook
// is the only legal entry point for fixture-derived state.
//
// Shape:
//   - opportunities: array (matches opportunities.json `opportunities` shape)
//   - contacts:      object keyed by contact_id (matches contacts.json `contacts` shape)
//   - appendOpportunity(opp): prepend a session opp to the array
//   - appendVehicleToContact(contactId, vehicle): push a vehicle onto the contact's
//                    vehicles[] (no-ops if contactId is unknown)
//   - appendContact(contact): add a new contact keyed by contact.id and
//                    return contact.id. Idempotent on id collision.
//   - updateOpportunity(oppId, patch): shallow-merge a patch onto a session
//                    opp record (no-ops if oppId is unknown). Used by
//                    CoPilotPane to bind opp.vehicle_id when a wizard mints
//                    a vehicle inside the embed.
//   - updateContactVehicle(contactId, vehicleId, patch): shallow-merge a
//                    patch onto a single vehicle inside the contact's
//                    vehicles[] (no-ops if either id is unknown). Used by
//                    CoPilotPane when the protection wizard's Step 2
//                    (VehicleDrive) commits mileage / ownership / purchase
//                    date / market_value onto an already-appended vehicle.
//                    Phase 1 stand-in for blinkerApi.contacts.patchVehicle.
//   - dedupAndUpsertVehicle(contactId, vehicle): id/VIN/YMMT-aware
//                    upsert (Wave 17 P1-fu3 / P1-fu3a). Returns
//                    `{ vehicleId, matched, matchedBy, noop }` so
//                    callers can bind opportunity.vehicle_id without
//                    re-deriving the match AND skip downstream side
//                    effects when the helper short-circuited. Owns the
//                    full match-or-append decision tree so the four
//                    observer paths (protection wizard, cross-sell
//                    pre-step, refi pre-step, insurance pre-step) all
//                    share one dedup contract. See helper comment below
//                    for match priority + patch semantics + the no-op
//                    short-circuit predicate.
//
// Phase 2: each appender becomes an `await blinkerApi.<entity>.create(...)`
// call. The hook's prop signature does not change.

// Build a session-only opportunity record for a given (contact, vehicle, type).
// Status default mirrors the earliest stage in canon/ghl-status.json for the
// type — for refi/insurance this is just an informational seed since the
// opportunity hasn't been worked yet. Refi has no canon machine_id today,
// so we use a generic "New" label and let the agent move it forward inside
// the embedded AgentView.
//
// `flowPath` only applies to insurance: 'capture_and_quote' (default) or
// 'quote_only'. CoPilotPane's InsuranceEmbed reads it to seed workflow.
export function buildNewOpp({ type, contact, vehicle, flowPath }) {
  const id = `opp_new_${
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now()
  }`;
  // Vehicle is null-safe — the StartOpp flow allows refi/protection to
  // skip the vehicle modal and collect inside the CoPilot embed wizard.
  // Label degrades to '—' so the inbox row still reads cleanly.
  const vehicleLabel = formatVehicleLabel(vehicle) || '—';
  const contactName = contact.name?.preferred ||
    `${contact.name?.first ?? ''} ${contact.name?.last ?? ''}`.trim();
  const now = new Date().toISOString();

  const status =
    type === 'protection'
      ? 'New'
      : type === 'refi'
        ? 'New'
        : type === 'insurance'
          ? 'Lead Captured'
          : 'New';

  const opp = {
    id,
    type,
    contact_id: contact.id,
    contact_name: contactName,
    household: contact.household_id ? `${contactName} Household` : null,
    vehicle: vehicleLabel,
    vehicle_id: vehicle?.id || null,
    status,
    owner: 'You',
    created_at: now,
    updated_at: now,
    value: null,
    next_action: 'New — start workflow',
    deadline: null,
  };
  if (type === 'insurance') {
    opp.flowPath = flowPath || 'capture_and_quote';
  }
  return opp;
}

export function useSessionData({ registerAsHost = true } = {}) {
  const [opportunities, setOpportunities] = useState(
    () => opportunitiesApi.list(),
  );
  const [contacts, setContacts] = useState(() => contactsApi.asMap());
  // Session-only household_relationship records — minted by AddContactModal
  // when the agent picks a relationship for a different-name dedupe match.
  // Canon shape is a stub today (see canon/blinker-domain.json `household._TODO`);
  // this list is the prototype's best-fit until canon formalizes the entity.
  const [householdRelationships, setHouseholdRelationships] = useState([]);

  const appendOpportunity = useCallback((opp) => {
    setOpportunities((prev) => [opp, ...prev]);
    return opp;
  }, []);

  // Wave 31 v3.0.11 — register `appendOpportunity` as the writer for
  // `blinker-platform/api`'s `opportunities.create()` wrapper. The wrapper
  // is the public entry point for the insurance→protection cross-sell
  // spawn (ADR 21 D3a); it delegates to whatever writer the host app
  // registers at boot. mc is the only host today.
  //
  // The writer receives the create() input (with id/timestamps already
  // normalized by the wrapper) and returns the same record so callers
  // can switch the active CoPilot to it.
  //
  // Re-registers on mount (and any time appendOpportunity's ref changes,
  // which is never — it's a stable useCallback). Cleanup nulls the writer
  // so stale references can't fire after the host unmounts (relevant for
  // tests / hot reload).
  //
  // Wave 31b-fu3 — `registerAsHost` opt-out. Only the true session host
  // (App.jsx) should register the writer. Child components that call
  // useSessionData() as a legacy fallback (AgentInbox, AgentHome,
  // AgentContacts, AgentMetricsGrid, ManagerInbox) mount AFTER App.jsx
  // (React parent-before-child mount order), so their useEffect runs
  // last and would override App.jsx's writer with a pointer to their
  // own local appendOpportunity. That orphans any opp spawned via
  // opportunitiesApi.create() because the child's local session is never
  // the one AgentInbox renders from when `session` prop is provided by
  // App.jsx. Pass `{ registerAsHost: false }` from all non-host callers
  // to prevent the override. Default stays `true` so standalone callers
  // (no session prop, e.g. isolated tests or future non-App entry points)
  // continue to work without changes.
  useEffect(() => {
    if (!registerAsHost) return undefined;
    registerOpportunityWriter((opp) => {
      appendOpportunity(opp);
      return opp;
    });
    return () => registerOpportunityWriter(null);
  }, [appendOpportunity, registerAsHost]);

  // Targeted opp patch — Phase 1 stand-in for blinkerApi.opportunities.patch.
  // Used by CoPilotPane to bind opportunity.vehicle_id after the embedded
  // protection wizard mints a vehicle inside Step 1 (VehicleAdd). Shallow
  // merge + bumped updated_at; rebuilds the human-readable `vehicle` label
  // when the patch carries a new vehicle_id and the contact has a matching
  // vehicle on file (so the inbox row updates from "—" to the YMMT label).
  const updateOpportunity = useCallback((oppId, patch) => {
    if (!oppId || !patch) return;
    setOpportunities((prev) => {
      const idx = prev.findIndex((o) => o.id === oppId);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = {
        ...prev[idx],
        ...patch,
        updated_at: new Date().toISOString(),
      };
      return next;
    });
  }, []);

  const appendVehicleToContact = useCallback((contactId, vehicle) => {
    setContacts((prev) => {
      const existing = prev[contactId];
      if (!existing) return prev;
      return {
        ...prev,
        [contactId]: {
          ...existing,
          vehicles: [...existing.vehicles, vehicle],
          updated_at: new Date().toISOString(),
        },
      };
    });
  }, []);

  // Targeted vehicle patch on a contact — Phase 1 stand-in for
  // blinkerApi.contacts.patchVehicle. Used by CoPilotPane to update an
  // already-appended vehicle when the protection wizard's Step 2
  // (VehicleDrive) commits mileage / ownership / purchase_date /
  // market_value. Shallow-merges the patch onto the matched vehicle
  // entry; no-ops cleanly if contactId or vehicleId aren't found, OR
  // if the patch is empty (so a fire that brings nothing new is free).
  // Bumps the contact's updated_at so downstream selectors that key on
  // it see the change.
  const updateContactVehicle = useCallback((contactId, vehicleId, patch) => {
    if (!contactId || !vehicleId || !patch) return;
    setContacts((prev) => {
      const existing = prev[contactId];
      if (!existing || !Array.isArray(existing.vehicles)) return prev;
      const idx = existing.vehicles.findIndex((v) => v.id === vehicleId);
      if (idx === -1) return prev;
      const nextVehicles = [...existing.vehicles];
      nextVehicles[idx] = { ...existing.vehicles[idx], ...patch };
      return {
        ...prev,
        [contactId]: {
          ...existing,
          vehicles: nextVehicles,
          updated_at: new Date().toISOString(),
        },
      };
    });
  }, []);

  // Wave 17 P1-fu3 — unified id/VIN/YMMT dedup for wire-back vehicle
  // commits from any of the four observer paths (protection wizard,
  // protection cross-sell pre-step, refi pre-step, insurance pre-step).
  //
  // Background: F2-fu11a's CoPilotPane handler did id-only dedup on the
  // append branch and field-extras patch on the match branch. The
  // cross-sell pre-step (P1-fu) re-collects a VIN for a vehicle that
  // protection wizard had already committed YMMT-only. The pre-step
  // payload carries id `xs_vin_<VIN>` while the existing record carries
  // `xs_ymmt_<Y_M_M_T>` — id-only dedup misses, the new record gets
  // appended, two `contact.vehicles` entries reference the same physical
  // vehicle, and `opportunity.vehicle_id` flaps between them on every
  // re-render → the oscillation observed in smoke.
  //
  // Match priority (id wins, then VIN, then YMMT):
  //   1. id match — exact equality. Patches in place; preserves the
  //      existing id (downstream opportunity.vehicle_id refs stay valid).
  //   2. VIN match — both sides have non-empty VIN AND VINs match
  //      case-insensitive. Patches in place; preserves the existing id
  //      EVEN IF it's a stand-in (`xs_ymmt_*` / `xs_vin_*`) so an
  //      already-bound opp's vehicle_id keeps resolving.
  //   3. YMMT match — both sides have year + make + model + trim
  //      that match case-insensitive (trim equality is loose so
  //      "Element Ex" === "Element EX"). Patches in place. Critically
  //      this is the path that handles the cross-sell race: existing
  //      vehicle has YMMT only, inbound payload has YMMT + a fresh
  //      VIN — VIN gets merged into the existing record.
  //   4. No match — append a new vehicle.
  //
  // Patch semantics on match:
  //   - Inbound fields with values (non-undefined, non-null, non-empty
  //     string) are merged onto the existing record. Existing fields
  //     present in inbound are overwritten by the inbound value.
  //   - Inbound undefined / null / "" are skipped — they never
  //     overwrite existing values (so e.g. a Step-1-only re-fire that
  //     carries no mileage doesn't blow away a Step-2-set mileage).
  //   - The existing id is preserved verbatim (id is the dedup key, not
  //     a payload field).
  //
  // Returns: { vehicleId, matched, matchedBy, noop } where matchedBy
  // is 'id' | 'vin' | 'ymmt' | null and noop is true ONLY when the
  // helper short-circuited because the merged record was field-equal
  // to the existing one across the patched fields (Wave 17 P1-fu3a).
  // Callers use vehicleId to bind opportunity.vehicle_id without re-
  // deriving the match, and noop to gate downstream side effects (e.g.
  // skip updateOpportunity + telemetry on idempotent re-fires).
  const dedupAndUpsertVehicle = useCallback((contactId, vehicle) => {
    if (!contactId || !vehicle) {
      return {
        vehicleId: vehicle?.id || null,
        matched: false,
        matchedBy: null,
        noop: false,
      };
    }
    const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase());
    const vinEq = (a, b) => {
      const na = norm(a);
      const nb = norm(b);
      return !!na && !!nb && na === nb;
    };
    // Wave 17 P1-fu3a — equality predicate for the no-op short-circuit.
    // Treats null / undefined / '' as the same "missing" value so a
    // re-fire that brings nothing new doesn't tip the comparison even
    // if one side stored '' and the other undefined. Only patched
    // fields are compared (the ones the merge loop actually writes
    // through): year / make / model / trim / vin / source / mileage /
    // ownership / purchase_date / market_value. id is NOT compared
    // because the helper preserves the existing id verbatim — checking
    // it would force a false-negative on every cross-sell match where
    // inbound id differs from existing id.
    const PATCHED_FIELDS = [
      'year',
      'make',
      'model',
      'trim',
      'vin',
      'source',
      'mileage',
      'ownership',
      'purchase_date',
      'market_value',
      'annual_mileage_estimate',
      'condition',
    ];
    const isMissing = (v) =>
      v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    const fieldEq = (a, b) => {
      if (isMissing(a) && isMissing(b)) return true;
      if (isMissing(a) || isMissing(b)) return false;
      // Coerce-and-compare via string for scalar fields (year may be
      // number-or-string, mileage is number, ownership/purchase_date
      // are strings). Avoids `2024 !== '2024'` false negatives across
      // observer payloads with mixed shapes.
      return String(a) === String(b);
    };
    const ymmtEq = (a, b) => {
      if (!a || !b) return false;
      const ya = norm(a.year);
      const yb = norm(b.year);
      if (!ya || !yb || ya !== yb) return false;
      if (norm(a.make) !== norm(b.make)) return false;
      if (norm(a.model) !== norm(b.model)) return false;
      // Trim is required on both sides for a YMMT match — partial
      // YMMT (no trim) is too loose. (E.g. "Honda Element" vs
      // "Honda Element EX" should NOT collapse.)
      const ta = norm(a.trim);
      const tb = norm(b.trim);
      if (!ta || !tb) return false;
      return ta === tb;
    };

    let resolvedId = vehicle.id || null;
    let matchedBy = null;
    let noop = false;

    setContacts((prev) => {
      const existing = prev[contactId];
      if (!existing) {
        // Contact not in session map — refuse silently. The handler's
        // noop short-circuit fires in this branch (matchedBy stays null,
        // resolvedId stays inbound) but the loop is closed at the
        // CoPilotPane handler-stability layer (Wave 17 P1-fu3b) so the
        // wizard observer no longer re-fires from prop churn alone.
        return prev;
      }
      // Treat a missing/non-array vehicles slot as []. Previously this
      // branch returned prev unchanged, which silently dropped the
      // inbound vehicle AND left matchedBy=null forever — so the handler
      // would keep binding opportunity.vehicle_id to the inbound stand-
      // in id every fire. Coercing to [] here lets the no-match append
      // branch run and seeds the array for subsequent id matches.
      const vehicles = Array.isArray(existing.vehicles)
        ? existing.vehicles
        : [];

      // 1. id match
      let idx = vehicle.id ? vehicles.findIndex((v) => v.id === vehicle.id) : -1;
      if (idx !== -1) {
        matchedBy = 'id';
      } else {
        // 2. VIN match
        idx = vehicles.findIndex((v) => vinEq(v.vin, vehicle.vin));
        if (idx !== -1) {
          matchedBy = 'vin';
        } else {
          // 3. YMMT match
          idx = vehicles.findIndex((v) => ymmtEq(v, vehicle));
          if (idx !== -1) matchedBy = 'ymmt';
        }
      }

      const nowIso = new Date().toISOString();

      if (idx === -1) {
        // 4. No match — append.
        resolvedId = vehicle.id || null;
        return {
          ...prev,
          [contactId]: {
            ...existing,
            vehicles: [...vehicles, vehicle],
            updated_at: nowIso,
          },
        };
      }

      // Match — merge inbound non-empty fields onto the existing record.
      // Skip undefined / null / empty-string inbound values so a
      // partial re-fire never erases an existing value. Preserve
      // existing id (so downstream opportunity.vehicle_id refs stick).
      const existingVeh = vehicles[idx];
      resolvedId = existingVeh.id;
      const merged = { ...existingVeh };
      for (const k of Object.keys(vehicle)) {
        if (k === 'id') continue;
        const inbound = vehicle[k];
        if (inbound === undefined || inbound === null) continue;
        if (typeof inbound === 'string' && inbound.trim() === '') continue;
        merged[k] = inbound;
      }

      // Wave 17 P1-fu3a — no-op short-circuit. If every patched field
      // on the merged record is field-equal to the existing record,
      // there is nothing to write. Returning prev (the SAME object
      // reference) makes React skip the re-render entirely; without
      // this the helper would build a new merged object every fire and
      // flip `contact.vehicles[idx]`'s reference, which propagates up
      // to CoPilotPane's `vehicle = useMemo(...)` resolver and re-runs
      // every downstream effect including the embed observers'
      // useEffect deps — that's the residual loop after P1-fu3.
      let allEqual = true;
      for (const k of PATCHED_FIELDS) {
        if (!fieldEq(merged[k], existingVeh[k])) {
          allEqual = false;
          break;
        }
      }
      if (allEqual) {
        noop = true;
        return prev;
      }

      const nextVehicles = [...vehicles];
      nextVehicles[idx] = merged;
      return {
        ...prev,
        [contactId]: {
          ...existing,
          vehicles: nextVehicles,
          updated_at: nowIso,
        },
      };
    });

    return {
      vehicleId: resolvedId,
      matched: matchedBy !== null,
      matchedBy,
      noop,
    };
  }, []);

  const appendContact = useCallback((contact) => {
    if (!contact || !contact.id) return null;
    setContacts((prev) => {
      if (prev[contact.id]) return prev;
      return { ...prev, [contact.id]: contact };
    });
    return contact.id;
  }, []);

  // Targeted contact patch — Phase 1 stand-in for blinkerApi.contacts.patch.
  // Used by the StartOpportunityFlow DOB-collection gate when an insurance
  // opp's contact lacks date_of_birth. Merges shallow over the existing
  // record and bumps updated_at.
  const patchContact = useCallback((contactId, patch) => {
    if (!contactId || !patch) return;
    setContacts((prev) => {
      const existing = prev[contactId];
      if (!existing) return prev;
      return {
        ...prev,
        [contactId]: {
          ...existing,
          ...patch,
          updated_at: new Date().toISOString(),
        },
      };
    });
  }, []);

  // Mint a household_relationship + cross-link both contacts'
  // household_member_ids so downstream UI (e.g., refi cross-sell co-applicant
  // prompt) sees them as related. Phase 2: a single API call writes the
  // relationship; the session mirror dies.
  const appendHouseholdRelationship = useCallback((rel) => {
    if (!rel || !rel.contact_a_id || !rel.contact_b_id) return null;
    setHouseholdRelationships((prev) => [...prev, rel]);
    setContacts((prev) => {
      const a = prev[rel.contact_a_id];
      const b = prev[rel.contact_b_id];
      if (!a || !b) return prev;
      const aMembers = Array.isArray(a.household_member_ids) ? a.household_member_ids : [];
      const bMembers = Array.isArray(b.household_member_ids) ? b.household_member_ids : [];
      return {
        ...prev,
        [rel.contact_a_id]: {
          ...a,
          household_member_ids: aMembers.includes(rel.contact_b_id)
            ? aMembers
            : [...aMembers, rel.contact_b_id],
        },
        [rel.contact_b_id]: {
          ...b,
          household_member_ids: bMembers.includes(rel.contact_a_id)
            ? bMembers
            : [...bMembers, rel.contact_a_id],
        },
      };
    });
    return rel.id;
  }, []);

  return {
    opportunities,
    contacts,
    householdRelationships,
    appendOpportunity,
    appendVehicleToContact,
    updateContactVehicle,
    dedupAndUpsertVehicle,
    appendContact,
    appendHouseholdRelationship,
    patchContact,
    updateOpportunity,
  };
}
