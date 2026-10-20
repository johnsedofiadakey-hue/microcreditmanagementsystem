import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { publishAllDayDashboards } from '../projections/firestore.js';
import { DATABASE_URL, REGION, getDatabase } from '../runtime.js';

/**
 * Every 5 minutes: today's and yesterday's dashboards for every active branch and for the company.
 * Branch figures also refresh immediately after each posted collection and cash action; this keeps
 * the company roll-up current, starts each new day's documents, and repairs any missed write.
 */
export const publishDayDashboards = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'Africa/Accra', region: REGION, secrets: [DATABASE_URL], timeoutSeconds: 240, retryCount: 0 },
  async () => {
    const { branches } = await publishAllDayDashboards(getDatabase());
    logger.info('Day dashboards published', { branches });
  },
);
