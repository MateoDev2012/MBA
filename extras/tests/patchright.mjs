/**
 * Hands both browser suites (smoke-widget, audit) the `patchright` module.
 *
 * Nothing in package.json installs a browser driver on purpose: the suites
 * borrow the copy the DSCodeGPT VSCode extension ships with. The catch is
 * that the extension lives in a versioned directory (…dscodegpt-3.24.74/…)
 * and updates itself - it went to 3.24.76 and the hardcoded anchor went with
 * it, failing every browser test with "Cannot find module 'patchright'".
 *
 * So the anchor is found, not memorised: PATCHRIGHT_PATH wins if set, a local
 * node_modules/patchright wins next, and otherwise every installed extension
 * version is tried newest-first. The error when none exists says what to do,
 * because "Cannot find module" from a borrowed path tells nobody anything.
 */
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

export function requirePatchright() {
  const anchors = [];
  if (process.env.PATCHRIGHT_PATH) anchors.push(process.env.PATCHRIGHT_PATH);
  // The project's own copy, if anyone ever adds one.
  anchors.push(fileURLToPath(new URL('../../node_modules/patchright/package.json', import.meta.url)));
  // The extension's copy, any version - newest first so a half-updated
  // directory never masks a working one.
  const root = path.join(os.homedir(), '.vscode', 'extensions');
  if (existsSync(root)) {
    const versions = readdirSync(root)
      .filter((d) => d.startsWith('danielsanmedium.dscodegpt-'))
      .sort()
      .reverse();
    for (const v of versions) {
      anchors.push(path.join(root, v, 'standalone', 'node_modules', 'patchright', 'package.json'));
    }
  }
  for (const anchor of anchors) {
    if (!existsSync(anchor)) continue;
    try {
      return createRequire(anchor)('patchright');
    } catch (_) {
      // Directory present but broken (mid-update, say): try the next anchor.
    }
  }
  throw new Error(
    'patchright not found. Set PATCHRIGHT_PATH to a file inside a node_modules ' +
      'that contains it, or install patchright into this project.'
  );
}
