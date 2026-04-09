import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSecret,
  loadSecrets,
  MissingSecretError,
} from '../secrets-loader.js';

// CAP-099 / story 019-003: secrets loader.

let secretsDir: string;
let overrideDir: string;

beforeEach(() => {
  secretsDir = mkdtempSync(join(tmpdir(), 'chq-secrets-'));
  overrideDir = mkdtempSync(join(tmpdir(), 'chq-secrets-override-'));
});

afterEach(() => {
  rmSync(secretsDir, { recursive: true, force: true });
  rmSync(overrideDir, { recursive: true, force: true });
});

describe('loadSecret — file mount', () => {
  it('reads from /run/secrets/<name>', () => {
    writeFileSync(join(secretsDir, 'my_secret'), 'hunter2');
    expect(loadSecret('my_secret', { secretsDir, env: {} })).toBe('hunter2');
  });

  it('trims trailing newlines', () => {
    writeFileSync(join(secretsDir, 'my_secret'), 'hunter2\n');
    expect(loadSecret('my_secret', { secretsDir, env: {} })).toBe('hunter2');
  });

  it('trims leading + trailing whitespace', () => {
    writeFileSync(join(secretsDir, 'my_secret'), '  hunter2  \n');
    expect(loadSecret('my_secret', { secretsDir, env: {} })).toBe('hunter2');
  });
});

describe('loadSecret — <NAME>_FILE override', () => {
  it('reads from a path in <NAME>_FILE env var', () => {
    const path = join(overrideDir, 'custom.pem');
    writeFileSync(path, 'pem-contents');
    const result = loadSecret('github_app_key', {
      secretsDir, // empty — no mount
      env: { GITHUB_APP_KEY_FILE: path },
    });
    expect(result).toBe('pem-contents');
  });

  it('prefers the mount over the <NAME>_FILE override', () => {
    writeFileSync(join(secretsDir, 'my_secret'), 'mounted');
    writeFileSync(join(overrideDir, 'override'), 'override');
    const result = loadSecret('my_secret', {
      secretsDir,
      env: { MY_SECRET_FILE: join(overrideDir, 'override') },
    });
    expect(result).toBe('mounted');
  });

  it('ignores <NAME>_FILE paths that do not exist', () => {
    const result = loadSecret('my_secret', {
      secretsDir, // empty
      env: { MY_SECRET_FILE: '/nonexistent/path' },
    });
    expect(result).toBeNull();
  });
});

describe('loadSecret — env var fallback', () => {
  it('falls back to <NAME> env var', () => {
    expect(
      loadSecret('my_secret', {
        secretsDir, // empty
        env: { MY_SECRET: 'from-env' },
      }),
    ).toBe('from-env');
  });

  it('trims env var values', () => {
    expect(
      loadSecret('my_secret', {
        secretsDir,
        env: { MY_SECRET: '  hunter2  ' },
      }),
    ).toBe('hunter2');
  });

  it('treats empty env var as absent', () => {
    expect(
      loadSecret('my_secret', {
        secretsDir,
        env: { MY_SECRET: '' },
      }),
    ).toBeNull();
  });

  it('file-based source wins over env var', () => {
    writeFileSync(join(secretsDir, 'my_secret'), 'mounted');
    expect(
      loadSecret('my_secret', {
        secretsDir,
        env: { MY_SECRET: 'env-value' },
      }),
    ).toBe('mounted');
  });
});

describe('loadSecret — required', () => {
  it('returns null by default when no source is found', () => {
    expect(loadSecret('missing', { secretsDir, env: {} })).toBeNull();
  });

  it('throws MissingSecretError when required=true', () => {
    expect(() =>
      loadSecret('required_secret', { secretsDir, env: {}, required: true }),
    ).toThrow(MissingSecretError);
  });

  it('error message lists all three fallback sources', () => {
    try {
      loadSecret('api_key', { secretsDir, env: {}, required: true });
    } catch (err) {
      expect((err as Error).message).toContain('/run/secrets/api_key');
      expect((err as Error).message).toContain('API_KEY_FILE');
      expect((err as Error).message).toContain('API_KEY');
    }
  });
});

describe('loadSecrets — bulk', () => {
  it('resolves a map of secrets at once', () => {
    writeFileSync(join(secretsDir, 'a'), 'alpha');
    writeFileSync(join(secretsDir, 'b'), 'beta');
    const result = loadSecrets({ a: false, b: false }, { secretsDir, env: {} });
    expect(result.a).toBe('alpha');
    expect(result.b).toBe('beta');
  });

  it('throws as soon as any required secret is missing', () => {
    writeFileSync(join(secretsDir, 'present'), 'yes');
    expect(() =>
      loadSecrets({ present: true, missing: true }, { secretsDir, env: {} }),
    ).toThrow(MissingSecretError);
  });

  it('returns null for optional missing secrets', () => {
    writeFileSync(join(secretsDir, 'present'), 'yes');
    const result = loadSecrets(
      { present: false, missing: false },
      { secretsDir, env: {} },
    );
    expect(result.present).toBe('yes');
    expect(result.missing).toBeNull();
  });
});
