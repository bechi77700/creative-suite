import { ImageResponse } from 'next/og';

// Next.js App Router file convention: this generates the favicon at build
// time from the JSX below. Keep the same mark as components/Logo.tsx so the
// browser tab matches the in-app sidebar.
export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#A855F7',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#FFFFFF',
          fontSize: 22,
          fontWeight: 800,
          fontFamily: 'system-ui, sans-serif',
          letterSpacing: '-0.04em',
        }}
      >
        C
      </div>
    ),
    { ...size },
  );
}
