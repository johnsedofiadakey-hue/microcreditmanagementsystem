import { cn } from '@/lib/utils';

/**
 * Illustration of the receipts members get. Wording mirrors the real template
 * (functions/src/messaging/templates.ts); names and amounts are examples.
 */
const MESSAGES = [
  { time: 'Mon 10:24', text: 'Gadufia: GHS 20.00 received 20 Oct 10:24. Balance GHS 120.00. Ref 357D5757. Keep this SMS as your receipt.' },
  { time: 'Tue 10:31', text: 'Gadufia: GHS 20.00 received 21 Oct 10:31. Balance GHS 140.00. Ref 8B21C0E4. Keep this SMS as your receipt.' },
  { time: 'Wed 09:58', text: 'Gadufia: GHS 20.00 received 22 Oct 09:58. Balance GHS 160.00. Ref C47F19A2. Keep this SMS as your receipt.' },
];

export function PhoneReceipt({ className }: { className?: string }) {
  return (
    <figure className={cn('relative mx-auto w-full max-w-[19rem]', className)}>
      <div className="rounded-[2.4rem] border border-white/15 bg-[#0c241d] p-2.5 shadow-[0_30px_80px_-20px_rgb(0_0_0/60%)]">
        <div className="overflow-hidden rounded-[1.9rem] bg-[#f4f1ea]">
          <div className="flex items-center justify-between bg-white px-5 pb-3 pt-4">
            <div>
              <p className="text-[11px] font-medium text-neutral-500">Messages</p>
              <p className="font-heading text-sm font-bold text-neutral-900">GadufiaSusu</p>
            </div>
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">Receipt</span>
          </div>
          <ol className="space-y-3 px-3.5 py-4" aria-label="Example SMS receipts">
            {MESSAGES.map((m, i) => (
              <li key={m.time} className={cn('sms-in', i === 1 && 'sms-in-2', i === 2 && 'sms-in-3')}>
                <p className="mb-1 text-center text-[10px] text-neutral-400">{m.time}</p>
                <p className="rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-[12.5px] leading-snug text-neutral-800 shadow-sm">{m.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <figcaption className="mt-4 text-center text-xs text-white/60">Example receipts. Your name and amounts will differ.</figcaption>
    </figure>
  );
}
