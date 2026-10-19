import {
  getAccountStatementRequestSchema,
  getMemberRequestSchema,
  listAgentPairsRequestSchema,
  listAuditEventsRequestSchema,
  listBranchesRequestSchema,
  listDevicesRequestSchema,
  listPendingApprovalsRequestSchema,
  listStaffRequestSchema,
  listSusuProductsRequestSchema,
  searchMembersRequestSchema,
  type MemberProfile,
} from '@susu/shared';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { listAuditEvents } from '../reads/audit.js';
import { getAccountStatement, getMember, listPendingApprovals, searchMembers } from '../reads/members.js';
import { listAgentPairs, listBranches, listDevices, listStaff, listSusuProducts } from '../reads/org.js';
import { staffCallable } from './staffCallable.js';

const PHOTO_URL_TTL_MS = 5 * 60 * 1000;

export const listBranchesFn = staffCallable(listBranchesRequestSchema, ({ db, actor }) => listBranches(db, actor));
export const listStaffFn = staffCallable(listStaffRequestSchema, ({ db, actor, input }) => listStaff(db, actor, input));
export const listAgentPairsFn = staffCallable(listAgentPairsRequestSchema, ({ db, actor, input }) => listAgentPairs(db, actor, input));
export const listDevicesFn = staffCallable(listDevicesRequestSchema, ({ db, actor, input }) => listDevices(db, actor, input));
export const listSusuProductsFn = staffCallable(listSusuProductsRequestSchema, ({ db, actor }) => listSusuProducts(db, actor));
export const searchMembersFn = staffCallable(searchMembersRequestSchema, ({ db, actor, input }) => searchMembers(db, actor, input));
export const getAccountStatementFn = staffCallable(getAccountStatementRequestSchema, ({ db, actor, input }) =>
  getAccountStatement(db, actor, input),
);
export const listPendingApprovalsFn = staffCallable(listPendingApprovalsRequestSchema, ({ db, actor, input }) =>
  listPendingApprovals(db, actor, input),
);
export const listAuditEventsFn = staffCallable(listAuditEventsRequestSchema, ({ db, actor, input }) => listAuditEvents(db, actor, input));

/** Profile plus 5-minute signed photo URLs, only for roles allowed to see full KYC. */
export const getMemberFn = staffCallable(getMemberRequestSchema, async ({ db, actor, input }): Promise<MemberProfile> => {
  const { profile, photoPathsToSign } = await getMember(db, actor, input);
  if (photoPathsToSign.length === 0) return profile;
  const bucket = getStorage().bucket();
  const photoUrls: string[] = [];
  for (const path of photoPathsToSign) {
    try {
      const [url] = await bucket.file(path).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + PHOTO_URL_TTL_MS });
      photoUrls.push(url);
    } catch (error) {
      logger.warn('Could not sign a KYC photo URL', { memberId: profile.id, path, error });
    }
  }
  return { ...profile, photoUrls };
});
