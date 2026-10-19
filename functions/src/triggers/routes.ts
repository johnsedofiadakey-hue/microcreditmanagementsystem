import { routeDayKey } from '@susu/shared';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { publishRoutes } from '../projections/firestore.js';
import { activePairIds } from '../routes/routes.js';
import { DATABASE_URL, REGION, getDatabase } from '../runtime.js';

/**
 * Just after midnight in Accra: write the new day's route for every active pair, so phones that
 * synced overnight start the day with their list. Assignment changes during the day republish at once.
 */
export const publishDailyRoutes = onSchedule(
  { schedule: 'every day 00:05', timeZone: 'Africa/Accra', region: REGION, secrets: [DATABASE_URL], retryCount: 3 },
  async () => {
    const db = getDatabase();
    const day = routeDayKey();
    const pairIds = await activePairIds(db);
    const failed = await publishRoutes(db, pairIds, day);
    if (failed.length > 0) {
      // Throwing makes the scheduler retry; publishing is idempotent.
      throw new Error(`Routes for ${failed.length} of ${pairIds.length} pairs could not be published for ${day}`);
    }
    logger.info('Daily routes published', { day, pairs: pairIds.length });
  },
);
