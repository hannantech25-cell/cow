'use client';

import { useEffect, useState, useMemo } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Tracker {
  id: number;
  board_id: string;
  mac_address: string;
  assigned_cow_id: number | null;
  cow_tag: string | null;
  cow_name: string | null;
  sleep_time_sec: number;
  battery_threshold: number;
  status: 'Active' | 'Inactive' | 'Maintenance';
  created_at: string;
}

type ModalState =
  | { type: 'none' }
  | { type: 'view';   tracker: Tracker }
  | { type: 'add' }
  | { type: 'edit';   tracker: Tracker }
  | { type: 'confirm-toggle';  tracker: Tracker }
  | { type: 'confirm-delete';  tracker: Tracker };

interface FormState {
  board_id: string;
  mac_address: string;
  sleep_time_sec: number;
  battery_threshold: number;
}

interface Toast {
  id: number;
  kind: 'success' | 'danger';
  message: string;
}

const emptyForm: FormState = {
  board_id: '', mac_address: '', sleep_time_sec: 300, battery_threshold: 20,
};

function getToken() {
  return localStorage.getItem('token') ?? sessionStorage.getItem('token') ?? '';
}

function StatusBadge({ status }: { status: Tracker['status'] }) {
  const map = {
    Active:      { cls: 'bg-label-success', icon: 'ri-radio-button-line' },
    Inactive:    { cls: 'bg-label-secondary', icon: 'ri-forbid-2-line' },
    Maintenance: { cls: 'bg-label-warning',  icon: 'ri-tools-line' },
  };
  const { cls, icon } = map[status];
  return (
    <span className={`badge rounded-pill ${cls}`}>
      <i className={`ri ${icon} me-1`} style={{ fontSize: 10 }}></i>
      {status}
    </span>
  );
}

export default function TrackersClient() {
  const [trackers, setTrackers]       = useState<Tracker[]>([]);
  const [loading, setLoading]         = useState(true);
  const [modal, setModal]             = useState<ModalState>({ type: 'none' });
  const [form, setForm]               = useState<FormState>(emptyForm);
  const [saving, setSaving]           = useState(false);
  const [formError, setFormError]     = useState('');
  const [search, setSearch]           = useState('');
  const [filterStatus, setFilterStatus] = useState<'All' | Tracker['status']>('All');
  const [toasts, setToasts]           = useState<Toast[]>([]);
  const [togglingId, setTogglingId]   = useState<number | null>(null);
  const [deletingId, setDeletingId]   = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/trackers`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) setTrackers(await res.json());
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

  const filtered = useMemo(() => trackers.filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      t.board_id.toLowerCase().includes(q) ||
      t.mac_address.toLowerCase().includes(q) ||
      (t.cow_tag ?? '').toLowerCase().includes(q) ||
      (t.cow_name ?? '').toLowerCase().includes(q);
    return matchSearch && (filterStatus === 'All' || t.status === filterStatus);
  }), [trackers, search, filterStatus]);

  const stats = useMemo(() => ({
    total:       trackers.length,
    active:      trackers.filter(t => t.status === 'Active').length,
    inactive:    trackers.filter(t => t.status === 'Inactive').length,
    maintenance: trackers.filter(t => t.status === 'Maintenance').length,
  }), [trackers]);

  function openAdd() {
    setForm(emptyForm);
    setFormError('');
    setModal({ type: 'add' });
  }

  function openEdit(t: Tracker) {
    setForm({ board_id: t.board_id, mac_address: t.mac_address,
              sleep_time_sec: t.sleep_time_sec, battery_threshold: t.battery_threshold });
    setFormError('');
    setModal({ type: 'edit', tracker: t });
  }

  function closeModal() { setModal({ type: 'none' }); }

  async function handleSave() {
    setFormError('');
    if (!form.board_id.trim() || !form.mac_address.trim()) {
      setFormError('Board ID and MAC Address are required.');
      return;
    }
    setSaving(true);
    try {
      const isEdit = modal.type === 'edit';
      const url    = isEdit
        ? `${API}/api/trackers/${(modal as any).tracker.id}`
        : `${API}/api/trackers`;
      const res = await fetch(url, {
        method:  isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json();
        setFormError(d.error ?? 'Save failed.');
        return;
      }
      closeModal();
      addToast('success', isEdit ? 'Tracker updated successfully.' : 'Tracker added successfully.');
      load();
    } finally {
      setSaving(false);
    }
  }

  async function confirmToggle() {
    if (modal.type !== 'confirm-toggle') return;
    const { tracker } = modal;
    setTogglingId(tracker.id);
    closeModal();
    try {
      const res = await fetch(`${API}/api/trackers/${tracker.id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        addToast('success', `Tracker ${tracker.status === 'Active' ? 'deactivated' : 'activated'} successfully.`);
        load();
      } else {
        const d = await res.json().catch(() => ({ error: 'Toggle failed.' }));
        addToast('danger', d.error ?? 'Toggle failed.');
      }
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmDelete() {
    if (modal.type !== 'confirm-delete') return;
    const { tracker } = modal;
    setDeletingId(tracker.id);
    closeModal();
    try {
      const res = await fetch(`${API}/api/trackers/${tracker.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        addToast('success', `Tracker "${tracker.board_id}" deleted successfully.`);
        load();
      } else {
        const d = await res.json().catch(() => ({ error: 'Delete failed.' }));
        addToast('danger', d.error ?? 'Delete failed.');
      }
    } finally {
      setDeletingId(null);
    }
  }

  const isModalOpen = modal.type !== 'none';
  const hasFilters  = search || filterStatus !== 'All';

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
        <h4 className="mb-1 fw-semibold">Cow Tracker Management</h4>
        <p className="mb-0 text-body-secondary small">Manage IoT trackers and their cow assignments</p>
      </div>

      {/* ── Summary cards ── */}
      <div className="row g-4 mb-4">
        {[
          { label: 'Total Trackers', value: stats.total,       icon: 'ri-router-line',        color: 'primary'   },
          { label: 'Active',         value: stats.active,      icon: 'ri-radio-button-line',  color: 'success'   },
          { label: 'Inactive',       value: stats.inactive,    icon: 'ri-forbid-2-line',      color: 'secondary' },
          { label: 'Maintenance',    value: stats.maintenance, icon: 'ri-tools-line',         color: 'warning'   },
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

      {/* ── Trackers table card ── */}
      <div className="card">
        <div className="card-header border-bottom">
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
            <h5 className="card-title mb-0">List of Trackers</h5>
            <button className="btn btn-sm btn-primary" onClick={openAdd}>
              <i className="ri ri-add-line me-1"></i>Add Tracker
            </button>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <div className="input-group input-group-sm flex-grow-1" style={{ maxWidth: 280 }}>
              <span className="input-group-text border-end-0 bg-transparent pe-1">
                <i className="ri ri-search-line text-body-secondary"></i>
              </span>
              <input type="text" className="form-control border-start-0 ps-0"
                placeholder="Search board ID, MAC, cow tag…"
                value={search} onChange={e => setSearch(e.target.value)} />
              {search && (
                <button className="btn btn-sm btn-outline-secondary border-0 px-2" onClick={() => setSearch('')}>
                  <i className="ri ri-close-line"></i>
                </button>
              )}
            </div>
            <select className="form-select form-select-sm" style={{ width: 155 }}
              value={filterStatus} onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}>
              <option value="All">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Maintenance">Maintenance</option>
            </select>
            {hasFilters && (
              <button className="btn btn-sm btn-outline-secondary"
                onClick={() => { setSearch(''); setFilterStatus('All'); }}>
                <i className="ri ri-filter-off-line me-1"></i>Clear
              </button>
            )}
          </div>
        </div>

        <div className="table-responsive">
          {loading ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary mb-2" style={{ width: 28, height: 28 }}></div>
              <p className="text-body-secondary small mb-0">Loading trackers…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-5">
              <i className="ri ri-router-line text-body-secondary" style={{ fontSize: 40 }}></i>
              <p className="text-body-secondary small mt-2 mb-0">
                {trackers.length === 0 ? 'No trackers found.' : 'No trackers match the current filters.'}
              </p>
            </div>
          ) : (
            <table className="table table-hover mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th className="ps-4">#</th>
                  <th>Board ID</th>
                  <th>MAC Address</th>
                  <th>Assigned Cow</th>
                  <th>Sleep Time</th>
                  <th>Batt. Threshold</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="text-center" style={{ width: 155 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, idx) => (
                  <tr key={t.id}>
                    <td className="ps-4">
                      <small className="text-body-secondary">{idx + 1}</small>
                    </td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <span className="avatar avatar-sm flex-shrink-0">
                          <span className="avatar-initial rounded-circle bg-label-primary">
                            <i className="ri ri-router-line" style={{ fontSize: 13 }}></i>
                          </span>
                        </span>
                        <span className="fw-medium">{t.board_id}</span>
                      </div>
                    </td>
                    <td><small className="text-body-secondary font-monospace">{t.mac_address}</small></td>
                    <td>
                      {t.cow_name
                        ? <span className="fw-medium" style={{ fontSize: 13 }}>{t.cow_name}</span>
                        : <span className="badge bg-label-secondary rounded-pill">Unassigned</span>
                      }
                    </td>
                    <td><small className="text-body-secondary">{t.sleep_time_sec}s</small></td>
                    <td><small className="text-body-secondary">{t.battery_threshold}%</small></td>
                    <td><StatusBadge status={t.status} /></td>
                    <td>
                      <small className="text-body-secondary">
                        {new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </small>
                    </td>
                    <td>
                      <div className="d-flex gap-1 justify-content-center">
                        <button className="btn btn-sm btn-icon btn-outline-secondary border-0"
                          title="View Details"
                          onClick={() => setModal({ type: 'view', tracker: t })}>
                          <i className="ri ri-eye-line"></i>
                        </button>
                        <button className="btn btn-sm btn-icon btn-outline-primary border-0"
                          title="Edit Tracker"
                          onClick={() => openEdit(t)}>
                          <i className="ri ri-pencil-line"></i>
                        </button>
                        <button
                          className={`btn btn-sm btn-icon border-0 ${t.status === 'Active' ? 'btn-outline-danger' : 'btn-outline-success'}`}
                          title={t.status === 'Active' ? 'Deactivate' : t.status === 'Inactive' ? 'Activate' : 'Maintenance — cannot toggle'}
                          onClick={() => setModal({ type: 'confirm-toggle', tracker: t })}
                          disabled={togglingId === t.id || t.status === 'Maintenance'}>
                          {togglingId === t.id
                            ? <span className="spinner-border spinner-border-sm"></span>
                            : <i className={`ri ${t.status === 'Active' ? 'ri-stop-circle-line' : 'ri-play-circle-line'}`}></i>
                          }
                        </button>
                        <button
                          className="btn btn-sm btn-icon btn-outline-danger border-0"
                          title="Delete Tracker"
                          onClick={() => setModal({ type: 'confirm-delete', tracker: t })}
                          disabled={deletingId === t.id}>
                          {deletingId === t.id
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
              Showing <strong>{filtered.length}</strong> of <strong>{trackers.length}</strong> trackers
              {hasFilters && <span> (filtered)</span>}
            </small>
          </div>
        )}
      </div>

      {/* ── Backdrop ── */}
      {isModalOpen && (
        <div className="modal-backdrop fade show" onClick={closeModal}></div>
      )}

      {/* ── View Modal ── */}
      {modal.type === 'view' && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="ri ri-router-line me-2 text-primary"></i>Tracker Details
                </h5>
                <button className="btn-close" onClick={closeModal}></button>
              </div>
              <div className="modal-body px-4 py-4">
                <div className="d-flex justify-content-center mb-4">
                  <span className="avatar" style={{ width: 72, height: 72 }}>
                    <span className="avatar-initial rounded-circle bg-label-primary" style={{ fontSize: 28 }}>
                      <i className="ri ri-router-line"></i>
                    </span>
                  </span>
                </div>
                <div className="text-center mb-4">
                  <h5 className="fw-semibold mb-1">{modal.tracker.board_id}</h5>
                  <small className="text-body-secondary font-monospace">{modal.tracker.mac_address}</small>
                  <div className="mt-2">
                    <StatusBadge status={modal.tracker.status} />
                  </div>
                </div>
                <hr className="my-3" />
                <div className="row g-2">
                  {[
                    { label: 'Board ID',          value: modal.tracker.board_id },
                    { label: 'MAC Address',        value: modal.tracker.mac_address },
                    { label: 'Assigned Cow',       value: modal.tracker.cow_name || 'Not Assigned' },
                    { label: 'Sleep Time',         value: `${modal.tracker.sleep_time_sec} seconds` },
                    { label: 'Battery Threshold',  value: `${modal.tracker.battery_threshold}%` },
                    { label: 'Status',             value: modal.tracker.status },
                    { label: 'Created',            value: new Date(modal.tracker.created_at)
                        .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) },
                  ].map(row => (
                    <div key={row.label} className="col-12 d-flex justify-content-between">
                      <span className="text-muted small">{row.label}</span>
                      <span className="small fw-semibold">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-sm btn-outline-secondary" onClick={closeModal}>Close</button>
                <button className="btn btn-sm btn-primary" onClick={() => openEdit(modal.tracker)}>
                  <i className="ri ri-pencil-line me-1"></i>Edit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Modal ── */}
      {(modal.type === 'add' || modal.type === 'edit') && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className={`ri ${modal.type === 'add' ? 'ri-add-circle-line' : 'ri-edit-line'} me-2 text-primary`}></i>
                  {modal.type === 'add' ? 'Add Tracker' : 'Edit Tracker'}
                </h5>
                <button className="btn-close" onClick={closeModal} disabled={saving}></button>
              </div>
              <div className="modal-body px-4 py-4">
                {formError && (
                  <div className="alert alert-danger d-flex align-items-center gap-2 py-2 small mb-3">
                    <i className="ri ri-error-warning-line flex-shrink-0"></i>{formError}
                  </div>
                )}
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label small fw-medium mb-1">
                      Board ID <span className="text-danger">*</span>
                    </label>
                    <input className="form-control form-control-sm" placeholder="e.g. ESP32-001"
                      value={form.board_id}
                      onChange={e => setForm(f => ({ ...f, board_id: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium mb-1">
                      MAC Address <span className="text-danger">*</span>
                    </label>
                    <input className="form-control form-control-sm font-monospace"
                      placeholder="e.g. AA:BB:CC:DD:EE:FF"
                      value={form.mac_address}
                      onChange={e => setForm(f => ({ ...f, mac_address: e.target.value }))} />
                  </div>
                  <div className="col-sm-6">
                    <label className="form-label small fw-medium mb-1">Sleep Time (seconds)</label>
                    <input type="number" min={10} className="form-control form-control-sm"
                      value={form.sleep_time_sec}
                      onChange={e => setForm(f => ({ ...f, sleep_time_sec: Number(e.target.value) }))} />
                    <div className="form-text">How often the tracker pings. Default: 300s</div>
                  </div>
                  <div className="col-sm-6">
                    <label className="form-label small fw-medium mb-1">Battery Threshold (%)</label>
                    <input type="number" min={0} max={100} className="form-control form-control-sm"
                      value={form.battery_threshold}
                      onChange={e => setForm(f => ({ ...f, battery_threshold: Number(e.target.value) }))} />
                    <div className="form-text">Alert when battery drops below this. Default: 20%</div>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-sm btn-outline-secondary" onClick={closeModal} disabled={saving}>Cancel</button>
                <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>
                  {saving && <span className="spinner-border spinner-border-sm me-1"></span>}
                  {modal.type === 'add' ? 'Add Tracker' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Toggle Modal ── */}
      {modal.type === 'confirm-toggle' && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm">
            <div className="modal-content">
              <div className="modal-body text-center py-4 px-4">
                <span
                  className={`d-inline-flex align-items-center justify-content-center rounded-circle mb-3 ${modal.tracker.status === 'Active' ? 'bg-label-danger' : 'bg-label-success'}`}
                  style={{ width: 56, height: 56, fontSize: 26 }}>
                  <i className={`ri ${modal.tracker.status === 'Active' ? 'ri-stop-circle-line' : 'ri-play-circle-line'}`}></i>
                </span>
                <h6 className="fw-semibold mb-1">
                  {modal.tracker.status === 'Active' ? 'Deactivate Tracker?' : 'Activate Tracker?'}
                </h6>
                <p className="text-body-secondary small mb-0">
                  {modal.tracker.status === 'Active'
                    ? <><strong>{modal.tracker.board_id}</strong> will stop reporting data.</>
                    : <><strong>{modal.tracker.board_id}</strong> will resume reporting data.</>
                  }
                </p>
              </div>
              <div className="modal-footer border-0 pt-0 justify-content-center gap-2 pb-4">
                <button className="btn btn-sm btn-outline-secondary" onClick={closeModal}>Cancel</button>
                <button
                  className={`btn btn-sm ${modal.tracker.status === 'Active' ? 'btn-danger' : 'btn-success'}`}
                  onClick={confirmToggle}>
                  {modal.tracker.status === 'Active' ? 'Deactivate' : 'Activate'}
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
                <h6 className="fw-semibold mb-1">Delete Tracker?</h6>
                <p className="text-body-secondary small mb-0">
                  <strong>{modal.tracker.board_id}</strong> will be permanently removed. This action cannot be undone.
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
    </>
  );
}
