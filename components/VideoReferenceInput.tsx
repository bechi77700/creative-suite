'use client';

// Drag-and-drop video uploader → POSTs to /api/analyze-video → returns the
// structured VideoAnalysis JSON to the parent. Used by Iterate Video and
// Video Script (Clone & Adapt mode). Single-file only — one reference per run.

import { useRef, useState } from 'react';
import type { VideoAnalysis } from '@/lib/gemini-video';

interface Props {
  /** The current analyzed video (if any). Parent owns the state. */
  analysis: VideoAnalysis | null;
  onChange: (analysis: VideoAnalysis | null) => void;
  /** Optional label for the empty drop zone. */
  emptyLabel?: string;
  className?: string;
}

const ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-m4v';
const MAX_BYTES = 100 * 1024 * 1024;

export default function VideoReferenceInput({
  analysis,
  onChange,
  emptyLabel = '↑ Upload a reference video',
  className = '',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('video/')) {
      setError(`Unsupported file type "${file.type}". Use MP4, MOV or WebM.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`Video too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 100 MB.`);
      return;
    }
    setFileName(file.name);
    setLoading(true);
    // Hard 5 min client-side cap — matches the server's maxDuration. Without
    // this an unfortunate Google stall would keep the spinner spinning forever.
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
    try {
      const fd = new FormData();
      fd.append('video', file);
      const res = await fetch('/api/analyze-video', {
        method: 'POST',
        body: fd,
        signal: controller.signal,
      });
      // Read text first so we can give a useful error if the body is empty
      // (Railway proxy timeout / container restart mid-request return an
      // empty body, which would otherwise blow up at JSON.parse with a
      // useless "Unexpected end of JSON input").
      const raw = await res.text();
      if (!raw.trim()) {
        throw new Error(
          res.ok
            ? 'Server returned an empty response — the request was likely killed by the platform before completing. Try again, or use a shorter clip.'
            : `Server returned empty response (HTTP ${res.status}). This usually means the platform proxy timed out — try again or use a shorter clip.`,
        );
      }
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          `Server returned non-JSON response (HTTP ${res.status}): ${raw.slice(0, 120)}…`,
        );
      }
      if (!res.ok) {
        const err = (data as { error?: string })?.error;
        throw new Error(err || `HTTP ${res.status}`);
      }
      onChange(data as VideoAnalysis);
      setOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Analysis failed';
      setError(
        controller.signal.aborted
          ? 'Analysis timed out after 5 minutes — Google likely stalled. Try again or use a shorter clip.'
          : msg,
      );
      onChange(null);
    } finally {
      clearTimeout(abortTimer);
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const reset = () => {
    onChange(null);
    setFileName(null);
    setError(null);
    setOpen(false);
  };

  // ---------- empty state ----------
  if (!analysis && !loading) {
    return (
      <div className={className}>
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className={`flex flex-col items-center justify-center h-28 border border-dashed rounded-md cursor-pointer transition-colors group ${
            dragOver ? 'border-accent-gold/70 bg-accent-gold/5' : 'border-bg-border hover:border-accent-gold/50'
          }`}
        >
          <span className="text-text-muted text-xs group-hover:text-text-secondary transition-colors">
            {emptyLabel}
          </span>
          <span className="text-text-muted text-[10px] mt-0.5">MP4 · MOV · WEBM · max 100 MB</span>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </label>
        {error && <p className="text-accent-red text-[11px] mt-2">{error}</p>}
      </div>
    );
  }

  // ---------- loading state ----------
  if (loading) {
    return (
      <div className={`${className} h-28 flex flex-col items-center justify-center border border-dashed border-bg-border rounded-md`}>
        <div className="flex items-center gap-2 text-text-secondary text-xs">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-accent-gold border-t-transparent animate-spin" />
          Analyzing {fileName ? `"${fileName}"` : 'video'}…
        </div>
        <p className="text-text-muted text-[10px] mt-1 text-center max-w-xs">
          Upload → Google transcoding → Gemini analysis. Short clips (&lt;30s) take ~15s.
          Longer videos (1-2 min) can take 1-3 min. Cap at 5 min.
        </p>
      </div>
    );
  }

  // ---------- analyzed state ----------
  return (
    <div className={className}>
      <div className="border border-bg-border rounded-md overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-bg-elev">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-accent-green text-xs">●</span>
            <span className="text-text-primary text-xs truncate">
              {fileName || 'Reference video analyzed'}
            </span>
            {analysis && (
              <span className="text-text-muted text-[10px] shrink-0">
                {analysis.duration}s · {analysis.shots?.length ?? 0} shots
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-text-muted hover:text-text-secondary text-[11px]"
            >
              {open ? 'Hide details' : 'Show details'}
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-text-muted hover:text-accent-red text-[11px]"
              title="Remove this video"
            >
              ✕
            </button>
          </div>
        </div>

        {open && analysis && (
          <div className="px-3 py-3 text-[11px] text-text-secondary space-y-3 max-h-80 overflow-y-auto">
            <Section label="Format">{analysis.format}</Section>
            <Section label="Hook">
              <span className="text-text-muted">{analysis.hook.timing} — </span>
              {analysis.hook.stopScrollMechanism}
              <div className="text-text-muted mt-0.5">Visual: {analysis.hook.visual}</div>
              <div className="text-text-muted">Audio: {analysis.hook.audio}</div>
            </Section>
            <Section label="Voice-over (verbatim)">
              <p className="whitespace-pre-wrap">{analysis.voiceOverFull}</p>
            </Section>
            <Section label="Pacing & music">
              {analysis.pacing}
              <div className="text-text-muted mt-0.5">{analysis.music}</div>
            </Section>
            <Section label="CTA">
              <span className="text-text-muted">{analysis.cta.timing} · {analysis.cta.type} — </span>
              &ldquo;{analysis.cta.text}&rdquo;
            </Section>
            <Section label="Auto-tagged axes">
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {Object.entries(analysis.axes).map(([k, v]) => (
                  <div key={k} className="truncate">
                    <span className="text-text-muted">{k}:</span> {v}
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>
      {error && <p className="text-accent-red text-[11px] mt-2">{error}</p>}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-text-muted text-[10px] uppercase tracking-wide mb-0.5">{label}</div>
      <div>{children}</div>
    </div>
  );
}
