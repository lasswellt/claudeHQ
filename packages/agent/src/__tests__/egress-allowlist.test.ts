import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseAllowlist,
  isHostAllowed,
  type AllowlistEntry,
} from '../egress-allowlist.js';

// CAP-082 / story 018-008: end-to-end egress allowlist test.
//
// Loads the real tinyproxy filter file shipped in deploy/ and
// asserts the expected allow/deny behavior against it. This
// catches regex typos without spinning up a docker network.

const here = dirname(fileURLToPath(import.meta.url));
const FILTER_PATH = resolve(here, '../../../../deploy/docker/network/filter');

describe('parseAllowlist', () => {
  it('ignores blank lines and comments', () => {
    const entries = parseAllowlist(`
      # comment line
      ^api\\.example\\.com$

      # another comment
      ^other\\.example\\.com$
    `);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.pattern).toBe('^api\\.example\\.com$');
  });

  it('compiles each line as a case-insensitive regex', () => {
    const entries = parseAllowlist('^API\\.EXAMPLE\\.COM$');
    expect(entries[0]?.regex.test('api.example.com')).toBe(true);
    expect(entries[0]?.regex.test('API.EXAMPLE.COM')).toBe(true);
  });

  it('throws on invalid regex', () => {
    expect(() => parseAllowlist('^(unclosed')).toThrow(/Invalid allowlist regex/);
  });
});

describe('isHostAllowed', () => {
  const entries: AllowlistEntry[] = parseAllowlist(`
    ^api\\.anthropic\\.com$
    ^.*\\.pkg\\.github\\.com$
  `);

  it('allows exact-match entries', () => {
    expect(isHostAllowed('api.anthropic.com', entries).allowed).toBe(true);
  });

  it('allows wildcard subdomain matches', () => {
    expect(isHostAllowed('ghcr.pkg.github.com', entries).allowed).toBe(true);
  });

  it('denies anything not in the allowlist', () => {
    expect(isHostAllowed('example.com', entries).allowed).toBe(false);
    expect(isHostAllowed('evil.example.com', entries).allowed).toBe(false);
  });

  it('strips port suffix before matching', () => {
    expect(isHostAllowed('api.anthropic.com:443', entries).allowed).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isHostAllowed('API.ANTHROPIC.COM', entries).allowed).toBe(true);
  });

  it('returns the matched pattern for auditing', () => {
    const result = isHostAllowed('api.anthropic.com', entries);
    expect(result.matchedPattern).toBe('^api\\.anthropic\\.com$');
  });
});

describe('deploy/docker/network/filter (real allowlist)', () => {
  const entries = parseAllowlist(readFileSync(FILTER_PATH, 'utf-8'));

  it.each([
    'api.anthropic.com',
    'registry.npmjs.org',
    'npm.pkg.github.com',
    'api.github.com',
    'codeload.github.com',
    'github.com',
    'raw.githubusercontent.com',
  ])('allows %s', (host) => {
    expect(isHostAllowed(host, entries).allowed).toBe(true);
  });

  it.each([
    'example.com',
    'evil.example.com',
    'packages.debian.org',
    'pypi.org',
    'anthropic.com', // note: only api.anthropic.com is allowed
    'fake-npmjs.org',
    'github.io', // github pages — not in allowlist
  ])('denies %s', (host) => {
    expect(isHostAllowed(host, entries).allowed).toBe(false);
  });

  it('denies IP literals', () => {
    expect(isHostAllowed('192.168.1.1', entries).allowed).toBe(false);
    expect(isHostAllowed('10.0.0.1', entries).allowed).toBe(false);
  });
});
