'use client';

import { useEffect, useState, useMemo, useRef } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  avatar: string | null;
  role: 'Admin' | 'User';
  status: 'Active' | 'Inactive';
  created_at: string;
}

type ModalState =
  | { type: 'none' }
  | { type: 'view'; user: User }
  | { type: 'edit'; user: User }
  | { type: 'add' }
  | { type: 'confirm-toggle'; user: User }
  | { type: 'confirm-delete'; user: User };

interface Toast {
  id: number;
  kind: 'success' | 'danger';
  message: string;
}

const emptyForm = {
  name: '', username: '', email: '', phone: '',
  role: 'User' as 'Admin' | 'User', avatar: '',
  currentPassword: '', newPassword: '', confirmPassword: '',
};

const AVATAR_COLORS = ['#696cff', '#03c3ec', '#71dd37', '#ffab00', '#ff3e1d', '#20c997'];

function avatarBg(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function Avatar({ user, size = 36 }: { user: User; size?: number }) {
  if (user.avatar) {
    return (
      <img src={user.avatar} alt={user.name} className="rounded-circle"
        style={{ width: size, height: size, objectFit: 'cover', flexShrink: 0 }} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: avatarBg(user.name), color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 600, flexShrink: 0,
    }}>
      {initials(user.name)}
    </div>
  );
}

function PreviewAvatar({ avatar, name, size = 72 }: { avatar: string; name: string; size?: number }) {
  if (avatar) {
    return (
      <img src={avatar} alt="preview" className="rounded-circle"
        style={{ width: size, height: size, objectFit: 'cover' }} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: name ? avatarBg(name) : '#696cff', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 600,
    }}>
      {name ? initials(name) : '?'}
    </div>
  );
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const size = 80;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = reject;
      img.src = ev.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getToken() {
  return localStorage.getItem('token') ?? sessionStorage.getItem('token') ?? '';
}

export default function UsersClient() {
  const [users, setUsers]           = useState<User[]>([]);
  const [loading, setLoading]       = useState(true);
  const [modal, setModal]           = useState<ModalState>({ type: 'none' });
  const [form, setForm]             = useState(emptyForm);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');
  const [search, setSearch]         = useState('');
  const [filterRole, setFilterRole]     = useState<'All' | 'Admin' | 'User'>('All');
  const [filterStatus, setFilterStatus] = useState<'All' | 'Active' | 'Inactive'>('All');
  const [toasts, setToasts]         = useState<Toast[]>([]);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const fileInputRef                = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/users`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) setUsers(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function addToast(kind: Toast['kind'], message: string) {
    const id = Date.now();
    setToasts(prev => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }

  const filtered = useMemo(() => users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      u.name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q);
    return matchSearch &&
      (filterRole === 'All' || u.role === filterRole) &&
      (filterStatus === 'All' || u.status === filterStatus);
  }), [users, search, filterRole, filterStatus]);

  const stats = useMemo(() => ({
    total:    users.length,
    admins:   users.filter(u => u.role === 'Admin').length,
    active:   users.filter(u => u.status === 'Active').length,
    inactive: users.filter(u => u.status === 'Inactive').length,
  }), [users]);

  function openAdd() {
    setForm(emptyForm);
    setFormError('');
    setModal({ type: 'add' });
  }

  function openEdit(user: User) {
    setForm({
      name: user.name, username: user.username, email: user.email,
      phone: user.phone ?? '',
      role: user.role, avatar: user.avatar ?? '',
      currentPassword: '', newPassword: '', confirmPassword: '',
    });
    setFormError('');
    setModal({ type: 'edit', user });
  }

  function closeModal() { setModal({ type: 'none' }); }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setFormError('Image must be smaller than 3 MB.');
      e.target.value = '';
      return;
    }
    try {
      const compressed = await compressImage(file);
      setForm(f => ({ ...f, avatar: compressed }));
    } catch {
      setFormError('Failed to process image.');
    }
    e.target.value = '';
  }

  async function handleSave() {
    setSaving(true);
    setFormError('');
    try {
      let res: Response;

      if (modal.type === 'add') {
        if (!form.name || !form.username || !form.email || !form.newPassword) {
          setFormError('Name, username, email and password are required.');
          return;
        }
        if (form.newPassword !== form.confirmPassword) {
          setFormError('Passwords do not match.');
          return;
        }
        if (form.newPassword.length < 8) {
          setFormError('Password must be at least 8 characters.');
          return;
        }
        res = await fetch(`${API}/api/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({
            name: form.name, username: form.username, email: form.email,
            phone: form.phone || null,
            password: form.newPassword, role: form.role, avatar: form.avatar || null,
          }),
        });

      } else if (modal.type === 'edit') {
        if (!form.name || !form.username || !form.email) {
          setFormError('Name, username and email are required.');
          return;
        }
        const changingPassword = form.currentPassword || form.newPassword || form.confirmPassword;
        if (changingPassword) {
          if (!form.currentPassword) { setFormError('Current password is required.'); return; }
          if (!form.newPassword)     { setFormError('New password is required.'); return; }
          if (form.newPassword.length < 8) { setFormError('New password must be at least 8 characters.'); return; }
          if (form.newPassword !== form.confirmPassword) { setFormError('New passwords do not match.'); return; }
        }
        const body: Record<string, unknown> = {
          name: form.name, username: form.username,
          email: form.email, phone: form.phone || null,
          role: form.role, avatar: form.avatar || null,
        };
        if (changingPassword) {
          body.password = form.newPassword;
          body.currentPassword = form.currentPassword;
        }
        res = await fetch(`${API}/api/users/${modal.user.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify(body),
        });

      } else {
        return;
      }

      if (!res.ok) {
        const d = await res.json();
        setFormError(d.error ?? 'An error occurred.');
        return;
      }
      closeModal();
      addToast('success', modal.type === 'add' ? 'User created successfully.' : 'User updated successfully.');
      load();
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (modal.type !== 'confirm-delete') return;
    const user = modal.user;
    setDeletingId(user.id);
    closeModal();
    try {
      const res = await fetch(`${API}/api/users/${user.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        addToast('success', `User "${user.name}" deleted successfully.`);
        load();
      } else {
        const d = await res.json().catch(() => ({ error: 'Delete failed.' }));
        addToast('danger', d.error ?? 'Delete failed.');
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function confirmToggle() {
    if (modal.type !== 'confirm-toggle') return;
    const user = modal.user;
    const next = user.status === 'Active' ? 'Inactive' : 'Active';
    setTogglingId(user.id);
    closeModal();
    try {
      const res = await fetch(`${API}/api/users/${user.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        addToast('success', `User ${next === 'Active' ? 'activated' : 'deactivated'} successfully.`);
        load();
      } else {
        addToast('danger', 'Failed to update user status.');
      }
    } finally {
      setTogglingId(null);
    }
  }

  const isModalOpen = modal.type !== 'none';
  const hasFilters  = search || filterRole !== 'All' || filterStatus !== 'All';

  return (
    <>
      {/* ── Toast notifications ── */}
      <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8 }}>
        {toasts.map(t => (
          <div key={t.id}
            className={`alert alert-${t.kind} d-flex align-items-center gap-2 shadow py-2 px-3 mb-0`}
            style={{ minWidth: 280, fontSize: 13 }}>
            <i className={`ri ${t.kind === 'success' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} flex-shrink-0`}></i>
            {t.message}
          </div>
        ))}
      </div>

      {/* ── Page header ── */}
      <div className="mb-4">
        <h4 className="mb-1 fw-semibold">User Management</h4>
        <p className="mb-0 text-body-secondary small">Manage system users, roles and access levels</p>
      </div>

      {/* ── Summary cards ── */}
      <div className="row g-4 mb-4">
        {[
          { label: 'Total Users',    value: stats.total,    icon: 'ri-team-line',          color: 'primary' },
          { label: 'Administrators', value: stats.admins,   icon: 'ri-shield-user-line',   color: 'warning' },
          { label: 'Active Users',   value: stats.active,   icon: 'ri-user-follow-line',   color: 'success' },
          { label: 'Inactive Users', value: stats.inactive, icon: 'ri-user-unfollow-line', color: 'danger'  },
        ].map(card => (
          <div key={card.label} className="col-sm-6 col-xl-3">
            <div className="card h-100">
              <div className="card-body d-flex align-items-center gap-3">
                <div className="avatar flex-shrink-0">
                  <span className={`avatar-initial rounded-circle bg-label-${card.color}`}>
                    <i className={`ri ${card.icon}`}></i>
                  </span>
                </div>
                <div>
                  <div className="fs-3 fw-bold lh-1 mb-1">{loading ? '—' : card.value}</div>
                  <small className="text-body-secondary">{card.label}</small>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Users table card ── */}
      <div className="card">
        <div className="card-header border-bottom">
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
            <h5 className="card-title mb-0">List of Users</h5>
            <button className="btn btn-sm btn-primary" onClick={openAdd}>
              <i className="ri ri-user-add-line me-1"></i>Add New User
            </button>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <div className="input-group input-group-sm flex-grow-1" style={{ maxWidth: 260 }}>
              <span className="input-group-text border-end-0 bg-transparent pe-1">
                <i className="ri ri-search-line text-body-secondary"></i>
              </span>
              <input type="text" className="form-control border-start-0 ps-0"
                placeholder="Search name, username or email…"
                value={search} onChange={e => setSearch(e.target.value)} />
              {search && (
                <button className="btn btn-sm btn-outline-secondary border-0 px-2" onClick={() => setSearch('')}>
                  <i className="ri ri-close-line"></i>
                </button>
              )}
            </div>
            <select className="form-select form-select-sm" style={{ width: 130 }}
              value={filterRole} onChange={e => setFilterRole(e.target.value as typeof filterRole)}>
              <option value="All">All Roles</option>
              <option value="Admin">Admin</option>
              <option value="User">User</option>
            </select>
            <select className="form-select form-select-sm" style={{ width: 140 }}
              value={filterStatus} onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}>
              <option value="All">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
            {hasFilters && (
              <button className="btn btn-sm btn-outline-secondary"
                onClick={() => { setSearch(''); setFilterRole('All'); setFilterStatus('All'); }}>
                <i className="ri ri-filter-off-line me-1"></i>Clear
              </button>
            )}
          </div>
        </div>

        <div className="table-responsive">
          {loading ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary mb-2" style={{ width: 28, height: 28 }}></div>
              <p className="text-body-secondary small mb-0">Loading users…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-5">
              <i className="ri ri-user-search-line text-body-secondary" style={{ fontSize: 40 }}></i>
              <p className="text-body-secondary small mt-2 mb-0">
                {users.length === 0 ? 'No users found.' : 'No users match the current filters.'}
              </p>
            </div>
          ) : (
            <table className="table table-hover mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th className="ps-4" style={{ width: '25%' }}>User</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th className="text-center" style={{ width: 155 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id}>
                    <td className="ps-4">
                      <div className="d-flex align-items-center gap-3">
                        <Avatar user={u} />
                        <div>
                          <div className="fw-medium lh-1 mb-1">{u.name}</div>
                          <small className="text-body-secondary">@{u.username}</small>
                        </div>
                      </div>
                    </td>
                    <td><small className="text-body-secondary">{u.email}</small></td>
                    <td><small className="text-body-secondary">{u.phone ?? '—'}</small></td>
                    <td>
                      <span className={`badge rounded-pill ${u.role === 'Admin' ? 'bg-label-primary' : 'bg-label-secondary'}`}>
                        <i className={`ri ${u.role === 'Admin' ? 'ri-shield-user-line' : 'ri-user-line'} me-1`} style={{ fontSize: 10 }}></i>
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <span className={`badge rounded-pill ${u.status === 'Active' ? 'bg-label-success' : 'bg-label-danger'}`}>
                        <i className={`ri ${u.status === 'Active' ? 'ri-radio-button-line' : 'ri-forbid-2-line'} me-1`} style={{ fontSize: 10 }}></i>
                        {u.status}
                      </span>
                    </td>
                    <td>
                      <small className="text-body-secondary">
                        {new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </small>
                    </td>
                    <td>
                      <div className="d-flex gap-1 justify-content-center">
                        <button className="btn btn-sm btn-icon btn-outline-secondary border-0"
                          title="View Profile" onClick={() => setModal({ type: 'view', user: u })}>
                          <i className="ri ri-eye-line"></i>
                        </button>
                        <button className="btn btn-sm btn-icon btn-outline-primary border-0"
                          title="Edit Profile" onClick={() => openEdit(u)}>
                          <i className="ri ri-pencil-line"></i>
                        </button>
                        <button
                          className={`btn btn-sm btn-icon border-0 ${u.status === 'Active' ? 'btn-outline-danger' : 'btn-outline-success'}`}
                          title={u.status === 'Active' ? 'Deactivate User' : 'Activate User'}
                          onClick={() => setModal({ type: 'confirm-toggle', user: u })}
                          disabled={togglingId === u.id}>
                          {togglingId === u.id
                            ? <span className="spinner-border spinner-border-sm"></span>
                            : <i className={`ri ${u.status === 'Active' ? 'ri-user-unfollow-line' : 'ri-user-follow-line'}`}></i>
                          }
                        </button>
                        <button
                          className="btn btn-sm btn-icon btn-outline-danger border-0"
                          title="Delete User"
                          onClick={() => setModal({ type: 'confirm-delete', user: u })}
                          disabled={deletingId === u.id}>
                          {deletingId === u.id
                            ? <span className="spinner-border spinner-border-sm"></span>
                            : <i className="ri ri-delete-bin-line"></i>
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && filtered.length > 0 && (
          <div className="card-footer border-top py-3">
            <small className="text-body-secondary">
              Showing <strong>{filtered.length}</strong> of <strong>{users.length}</strong> users
              {hasFilters && <span> (filtered)</span>}
            </small>
          </div>
        )}
      </div>

      {/* ── Backdrop ── */}
      {isModalOpen && (
        <div className="modal-backdrop fade show" onClick={closeModal}></div>
      )}

      {/* ── View Profile Modal ── */}
      {modal.type === 'view' && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">User Profile</h5>
                <button className="btn-close" onClick={closeModal}></button>
              </div>
              <div className="modal-body px-4 py-4">

                {/* Profile picture — centred */}
                <div className="d-flex justify-content-center mb-3">
                  <Avatar user={modal.user} size={90} />
                </div>

                {/* Identity */}
                <div className="text-center mb-4">
                  <h5 className="fw-semibold mb-1">{modal.user.name}</h5>
                  <p className="text-muted small mb-2">@{modal.user.username}</p>
                  <div className="d-flex justify-content-center gap-2">
                    <span className={`badge rounded-pill ${modal.user.role === 'Admin' ? 'bg-label-primary' : 'bg-label-secondary'}`}>
                      {modal.user.role}
                    </span>
                    <span className={`badge rounded-pill ${modal.user.status === 'Active' ? 'bg-label-success' : 'bg-label-danger'}`}>
                      {modal.user.status}
                    </span>
                  </div>
                </div>

                <hr className="my-3" />

                <div className="row g-2">
                  <div className="col-12 d-flex justify-content-between">
                    <span className="text-muted small">Username</span>
                    <span className="small fw-semibold">@{modal.user.username}</span>
                  </div>
                  <div className="col-12 d-flex justify-content-between">
                    <span className="text-muted small">Email</span>
                    <span className="small fw-semibold">{modal.user.email}</span>
                  </div>
                  <div className="col-12 d-flex justify-content-between">
                    <span className="text-muted small">Phone</span>
                    <span className="small fw-semibold">{modal.user.phone ?? '—'}</span>
                  </div>
                  <div className="col-12 d-flex justify-content-between">
                    <span className="text-muted small">Joined</span>
                    <span className="small fw-semibold">
                      {new Date(modal.user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-sm btn-outline-secondary" onClick={closeModal}>Close</button>
                <button className="btn btn-sm btn-primary" onClick={() => openEdit(modal.user)}>
                  <i className="ri ri-pencil-line me-1"></i>Edit Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Modal ── */}
      {(modal.type === 'add' || modal.type === 'edit') && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className={`ri ${modal.type === 'add' ? 'ri-user-add-line' : 'ri-user-settings-line'} me-2 text-primary`}></i>
                  {modal.type === 'add' ? 'Add New User' : 'Edit User'}
                </h5>
                <button className="btn-close" onClick={closeModal} disabled={saving}></button>
              </div>

              <div className="modal-body px-4 py-4">
                {formError && (
                  <div className="alert alert-danger d-flex align-items-center gap-2 py-2 small mb-4">
                    <i className="ri ri-error-warning-line flex-shrink-0"></i>{formError}
                  </div>
                )}

                {/* ── Profile picture upload ── */}
                <div className="d-flex justify-content-center mb-4">
                  <div className="text-center">
                    <div className="position-relative d-inline-block mb-2">
                      <PreviewAvatar avatar={form.avatar} name={form.name} size={90} />
                      <button
                        type="button"
                        className="btn btn-sm btn-primary rounded-circle position-absolute"
                        style={{ width: 28, height: 28, padding: 0, bottom: 0, right: 0 }}
                        onClick={() => fileInputRef.current?.click()}
                        title="Upload photo"
                      >
                        <i className="ri ri-camera-line" style={{ fontSize: 13 }}></i>
                      </button>
                    </div>
                    <div className="d-flex gap-2 justify-content-center">
                      <button type="button" className="btn btn-sm btn-outline-primary"
                        onClick={() => fileInputRef.current?.click()}>
                        <i className="ri ri-upload-2-line me-1"></i>Upload Photo
                      </button>
                      {form.avatar && (
                        <button type="button" className="btn btn-sm btn-outline-danger"
                          onClick={() => setForm(f => ({ ...f, avatar: '' }))}>
                          <i className="ri ri-delete-bin-line me-1"></i>Remove
                        </button>
                      )}
                    </div>
                    <p className="text-muted small mt-1 mb-0">JPG or PNG, max 3 MB</p>
                    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp"
                      className="d-none" onChange={handleFileUpload} />
                  </div>
                </div>

                {/* ── Basic info ── */}
                <div className="row g-3 mb-4">
                  <div className="col-12">
                    <label className="form-label small fw-medium mb-1">Full Name <span className="text-danger">*</span></label>
                    <input className="form-control form-control-sm" placeholder="e.g. John Doe"
                      value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="col-sm-6">
                    <label className="form-label small fw-medium mb-1">Username <span className="text-danger">*</span></label>
                    <input className="form-control form-control-sm" placeholder="e.g. johndoe"
                      value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
                  </div>
                  <div className="col-sm-6">
                    <label className="form-label small fw-medium mb-1">Role</label>
                    <select className="form-select form-select-sm" value={form.role}
                      onChange={e => setForm(f => ({ ...f, role: e.target.value as 'Admin' | 'User' }))}>
                      <option value="User">User</option>
                      <option value="Admin">Admin</option>
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium mb-1">Email <span className="text-danger">*</span></label>
                    <input type="email" className="form-control form-control-sm" placeholder="e.g. john@example.com"
                      value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium mb-1">
                      Phone <span className="text-body-secondary fw-normal">(optional)</span>
                    </label>
                    <input type="tel" className="form-control form-control-sm" placeholder="e.g. +60123456789"
                      value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                  </div>
                </div>

                {/* ── Password section ── */}
                <div className="border rounded p-3">
                  <p className="small fw-semibold mb-3 d-flex align-items-center gap-2">
                    <i className="ri ri-lock-password-line text-primary"></i>
                    {modal.type === 'add' ? 'Set Password' : 'Change Password'}
                    {modal.type === 'edit' && <span className="text-muted fw-normal">(leave blank to keep current)</span>}
                  </p>
                  <div className="row g-3">
                    {modal.type === 'edit' && (
                      <div className="col-12">
                        <label className="form-label small fw-medium mb-1">Current Password</label>
                        <input type="password" className="form-control form-control-sm"
                          placeholder="Enter current password"
                          value={form.currentPassword}
                          onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))} />
                      </div>
                    )}
                    <div className="col-sm-6">
                      <label className="form-label small fw-medium mb-1">
                        {modal.type === 'add' ? <>Password <span className="text-danger">*</span></> : 'New Password'}
                      </label>
                      <input type="password" className="form-control form-control-sm"
                        placeholder="Min. 8 characters"
                        value={form.newPassword}
                        onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))} />
                    </div>
                    <div className="col-sm-6">
                      <label className="form-label small fw-medium mb-1">
                        {modal.type === 'add' ? <>Confirm Password <span className="text-danger">*</span></> : 'Confirm New Password'}
                      </label>
                      <input type="password" className="form-control form-control-sm"
                        placeholder="Re-enter password"
                        value={form.confirmPassword}
                        onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button className="btn btn-sm btn-outline-secondary" onClick={closeModal} disabled={saving}>Cancel</button>
                <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>
                  {saving && <span className="spinner-border spinner-border-sm me-1"></span>}
                  {modal.type === 'add' ? 'Create User' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Delete Modal ── */}
      {modal.type === 'confirm-delete' && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm">
            <div className="modal-content">
              <div className="modal-body text-center py-4 px-4">
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3 bg-label-danger"
                  style={{ width: 56, height: 56, fontSize: 26 }}>
                  <i className="ri ri-delete-bin-line"></i>
                </span>
                <h6 className="fw-semibold mb-1">Delete User?</h6>
                <p className="text-body-secondary small mb-0">
                  <strong>{modal.user.name}</strong> will be permanently removed. This action cannot be undone.
                </p>
              </div>
              <div className="modal-footer border-0 pt-0 justify-content-center gap-2 pb-4">
                <button className="btn btn-sm btn-outline-secondary" onClick={closeModal}>Cancel</button>
                <button className="btn btn-sm btn-danger" onClick={confirmDelete}>
                  <i className="ri ri-delete-bin-line me-1"></i>Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Status Toggle Modal ── */}
      {modal.type === 'confirm-toggle' && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm">
            <div className="modal-content">
              <div className="modal-body text-center py-4 px-4">
                <span
                  className={`d-inline-flex align-items-center justify-content-center rounded-circle mb-3 ${modal.user.status === 'Active' ? 'bg-label-danger' : 'bg-label-success'}`}
                  style={{ width: 56, height: 56, fontSize: 26 }}>
                  <i className={`ri ${modal.user.status === 'Active' ? 'ri-user-unfollow-line' : 'ri-user-follow-line'}`}></i>
                </span>
                <h6 className="fw-semibold mb-1">
                  {modal.user.status === 'Active' ? 'Deactivate User?' : 'Activate User?'}
                </h6>
                <p className="text-body-secondary small mb-0">
                  {modal.user.status === 'Active'
                    ? <><strong>{modal.user.name}</strong> will lose system access.</>
                    : <><strong>{modal.user.name}</strong> will regain system access.</>
                  }
                </p>
              </div>
              <div className="modal-footer border-0 pt-0 justify-content-center gap-2 pb-4">
                <button className="btn btn-sm btn-outline-secondary" onClick={closeModal}>Cancel</button>
                <button className={`btn btn-sm ${modal.user.status === 'Active' ? 'btn-danger' : 'btn-success'}`}
                  onClick={confirmToggle}>
                  {modal.user.status === 'Active' ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
