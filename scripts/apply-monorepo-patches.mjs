#!/usr/bin/env node
/**
 * The only edits this monorepo makes to vendored upstream source.
 *
 * Upstream each portal is a standalone repo that reaches its siblings through
 * `"refi-portal": "file:../refi-portal"` — a path that only resolves in the
 * original polyrepo checkout. Inside a pnpm workspace that same dependency has
 * to be `"workspace:*"`, which resolves by *package name*, so the folder may be
 * named differently (apps/refinance-prototype publishes the name `refi-portal`).
 *
 * It also pins each app to its slot in the Blinker platform port map (30001-30005)
 * so the five dev servers coexist. Upstream each repo picks its own 517x port and
 * two of them would otherwise collide once they run side by side.
 *
 * Nothing else is touched: no source files, no build scripts, no removed
 * dependencies. Idempotent — safe to run after every sync.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** Blinker platform port map, keyed by folder name under apps/. */
const PORTS = {
    'protection-portal': 30001,
    'insurance-portal': 30002,
    'mission-control': 30003,
    'customer-portal': 30004,
    'refinance-prototype': 30005,
};

/** Scripts that take a `--port` flag. `build` and `lint` are left alone. */
const PORTED_SCRIPTS = ['dev', 'preview'];

/** Every package.json inside the workspace globs, keyed by package name. */
function collectWorkspacePackages() {
    const dirs = [
        ...listDirs(path.join(ROOT, 'apps')),
        ...listDirs(path.join(ROOT, 'packages')),
        ...listDirs(path.join(ROOT, 'packages', 'blinker-platform', 'packages')),
    ];
    const packages = new Map();
    for (const dir of dirs) {
        const file = path.join(dir, 'package.json');
        if (!fs.existsSync(file)) continue;
        try {
            const json = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (json.name) packages.set(json.name, { dir, file, json });
        } catch {
            console.warn(`  ! unreadable package.json: ${path.relative(ROOT, file)}`);
        }
    }
    return packages;
}

function listDirs(parent) {
    if (!fs.existsSync(parent)) return [];
    return fs
        .readdirSync(parent, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== 'node_modules')
        .map((e) => path.join(parent, e.name));
}

/**
 * Force `--port <n>` on a vite dev/preview script, whatever upstream chose.
 * Returns the rewritten command, or null when it already matches.
 */
function withPort(command, port) {
    if (typeof command !== 'string' || !/\bvite\b/.test(command)) return null;
    const next = /--port(?:[= ])\d+/.test(command)
        ? command.replace(/--port(?:[= ])\d+/, `--port ${port}`)
        : `${command} --port ${port}`;
    return next === command ? null : next;
}

/**
 * Rewrite `port: <n>` inside a vite config. Matches only the lowercase `port:`
 * key, so `strictPort:` and proxy target URLs are left alone.
 */
function patchViteConfigPort(dir, port) {
    const file = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']
        .map((name) => path.join(dir, name))
        .find((candidate) => fs.existsSync(candidate));
    if (!file) return false;

    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace(/(^|[^A-Za-z])port:(\s*)\d+/g, `$1port:$2${port}`);
    if (after === before) return false;

    fs.writeFileSync(file, after, 'utf8');
    console.log(`  patched ${path.relative(ROOT, file).replace(/\\/g, '/')} (port ${port})`);
    return true;
}

function main() {
    const packages = collectWorkspacePackages();
    const names = new Set(packages.keys());
    let touched = 0;
    const warnings = [];

    for (const [name, pkg] of packages) {
        let modified = false;

        const port = PORTS[path.basename(pkg.dir)];
        if (port && pkg.json.scripts) {
            for (const script of PORTED_SCRIPTS) {
                const next = withPort(pkg.json.scripts[script], port);
                if (next) {
                    pkg.json.scripts[script] = next;
                    modified = true;
                }
            }
        }

        for (const field of DEP_FIELDS) {
            const deps = pkg.json[field];
            if (!deps) continue;
            for (const [dep, range] of Object.entries(deps)) {
                if (typeof range !== 'string' || !range.startsWith('file:')) continue;
                if (!names.has(dep)) {
                    warnings.push(`${name}: "${dep}": "${range}" — no workspace package publishes that name; left as-is`);
                    continue;
                }
                deps[dep] = 'workspace:*';
                modified = true;
            }
        }

        if (modified) {
            fs.writeFileSync(pkg.file, `${JSON.stringify(pkg.json, null, 2)}\n`, 'utf8');
            console.log(`  patched ${path.relative(ROOT, pkg.file).replace(/\\/g, '/')}`);
            touched += 1;
        }
        if (port && patchViteConfigPort(pkg.dir, port)) touched += 1;
    }

    if (touched === 0) console.log('  workspace rewrites and port map already applied — nothing to do');
    for (const warning of warnings) console.warn(`  ! ${warning}`);
}

console.log('\nApplying monorepo patches (file:../x -> workspace:*)');
main();
