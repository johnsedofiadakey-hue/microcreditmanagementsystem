import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const chip = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
  {
    variants: {
      tone: {
        success: 'bg-success-soft text-success ring-success/20',
        warning: 'bg-warning-soft text-warning ring-warning/25',
        danger: 'bg-destructive-soft text-destructive ring-destructive/20',
        info: 'bg-info-soft text-info ring-info/20',
        neutral: 'bg-muted text-muted-foreground ring-border',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function StatusChip({
  tone,
  children,
  dot = true,
  className,
}: VariantProps<typeof chip> & { children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn(chip({ tone }), className)}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, VariantProps<typeof chip>['tone']> = {
  ACTIVE: 'success',
  POSTED: 'success',
  APPROVED: 'success',
  PENDING: 'warning',
  PENDING_APPROVAL: 'warning',
  CLOSED: 'neutral',
  INACTIVE: 'neutral',
  DISABLED: 'neutral',
  REVOKED: 'danger',
  REJECTED: 'danger',
  FROZEN: 'warning',
  RETIRED: 'neutral',
  RESTRICTED: 'danger',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  INACTIVE: 'Inactive',
  DISABLED: 'Disabled',
  REVOKED: 'Revoked',
  PENDING_APPROVAL: 'Awaiting approval',
  FROZEN: 'Frozen',
  RETIRED: 'Retired',
  RESTRICTED: 'Restricted',
};

export function RecordStatus({ status }: { status: string }) {
  return <StatusChip tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? status}</StatusChip>;
}

const KYC: Record<string, { label: string; tone: VariantProps<typeof chip>['tone'] }> = {
  DRAFT: { label: 'KYC draft', tone: 'neutral' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  RETRY_REQUIRED: { label: 'Retry KYC', tone: 'warning' },
  EXCEPTION: { label: 'KYC exception', tone: 'danger' },
  RESTRICTED: { label: 'Restricted', tone: 'danger' },
  REJECTED: { label: 'KYC rejected', tone: 'danger' },
  EXPIRED: { label: 'KYC expired', tone: 'warning' },
};

export function KycChip({ status }: { status: string }) {
  const k = KYC[status] ?? { label: status, tone: 'neutral' as const };
  return (
    <StatusChip tone={k.tone} dot={false}>
      {k.label}
    </StatusChip>
  );
}
