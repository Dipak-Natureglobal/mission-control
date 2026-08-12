#!/usr/bin/env node
// validate-fixtures.js
//
// Walks each child app's src/fixtures/*.json AND the platform's own
// packages/api/_fixtures/*.json, checking shape conformance against
// canon/blinker-domain.json. Lightweight: matches filename → canon
// entity, then warns on top-level field drift (extra fields not in canon,
// canon fields missing from the fixture). Doesn't enforce types or formats.
//
// Usage:
//   ./scripts/validate-fixtures.js
//
// Exit codes:
//   0 — no errors (warnings allowed)
//   1 — at least one error (parse failure or filename → entity that has
//       no canon block at all)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROJECTS = path.resolve(ROOT, '..');
const CANON_FILE = path.join(ROOT, 'canon', 'blinker-domain.json');

// Each TARGET is a { label, dir } pair. Child apps live as siblings under
// PROJECTS; the platform's own canonical fixtures live inside this repo at
// packages/api/_fixtures/ (Wave 18 — see packages/api/index.js for the
// list of entities lifted into the SDK).
const TARGETS = [
  { label: 'protection-portal',     dir: path.join(PROJECTS, 'protection-portal',     'src', 'fixtures') },
  { label: 'insurance-portal',      dir: path.join(PROJECTS, 'insurance-portal',      'src', 'fixtures') },
  { label: 'mission-control',       dir: path.join(PROJECTS, 'mission-control',       'src', 'fixtures') },
  { label: 'customer-portal',       dir: path.join(PROJECTS, 'customer-portal',       'src', 'fixtures') },
  { label: 'platform/packages/api', dir: path.join(ROOT,     'packages', 'api', '_fixtures') },
];

// Map fixture basename (without .json, lowercased) → canon entity key.
// Unmapped filenames are skipped as "not a Blinker-domain fixture" — that's
// where partner payload fixtures (stone-eagle-*, embedded-insurance-*) land.
const FILENAME_TO_ENTITY = {
  contacts:      'contact',
  opportunities: 'opportunity',
  vehicles:      'vehicle',
  households:    'household',
  notes:         'note',
  activities:    'activity',
  tags:          'tags',
};

// When the fixture is wrapped in a single key, this is the key we look for.
const PLURAL_KEY = {
  contact:     'contacts',
  opportunity: 'opportunities',
  vehicle:     'vehicles',
  household:   'households',
  note:        'notes',
  activity:    'activities',
  tags:        'tags',
};

function isMeta(key) { return key.startsWith('_'); }

function loadCanon() {
  const raw = fs.readFileSync(CANON_FILE, 'utf8');
  return JSON.parse(raw);
}

function canonShapeKeys(entityBlock) {
  if (!entityBlock || typeof entityBlock !== 'object') return null;
  const shape = entityBlock.shape;
  if (!shape || typeof shape !== 'object') return null;
  return Object.keys(shape).filter(k => !isMeta(k));
}

function classifyFile(file) {
  const base = path.basename(file, '.json').toLowerCase();
  return FILENAME_TO_ENTITY[base] || null;
}

function extractRecords(json, entity) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];

  const pluralKey = PLURAL_KEY[entity];
  if (pluralKey && Object.prototype.hasOwnProperty.call(json, pluralKey)) {
    const v = json[pluralKey];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') return Object.values(v);
  }

  // Fall through: treat the whole object as a single record (after dropping _meta keys).
  const stripped = Object.fromEntries(Object.entries(json).filter(([k]) => !isMeta(k)));
  if (Object.keys(stripped).length === 0) return [];
  return [stripped];
}

function validateRecord(record, canonKeys) {
  const recordKeys = Object.keys(record).filter(k => !isMeta(k));
  const extra = recordKeys.filter(k => !canonKeys.includes(k));
  const missing = canonKeys.filter(k => !recordKeys.includes(k));
  return { extra, missing };
}

function main() {
  const canon = loadCanon();
  console.log(`canon/blinker-domain.json @ ${canon._version || 'unknown'}\n`);

  let totalErrors = 0;

  for (const target of TARGETS) {
    const fixturesDir = target.dir;
    const app = target.label;
    console.log(`[${app}]`);

    if (!fs.existsSync(fixturesDir)) {
      console.log('  (no fixtures directory)\n');
      continue;
    }

    const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json')).sort();
    if (files.length === 0) {
      console.log('  (no JSON fixtures)\n');
      continue;
    }

    let appErrors = 0;
    let appWarnings = 0;

    for (const file of files) {
      const filePath = path.join(fixturesDir, file);

      let json;
      try {
        json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        console.log(`  ❌ ${file} — JSON parse error: ${e.message}`);
        appErrors++;
        continue;
      }

      const entity = classifyFile(file);
      if (!entity) {
        console.log(`  ·  ${file} — skipped (not a Blinker-domain entity fixture)`);
        continue;
      }

      const block = canon[entity];
      if (!block) {
        console.log(`  ❌ ${file} — entity '${entity}' missing from canon/blinker-domain.json`);
        appErrors++;
        continue;
      }

      const canonKeys = canonShapeKeys(block);
      if (!canonKeys) {
        console.log(`  ·  ${file} (entity: ${entity}) — canon stub, no shape to validate yet`);
        continue;
      }

      const records = extractRecords(json, entity);
      if (records.length === 0) {
        console.log(`  ⚠  ${file} (entity: ${entity}) — no records found in fixture`);
        appWarnings++;
        continue;
      }

      const extraSet = new Set();
      const missingSet = new Set();
      for (const rec of records) {
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
        const { extra, missing } = validateRecord(rec, canonKeys);
        extra.forEach(k => extraSet.add(k));
        missing.forEach(k => missingSet.add(k));
      }

      if (extraSet.size === 0 && missingSet.size === 0) {
        console.log(`  ✅ ${file} (entity: ${entity}) — ${records.length} record(s), shape matches canon`);
      } else {
        const parts = [];
        if (extraSet.size)   parts.push(`extra: ${[...extraSet].join(', ')}`);
        if (missingSet.size) parts.push(`missing: ${[...missingSet].join(', ')}`);
        console.log(`  ⚠  ${file} (entity: ${entity}) — ${records.length} record(s); ${parts.join(' | ')}`);
        appWarnings++;
      }
    }

    let sigil, summary;
    if (appErrors) {
      sigil = '❌';
      summary = `${appErrors} error(s)` + (appWarnings ? `, ${appWarnings} warning(s)` : '');
    } else if (appWarnings) {
      sigil = '⚠ ';
      summary = `${appWarnings} warning(s)`;
    } else {
      sigil = '✅';
      summary = 'ok';
    }
    console.log(`  ${sigil} ${app}: ${summary}\n`);

    totalErrors += appErrors;
  }

  process.exit(totalErrors ? 1 : 0);
}

main();
