import { describe, it, expect } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  generateMasterPassphrase,
} from '../cred-envelope.js';

// CAP-060 / story 017-005: credential encryption at rest.

describe('encryptSecret / decryptSecret', () => {
  const passphrase = 'test-master-passphrase-xxxx';

  it('round-trips a plaintext string', () => {
    const blob = encryptSecret('hello world', passphrase);
    expect(blob.ciphertext).toBeTypeOf('string');
    expect(decryptSecret(blob, passphrase)).toBe('hello world');
  });

  it('round-trips a PEM-shaped multiline payload', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\n' +
      'MIIEowIBAAKCAQEA...\n' +
      '-----END RSA PRIVATE KEY-----\n';
    const blob = encryptSecret(pem, passphrase);
    expect(decryptSecret(blob, passphrase)).toBe(pem);
  });

  it('accepts the raw base64 string as well as the wrapper object', () => {
    const blob = encryptSecret('secret', passphrase);
    expect(decryptSecret(blob.ciphertext, passphrase)).toBe('secret');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = encryptSecret('same', passphrase).ciphertext;
    const b = encryptSecret('same', passphrase).ciphertext;
    expect(a).not.toBe(b);
  });

  it('rejects the wrong passphrase', () => {
    const blob = encryptSecret('secret', passphrase);
    expect(() => decryptSecret(blob, 'wrong-passphrase')).toThrow(
      /Decryption failed/,
    );
  });

  it('detects tampering via GCM auth tag', () => {
    const blob = encryptSecret('secret', passphrase);
    const bytes = Buffer.from(blob.ciphertext, 'base64');
    // Flip the final ciphertext byte.
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0x01;
    const tampered = bytes.toString('base64');
    expect(() => decryptSecret(tampered, passphrase)).toThrow(
      /Decryption failed/,
    );
  });

  it('rejects an envelope that is too short', () => {
    expect(() => decryptSecret('dGVzdA==', passphrase)).toThrow(/too short/);
  });

  it('rejects an envelope with a bad magic prefix', () => {
    // Build a minimal-length blob but with bad magic.
    const bad = Buffer.alloc(50);
    bad.write('XXXX', 0); // wrong magic
    expect(() => decryptSecret(bad.toString('base64'), passphrase)).toThrow(
      /magic mismatch/,
    );
  });

  it('rejects an envelope with an unknown version byte', () => {
    const blob = encryptSecret('secret', passphrase);
    const bytes = Buffer.from(blob.ciphertext, 'base64');
    bytes[4] = 99; // version byte
    expect(() => decryptSecret(bytes.toString('base64'), passphrase)).toThrow(
      /Unsupported ciphertext version: 99/,
    );
  });
});

describe('generateMasterPassphrase', () => {
  it('returns a base64 string with adequate entropy', () => {
    const p = generateMasterPassphrase();
    expect(p).toBeTypeOf('string');
    expect(p.length).toBeGreaterThanOrEqual(40);
  });

  it('is different each call', () => {
    expect(generateMasterPassphrase()).not.toBe(generateMasterPassphrase());
  });
});
