import { submitEnquiryRequestSchema } from '@susu/shared';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { EnquiryRateLimitedError, submitEnquiry } from '../enquiries/submit.js';
import { ENFORCE_APP_CHECK, REGION } from '../runtime.js';

/**
 * The public website's only backend call (API.md §2). No sign-in; App Check proves the request came
 * from the site. Never touches Postgres, so it needs no database secret.
 */
export const submitEnquiryFn = onCall({ region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, maxInstances: 5 }, async (request) => {
  const input = submitEnquiryRequestSchema.safeParse(request.data);
  if (!input.success) {
    throw new HttpsError('invalid-argument', 'Some fields are invalid', {
      reason: 'INVALID_COMMAND',
      issues: input.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  try {
    return await submitEnquiry(getFirestore(), input.data, { appCheckAppId: request.app?.appId ?? null });
  } catch (error) {
    if (error instanceof EnquiryRateLimitedError) throw new HttpsError('resource-exhausted', error.message, { reason: error.reason });
    logger.error('submitEnquiry failed', { error });
    throw new HttpsError('internal', 'Something went wrong. Please try again or call the office.');
  }
});
