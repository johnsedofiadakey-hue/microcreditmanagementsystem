import type { RejectReason } from '@susu/shared';
import { FirebaseError } from 'firebase/app';

/** Friendly copy for the stable reason codes in @susu/shared/errors.ts. */
const REASON_COPY: Record<RejectReason, string> = {
  INVALID_COMMAND: 'Some details are not valid. Check the highlighted fields.',
  INVALID_SIGNATURE: 'The phone’s signature did not match its enrolled key.',
  DEVICE_NOT_BOUND: 'This phone is not registered to an agent.',
  DEVICE_NOT_ENROLLED: 'This phone has not enrolled its security key yet. Open the agent app on it and sign in first.',
  DEVICE_REVOKED: 'This phone has been revoked.',
  DEVICE_AGENT_MISMATCH: 'This phone is registered to a different agent.',
  AGENT_NOT_ACTIVE: 'This agent’s account is not active.',
  AGENT_NOT_IN_PAIR: 'This agent is not part of that pair.',
  AGENT_PAIR_NOT_ACTIVE: 'This agent pair is not active.',
  SEQUENCE_REUSED: 'This record was already received from the phone.',
  MEMBER_NOT_FOUND: 'We could not find that member.',
  MEMBER_NOT_ACTIVE: 'This member is not active yet.',
  ACCOUNT_NOT_FOUND: 'We could not find that Susu account.',
  ACCOUNT_NOT_ACTIVE: 'This Susu account is not active.',
  ACCOUNT_OUTSIDE_BRANCH: 'This account belongs to a different branch.',
  AMOUNT_ABOVE_LIMIT: 'This amount is above the allowed limit.',
  INSUFFICIENT_BALANCE: 'There is not enough balance for this.',
  IDEMPOTENCY_CONFLICT: 'This request was already used for something else. Start again.',
  SELF_APPROVAL_FORBIDDEN: 'You started this request, so a different person must approve it.',
  NOT_PERMITTED: 'Your role is not allowed to do this here.',
  STAFF_NOT_ACTIVE: 'Your access has changed. Sign out and sign in again; if it still fails, contact your administrator.',
  ALREADY_REVERSED: 'This has already been reversed.',
  NOT_FOUND: 'We could not find what you were looking for.',
  CONFLICT: 'This already exists or clashes with an existing record.',
  BRANCH_DAY_CLOSED: 'This branch day is already closed. Record it on the next day.',
  APPROVAL_LIMIT_EXCEEDED: 'This amount needs approval from head office (finance or an administrator).',
  EXPECTED_CASH_CHANGED: 'More collections reached the server while you were counting. Check the new expected amount and count again.',
};

const CODE_COPY: Record<string, string> = {
  unauthenticated: 'Your session has ended. Sign in again.',
  'permission-denied': 'Your role is not allowed to do this.',
  'not-found': 'We could not find what you were looking for.',
  'already-exists': 'This already exists.',
  'failed-precondition': 'This cannot be done right now.',
  unavailable: 'The service is not reachable. Check your connection and try again.',
  internal: 'Something went wrong on our side. Please try again.',
};

export interface FieldIssue {
  path: string;
  message: string;
}

export interface ActionError {
  message: string;
  reason?: string;
  fieldErrors: Record<string, string>;
}

/** Turn a callable FunctionsError (API.md §2) into copy plus inline field errors. */
export function toActionError(error: unknown): ActionError {
  if (error instanceof FirebaseError) {
    const details = (error as FirebaseError & { details?: { reason?: string; issues?: FieldIssue[] } }).details;
    const reason = details?.reason;
    const fieldErrors: Record<string, string> = {};
    for (const issue of details?.issues ?? []) fieldErrors[issue.path] = issue.message;
    const code = error.code.replace(/^functions\//, '');
    const message =
      (reason && ['INSUFFICIENT_BALANCE', 'SELF_APPROVAL_FORBIDDEN', 'APPROVAL_LIMIT_EXCEEDED'].includes(reason) && error.message
        ? error.message
        : undefined) ??
      (reason && reason in REASON_COPY ? REASON_COPY[reason as RejectReason] : undefined) ??
      CODE_COPY[code] ??
      error.message;
    return { message, reason, fieldErrors };
  }
  return { message: error instanceof Error ? error.message : 'Something went wrong.', fieldErrors: {} };
}

/** Copy for Firebase Auth sign-in failures. Never reveals whether an email exists. */
export function authErrorMessage(error: unknown): string {
  const code = error instanceof FirebaseError ? error.code : '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Email or password is not correct.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact your administrator.';
    case 'auth/invalid-verification-code':
      return 'That code is not correct. Try again.';
    case 'auth/network-request-failed':
      return 'No connection. Check your network and try again.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}
