import { createHash } from 'node:crypto';
import { canonicalJson } from '@susu/shared';

export { canonicalJson };

export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
