import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cow→Mana | IoT Livestock Management',
  description: 'IoT-based cow tracking and management system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
