'use client';

import { registerMemberRequestSchema, type RegisterMemberRequest } from '@susu/shared';
import { ImagePlus, Loader2, UserPlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { can } from '@/lib/access';
import { useSession } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { registerMember, uploadKycPhoto } from '@/lib/members-api';
import { useAction } from '@/lib/use-action';

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function RegisterMemberDialog() {
  const router = useRouter();
  const { user, claims } = useSession();
  const { branches, scope } = useBranch();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState(scope ?? branches[0]?.id ?? '');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [ghanaCardNumber, setCard] = useState('');
  const [dateOfBirth, setDob] = useState('');
  const [consent, setConsent] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const canUpload = can.uploadKyc(claims.role);

  const action = useAction(registerMemberRequestSchema, async (input) => {
    // Photos go to the KYC inbox first; the callable receives their storage paths.
    setUploading(true);
    try {
      const photoPaths = await Promise.all(photos.map((file) => uploadKycPhoto(file, user.uid)));
      return await registerMember({ ...(input as RegisterMemberRequest), photoPaths });
    } finally {
      setUploading(false);
    }
  });

  function reset() {
    setFullName('');
    setPhone('');
    setCard('');
    setDob('');
    setConsent(false);
    setPhotos([]);
    setPhotoError(null);
    action.reset();
  }

  function addPhotos(files: FileList | null) {
    setPhotoError(null);
    const next = [...photos];
    for (const file of Array.from(files ?? [])) {
      if (!TYPES.includes(file.type)) setPhotoError('Use JPEG, PNG or WebP photos.');
      else if (file.size >= MAX_BYTES) setPhotoError('Each photo must be under 8 MB.');
      else if (next.length < 6) next.push(file);
    }
    setPhotos(next);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = await action.run({
      branchId,
      fullName,
      phone,
      ghanaCardNumber,
      dateOfBirth,
      consentGiven: consent as true,
    });
    if (result) {
      toast.success(`${fullName.trim()} registered`, {
        description: 'Awaiting approval by a second person before a Susu account can be opened.',
      });
      setOpen(false);
      reset();
      router.push(`/members/${result.data.memberId}`);
    }
  }

  const busy = action.busy || uploading;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setBranchId(scope ?? branches[0]?.id ?? '');
        else reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Register member
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-xl"
        title="Register a member"
        description="Enter the details exactly as on the Ghana Card. A different person approves the registration."
      >
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {action.error && !Object.keys(action.error.fieldErrors).length && <Alert tone="error">{action.error.message}</Alert>}
          {branches.length > 1 && (
            <Field label="Branch" htmlFor="m-branch" error={action.fieldError('branchId')}>
              <NativeSelect id="m-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Full name" htmlFor="m-name" error={action.fieldError('fullName')}>
            <Input id="m-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" autoFocus aria-invalid={!!action.fieldError('fullName')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile number" htmlFor="m-phone" hint="e.g. 024 123 4567" error={action.fieldError('phone')}>
              <Input id="m-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!action.fieldError('phone')} />
            </Field>
            <Field label="Date of birth" htmlFor="m-dob" error={action.fieldError('dateOfBirth')}>
              <Input id="m-dob" type="date" value={dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDob(e.target.value)} aria-invalid={!!action.fieldError('dateOfBirth')} />
            </Field>
          </div>
          <Field label="Ghana Card number" htmlFor="m-card" hint="GHA-123456789-0" error={action.fieldError('ghanaCardNumber')}>
            <Input
              id="m-card"
              value={ghanaCardNumber}
              onChange={(e) => setCard(e.target.value.toUpperCase())}
              className="font-mono uppercase"
              autoComplete="off"
              aria-invalid={!!action.fieldError('ghanaCardNumber')}
            />
          </Field>

          {canUpload ? (
            <div className="grid gap-2">
              <p className="text-[13px] font-medium">Photos (member and both sides of the Ghana Card)</p>
              <div className="flex flex-wrap gap-2">
                {photos.map((file, i) => (
                  <span key={`${file.name}-${i}`} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 py-1 pr-1 pl-2.5 text-xs">
                    <span className="max-w-40 truncate">{file.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                      className="rounded p-0.5 hover:bg-muted"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
                {photos.length < 6 && (
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50">
                    <ImagePlus className="size-4" /> Add photo
                    <input type="file" accept={TYPES.join(',')} multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} />
                  </label>
                )}
              </div>
              {photoError && <p role="alert" className="text-[13px] text-destructive">{photoError}</p>}
              <p className="text-xs text-muted-foreground">Photos go to a locked inbox. Nobody can open them from the portal until the member is verified.</p>
            </div>
          ) : (
            <Alert tone="info">Photos are captured by branch staff or agents. Your role registers details only.</Alert>
          )}

          <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              The member agreed to us storing their details and Ghana Card for Susu membership.
              {action.fieldError('consentGiven') && <span className="block text-[13px] text-destructive">Consent is required.</span>}
            </span>
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !consent || !branchId}>
              {busy && <Loader2 className="animate-spin" />} {uploading ? 'Uploading photos…' : 'Register member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
