#!/usr/bin/env node
/**
 * Sync the vendored portal sources from their upstream BlinkerGit repositories.
 *
 * This script only ever *reads* from upstream. It fetches, compares, and copies
 * files into the working tree. It never commits, never pushes, and never touches
 * the upstream remotes with anything but `git fetch`.
 *
 *   pnpm sync              fetch + report + update the working tree
 *   pnpm sync:check        fetch + report only, no files touched
 *   pnpm sync -- --force   overwrite a portal folder even if it has local edits
 *   pnpm sync -- customer insurance     limit to specific portals (by remote name)
 *
 * After it runs, review with `git status` / `git diff`, then commit and push to
 * `origin` yourself.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'sync.config.json'), 'utf8'));
const STATE_FILE = path.join(ROOT, 'sync-state.json');
const TMP_DIR = path.join(ROOT, '.sync-tmp');

const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes('--check');
const FORCE = argv.includes('--force');
const only = argv.filter((a) => !a.startsWith('--'));

const c = {
    reset: '[0m',
    dim: '[2m',
    bold: '[1m',
    green: '[32m',
    yellow: '[33m',
    red: '[31m',
    cyan: '[36m',
};

function git(args, opts = {}) {
    return execFileSync('git', args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...opts,
    }).trim();
}

function readState() {
    if (!fs.existsSync(STATE_FILE)) return { portals: {} };
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return { portals: {} };
    }
}

function writeState(state) {
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** True when the portal folder has uncommitted changes of its own. */
function isDirty(dir) {
    const out = git(['status', '--porcelain', '--', dir]);
    return out.length > 0;
}

/**
 * Mirror `src` onto `dest`: copy every upstream file, delete files upstream
 * removed, and leave protected entries (vercel.json, node_modules, .env, ...)
 * alone. Returns counts for the report.
 */
function mirror(src, dest, relBase = '') {
    const stats = { added: 0, updated: 0, removed: 0 };
    fs.mkdirSync(dest, { recursive: true });

    const srcEntries = fs.existsSync(src) ? fs.readdirSync(src, { withFileTypes: true }) : [];
    const srcNames = new Set(srcEntries.map((e) => e.name));

    // Prune anything upstream no longer has.
    for (const entry of fs.readdirSync(dest, { withFileTypes: true })) {
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (CONFIG.keepAnyDepth.includes(entry.name)) continue;
        if (CONFIG.keep.includes(rel)) continue;
        if (srcNames.has(entry.name)) continue;
        fs.rmSync(path.join(dest, entry.name), { recursive: true, force: true });
        stats.removed += 1;
    }

    for (const entry of srcEntries) {
        if (entry.name === '.git') continue;
        if (CONFIG.keepAnyDepth.includes(entry.name)) continue;
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (CONFIG.keep.includes(rel)) continue;

        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            const sub = mirror(from, to, rel);
            stats.added += sub.added;
            stats.updated += sub.updated;
            stats.removed += sub.removed;
            continue;
        }
        if (!entry.isFile()) continue;

        const next = fs.readFileSync(from);
        if (!fs.existsSync(to)) {
            fs.writeFileSync(to, next);
            stats.added += 1;
        } else if (!fs.readFileSync(to).equals(next)) {
            fs.writeFileSync(to, next);
            stats.updated += 1;
        }
    }
    return stats;
}

function main() {
    const state = readState();
    const portals = CONFIG.portals.filter((p) => only.length === 0 || only.includes(p.remote));

    if (only.length > 0 && portals.length === 0) {
        console.error(`${c.red}No portal matches: ${only.join(', ')}${c.reset}`);
        process.exit(1);
    }

    console.log(`${c.bold}Syncing ${portals.length} upstream source(s)${c.reset}${CHECK_ONLY ? `${c.dim} (check only — no files will change)${c.reset}` : ''}\n`);

    const report = [];
    let changed = false;

    for (const portal of portals) {
        const { remote, branch, dir } = portal;
        process.stdout.write(`${c.cyan}${remote}${c.reset} ${c.dim}(${dir})${c.reset} … `);

        try {
            git(['fetch', remote, branch, '--quiet']);
        } catch (err) {
            console.log(`${c.red}fetch failed${c.reset}`);
            report.push({ remote, dir, status: 'fetch failed', detail: String(err.message).split('\n')[0] });
            continue;
        }

        const newSha = git(['rev-parse', `refs/remotes/${remote}/${branch}`]);
        const oldSha = state.portals?.[remote]?.sha ?? null;
        const short = (s) => (s ? s.slice(0, 8) : '—');

        if (oldSha === newSha && fs.existsSync(path.join(ROOT, dir)) && !FORCE) {
            console.log(`${c.dim}up to date (${short(newSha)})${c.reset}`);
            report.push({ remote, dir, status: 'up to date', detail: short(newSha) });
            continue;
        }

        const commits = oldSha
            ? git(['log', '--oneline', '--no-decorate', `${oldSha}..${newSha}`]).split('\n').filter(Boolean)
            : [];

        if (CHECK_ONLY) {
            console.log(`${c.yellow}${commits.length || '?'} new commit(s)${c.reset} ${c.dim}${short(oldSha)} -> ${short(newSha)}${c.reset}`);
            commits.slice(0, 10).forEach((line) => console.log(`      ${c.dim}${line}${c.reset}`));
            if (commits.length > 10) console.log(`      ${c.dim}… ${commits.length - 10} more${c.reset}`);
            report.push({ remote, dir, status: 'behind', detail: `${commits.length} commit(s)` });
            changed = true;
            continue;
        }

        const target = path.join(ROOT, dir);
        if (fs.existsSync(target) && isDirty(dir) && !FORCE) {
            console.log(`${c.yellow}skipped — local uncommitted changes${c.reset}`);
            console.log(`      ${c.dim}commit or stash ${dir}, or re-run with --force to overwrite${c.reset}`);
            report.push({ remote, dir, status: 'skipped (dirty)', detail: 'local edits present' });
            continue;
        }

        const wt = path.join(TMP_DIR, remote);
        fs.rmSync(wt, { recursive: true, force: true });
        try {
            git(['worktree', 'add', '--detach', '--quiet', wt, newSha]);
            const stats = mirror(wt, target);
            console.log(
                `${c.green}updated${c.reset} ${c.dim}${short(oldSha)} -> ${short(newSha)} · +${stats.added} ~${stats.updated} -${stats.removed}${c.reset}`,
            );
            commits.slice(0, 10).forEach((line) => console.log(`      ${c.dim}${line}${c.reset}`));
            if (commits.length > 10) console.log(`      ${c.dim}… ${commits.length - 10} more${c.reset}`);
            report.push({
                remote,
                dir,
                status: 'updated',
                detail: `+${stats.added} ~${stats.updated} -${stats.removed}`,
            });
            state.portals = state.portals ?? {};
            state.portals[remote] = { repo: portal.repo, branch, dir, sha: newSha };
            changed = true;
        } finally {
            try {
                git(['worktree', 'remove', '--force', wt]);
            } catch {
                fs.rmSync(wt, { recursive: true, force: true });
            }
        }
    }

    if (!CHECK_ONLY) {
        writeState(state);
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }

    console.log(`\n${c.bold}Summary${c.reset}`);
    for (const row of report) {
        console.log(`  ${row.remote.padEnd(12)} ${row.status.padEnd(16)} ${c.dim}${row.detail}${c.reset}`);
    }

    console.log(`\n${c.dim}Nothing was pushed to any BlinkerGit repository — fetch only.${c.reset}`);

    if (CHECK_ONLY) {
        console.log(`${c.dim}Check-only run: no files were modified. Run \`pnpm sync\` to apply.${c.reset}`);
        return;
    }

    if (changed) {
        console.log(`\nNext:`);
        console.log(`  ${c.bold}pnpm run sync:patch${c.reset}   ${c.dim}re-apply monorepo dependency rewrites (also run automatically below)${c.reset}`);
        console.log(`  ${c.bold}pnpm install${c.reset}          ${c.dim}refresh pnpm-lock.yaml if any package.json changed${c.reset}`);
        console.log(`  ${c.bold}git status && git diff${c.reset}`);
        console.log(`  ${c.bold}git add . && git commit -m "sync: update portals"${c.reset}`);
        console.log(`  ${c.bold}git push origin main${c.reset}`);
    }
}

main();

// Upstream package.json files declare `file:../x` deps that only resolve in the
// original polyrepo layout. Re-apply the workspace rewrites after every sync.
await import('./apply-monorepo-patches.mjs');
