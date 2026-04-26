'use client';

import { FUNNEL_STAGE_OPTIONS, type FunnelStage } from '@/lib/funnel-stage';

interface Props {
  value: FunnelStage | null;
  onChange: (next: FunnelStage | null) => void;
  /** Optional class added to the wrapper for layout tweaks. */
  className?: string;
}

/**
 * Optional 3-chip selector (TOFU / MOFU / BOFU) used by every generation page.
 * Click a chip to lock that funnel stage; click it again to clear.
 * When null, the route gets no funnel-stage instruction and Claude decides freely.
 */
export default function FunnelStageSelector({ value, onChange, className }: Props) {
  return (
    <div className={className}>
      <label className="text-text-muted text-xs mb-1.5 block">
        Funnel Stage
        <span className="text-text-muted ml-1 font-normal opacity-60">
          — optional, AI decides freely if empty
        </span>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {FUNNEL_STAGE_OPTIONS.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(isSelected ? null : opt.value)}
              title={opt.hint}
              className={`text-[11px] px-2.5 py-1 rounded border transition-colors ${
                isSelected
                  ? 'bg-accent-gold text-bg-base border-accent-gold'
                  : 'border-bg-border text-text-secondary hover:border-text-muted hover:text-text-primary'
              }`}
            >
              <span className="font-semibold">{opt.label}</span>
              <span className={`ml-1.5 ${isSelected ? 'opacity-80' : 'opacity-60'}`}>
                · {opt.hint.split('—')[0].trim()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
