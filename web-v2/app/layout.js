import './globals.css';

export const metadata = {
  title: 'FairShare — fair splits for groups',
  description: 'Snap a receipt, split it fairly by family & age, settle up.',
  manifest: '/manifest.webmanifest',
};

export const viewport = {
  themeColor: '#0f1024',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
