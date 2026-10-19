import type { AuthClaims, Channel } from '@susu/shared';

/** Who is acting, as established by the server (Firebase Auth token or device binding). */
export interface Actor {
  uid: string;
  claims: AuthClaims;
  channel: Channel;
  deviceId?: string;
}

/** The system itself (scheduled jobs, migrations). */
export const SYSTEM_ACTOR_UID = 'system';
