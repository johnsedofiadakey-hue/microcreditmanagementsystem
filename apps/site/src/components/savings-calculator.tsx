'use client';

import { formatCedis } from '@susu/shared';
import { useId, useState } from 'react';

const DAILY_PRESETS = [500, 1000, 2000, 5000]; // pesewas: GH₵ 5, 10, 20, 50
const MIN_DAILY = 100;
const MAX_DAILY = 50_000;

/**
 * Illustration only: daily amount × collection days. Shows no fee, interest or payout date,
 * because those depend on the product terms the client has not yet signed off.
 */
export function SavingsCalculator() {
  const id = useId();
  const [daily, setDaily] = useState(2000);
  const [daysPerWeek, setDaysPerWeek] = useState(6);
  const [months, setMonths] = useState(3);

  const days = Math.round((daysPerWeek * 52 * months) / 12);
  const total = daily * days;

  return (
    <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm sm:p-8">
      <div className="grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div className="space-y-7">
          <div>
            <label htmlFor={`${id}-daily`} className="text-sm font-semibold">
              I can save each day
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {DAILY_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setDaily(p)}
                  aria-pressed={daily === p}
                  className={
                    daily === p
                      ? 'min-h-10 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground'
                      : 'min-h-10 rounded-full border border-border bg-background px-4 text-sm font-medium hover:border-primary/40'
                  }
                >
                  {formatCedis(p).replace('.00', '')}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-4">
              <input
                id={`${id}-daily`}
                type="range"
                min={MIN_DAILY}
                max={MAX_DAILY}
                step={100}
                value={daily}
                onChange={(e) => setDaily(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-[var(--primary)]"
                aria-valuetext={formatCedis(daily)}
              />
              <span className="money w-28 text-right font-heading text-lg font-bold">{formatCedis(daily)}</span>
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold">Collection days each week</legend>
            <div className="mt-3 inline-flex rounded-full border border-border bg-background p-1">
              {[5, 6, 7].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDaysPerWeek(d)}
                  aria-pressed={daysPerWeek === d}
                  className={
                    daysPerWeek === d
                      ? 'min-h-9 rounded-full bg-primary-strong px-4 text-sm font-semibold text-white'
                      : 'min-h-9 rounded-full px-4 text-sm font-medium text-muted-foreground hover:text-foreground'
                  }
                >
                  {d} days
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={`${id}-months`} className="text-sm font-semibold">
              For how long
            </label>
            <div className="mt-3 flex items-center gap-4">
              <input
                id={`${id}-months`}
                type="range"
                min={1}
                max={12}
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-[var(--primary)]"
                aria-valuetext={`${months} months`}
              />
              <span className="w-28 text-right font-heading text-lg font-bold">
                {months} {months === 1 ? 'month' : 'months'}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-primary-strong p-6 text-white" aria-live="polite">
          <p className="text-sm text-white/70">You would put aside about</p>
          <p className="money mt-2 font-heading text-4xl font-black text-accent sm:text-5xl">{formatCedis(total)}</p>
          <p className="mt-3 text-sm text-white/75">
            over roughly <strong className="text-white">{days} collection days</strong>, one receipt for each.
          </p>
          <p className="mt-6 border-t border-white/15 pt-4 text-xs leading-relaxed text-white/60">
            Illustration only. It is simply your daily amount added up. It does not show any fee, interest or payout date —
            our staff will explain the terms of your Susu plan before you start.
          </p>
        </div>
      </div>
    </div>
  );
}
