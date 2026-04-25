'use client';

import { useRef, useState } from 'react';

export interface RefImage {
  base64: string;
  mimeType: string;
  previewDataUri: string;
  name?: string;
}

interface Props {
  images: RefImage[];
  onChange: (images: RefImage[]) => void;
  /** Optional cap. Defaults to 8. */
  max?: number;
  /** Label shown when empty. */
  emptyLabel?: string;
  /** Compact = smaller upload zone (used in nested per-prompt areas). */
  compact?: boolean;
  className?: string;
}

const ACCEPT = 'image/jpeg,image/png,image/webp';

function readFileAsRefImage(file: File): Promise<RefImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUri = ev.target?.result as string;
      const comma = dataUri.indexOf(',');
      resolve({
        base64: dataUri.slice(comma + 1),
        mimeType: file.type,
        previewDataUri: dataUri,
        name: file.name,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function MultiImageInput({
  images,
  onChange,
  max = 8,
  emptyLabel = '↑ Upload photo(s)',
  compact = false,
  className = '',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = Math.max(0, max - images.length);
    // Filter to images only (drops can carry anything).
    const incoming = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, room);
    if (incoming.length === 0) return;
    const next = await Promise.all(incoming.map(readFileAsRefImage));
    onChange([...images, ...next]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeAt = (idx: number) => {
    onChange(images.filter((_, i) => i !== idx));
  };

  const canAddMore = images.length < max;

  return (
    <div className={className}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {images.map((img, idx) => (
            <div key={idx} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.previewDataUri}
                alt={img.name || `ref-${idx + 1}`}
                className={`${compact ? 'h-20' : 'h-24'} rounded-md border border-bg-border object-cover`}
              />
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="absolute top-1 right-1 bg-bg-base/90 text-text-muted text-[10px] px-1.5 py-0.5 rounded hover:text-accent-red"
                title="Remove this image"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {canAddMore && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center justify-center ${
            compact ? 'h-20' : 'h-24'
          } border border-dashed rounded-md cursor-pointer transition-colors group ${
            dragOver
              ? 'border-accent-gold/70 bg-accent-gold/5'
              : 'border-bg-border hover:border-accent-gold/50'
          }`}
        >
          <span className="text-text-muted text-xs group-hover:text-text-secondary transition-colors">
            {images.length === 0 ? emptyLabel : `↑ Add another (${images.length}/${max})`}
          </span>
          <span className="text-text-muted text-[10px] mt-0.5">JPG · PNG · WEBP</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            accept={ACCEPT}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      )}

      {!canAddMore && (
        <p className="text-text-muted text-[10px]">Max {max} images. Remove one to add another.</p>
      )}
    </div>
  );
}
