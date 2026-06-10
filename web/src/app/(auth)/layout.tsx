export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Inter font — loaded from Google Fonts (same as Materio template) */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
        rel="stylesheet"
      />

      {/* All other assets served from project /public — no external CDN */}
      <link rel="stylesheet" href="/materio/fonts/iconify-icons.css" />
      <link rel="stylesheet" href="/materio/css/core.css" />
      <link rel="stylesheet" href="/materio/css/demo.css" />
      <link rel="stylesheet" href="/materio/css/page-auth.css" />
      <link rel="stylesheet" href="/materio/css/auth-overrides.css" />
      {children}
    </>
  );
}
