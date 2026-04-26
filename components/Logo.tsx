// Creative Suite logo — tech-premium mark (Linear / Vercel / Arc vibe).
//
// Layered geometry rendered as solid SVG shapes (no <mask> — masks fail
// silently in some browsers and behind some CDN caches, leaving an empty
// box). The plate is a violet → fuchsia gradient. The "C" is a white
// stroked arc with a notch on the right, plus a small horizontal accent
// bar (circuit-trace cue) and a spark dot (creative cue).
//
// All inline SVG, no raster. Pass `noGlow` to disable the halo.
//
// Usage:
//   <Logo />              // default 32px
//   <Logo size={48} />    // hero placement
//   <Logo size={20} />    // compact mobile bar

interface LogoProps {
  size?: number;
  /** Tailwind class hooks for layout (margin, transform, etc). */
  className?: string;
  /** Disable the soft glow halo (useful inside dense lists / favicons). */
  noGlow?: boolean;
}

export default function Logo({ size = 32, className = '', noGlow = false }: LogoProps) {
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
        {/* Plate gradient — top-left violet → bottom-right fuchsia. */}
        <linearGradient id="cs-plate" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="55%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#D946EF" />
        </linearGradient>

        {/* Top inner highlight overlay — adds depth. */}
        <linearGradient id="cs-shine" x1="0" y1="0" x2="0" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.28" />
          <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Plate. */}
      <rect x="0" y="0" width="40" height="40" rx="10" fill="url(#cs-plate)" />

      {/* Top shine overlay. */}
      <rect x="0" y="0" width="40" height="40" rx="10" fill="url(#cs-shine)" />

      {/* The C — white stroked arc, opens to the right.
          Built as a path for a clean half-open shape (no notch hack). */}
      <path
        d="M 27 13 A 9 9 0 1 0 27 27"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.6"
        strokeLinecap="round"
      />

      {/* Tech accent — small horizontal circuit-trace bar at the C's mouth. */}
      <rect x="26" y="19.1" width="6" height="1.8" rx="0.9" fill="#FFFFFF" opacity="0.9" />

      {/* Spark dot — top-right corner. */}
      <circle cx="32.2" cy="8" r="2" fill="#FFFFFF" />

      {/* Hairline border — defines the edge on dark backgrounds. */}
      <rect
        x="0.5"
        y="0.5"
        width="39"
        height="39"
        rx="9.5"
        fill="none"
        stroke="rgba(255,255,255,0.10)"
        strokeWidth="1"
      />
    </svg>
  );
}
