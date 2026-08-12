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
 * Nothing else is touched: no ports, no scripts, no source files, no removed
 * dependencies. Idempotent — safe to run after every sync.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

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

function main() {
    const packages = collectWorkspacePackages();
    const names = new Set(packages.keys());
    let touched = 0;
    const warnings = [];

    for (const [name, pkg] of packages) {
        let modified = false;

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
    }

    if (touched === 0) console.log('  workspace dependency rewrites already applied — nothing to do');
    for (const warning of warnings) console.warn(`  ! ${warning}`);
}

console.log('\nApplying monorepo patches (file:../x -> workspace:*)');
main();
