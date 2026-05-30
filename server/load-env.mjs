// Dependency-free local env loading for the proxy. Kept side-effect-free
// (parseEnv) so it can be unit-tested without booting the HTTP server.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Parse dotenv-style contents into a plain object. Pure. */
export function parseEnv(contents) {
  const out = {};
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load `.env.local` then `.env` from the repo root into process.env. A non-empty
 * shell value always wins; a blank/unset var falls through to the file. Missing
 * files are ignored — never throws.
 */
export function loadLocalEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  for (const file of [".env.local", ".env"]) {
    let contents;
    try {
      contents = readFileSync(resolve(root, file), "utf8");
    } catch {
      continue; // file not present — fine
    }
    for (const [key, value] of Object.entries(parseEnv(contents))) {
      if (process.env[key]) continue; // a non-empty shell value wins
      process.env[key] = value;
    }
  }
}
