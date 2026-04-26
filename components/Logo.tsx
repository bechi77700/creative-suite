// Creative Suite logo — Shopify-style monochrome mark.
//
// A rounded-square violet container with a negative-space "C" cut out and
// a small spark dot in the top-right corner (the "creative" cue).
// Single inline SVG so it scales cleanly at any size and inherits theme
// tokens via currentColor — no PNG/raster, no extra HTTP roundtrip.
//
// Usage:
//   <Logo />              // default 28×28 (matches old logo-mark size)
//   <Logo size={40} />    // larger hero placement
//   <Logo size={20} />    // compact mobile bar
//
// The mark itself is the violet plate — text label stays a separate <span>
// next to it (handled by the caller), so we don't bundle "Creative Suite"
// inside the SVG.

interface LogoProps {
  size?: number;
  /** Tailwind class hooks for layout (margin, etc). */
  className?: string;
  /** Disable the soft glow halo (useful inside dense lists / favicons). */
  noGlow?: boolean;
}

export default function Logo({ size = 28, className = '', noGlow = false }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Creative Suite"
      className={`${noGlow ? '' : 'drop-shadow-[0_0_10px_rgba(168,85,247,0.55)]'} ${className}`}
    >
      <defs>
        {/* Mask carves the C and the spark hole out of the violet plate. */}
        <mask id="cs-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          {/* White = visible plate. */}
          <rect x="0" y="0" width="32" height="32" rx="8" fill="white" />

          {/* Negative-space "C" — outer ring then mouth notch. */}
          {/* Outer ring: stroke a circle with thick line so the inside is hollow. */}
          <circle cx="16" cy="16" r="7.5" fill="none" stroke="black" strokeWidth="3.2" />
          {/* Mouth notch — wedge cut on the right that opens the C. */}
          <rect x="17.5" y="13.5" width="6" height="5" fill="black" />

          {/* Spark dot — tiny circle top-right, the "creative" cue. */}
          <circle cx="25.5" cy="6.5" r="1.6" fill="black" />
        </mask>
      </defs>

      {/* Violet rounded-square plate — masked to reveal the C + spark. */}
      <rect x="0" y="0" width="32" height="32" rx="8" fill="#A855F7" mask="url(#cs-cut)" />
    </svg>
  );
}
