'use client';

import { MARKET_OPTIONS, type Market } from '@/lib/market';

interface Props {
  value: Market | null;
  onChange: (next: Market | null) => void;
  /** Optional class added to the wrapper for layout tweaks. */
  className?: string;
}

/**
 * Optional market selector used by every generation page. 9 options is
 * too many for chip toggles (the FunnelStageSelector pattern doesn't
 * scale here), so we use a native <select>. Clearing back to "Auto (US)"
 * sets the value to null — the route then gets no market block and
 * Claude defaults to US-market behavior from GENERATION_RULES.
 */
export default function MarketSelector({ value, onChange, className }: Props) {
  return (
    <div className={className}>
      <label className="text-text-muted text-xs mb-1.5 block">
        Market
        <span className="text-text-muted ml-1 font-normal opacity-60">
          — optional, defaults to US if empty
        </span>
      </label>
      <select
        value={value ?? ''}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next === '' ? null : (next as Market));
        }}
        className="input-field text-sm"
      >
        <option value="">Auto (US default)</option>
        {MARKET_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label} — {opt.hint}
          </option>
        ))}
      </select>
    </div>
  );
}
