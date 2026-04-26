// Creative Suite logo — tech-premium mark (Linear / Vercel / Arc vibe).
//
// Layered geometry inside a rounded-square plate with a violet → fuchsia
// diagonal gradient. The "C" is formed by two thick concentric arcs that
// stop just short of meeting on the right (the signature notch). A
// horizontal accent bar bisects the lower arc — the "tech" line that
// reads as a chip / circuit cue. A small spark dot in the top-right
// corner keeps the "creative" wink.
//
// All inline SVG, no raster. Inherits no theme color (the gradient is
// the brand identity) — pass `noGlow` when you don't want the halo.
//
// Usage:
//   <Logo />              // default 32px
//   <Logo size={48} />    // hero placement
//   <Logo size={20} />    // compact mobile bar
//
// The mark itself is the plate — label "Creative Suite" stays a sibling
// <span>, handled by the caller. Keeps the SVG clean and language-free.

interface LogoProps {
  size?: number;
  /** Tailwind class hooks for layout (margin, transform, etc). */
  className?: string;
  /** Disable the soft glow halo (useful inside dense lists / favicons). */
  noGlow?: boolean;
}

export default function Logo({ size = 32, className = '', noGlow = false }: LogoProps) {
  // Stable id suffix per render — avoids cross-instance defs collisions
  // when multiple <Logo /> render on the same page.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Creative Suite"
      className={`${noGlow ? '' : 'drop-shadow-[0_0_14px_rgba(168,85,247,0.55)]'} ${className}`}
    >
      <defs>
        {/* Plate gradient — top-left violet, bottom-right fuchsia. */}
        <linearGradient id="cs-plate" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="55%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#D946EF" />
        </linearGradient>

        {/* Subtle inner highlight on the top edge — adds depth. */}
        <linearGradient id="cs-shine" x1="0" y1="0" x2="0" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.28" />
          <stop offset="40%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>

        {/* The C-mark mask — white = keep plate visible, black = cut through. */}
        <mask id="cs-mark" maskUnits="userSpaceOnUse" x="0" y="0" width="40" height="40">
          <rect x="0" y="0" width="40" height="40" rx="10" fill="white" />

          {/* Outer C ring — thick stroke, opens to the right. */}
          <circle cx="20" cy="20" r="9.2" fill="none" stroke="black" strokeWidth="3.6" />
          {/* Right-side notch that opens the C and gives it the sharp tech edge. */}
          <rect x="21.5" y="16.6" width="9" height="6.8" fill="black" />

          {/* Tech accent — horizontal bar slicing through the right of the C,
              reads as a circuit trace / chip pin. */}
          <rect x="24.5" y="19.2" width="6" height="1.8" rx="0.9" fill="black" />

          {/* Spark dot — top-right corner. */}
          <circle cx="32.2" cy="8" r="2" fill="black" />
        </mask>
      </defs>

      {/* Base plate with the gradient, masked by the C-mark. */}
      <rect x="0" y="0" width="40" height="40" rx="10" fill="url(#cs-plate)" mask="url(#cs-mark)" />

      {/* Top highlight overlay — applied after the mask so it only paints
          the visible plate area. Same mask reused for clean clipping. */}
      <rect x="0" y="0" width="40" height="40" rx="10" fill="url(#cs-shine)" mask="url(#cs-mark)" />

      {/* Hairline border — gives the mark a defined edge on dark backgrounds. */}
      <rect
        x="0.5"
        y="0.5"
        width="39"
        height="39"
        rx="9.5"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="1"
      />
    </svg>
  );
}
