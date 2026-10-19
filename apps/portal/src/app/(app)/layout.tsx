'use client';

import { Loader2, Smartphone, UserX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuth } from '@/lib/auth-context';
import { BranchProvider } from '@/lib/branch-context';

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-6">{children}</div>;
}

export default function SignedInLayout({ children }: { children: ReactNode }) {
  const { state, signOut, refreshClaims } = useAuth();
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (state.status === 'signed-out') router.replace('/sign-in');
  }, [state.status, router]);

  if (state.status === 'loading' || state.status === 'signed-out') {
    return (
      <FullScreen>
        <Loader2 className="size-6 animate-spin text-primary" aria-label="Loading" />
      </FullScreen>
    );
  }

  if (state.status === 'no-role') {
    return (
      <FullScreen>
        <EmptyState
          icon={UserX}
          title="Your account is not set up yet"
          description="Contact your administrator. Once they assign your role, choose “Check again”."
          action={
            <div className="flex gap-2">
              <Button
                disabled={checking}
                onClick={async () => {
                  setChecking(true);
                  await refreshClaims().finally(() => setChecking(false));
                }}
              >
                {checking && <Loader2 className="animate-spin" />} Check again
              </Button>
              <Button variant="outline" onClick={() => signOut()}>
                Sign out
              </Button>
            </div>
          }
        />
      </FullScreen>
    );
  }

  if (state.claims.role === 'AGENT') {
    return (
      <FullScreen>
        <EmptyState
          icon={Smartphone}
          title="Field agents use the agent app"
          description="Collections, routes and handovers are on your company phone. The portal is for branch and head-office staff."
          action={
            <Button variant="outline" onClick={() => signOut()}>
              Sign out
            </Button>
          }
        />
      </FullScreen>
    );
  }

  return (
    <BranchProvider>
      <AppShell>{children}</AppShell>
    </BranchProvider>
  );
}
