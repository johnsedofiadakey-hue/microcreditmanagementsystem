import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { DomainError } from './errors.js';

/** Parse an enrolled device key: base64 X.509 SubjectPublicKeyInfo (DER) of an EC P-256 key. */
export function parseDevicePublicKey(publicKeyBase64: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
  } catch {
    throw new DomainError('DEVICE_NOT_ENROLLED', 'The phone key is not a valid public key');
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new DomainError('DEVICE_NOT_ENROLLED', 'The phone key must be an EC P-256 key');
  }
  return key;
}

/**
 * Short code a supervisor reads on the phone and in the portal to confirm they match:
 * first 16 hex characters of SHA-256 over the DER key, upper-case, in groups of four.
 */
export function deviceKeyFingerprint(publicKeyBase64: string): string {
  const hex = createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest('hex').slice(0, 16).toUpperCase();
  return hex.match(/.{4}/g)!.join('-');
}

/** ECDSA P-256 / SHA-256 over the UTF-8 message, DER signature (Android `SHA256withECDSA`). */
export function verifyDeviceSignature(publicKeyBase64: string, message: string, signatureBase64: string): boolean {
  try {
    const key = parseDevicePublicKey(publicKeyBase64);
    return verify('sha256', Buffer.from(message, 'utf8'), { key, dsaEncoding: 'der' }, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}
