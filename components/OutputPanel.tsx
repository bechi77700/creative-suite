'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface OutputPanelProps {
  output: string;
  generationId?: string;
  onVariations?: (id: string) => void;
  isWinner?: boolean;
  onToggleWinner?: (id: string) => void;
}

export default function OutputPanel({
  output,
  generationId,
  onVariations,
  isWinner,
  onToggleWinner,
}: OutputPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="card flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
        <span className="text-text-muted text-xs uppercase tracking-widest font-medium">Output</span>
        <div className="flex items-center gap-2">
          {generationId && onToggleWinner && (
            <button
              onClick={() => onToggleWinner(generationId)}
              className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                isWinner
                  ? 'bg-accent-gold/20 border-accent-gold/60 text-accent-gold'
                  : 'bg-transparent border-bg-border text-text-muted hover:border-accent-gold/40 hover:text-accent-gold'
              }`}
            >
              {isWinner ? '★ Winner' : '☆ Mark Winner'}
            </button>
          )}
          {generationId && onVariations && (
            <button
              onClick={() => onVariations(generationId)}
              className="btn-secondary text-xs px-3 py-1"
            >
              5 Variations
            </button>
          )}
          <button onClick={handleCopy} className="btn-secondary text-xs px-3 py-1">
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="result-content prose prose-invert max-w-none">
          <ReactMarkdown>{output}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
