import { ROLES, type Role } from '@susu/shared';
import {
  Building2,
  ClipboardCheck,
  Landmark,
  LayoutDashboard,
  Package,
  ScrollText,
  Smartphone,
  UserCog,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * What each role may see and start in the portal. This only hides what a role can't use; the
 * backend refuses it anyway (functions/src/lib/permissions.ts is the authority).
 */

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Administrator',
  FINANCE: 'Finance',
  COMPLIANCE: 'Compliance',
  BRANCH_MANAGER: 'Branch manager',
  CASHIER: 'Cashier',
  SUPERVISOR: 'Supervisor',
  AGENT: 'Field agent',
};

export const can = {
  createBranch: (role: Role) => role === 'SUPER_ADMIN',
  viewStaff: (role: Role) => role === 'SUPER_ADMIN' || role === 'BRANCH_MANAGER',
  createAgentPair: (role: Role) => role === 'SUPER_ADMIN' || role === 'BRANCH_MANAGER',
  manageDevices: (role: Role) => role === 'SUPER_ADMIN' || role === 'BRANCH_MANAGER' || role === 'SUPERVISOR',
  viewAudit: (role: Role) => role === 'SUPER_ADMIN' || role === 'COMPLIANCE' || role === 'BRANCH_MANAGER',
  /** registerMember makers (AGENT registers from the app, not the portal). */
  registerMember: (role: Role) => ['SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'SUPERVISOR'].includes(role),
  /** approveMember checkers. The backend also refuses the person who registered the member. */
  approveMember: (role: Role) => ['SUPER_ADMIN', 'COMPLIANCE', 'BRANCH_MANAGER'].includes(role),
  openSusuAccount: (role: Role) => ['SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER'].includes(role),
  /** Decide which agent pair collects an account (assignCollector / unassignCollector). */
  assignCollector: (role: Role) => ['SUPER_ADMIN', 'BRANCH_MANAGER', 'SUPERVISOR'].includes(role),
  createProduct: (role: Role) => role === 'SUPER_ADMIN',
  /** storage.rules canUploadKyc (API.md §5). */
  uploadKyc: (role: Role) => ['SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'SUPERVISOR'].includes(role),
  /** Full Ghana Card number on the member profile. Everyone else sees GHA-•••••••••-3. */
  seeFullGhanaCard: (role: Role) => ['SUPER_ADMIN', 'COMPLIANCE', 'BRANCH_MANAGER'].includes(role),
  /** Bank accounts, statement import, matching and setting lines aside (API.md §2 "Bank deposits"). */
  reconcileBank: (role: Role) => role === 'SUPER_ADMIN' || role === 'FINANCE',
  /** requestCollectionCorrection makers (API.md §2 "Corrections to collections"). */
  requestCorrection: (role: Role) => ['SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'SUPERVISOR'].includes(role),
  /** approveCorrection / rejectCorrection: head office any amount; a branch manager up to the threshold (approve only). */
  decideCorrection: (role: Role) => ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE', 'BRANCH_MANAGER'].includes(role),
  approveCorrectionAmount: (role: Role, needsHeadOffice: boolean) =>
    ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE'].includes(role) || (role === 'BRANCH_MANAGER' && !needsHeadOffice),
  /** Member-registration approvals (listPendingApprovals). */
  approveMembers: (role: Role) => ['SUPER_ADMIN', 'COMPLIANCE', 'BRANCH_MANAGER'].includes(role),
};

/** Roles a person may create through createStaffUser (API.md §2). */
export function creatableRoles(role: Role): readonly Role[] {
  if (role === 'SUPER_ADMIN') return ROLES;
  if (role === 'BRANCH_MANAGER') return ['CASHIER', 'SUPERVISOR', 'AGENT'];
  return [];
}

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: readonly Role[];
  /** Shown but disabled until the backend step lands. */
  comingIn?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const PORTAL_ROLES = ROLES.filter((r) => r !== 'AGENT');

export const NAV: NavSection[] = [
  {
    title: 'Today',
    items: [{ href: '/', label: 'Overview', icon: LayoutDashboard, roles: PORTAL_ROLES }],
  },
  {
    title: 'Operations',
    items: [
      { href: '/members', label: 'Members', icon: Users, roles: PORTAL_ROLES },
      {
        href: '/approvals',
        label: 'Approvals',
        icon: ClipboardCheck,
        // Member checkers, plus everyone who requests or decides collection corrections.
        roles: ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE', 'BRANCH_MANAGER', 'CASHIER', 'SUPERVISOR'],
      },
      {
        href: '/cash',
        label: 'Cash & handovers',
        icon: Wallet,
        roles: ['SUPER_ADMIN', 'FINANCE', 'BRANCH_MANAGER', 'CASHIER'],
      },
      {
        href: '/bank',
        label: 'Bank reconciliation',
        icon: Landmark,
        roles: ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE'],
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        href: '/admin/branches',
        label: 'Branches',
        icon: Building2,
        roles: ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE', 'BRANCH_MANAGER'],
      },
      {
        href: '/admin/products',
        label: 'Products',
        icon: Package,
        roles: ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE', 'BRANCH_MANAGER'],
      },
      { href: '/admin/staff', label: 'Staff & roles', icon: UserCog, roles: ['SUPER_ADMIN', 'BRANCH_MANAGER'] },
      {
        href: '/admin/agent-pairs',
        label: 'Agent pairs',
        icon: UsersRound,
        roles: ['SUPER_ADMIN', 'BRANCH_MANAGER', 'SUPERVISOR'],
      },
      {
        href: '/admin/devices',
        label: 'Devices',
        icon: Smartphone,
        roles: ['SUPER_ADMIN', 'BRANCH_MANAGER', 'SUPERVISOR'],
      },
    ],
  },
  {
    title: 'Oversight',
    items: [
      { href: '/audit', label: 'Audit log', icon: ScrollText, roles: ['SUPER_ADMIN', 'COMPLIANCE', 'BRANCH_MANAGER'] },
    ],
  },
];

export function navFor(role: Role): NavSection[] {
  return NAV.map((section) => ({ ...section, items: section.items.filter((i) => i.roles.includes(role)) })).filter(
    (section) => section.items.length > 0,
  );
}

/** The roles allowed on a given route (first matching nav item), or undefined for unlisted routes. */
export function rolesForPath(pathname: string): readonly Role[] | undefined {
  for (const section of NAV) {
    for (const item of section.items) {
      if (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)) return item.roles;
    }
  }
  return undefined;
}
