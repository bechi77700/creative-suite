import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Creative Suite — Meta Ads Generator',
  description: 'Creative brief and script generator for e-commerce brands running Meta Ads cold traffic',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
