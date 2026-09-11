#!/usr/bin/env node
/**
 * The human-readable record of what changed in this monorepo, and when.
 *
 * `pnpm sync` calls this at the end of a successful run. It reads the upstream
 * commits the sync just pulled in, plus this repo's own new commits, and writes
 * a dated entry that anyone — technical or not — can read.
 *
 *   pnpm changelog          write a new entry (or say there is nothing to write)
 *   pnpm changelog:dry      render the entry to the terminal, touch no files
 *   pnpm changelog:check    fail while any TODO placeholder is still unfilled
 *
 * The JSON file is the source of truth. CHANGELOG.md is rendered from it on
 * every write and must never be hand-edited — `--check` catches it if it is.
 *
 * A generated entry is only half done. The four plain-English fields (headline,
 * meaning, actionNeeded, stillOpen) are written by a person, because no script
 * knows what a change *meant*. `--check` is what stops a half-done entry from
 * reaching a commit.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'sync.config.json'), 'utf8'));
const STATE_FILE = path.join(ROOT, 'sync-state.json');
const DATA_FILE = path.join(ROOT, 'apps', 'changelog-portal', 'src', 'data', 'changelog.json');
const HISTORY_FILE = path.join(ROOT, 'apps', 'changelog-portal', 'src', 'data', 'history.json');
const MD_FILE = path.join(ROOT, 'CHANGELOG.md');

/** Anything still carrying this is an entry a person has not finished. */
const TODO = 'TODO:';

/** How this repo's own history is keyed, alongside the upstream apps. */
const LOCAL_KEY = '__local';

/** Folder name -> the name a non-technical reader would recognise. */
export const DISPLAY_NAMES = {
    'customer-portal': 'Customer Portal',
    'home-protection-portal': 'Home Protection Portal',
    'insurance-portal': 'Insurance Portal',
    'mission-control': 'Mission Control',
    'protection-portal': 'Protection Portal',
    'refinance-prototype': 'Refinance Portal',
    'blinker-platform': 'Blinker Platform (shared library)',
    'changelog-portal': 'Changelog Portal',
};

/**
 * Conventional-commit prefix -> a heading a non-developer understands.
 * Nothing is ever shown with its raw `feat:` / `chore:` prefix attached.
 */
const GROUPS = [
    [/^feat\b/i, 'New features'],
    [/^fix\b/i, 'Fixes'],
    [/^(refactor|perf|style)\b/i, 'Internal cleanup (nothing visible changed)'],
    [/^docs?\b/i, 'Documentation'],
    [/^sync\b/i, 'Upstream syncs'],
    [/^(chore|build|ci|test)\b/i, 'Housekeeping'],
];
const OTHER = 'Other changes';
const GROUP_ORDER = [...GROUPS.map(([, label]) => label), OTHER];

// ---------------------------------------------------------------- git helpers

function git(args) {
    return execFileSync('git', args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function tryGit(args) {
    try {
        return git(args);
    } catch {
        return null;
    }
}

function commitExists(rev) {
    return tryGit(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]) !== null;
}

function readJson(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

// ------------------------------------------------------------ commit grouping

function groupFor(subject) {
    for (const [pattern, label] of GROUPS) if (pattern.test(subject)) return label;
    return OTHER;
}

/** Strip the `feat(scope):` prefix and start with a capital, so it reads as a sentence. */
function humanise(subject) {
    const stripped = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '').trim();
    return stripped ? stripped[0].toUpperCase() + stripped.slice(1) : subject;
}

function readCommits(range) {
    const out = tryGit(['log', '--no-merges', '--date=iso-strict', '--pretty=%h%x09%ad%x09%s', range]);
    if (!out) return [];
    return out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const [sha, at, ...rest] = line.split('\t');
            const subject = rest.join('\t');
            return { sha, at, group: groupFor(subject), subject: humanise(subject) };
        });
}

/** { "New features": [...], "Fixes": [...] } — empty groups are dropped. */
function groupCommits(commits) {
    const groups = {};
    for (const label of GROUP_ORDER) {
        const hits = commits.filter((commit) => commit.group === label);
        if (hits.length) groups[label] = hits.map(({ group: _group, ...rest }) => rest);
    }
    return groups;
}

// ------------------------------------------------------------- entry building

const short = (sha) => (sha ? sha.slice(0, 8) : null);

/**
 * The range of this repo's own commits not yet logged. Falls back to the last
 * 20 commits when the recorded marker is gone (rewritten history).
 */
function localRange(state) {
    const sha = state.changelog?.lastLocalSha;
    if (sha && commitExists(sha)) return `${sha}..HEAD`;
    if (sha) console.warn('  ! recorded lastLocalSha is gone (history rewritten?) — using the last 20 commits instead');
    return commitExists('HEAD~20') ? 'HEAD~20..HEAD' : 'HEAD';
}

/**
 * Build one entry. `report` is the array `sync-portals.mjs` collects; pass null
 * to build an entry from this repo's own commits alone.
 */
export function buildEntry(report) {
    const state = readJson(STATE_FILE, { portals: {} });
    const portals = [];

    for (const portal of CONFIG.portals) {
        const name = DISPLAY_NAMES[path.basename(portal.dir)] ?? path.basename(portal.dir);
        const row = report?.find((entry) => entry.remote === portal.remote);
        const moved = row?.status === 'updated' && row.newSha && row.oldSha !== row.newSha;

        if (!moved) {
            const sha = row?.newSha ?? state.portals?.[portal.remote]?.sha;
            portals.push({ remote: portal.remote, name, dir: portal.dir, unchanged: true, at: short(sha) });
            continue;
        }

        portals.push({
            remote: portal.remote,
            name,
            dir: portal.dir,
            from: short(row.oldSha),
            to: short(row.newSha),
            files: row.stats ?? null,
            compare: row.oldSha
                ? `${portal.repo}/compare/${row.oldSha}...${row.newSha}`
                : `${portal.repo}/commits/${row.newSha}`,
            groups: groupCommits(row.oldSha ? readCommits(`${row.oldSha}..${row.newSha}`) : []),
        });
    }

    const local = readCommits(localRange(state));
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');

    return {
        entry: {
            date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
            generatedAt: now.toISOString(),
            kind: report ? 'sync' : 'update',
            headline: `${TODO} one sentence, in plain words, no jargon`,
            meaning: [`${TODO} one bullet per app that changed — what someone using it would notice`],
            actionNeeded: `${TODO} does anyone need to do anything? If not, write "No."`,
            stillOpen: `${TODO} anything left unfinished after this, or "Nothing new."`,
            portals,
            local,
        },
        hasChanges: portals.some((portal) => !portal.unchanged) || local.length > 0,
    };
}

// ------------------------------------------------------------------ rendering

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

function humanDate(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** `2026-09-08T14:04:22+05:30` -> `2026-09-08 14:04` */
function shortStamp(iso) {
    return typeof iso === 'string' ? iso.replace('T', ' ').slice(0, 16) : '';
}

const HEADER = `# Changelog

Everything that has changed in this project, newest first — what changed, when it
changed, and what it actually means.

**How to read this page**

1. Entries are newest first. Each one opens with a plain-English summary. You do
   not need to be a developer to read it.
2. **What this means** is the part that matters to most people: what is different
   now, app by app.
3. Only if you want commit-level detail, open **Technical detail** at the bottom
   of an entry. Everything above it is written to be understood on its own.

There is a companion page for what is still *coming*: [ROADMAP.md](ROADMAP.md).
The same information is browsable, with filters, in the Changelog Portal app
(\`pnpm --filter changelog-portal dev\`).

<details>
<summary>Glossary — the six words that show up below</summary>

- **Portal / app** — one of the websites in this project (Mission Control, Home
  Protection Portal, and so on). Each one runs on its own.
- **Upstream** — the original repository a portal's code is written in, owned by
  the Blinker teams. This project copies from it and never writes back.
- **Sync** — the act of copying the newest upstream code into this project.
- **Commit** — one saved change, with a short message describing it.
- **SHA** — the short code identifying a commit, like \`1a2b3c4d\`. Think of it as
  a version number that is never reused.
- **Canon** — the shared settings files (plans, statuses, field names) every
  portal reads, so they all agree on the same values.

</details>

> **This file is generated.** The source of truth is
> \`apps/changelog-portal/src/data/changelog.json\`. Edit that, then run
> \`pnpm changelog --render\` to rebuild this page. Hand-edits here are overwritten.

<!-- changelog:insert -->
`;

function renderEntry(entry) {
    const lines = [];
    lines.push(`## ${humanDate(entry.date)} — ${entry.headline}`, '');
    lines.push('**What this means**', '');
    for (const bullet of entry.meaning) lines.push(`- ${bullet}`);
    lines.push('', `**Does this need anything from us?** ${entry.actionNeeded}`, '');
    lines.push(`**Still open after this:** ${entry.stillOpen}`, '');

    lines.push('<details>', '<summary>Technical detail — commits, versions, file counts</summary>', '');

    const moved = entry.portals.filter((portal) => !portal.unchanged);
    const still = entry.portals.filter((portal) => portal.unchanged);

    for (const portal of moved) {
        lines.push(`#### ${portal.name} — \`${portal.dir}\``, '');
        const files = portal.files
            ? ` · ${portal.files.added} files added, ${portal.files.updated} changed, ${portal.files.removed} removed`
            : '';
        lines.push(
            `Version \`${portal.from ?? 'first sync'}\` → \`${portal.to}\`${files} · [compare on GitHub](${portal.compare})`,
            '',
        );
        for (const [label, commits] of Object.entries(portal.groups)) {
            lines.push(`**${label}**`, '');
            for (const commit of commits) lines.push(`- ${shortStamp(commit.at)} · \`${commit.sha}\` · ${commit.subject}`);
            lines.push('');
        }
    }

    if (still.length) {
        lines.push('**Unchanged this round**', '');
        for (const portal of still) lines.push(`- ${portal.name} — still at \`${portal.at ?? 'not synced yet'}\``);
        lines.push('');
    }

    if (entry.local.length) {
        lines.push('**Changes made in this monorepo itself**', '');
        for (const label of GROUP_ORDER) {
            const hits = entry.local.filter((commit) => commit.group === label);
            if (!hits.length) continue;
            lines.push(`*${label}*`, '');
            for (const commit of hits) lines.push(`- ${shortStamp(commit.at)} · \`${commit.sha}\` · ${commit.subject}`);
            lines.push('');
        }
    }

    lines.push('</details>', '');
    return lines.join('\n');
}

export function renderMarkdown(entries) {
    if (!entries.length) return `${HEADER}\n_No entries yet. Run \`pnpm changelog\` after a sync._\n`;
    return `${HEADER}\n${entries.map(renderEntry).join('\n---\n\n')}`;
}

// ------------------------------------------------------- full history per app

/** Group a newest-first commit list into months, newest month first. */
function byMonth(commits) {
    const months = [];
    const index = new Map();
    for (const commit of commits) {
        const date = commit.at.slice(0, 10);
        const key = date.slice(0, 7);
        if (!index.has(key)) {
            const [year, month] = key.split('-').map(Number);
            const bucket = { key, label: `${MONTHS[month - 1]} ${year}`, items: [] };
            index.set(key, bucket);
            months.push(bucket);
        }
        index.get(key).items.push({ date, day: Number(date.slice(8, 10)), text: commit.subject });
    }
    return months;
}

/**
 * Every update each app has ever had, from its first to the version this project
 * currently uses. Read straight from the app's own history, so it needs no
 * record-keeping of ours and is complete the first time it runs.
 */
export function buildHistory() {
    const state = readJson(STATE_FILE, { portals: {} });
    const apps = [];

    for (const portal of CONFIG.portals) {
        const sha = state.portals?.[portal.remote]?.sha;
        if (!sha || !commitExists(sha)) continue;
        const commits = readCommits(sha);
        if (!commits.length) continue;
        apps.push({
            key: portal.remote,
            name: DISPLAY_NAMES[path.basename(portal.dir)] ?? path.basename(portal.dir),
            total: commits.length,
            first: commits[commits.length - 1].at.slice(0, 10),
            last: commits[0].at.slice(0, 10),
            months: byMonth(commits),
        });
    }

    const local = readCommits('HEAD');
    if (local.length) {
        apps.push({
            key: LOCAL_KEY,
            name: 'This project itself',
            total: local.length,
            first: local[local.length - 1].at.slice(0, 10),
            last: local[0].at.slice(0, 10),
            months: byMonth(local),
        });
    }

    return { generatedAt: new Date().toISOString(), apps };
}

// -------------------------------------------------------------------- writing

function writeFiles(entries) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    fs.writeFileSync(HISTORY_FILE, `${JSON.stringify(buildHistory(), null, 2)}\n`, 'utf8');
    fs.writeFileSync(MD_FILE, renderMarkdown(entries), 'utf8');
}

/**
 * Add one entry. Returns true when something was written. Existing entries are
 * never rewritten or reordered — hand-written prose is safe.
 */
export function writeChangelogEntry(report = null, opts = {}) {
    const { force = false, dryRun = false } = opts;
    const { entry, hasChanges } = buildEntry(report);

    if (!hasChanges && !force) {
        const state = readJson(STATE_FILE, {});
        const since = state.changelog?.lastEntry ? ` since ${state.changelog.lastEntry.slice(0, 10)}` : '';
        console.log(`\nChangelog: nothing new to record${since}. (Pass --force to write an entry anyway.)`);
        return false;
    }

    if (dryRun) {
        console.log(`\n${renderEntry(entry)}`);
        console.log('Dry run — no files were written.');
        return false;
    }

    const entries = readJson(DATA_FILE, []);
    entries.unshift(entry);
    writeFiles(entries);

    const state = readJson(STATE_FILE, { portals: {} });
    state.changelog = { lastLocalSha: git(['rev-parse', 'HEAD']), lastEntry: entry.generatedAt };
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

    const moved = entry.portals.filter((portal) => !portal.unchanged).length;
    console.log(`\nChangelog: added an entry for ${humanDate(entry.date)} — ${moved} app(s) updated, ${entry.local.length} local commit(s).`);
    console.log('  Next: fill the four plain-English fields on the newest entry in');
    console.log('  apps/changelog-portal/src/data/changelog.json, then run `pnpm changelog:check`.');
    return true;
}

// ------------------------------------------------------------------- checking

/** Fails while an entry is half-written, or while CHANGELOG.md has drifted. */
export function check() {
    const entries = readJson(DATA_FILE, null);
    if (entries === null) {
        console.error(`! ${path.relative(ROOT, DATA_FILE).replace(/\\/g, '/')} is missing or unreadable. Run \`pnpm changelog\` first.`);
        return false;
    }

    let ok = true;
    for (const entry of entries) {
        const unfilled = ['headline', 'actionNeeded', 'stillOpen'].filter((field) =>
            String(entry[field] ?? '').includes(TODO),
        );
        if (entry.meaning?.some((line) => String(line).includes(TODO))) unfilled.push('meaning');
        if (unfilled.length) {
            ok = false;
            console.error(`! ${entry.date}: still unwritten — ${unfilled.join(', ')}`);
        }
    }
    if (!ok) {
        console.error('\n  Every entry needs a plain-English summary a non-developer can read.');
        console.error(`  Edit ${path.relative(ROOT, DATA_FILE).replace(/\\/g, '/')}, then run \`pnpm changelog:check\` again.`);
    }

    const expected = renderMarkdown(entries);
    const actual = fs.existsSync(MD_FILE) ? fs.readFileSync(MD_FILE, 'utf8') : '';
    if (expected !== actual) {
        ok = false;
        console.error('! CHANGELOG.md does not match the data it is generated from.');
        console.error('  It is generated — edit the JSON instead, then run `pnpm changelog --render`.');
    }

    if (ok) console.log(`Changelog OK — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, all written in plain English.`);
    return ok;
}

/** Rebuild CHANGELOG.md from the JSON without adding an entry. */
export function rerender() {
    const entries = readJson(DATA_FILE, []);
    writeFiles(entries);
    console.log(`Rebuilt CHANGELOG.md from ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
}

// ------------------------------------------------------------------ cli entry

const invokedDirectly =
    process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
    const argv = process.argv.slice(2);
    if (argv.includes('--check')) {
        process.exit(check() ? 0 : 1);
    } else if (argv.includes('--render') || argv.includes('--history')) {
        rerender();
    } else {
        writeChangelogEntry(null, {
            force: argv.includes('--force'),
            dryRun: argv.includes('--dry-run'),
        });
    }
}
