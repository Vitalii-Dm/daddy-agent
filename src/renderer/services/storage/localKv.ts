/**
 * Typed wrapper around `window.localStorage` for renderer code.
 *
 * Use this instead of calling `localStorage` directly from components, hooks,
 * or adapters. It handles JSON serialization, key namespacing, and the
 * try/catch that every raw `localStorage` call needs (SSR, quota, privacy
 * mode, Electron sandbox edge cases).
 *
 * Keys are namespaced as `daddy:<feature>:<suffix>` so slices cannot collide.
 *
 * Per the architecture standard (docs/FEATURE_ARCHITECTURE_STANDARD.md),
 * components/hooks/adapters should not reach into `localStorage` directly.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const NAMESPACE_PREFIX = 'daddy';

/** Build a namespaced storage key: `daddy:<feature>:<suffix>`. */
export function namespacedKey(feature: string, suffix: string): string {
  return `${NAMESPACE_PREFIX}:${feature}:${suffix}`;
}

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** Read a raw string value. Returns null if missing, unavailable, or on error. */
export function getString(key: string): string | null {
  if (!hasWindow()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a raw string value. Silently ignores quota/unavailable errors. */
export function setString(key: string, value: string): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable or quota exceeded */
  }
}

/** Remove a key. Silently ignores errors. */
export function remove(key: string): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Read a JSON-encoded value and validate it with a type guard.
 * Returns `fallback` if missing, malformed, or guard fails.
 */
export function getJson<T extends Json>(
  key: string,
  isValid: (v: unknown) => v is T,
  fallback: T
): T {
  const raw = getString(key);
  if (raw == null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Write a JSON-encoded value. Silently ignores errors. */
export function setJson(key: string, value: Json): void {
  try {
    setString(key, JSON.stringify(value));
  } catch {
    /* serialization failure */
  }
}
