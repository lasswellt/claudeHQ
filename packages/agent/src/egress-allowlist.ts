/**
 * CAP-082 / story 018-008: pure egress allowlist evaluator.
 *
 * Mirrors the logic tinyproxy applies against `filter` regex
 * entries. Exposed as a pure function so the E2E test can assert
 * "api.anthropic.com is allowed, example.com is blocked" without
 * spinning up the full Docker network stack in CI.
 *
 * The production check happens inside tinyproxy (see
 * `deploy/docker/network/filter`). This module reads that same
 * file format so the regexes are tested exactly as they would be
 * enforced at runtime.
 */

export interface AllowlistEntry {
  /** Original regex source, preserved for logging. */
  pattern: string;
  /** Compiled RegExp (case-insensitive, per tinyproxy config). */
  regex: RegExp;
}

export interface AllowlistCheckResult {
  allowed: boolean;
  matchedPattern?: string;
}

/**
 * Parses the tinyproxy filter file format into regex entries:
 *   - Blank lines and lines starting with `#` are comments and
 *     are ignored.
 *   - Every other line is treated as a POSIX extended regex.
 *
 * Invalid regexes throw — the intent is to fail loudly at load
 * time rather than silently allow traffic because a broken
 * pattern matched nothing.
 */
export function parseAllowlist(fileContent: string): AllowlistEntry[] {
  const entries: AllowlistEntry[] = [];
  const lines = fileContent.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;

    let regex: RegExp;
    try {
      regex = new RegExp(line, 'i'); // case-insensitive to match FilterCaseSensitive No
    } catch (e) {
      throw new Error(
        `Invalid allowlist regex "${line}": ${(e as Error).message}`,
      );
    }
    entries.push({ pattern: line, regex });
  }

  return entries;
}

/**
 * Checks a hostname against the allowlist. Returns the matched
 * pattern so a denial log can explain which rule (if any) let
 * traffic through.
 */
export function isHostAllowed(
  host: string,
  entries: readonly AllowlistEntry[],
): AllowlistCheckResult {
  // Strip port if present (tinyproxy sees the hostname portion).
  const bareHost = host.replace(/:\d+$/, '').toLowerCase();
  for (const entry of entries) {
    if (entry.regex.test(bareHost)) {
      return { allowed: true, matchedPattern: entry.pattern };
    }
  }
  return { allowed: false };
}
