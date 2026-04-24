import type { Config } from 'tailwindcss';

// ─────────────────────────────────────────────────────────────────────────────
// Creative Suite — Trendtrack-inspired DA
// Pure black backgrounds, violet electric accent (#A855F7), Geist typography.
// Class names kept as `accent-gold` / `text-gold` to avoid touching every file
// — they now map to violet. Use `accent-violet` going forward.
// ─────────────────────────────────────────────────────────────────────────────

const ACCENT = '#A855F7';      // violet electric
const ACCENT_DIM = '#7C3AED';  // violet darker for hover

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#000000',     // pure black
          elevated: '#0A0A0A', // sidebar / surfaces
          card: '#0F0F0F',     // cards
          border: '#1F1F1F',   // hairline borders
          hover: '#171717',    // hover backgrounds
        },
        accent: {
          // Legacy "gold" tokens — now mapped to violet so existing pages
          // automatically get the new theme.
          gold: ACCENT,
          'gold-dim': ACCENT_DIM,
          // New canonical name
          violet: ACCENT,
          'violet-dim': ACCENT_DIM,
          blue: '#3B82F6',
          'blue-dim': '#1D4ED8',
          green: '#22C55E',
          red: '#EF4444',
          purple: '#8B5CF6',
        },
        text: {
          primary: '#FAFAFA',
          secondary: '#D4D4D8',
          muted: '#71717A',
          gold: ACCENT, // legacy alias
          violet: ACCENT,
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'JetBrains Mono', 'monospace'],
        display: ['var(--font-geist-sans)', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-violet': '0 0 24px -4px rgba(168, 85, 247, 0.55), 0 0 48px -8px rgba(168, 85, 247, 0.25)',
        'glow-violet-lg': '0 0 40px -4px rgba(168, 85, 247, 0.6), 0 0 80px -8px rgba(168, 85, 247, 0.3)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        shimmer: 'shimmer 2s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'glow-pulse': 'glowPulse 3s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 24px -4px rgba(168, 85, 247, 0.45)' },
          '50%': { boxShadow: '0 0 40px -4px rgba(168, 85, 247, 0.7)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
