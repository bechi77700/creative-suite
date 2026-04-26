import { ImageResponse } from 'next/og';

// Next.js App Router file convention: this generates the favicon at build
// time. Mirrors components/Logo.tsx — violet → fuchsia gradient plate
// with a bold "C" so the browser tab matches the in-app sidebar mark.
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
          background: 'linear-gradient(135deg, #A855F7 0%, #8B5CF6 55%, #D946EF 100%)',
          borderRadius: 7,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#FFFFFF',
          fontSize: 22,
          fontWeight: 800,
          fontFamily: 'system-ui, sans-serif',
          letterSpacing: '-0.06em',
        }}
      >
        C
      </div>
    ),
    { ...size },
  );
}
