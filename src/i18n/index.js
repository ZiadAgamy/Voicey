import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, 'locales');

const packs = new Map(); // localeCode -> flat key->string map
const meta = new Map(); // localeCode -> { name, flag }

function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, fullKey, out);
    } else {
      out[fullKey] = value;
    }
  }
  return out;
}

export function loadLocales() {
  const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const code = path.basename(file, '.json');
    const raw = JSON.parse(readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
    packs.set(code, flatten(raw));
    meta.set(code, { name: raw._meta?.name ?? code, flag: raw._meta?.flag ?? '🏳️' });
  }
  return { packs, meta };
}

export const DEFAULT_LOCALE = 'en';

export function availableLocales() {
  return [...meta.entries()].map(([code, m]) => ({ code, ...m }));
}

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

/**
 * t(locale, key, vars?) — looks up `key` in the given locale's flattened
 * pack, falling back to DEFAULT_LOCALE, then to the raw key itself so a
 * missing string never crashes a command — it just shows the key untranslated,
 * which is easy to spot and fix.
 */
export function t(locale, key, vars) {
  const pack = packs.get(locale) ?? packs.get(DEFAULT_LOCALE);
  let str = pack?.[key];
  if (str === undefined) str = packs.get(DEFAULT_LOCALE)?.[key];
  if (str === undefined) return key;
  return interpolate(str, vars);
}

export function hasLocale(code) {
  return packs.has(code);
}
