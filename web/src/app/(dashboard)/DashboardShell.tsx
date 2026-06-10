'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface NavItem {
  href?: string;
  icon: string;
  label: string;
  badge?: React.ReactNode;
  children?: NavItem[];
}

interface StoredUser {
  id: number;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  avatar: string | null;
  role: string;
}

interface FullProfile extends StoredUser {
  status: 'Active' | 'Inactive';
  created_at: string;
}

const navItems: NavItem[] = [
  {
    href: '/realtime-map',
    icon: 'ri-map-pin-line',
    label: 'Real-Time Location',
    badge: <span className="badge text-bg-success rounded-pill ms-auto">Live</span>,
  },
  { href: '/historical-location', icon: 'ri-history-line',   label: 'Historical Location' },
  { href: '/cows',                icon: 'ri-profile-line',     label: 'Cow' },
  { href: '/trackers', icon: 'ri-router-line',  label: 'Tracker' },
  { href: '/farms',               icon: 'ri-community-line',   label: 'Farm' },
  { href: '/users',    icon: 'ri-team-line',    label: 'User' },
];

const pageTitles: Record<string, string> = {
  '/realtime-map':        'Real-Time Map',
  '/historical-location': 'Historical Location',
  '/farms':               'Farm Management',
  '/cows':                'Cow Management',
  '/trackers':            'Tracker Management',
  '/users':               'User Management',
};

const AVATAR_COLORS = ['#696cff', '#03c3ec', '#71dd37', '#ffab00', '#ff3e1d', '#20c997'];
function avatarBg(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}
function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function UserAvatar({ user, size = 38 }: { user: StoredUser; size?: number }) {
  if (user.avatar) {
    return (
      <img src={user.avatar} alt={user.name} className="rounded-circle"
        style={{ width: size, height: size, objectFit: 'cover' }} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: avatarBg(user.name), color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 600, flexShrink: 0,
    }}>
      {initials(user.name)}
    </div>
  );
}

function getToken() {
  return localStorage.getItem('token') ?? sessionStorage.getItem('token') ?? '';
}

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen]     = useState(false);
  const [openGroups, setOpenGroups] = useState<string[]>(() => {
    const active = navItems.find(i => i.children?.some(c => c.href === pathname));
    return active ? [active.label] : [];
  });

  function toggleGroup(label: string) {
    setOpenGroups(prev => prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]);
  }
  const [user, setUser]             = useState<StoredUser | null>(null);
  const [profile, setProfile]       = useState<FullProfile | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token') ?? sessionStorage.getItem('token');
    if (!token) { router.replace('/login'); return; }
    const raw = localStorage.getItem('user') ?? sessionStorage.getItem('user');
    if (raw) setUser(JSON.parse(raw));
  }, [router]);

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    router.push('/login');
  }

  async function openProfile() {
    setShowProfile(true);
    if (profile) return;
    setProfileLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) setProfile(await res.json());
    } finally {
      setProfileLoading(false);
    }
  }

  const pageTitle = pageTitles[pathname] ?? 'Dashboard';

  return (
    <div className={`layout-wrapper layout-content-navbar layout-menu-fixed layout-compact${menuOpen ? ' layout-menu-expanded' : ''}`}>
      <div className="layout-container">

        {/* ── Sidebar ── */}
        <aside id="layout-menu" className="layout-menu menu-vertical menu bg-menu-theme">
          <div className="app-brand demo">
            <Link href="/realtime-map" className="app-brand-link">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/cow-mana.svg" alt="Cow→Mana" style={{ height: '40px', width: 'auto', filter: 'invert(1)' }} />
            </Link>
            <button
              className="layout-menu-toggle menu-link text-large ms-auto border-0 bg-transparent"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
            >
              <i className="menu-toggle-icon d-xl-inline-block align-middle"></i>
            </button>
          </div>

          <div className="menu-inner-shadow"></div>

          <ul className="menu-inner py-1">
            {navItems.map(item => {
              if (item.children) {
                const isOpen = openGroups.includes(item.label);
                const isChildActive = item.children.some(c => c.href === pathname);
                return (
                  <li key={item.label} className={`menu-item has-sub${isOpen || isChildActive ? ' open' : ''}`}>
                    <button
                      className="menu-link menu-toggle border-0 bg-transparent w-100 text-start"
                      onClick={() => toggleGroup(item.label)}
                    >
                      <i className={`menu-icon icon-base ri ${item.icon}`}></i>
                      <div>{item.label}</div>
                    </button>
                    <ul className="menu-sub">
                      {item.children.map(child => (
                        <li key={child.href} className={`menu-item${pathname === child.href ? ' active' : ''}`}>
                          <Link href={child.href!} className="menu-link" onClick={() => setMenuOpen(false)}>
                            <i className={`menu-icon icon-base ri ${child.icon}`}></i>
                            <div>{child.label}</div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              }
              return (
                <li key={item.href} className={`menu-item${pathname === item.href ? ' active' : ''}`}>
                  <Link href={item.href!} className="menu-link" onClick={() => setMenuOpen(false)}>
                    <i className={`menu-icon icon-base ri ${item.icon}`}></i>
                    <div>{item.label}</div>
                    {item.badge}
                  </Link>
                </li>
              );
            })}

            <li className="menu-header mt-4"></li>

            <li className="menu-item">
              <button className="menu-link border-0 bg-transparent w-100 text-start" onClick={handleLogout}>
                <i className="menu-icon icon-base ri ri-logout-box-r-line"></i>
                <div>Logout</div>
              </button>
            </li>
          </ul>
        </aside>
        {/* / Sidebar */}

        {/* ── Layout page ── */}
        <div className="layout-page">

          {/* Navbar */}
          <nav
            className="layout-navbar container-xxl navbar-detached navbar navbar-expand-xl align-items-center bg-navbar-theme"
            id="layout-navbar"
          >
            <div className="layout-menu-toggle navbar-nav align-items-xl-center me-4 me-xl-0 d-xl-none">
              <button
                className="nav-item nav-link px-0 me-xl-6 border-0 bg-transparent"
                onClick={() => setMenuOpen(true)}
                aria-label="Open menu"
              >
                <i className="icon-base ri ri-menu-line icon-md"></i>
              </button>
            </div>

            <div className="navbar-nav-right d-flex align-items-center justify-content-between w-100" id="navbar-collapse">
              <div className="d-flex align-items-center gap-2">
                <span className="text-body-secondary small">Cow→Mana</span>
                <i className="ri ri-arrow-right-s-line text-body-secondary"></i>
                <span className="fw-medium small">{pageTitle}</span>
              </div>

              <ul className="navbar-nav flex-row align-items-center ms-md-auto">
                {/* User dropdown — no notification bell */}
                <li className="nav-item navbar-dropdown dropdown-user dropdown">
                  <a className="nav-link dropdown-toggle hide-arrow p-0" href="#" data-bs-toggle="dropdown">
                    <div className="avatar avatar-online">
                      {user ? (
                        <UserAvatar user={user} size={38} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src="/materio/img/avatars/1.png" alt="user" className="rounded-circle" />
                      )}
                    </div>
                  </a>
                  <ul className="dropdown-menu dropdown-menu-end">
                    <li>
                      <a className="dropdown-item pe-none">
                        <div className="d-flex align-items-center gap-2">
                          <div className="flex-shrink-0">
                            <div className="avatar avatar-online">
                              {user ? (
                                <UserAvatar user={user} size={40} />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src="/materio/img/avatars/1.png" alt="user" className="w-px-40 h-auto rounded-circle" />
                              )}
                            </div>
                          </div>
                          <div className="flex-grow-1">
                            <h6 className="mb-0">{user?.name ?? '—'}</h6>
                            <small className="text-body-secondary">{user?.role ?? '—'}</small>
                          </div>
                        </div>
                      </a>
                    </li>
                    <li><div className="dropdown-divider my-1"></div></li>
                    <li>
                      <button className="dropdown-item w-100 text-start border-0 bg-transparent" onClick={openProfile}>
                        <i className="icon-base ri ri-user-line icon-md me-3"></i>
                        <span>My Profile</span>
                      </button>
                    </li>
                    <li><div className="dropdown-divider my-1"></div></li>
                    <li>
                      <div className="d-grid px-4 pt-2 pb-1">
                        <button
                          className="btn btn-sm d-flex align-items-center justify-content-center gap-2"
                          style={{ background: '#1C1C1C', color: '#fff' }}
                          onClick={handleLogout}
                        >
                          <i className="ri ri-logout-box-r-line ri-xs"></i>
                          <small>Logout</small>
                        </button>
                      </div>
                    </li>
                  </ul>
                </li>
              </ul>
            </div>
          </nav>
          {/* / Navbar */}

          {/* Content wrapper */}
          <div className="content-wrapper">
            <div className="container-xxl flex-grow-1 container-p-y">
              {children}
            </div>

            <footer className="content-footer footer bg-footer-theme">
              <div className="container-xxl">
                <div className="footer-container d-flex align-items-center justify-content-between py-4 flex-md-row flex-column">
                  <div className="mb-2 mb-md-0">
                    © 2025 <strong>Cow→Mana</strong> · IoT Livestock Tracking System
                  </div>
                  <div className="d-none d-lg-inline-block text-body-secondary small">
                    UTHM · Powered by MQTT + Leaflet.js + InfluxDB
                  </div>
                </div>
              </div>
            </footer>

            <div className="content-backdrop fade"></div>
          </div>
          {/* / Content wrapper */}

        </div>
        {/* / Layout page */}
      </div>

      {/* Mobile overlay */}
      <div
        className="layout-overlay layout-menu-toggle"
        onClick={() => setMenuOpen(false)}
      ></div>

      {/* ── My Profile Modal ── */}
      {showProfile && (
        <>
          <div className="modal-backdrop fade show" onClick={() => setShowProfile(false)}></div>
          <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">My Profile</h5>
                  <button className="btn-close" onClick={() => setShowProfile(false)}></button>
                </div>

                <div className="modal-body px-4 py-4">
                  {profileLoading ? (
                    <div className="text-center py-4">
                      <div className="spinner-border text-primary"></div>
                    </div>
                  ) : profile ? (
                    <>
                      {/* Avatar — centred */}
                      <div className="d-flex justify-content-center mb-3">
                        <UserAvatar user={profile} size={90} />
                      </div>

                      {/* Identity */}
                      <div className="text-center mb-4">
                        <h5 className="fw-semibold mb-1">{profile.name}</h5>
                        <p className="text-muted small mb-2">@{profile.username}</p>
                        <div className="d-flex justify-content-center gap-2">
                          <span className={`badge rounded-pill ${profile.role === 'Admin' ? 'bg-label-primary' : 'bg-label-secondary'}`}>
                            {profile.role}
                          </span>
                          <span className={`badge rounded-pill ${profile.status === 'Active' ? 'bg-label-success' : 'bg-label-danger'}`}>
                            {profile.status}
                          </span>
                        </div>
                      </div>

                      <hr className="my-3" />

                      <div className="row g-2">
                        <div className="col-12 d-flex justify-content-between">
                          <span className="text-muted small">Username</span>
                          <span className="small fw-semibold">@{profile.username}</span>
                        </div>
                        <div className="col-12 d-flex justify-content-between">
                          <span className="text-muted small">Email</span>
                          <span className="small fw-semibold">{profile.email}</span>
                        </div>
                        <div className="col-12 d-flex justify-content-between">
                          <span className="text-muted small">Phone</span>
                          <span className="small fw-semibold">{profile.phone ?? '—'}</span>
                        </div>
                        <div className="col-12 d-flex justify-content-between">
                          <span className="text-muted small">Joined</span>
                          <span className="small fw-semibold">
                            {new Date(profile.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-center text-muted small">Failed to load profile.</p>
                  )}
                </div>

                <div className="modal-footer">
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowProfile(false)}>Close</button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
