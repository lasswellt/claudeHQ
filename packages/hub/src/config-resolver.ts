import { readFileSync, existsSync } from 'node:fs';

/**
 * CAP-099 / story 019-003: Docker secrets loader.
 *
 * Reads a secret by name, trying three sources in order:
 *   1. `/run/secrets/<name>` — Docker secrets file mount
 *   2. `process.env[<NAME>_FILE]` — path override (matches the
 *      `_FILE` convention used by Postgres, MariaDB, etc.)
 *   3. `process.env[<NAME>]` — plain env var fallback
 *
 * Strings are trimmed of surrounding whitespace because Docker
 * secrets often end with a trailing newline from `echo > secret`.
 *
 * Pure read-only function — no caching — so the hub can call it
 * once at startup and not worry about stale values. If you need
 * repeated reads, cache at the caller.
 */

export interface LoadSecretOptions {
  /**
   * When true, `loadSecret` throws if no source is found. When
   * false (default), returns `null`.
   */
  required?: boolean;
  /**
   * Override the secrets directory — useful for tests. Defaults
   * to `/run/secrets` which is what Docker mounts.
   */
  secretsDir?: string;
  /**
   * Override the environment object. Defaults to `process.env`.
   */
  env?: NodeJS.ProcessEnv;
}

export class MissingSecretError extends Error {
  constructor(public readonly name: string) {
    super(
      `Missing required secret "${name}". Provide via file mount at /run/secrets/${name}, ${name.toUpperCase()}_FILE env var, or ${name.toUpperCase()} env var.`,
    );
    this.name = 'MissingSecretError';
  }
}

export function loadSecret(
  name: string,
  opts: LoadSecretOptions = {},
): string | null {
  const secretsDir = opts.secretsDir ?? '/run/secrets';
  const env = opts.env ?? process.env;
  const envKey = name.toUpperCase();
  const envKeyFile = `${envKey}_FILE`;

  // 1. Docker secret mount (preferred).
  const mountedPath = `${secretsDir}/${name}`;
  if (existsSync(mountedPath)) {
    try {
      return readFileSync(mountedPath, 'utf-8').trim();
    } catch {
      // Fall through to the next source
    }
  }

  // 2. <NAME>_FILE env override pointing at an arbitrary path.
  const filePathOverride = env[envKeyFile];
  if (filePathOverride && existsSync(filePathOverride)) {
    try {
      return readFileSync(filePathOverride, 'utf-8').trim();
    } catch {
      // Fall through
    }
  }

  // 3. Plain env var.
  const envValue = env[envKey];
  if (envValue !== undefined && envValue.length > 0) {
    return envValue.trim();
  }

  if (opts.required) throw new MissingSecretError(name);
  return null;
}

/**
 * Bulk loader — resolves multiple secrets in one call. Useful
 * for the hub's startup sequence.
 */
export function loadSecrets<T extends Record<string, boolean>>(
  spec: T,
  opts: Omit<LoadSecretOptions, 'required'> = {},
): { [K in keyof T]: T[K] extends true ? string : string | null } {
  const out: Record<string, string | null> = {};
  for (const [name, required] of Object.entries(spec)) {
    out[name] = loadSecret(name, { ...opts, required });
  }
  return out as { [K in keyof T]: T[K] extends true ? string : string | null };
}
