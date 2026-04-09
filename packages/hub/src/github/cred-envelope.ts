import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * CAP-060 / story 017-005: GitHub credential encryption at rest.
 *
 * AES-256-GCM with a scrypt-derived key from a caller-supplied
 * master passphrase. The ciphertext format is deliberately
 * self-describing so the DB column is the only source of truth:
 *
 *   <magic:4><version:1><salt:16><iv:12><tag:16><ciphertext:*>
 *
 * Everything is concatenated and returned as base64.
 *
 * Why not @noble/ciphers? Node's built-in `crypto` has been the
 * correct choice for server-side AES-GCM for years; @noble is
 * better for browsers. The epic risk factor flagged "no legacy
 * ciphers" — AES-256-GCM satisfies that.
 */

const MAGIC = Buffer.from('CHQ1'); // 4 bytes
const VERSION = 1; // 1 byte
const SALT_LEN = 16;
const IV_LEN = 12; // 96-bit IV is GCM best practice
const TAG_LEN = 16;

const KEY_LEN = 32; // AES-256
const SCRYPT_COST = 2 ** 15; // 32768
const SCRYPT_BLOCK = 8;
const SCRYPT_PARALLEL = 1;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK,
    p: SCRYPT_PARALLEL,
    // Node's default maxmem (32MB) is right at the boundary of
    // 128 * N * r * p = 32MB for N=32768,r=8,p=1; raise the limit
    // so OpenSSL's off-by-one memory guard doesn't reject us.
    maxmem: 128 * 1024 * 1024,
  });
}

export interface EncryptedBlob {
  /** Base64 string safe to store in a SQLite TEXT column. */
  ciphertext: string;
}

/**
 * Encrypts a UTF-8 plaintext with the master passphrase. Returns
 * the self-describing base64 envelope.
 */
export function encryptSecret(plaintext: string, passphrase: string): EncryptedBlob {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const envelope = Buffer.concat([
    MAGIC,
    Buffer.from([VERSION]),
    salt,
    iv,
    tag,
    ciphertext,
  ]);
  return { ciphertext: envelope.toString('base64') };
}

/**
 * Decrypts a blob produced by `encryptSecret`. Throws on any
 * tampering (GCM tag failure), wrong passphrase, or malformed
 * envelope.
 */
export function decryptSecret(blob: EncryptedBlob | string, passphrase: string): string {
  const base64 = typeof blob === 'string' ? blob : blob.ciphertext;
  const envelope = Buffer.from(base64, 'base64');

  const minLen = MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN;
  if (envelope.length < minLen) {
    throw new Error('Ciphertext envelope is too short');
  }

  let offset = 0;
  const magic = envelope.subarray(offset, offset + MAGIC.length);
  offset += MAGIC.length;
  if (!magic.equals(MAGIC)) {
    throw new Error('Ciphertext magic mismatch');
  }

  const version = envelope[offset];
  offset += 1;
  if (version !== VERSION) {
    throw new Error(`Unsupported ciphertext version: ${version}`);
  }

  const salt = envelope.subarray(offset, offset + SALT_LEN);
  offset += SALT_LEN;
  const iv = envelope.subarray(offset, offset + IV_LEN);
  offset += IV_LEN;
  const tag = envelope.subarray(offset, offset + TAG_LEN);
  offset += TAG_LEN;
  const ciphertext = envelope.subarray(offset);

  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf-8');
  } catch (err) {
    throw new Error(
      `Decryption failed (wrong passphrase or tampered ciphertext): ${(err as Error).message}`,
    );
  }
}

/**
 * Generates a new random passphrase suitable for the master key.
 * 256 bits of entropy, encoded as base64 (~43 chars).
 */
export function generateMasterPassphrase(): string {
  return randomBytes(32).toString('base64');
}
