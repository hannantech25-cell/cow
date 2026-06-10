import Script from 'next/script';
import DashboardShell from './DashboardShell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="/materio/fonts/iconify-icons.css" />
      <link rel="stylesheet" href="/materio/css/core.css" />
      <link rel="stylesheet" href="/materio/css/demo.css" />
      <link rel="stylesheet" href="/materio/css/node-waves.css" />
      <link rel="stylesheet" href="/materio/css/perfect-scrollbar.css" />
      <link rel="stylesheet" href="/materio/css/realtime-map.css" />
      <link rel="stylesheet" href="/materio/css/historical-location.css" />
      <DashboardShell>{children}</DashboardShell>
      <Script
        src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"
        strategy="afterInteractive"
      />
    </>
  );
}
