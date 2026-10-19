import { assignCollectorRequestSchema, unassignCollectorRequestSchema } from '@susu/shared';
import { publishRoutes } from '../projections/firestore.js';
import { assignCollector, unassignCollector } from '../routes/routes.js';
import { staffCallable } from './staffCallable.js';

/** Put a Susu account on an agent pair's route, then refresh today's route on the affected phones. */
export const assignCollectorFn = staffCallable(assignCollectorRequestSchema, async ({ db, actor, input }) => {
  const { affectedPairIds } = await db.transaction((tx) => assignCollector(tx, actor, input));
  await publishRoutes(db, affectedPairIds);
  return null;
});

export const unassignCollectorFn = staffCallable(unassignCollectorRequestSchema, async ({ db, actor, input }) => {
  const { affectedPairIds } = await db.transaction((tx) => unassignCollector(tx, actor, input));
  await publishRoutes(db, affectedPairIds);
  return null;
});
