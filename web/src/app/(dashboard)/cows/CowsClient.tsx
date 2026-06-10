'use client';

import { useEffect, useState, useMemo } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Cow {
  id: number;
  farm_id: number | null;
  farm_name: string | null;
  tag_number: string | null;
  name: string;
  breed: string | null;
  gender: 'Male' | 'Female' | null;
  date_of_birth: string | null;
  status: 'Pair' | 'Unpair';
  assigned_tracker_id: number | null;
  tracker_board_id: string | null;
  created_at: string;
}

interface Farm {
  id: number;
  name: string;
}

interface ActiveTracker {
  id: number;
  board_id: string;
  mac_address: string;
  assigned_cow_id: number | null;
}

type ModalState =
  | { type: 'none' }
  | { type: 'view';           cow: Cow }
  | { type: 'add' }
  | { type: 'edit';           cow: Cow }
  | { type: 'pair';           cow: Cow; trackers: ActiveTracker[] }
  | { type: 'confirm-unpair'; cow: Cow }
  | { type: 'confirm-delete'; cow: Cow };

interface FormState {
  name: string;
  breed: string;
  sex: '' | 'Male' | 'Female';
  date_of_birth: string;
  farm_id: string;
}

interface Toast {
  id: number;
  kind: 'success' | 'danger';
  message: string;
}

type SortCol = 'name' | 'tag' | 'sex' | 'breed' | 'tag_status';

const BREEDS = ['Local', 'Cross-Breed', 'Unknown'];
const emptyForm: FormState = { name: '', breed: '', sex: '', date_of_birth: '', farm_id: '' };

function getToken() {
  return localStorage.getItem('token') ?? sessionStorage.getItem('token') ?? '';
}

function SexBadge({ sex }: { sex: Cow['gender'] }) {
  if (!sex) return <span className="text-body-secondary small">—</span>;
  const cls  = sex === 'Male' ? 'bg-label-info' : 'bg-label-danger';
  const icon = sex === 'Male' ? 'ri-men-line'   : 'ri-women-line';
  return (
    <span className={`badge rounded-pill ${cls}`}>
      <i className={`ri ${icon} me-1`} style={{ fontSize: 10 }}></i>
      {sex}
    </span>
  );
}

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol | null; sortDir: 'asc' | 'desc' }) {
  if (sortCol !== col)
    return <i className="ri ri-arrow-up-down-line ms-1 text-body-secondary opacity-50" style={{ fontSize: 11 }}></i>;
  return <i className={`ri ${sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} ms-1 text-primary`} style={{ fontSize: 11 }}></i>;
}

export default function CowsClient() {
  const [cows, setCows]             = useState<Cow[]>([]);
  const [farms, setFarms]           = useState<Farm[]>([]);
  const [loading, setLoading]       = useState(true);
  const [modal, setModal]           = useState<ModalState>({ type: 'none' });
  const [form, setForm]             = useState<FormState>(emptyForm);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');
  const [search, setSearch]         = useState('');
  const [filterTag, setFilterTag]   = useState<'All' | 'Paired' | 'Unpaired'>('All');
  const [filterFarm, setFilterFarm] = useState<string>('All');
  const [toasts, setToasts]         = useState<Toast[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pairing, setPairing]       = useState(false);
  const [unpairing, setUnpairing]   = useState(false);
  const [selectedTrackerId, setSelectedTrackerId] = useState<string>('');
  const [sortCol, setSortCol]       = useState<SortCol | null>(null);
  const [sortDir, setSortDir]       = useState<'asc' | 'desc'>('asc');

  async function load() {
    setLoading(true);
    try {
      const [cowsRes, farmsRes] = await Promise.all([
        fetch(`${API}/api/cows`,  { headers: { Authorization: `Bearer ${getToken()}` } }),
        fetch(`${API}/api/farms`, { headers: { Authorization: `Bearer ${getToken()}` } }),
      ]);
      if (cowsRes.ok) setCows(await cowsRes.json());
      else {
        const d = await cowsRes.json().catch(() => ({ error: `HTTP ${cowsRes.status}` }));
        addToast('danger', `Failed to load cows: ${d.error ?? cowsRes.status}`);
      }
      if (farmsRes.ok) {
        const farmList = await farmsRes.json();
        setFarms(farmList);
        if (filterFarm === 'All' && farmList.length > 0) {
          setFilterFarm(String(farmList[0].id));
        }
      }
    } catch (err: any) {
      addToast('danger', `Network error: ${err.message}`);
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

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = cows.filter(c => {
      const matchSearch = !q ||
        (c.tag_number ?? '').toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.breed ?? '').toLowerCase().includes(q);
      const matchTag =
        filterTag === 'All' ||
        (filterTag === 'Paired'   && c.status === 'Pair') ||
        (filterTag === 'Unpaired' && c.status === 'Unpair');
      const matchFarm = filterFarm === 'All' || String(c.farm_id) === filterFarm;
      return matchSearch && matchTag && matchFarm;
    });

    if (sortCol) {
      list = [...list].sort((a, b) => {
        let av = '';
        let bv = '';
        if (sortCol === 'name')       { av = a.name;        bv = b.name; }
        if (sortCol === 'tag')        { av = a.tag_number ?? ''; bv = b.tag_number ?? ''; }
        if (sortCol === 'sex')        { av = a.gender ?? ''; bv = b.gender ?? ''; }
        if (sortCol === 'breed')      { av = a.breed ?? '';  bv = b.breed ?? ''; }
        if (sortCol === 'tag_status') { av = a.status; bv = b.status; }
        const cmp = av.localeCompare(bv);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return list;
  }, [cows, search, filterTag, filterFarm, sortCol, sortDir]);

  const stats = useMemo(() => ({
    total:    cows.length,
    paired:   cows.filter(c => c.status === 'Pair').length,
    unpaired: cows.filter(c => c.status === 'Unpair').length,
    male:     cows.filter(c => c.gender === 'Male').length,
    female:   cows.filter(c => c.gender === 'Female').length,
  }), [cows]);

  function openAdd() {
    setForm(emptyForm);
    setFormError('');
    setModal({ type: 'add' });
  }

  function openEdit(c: Cow) {
    setForm({
      name:          c.name,
      breed:         c.breed ?? '',
      sex:           c.gender ?? '',
      date_of_birth: c.date_of_birth ?? '',
      farm_id:       c.farm_id != null ? String(c.farm_id) : '',
    });
    setFormError('');
    setModal({ type: 'edit', cow: c });
  }

  async function openPair(c: Cow) {
    const res = await fetch(`${API}/api/trackers`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const all: Array<{ id: number; board_id: string; mac_address: string; assigned_cow_id: number | null; status: string }> =
      res.ok ? await res.json() : [];
    const available = all.filter(t => t.status === 'Active' && t.assigned_cow_id === null);
    setSelectedTrackerId('');
    setModal({ type: 'pair', cow: c, trackers: available });
  }

  function closeModal() { setModal({ type: 'none' }); }

  async function handleSave() {
    setFormError('');
    if (!form.name.trim()) { setFormError('Name is required.'); return; }
    setSaving(true);
    try {
      const isEdit = modal.type === 'edit';
      const url    = isEdit
        ? `${API}/api/cows/${(modal as { type: 'edit'; cow: Cow }).cow.id}`
        : `${API}/api/cows`;
      const res = await fetch(url, {
        method:  isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({
          name:          form.name.trim(),
          breed:         form.breed || null,
          gender:        form.sex   || null,
          date_of_birth: form.date_of_birth || null,
          farm_id:       form.farm_id ? Number(form.farm_id) : null,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setFormError(d.error ?? 'Save failed.');
        return;
      }
      closeModal();
      addToast('success', isEdit ? 'Cow updated successfully.' : 'Cow added successfully.');
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handlePairSave() {
    if (modal.type !== 'pair' || !selectedTrackerId) return;
    const { cow } = modal;
    setPairing(true);
    try {
      const res = await fetch(`${API}/api/cows/${cow.id}/tag`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ tracker_id: Number(selectedTrackerId) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Pair failed.' }));
        addToast('danger', d.error ?? 'Pair failed.');
        return;
      }
      closeModal();
      addToast('success', `Tracker paired with "${cow.name}" successfully.`);
      load();
    } finally {
      setPairing(false);
    }
  }

  async function handleUnpair() {
    if (modal.type !== 'confirm-unpair') return;
    const { cow } = modal;
    setUnpairing(true);
    closeModal();
    try {
      const res = await fetch(`${API}/api/cows/${cow.id}/tag`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body:    JSON.stringify({ tracker_id: null }),
      });
      if (res.ok) {
        addToast('success', `Tracker unpaired from "${cow.name}" successfully.`);
        load();
      } else {
        const d = await res.json().catch(() => ({ error: 'Unpair failed.' }));
        addToast('danger', d.error ?? 'Unpair failed.');
      }
    } finally {
      setUnpairing(false);
    }
  }

  async function confirmDelete() {
    if (modal.type !== 'confirm-delete') return;
    const { cow } = modal;
    setDeletingId(cow.id);
    closeModal();
    try {
      const res = await fetch(`${API}/api/cows/${cow.id}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        addToast('success', `Cow "${cow.name}" deleted successfully.`);
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
  const hasFilters  = !!search || filterTag !== 'All' || filterFarm !== 'All';
  const thSort: React.CSSProperties = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };

  return (
    <>
      {/* Toast notifications */}
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

      {/* Page header */}
      <div className="mb-4">
        <h4 className="mb-1 fw-semibold">Cow Management</h4>
        <p className="mb-0 text-body-secondary small">Manage livestock records and tracker assignments</p>
      </div>

      {/* Summary cards */}
      <div className="row g-4 mb-4">
        {[
          { label: 'Total Cows', value: stats.total,    icon: 'ri-profile-line', color: 'primary'   },
          { label: 'Paired',     value: stats.paired,   icon: 'ri-link-m',       color: 'success'   },
          { label: 'Unpaired',   value: stats.unpaired, icon: 'ri-link-unlink',  color: 'secondary' },
          { label: 'Male',       value: stats.male,     icon: 'ri-men-line',     color: 'info'      },
          { label: 'Female',     value: stats.female,   icon: 'ri-women-line',   color: 'danger'    },
        ].map(card => (
          <div key={card.label} className="col-sm-6 col-xl">
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

      {/* Cows table card */}
      <div className="card">
        <div className="card-header border-bottom">
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
            <h5 className="card-title mb-0">List of Cows</h5>
            <button className="btn btn-sm btn-primary" onClick={openAdd}>
              <i className="ri ri-add-line me-1"></i>Add New Cow
            </button>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <div className="input-group input-group-sm flex-grow-1" style={{ maxWidth: 280 }}>
              <span className="input-group-text border-end-0 bg-transparent pe-1">
                <i className="ri ri-search-line text-body-secondary"></i>
              </span>
              <input type="text" className="form-control border-start-0 ps-0"
                placeholder="Search name, tag, breed…"
                value={search} onChange={e => setSearch(e.target.value)} />
              {search && (
                <button className="btn btn-sm btn-outline-secondary border-0 px-2" onClick={() => setSearch('')}>
                  <i className="ri ri-close-line"></i>
                </button>
              )}
            </div>
            <select className="form-select form-select-sm" style={{ width: 155 }}
              value={filterTag} onChange={e => setFilterTag(e.target.value as typeof filterTag)}>
              <option value="All">All Tag Status</option>
              <option value="Paired">Paired</option>
              <option value="Unpaired">Not Paired</option>
            </select>
            <select className="form-select form-select-sm" style={{ width: 155 }}
              value={filterFarm} onChange={e => setFilterFarm(e.target.value)}>
              <option value="All">All Farms</option>
              {farms.map(fm => <option key={fm.id} value={fm.id}>{fm.name}</option>)}
            </select>
            {hasFilters && (
              <button className="btn btn-sm btn-outline-secondary"
                onClick={() => { setSearch(''); setFilterTag('All'); setFilterFarm('All'); }}>
                <i className="ri ri-filter-off-line me-1"></i>Clear
              </button>
            )}
          </div>
        </div>

        <div className="table-responsive">
          {loading ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary mb-2" style={{ width: 28, height: 28 }}></div>
              <p className="text-body-secondary small mb-0">Loading cows…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-5">
              <i className="ri ri-profile-line text-body-secondary" style={{ fontSize: 40 }}></i>
              <p className="text-body-secondary small mt-2 mb-0">
                {cows.length === 0 ? 'No cows found.' : 'No cows match the current filters.'}
              </p>
            </div>
          ) : (
            <table className="table table-hover mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th className="ps-4" style={{ width: 48 }}>#</th>
                  <th style={thSort} onClick={() => toggleSort('name')}>
                    Name <SortIcon col="name" sortCol={sortCol} sortDir={sortDir} />
                  </th>
                  <th style={thSort} onClick={() => toggleSort('tag')}>
                    Tag Number <SortIcon col="tag" sortCol={sortCol} sortDir={sortDir} />
                  </th>
                  <th style={thSort} onClick={() => toggleSort('sex')}>
                    Sex <SortIcon col="sex" sortCol={sortCol} sortDir={sortDir} />
                  </th>
                  <th style={thSort} onClick={() => toggleSort('breed')}>
                    Breed <SortIcon col="breed" sortCol={sortCol} sortDir={sortDir} />
                  </th>
                  <th style={{ ...thSort, width: 120 }} onClick={() => toggleSort('tag_status')}>
                    Tag Status <SortIcon col="tag_status" sortCol={sortCol} sortDir={sortDir} />
                  </th>
                  <th className="text-center" style={{ width: 120 }}>Action</th>
                  <th style={{ width: 110 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => (
                  <tr key={c.id}>
                    <td className="ps-4">
                      <small className="text-body-secondary">{idx + 1}</small>
                    </td>
                    <td><span className="fw-medium">{c.name}</span></td>
                    <td>
                      {c.tag_number
                        ? <span className="fw-medium font-monospace">{c.tag_number}</span>
                        : <span className="text-body-secondary small">—</span>}
                    </td>
                    <td><SexBadge sex={c.gender} /></td>
                    <td><small className="text-body-secondary">{c.breed ?? '—'}</small></td>
                    <td>
                      {c.status === 'Pair'
                        ? <span className="badge rounded-pill bg-label-success">
                            <i className="ri ri-link-m me-1" style={{ fontSize: 10 }}></i>Pair
                          </span>
                        : <span className="badge rounded-pill bg-label-secondary">
                            <i className="ri ri-link-unlink me-1" style={{ fontSize: 10 }}></i>Unpair
                          </span>
                      }
                    </td>
                    <td>
                      <div className="d-flex gap-1 justify-content-center">
                        <button className="btn btn-sm btn-icon btn-outline-secondary border-0"
                          title="View Cow Profile"
                          onClick={() => setModal({ type: 'view', cow: c })}>
                          <i className="ri ri-eye-line"></i>
                        </button>
                        <button className="btn btn-sm btn-icon btn-outline-primary border-0"
                          title="Edit Cow Profile"
                          onClick={() => openEdit(c)}>
                          <i className="ri ri-pencil-line"></i>
                        </button>
                        <button className="btn btn-sm btn-icon btn-outline-danger border-0"
                          title="Delete Cow Profile"
                          onClick={() => setModal({ type: 'confirm-delete', cow: c })}
                          disabled={deletingId === c.id}>
                          {deletingId === c.id
                            ? <span className="spinner-border spinner-border-sm"></span>
                            : <i className="ri ri-delete-bin-line"></i>
                          }
                        </button>
                      </div>
                    </td>
                    <td>
                      {c.status !== 'Pair' ? (
                        <button className="btn btn-sm btn-warning"
                          style={{ minWidth: 90 }}
                          onClick={() => openPair(c)}>
                          <i className="ri ri-link-m me-1"></i>Pair
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-outline-danger"
                          style={{ minWidth: 90 }}
                          onClick={() => setModal({ type: 'confirm-unpair', cow: c })}>
                          <i className="ri ri-link-unlink me-1"></i>UnPair
                        </button>
                      )}
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
              Showing <strong>{filtered.length}</strong> of <strong>{cows.length}</strong> cows
              {hasFilters && <span> (filtered)</span>}
            </small>
          </div>
        )}
      </div>

      {/* Backdrop */}
      {isModalOpen && (
        <div className="modal-backdrop fade show" onClick={closeModal}></div>
      )}

      {/* View Modal */}
      {modal.type === 'view' && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="ri ri-profile-line me-2 text-primary"></i>Cow Profile
                </h5>
                <button className="btn-close" onClick={closeModal}></button>
              </div>
              <div className="modal-body px-4 py-4">
                <div className="d-flex justify-content-center mb-4">
                  <span className="avatar" style={{ width: 72, height: 72 }}>
                    <span className="avatar-initial rounded-circle bg-label-primary" style={{ fontSize: 28 }}>
                      <i className="ri ri-profile-line"></i>
                    </span>
                  </span>
                </div>
                <div className="text-center mb-4">
                  <h5 className="fw-semibold mb-1">{modal.cow.name}</h5>
                  {modal.cow.tag_number && (
                    <small className="text-body-secondary font-monospace">{modal.cow.tag_number}</small>
                  )}
                  <div className="mt-2"><SexBadge sex={modal.cow.gender} /></div>
                </div>
                <hr className="my-3" />
                <div className="row g-0">
                  {[
                    { label: 'Name',          value: modal.cow.name },
                    { label: 'Date of Birth', value: modal.cow.date_of_birth
                        ? new Date(modal.cow.date_of_birth).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
                        : '—' },
                    { label: 'Sex',           value: modal.cow.gender ?? '—' },
                    { label: 'Breed',         value: modal.cow.breed ?? '—' },
                    { label: 'Tag Number',    value: modal.cow.tag_number ?? '—' },
                  ].map((row, i) => (
                    <div key={row.label}
                      className={`col-12 d-flex justify-content-between align-items-center py-2 ${i < 4 ? 'border-bottom' : ''}`}>
                      <span className="text-muted small">{row.label}</span>
                      <span className="small fw-semibold text-end" style={{ maxWidth: '60%', wordBreak: 'break-word' }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-sm btn-outline-secondary" onClick={closeModal}>Close</button>
                <button className="btn btn-sm btn-primary" onClick={() => openEdit(modal.cow)}>
                  <i className="ri ri-pencil-line me-1"></i>Edit Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {(modal.type === 'add' || modal.type === 'edit') && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className={`ri ${modal.type === 'add' ? 'ri-add-circle-line' : 'ri-edit-line'} me-2 text-primary`}></i>
                  {modal.type === 'add' ? 'Add New Cow' : 'Edit Cow Profile'}
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
                      Name <span className="text-danger">*</span>
                    </label>
                    <input className="form-control form-control-sm"
                      placeholder="Enter cow name"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium mb-1">Farm</label>
                    <select className="form-select form-select-sm"
                      value={form.farm_id}
                      onChange={e => setForm(f => ({ ...f, farm_id: e.target.value }))}>
                      <option value="">— Select Farm —</option>
                      {farms.map(fm => <option key={fm.id} value={fm.id}>{fm.name}</option>)}
                    </select>
                  </div>
                  <div className="col-sm-6">
                    <label className="form-label small fw-medium mb-1">Date of Birth</label>
                    <input type="date" className="form-control form-control-sm"
                      value={form.date_of_birth}
                      onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))} />
                  </div>
                  <div className="col-sm-6">
                    <label className="form-label small fw-medium mb-1">Sex</label>
                    <select className="form-select form-select-sm"
                      value={form.sex}
                      onChange={e => setForm(f => ({ ...f, sex: e.target.value as FormState['sex'] }))}>
                      <option value="">— Select —</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium mb-1">Breed</label>
                    <select className="form-select form-select-sm"
                      value={form.breed}
                      onChange={e => setForm(f => ({ ...f, breed: e.target.value }))}>
                      <option value="">— Select —</option>
                      {BREEDS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  {modal.type === 'edit' && (
                    <div className="col-12">
                      <label className="form-label small fw-medium mb-1">Tag Number</label>
                      <input className="form-control form-control-sm"
                        value={modal.cow.tag_number ?? 'Not Paired'}
                        readOnly disabled />
                      <div className="form-text">Tag number is set automatically when a tracker is paired.</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-sm btn-outline-secondary" onClick={closeModal} disabled={saving}>Cancel</button>
                <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>
                  {saving && <span className="spinner-border spinner-border-sm me-1"></span>}
                  {modal.type === 'add' ? 'Add Cow' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pair Modal */}
      {modal.type === 'pair' && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="ri ri-link-m me-2 text-warning"></i>Pair Tracker
                </h5>
                <button className="btn-close" onClick={closeModal} disabled={pairing}></button>
              </div>
              <div className="modal-body px-4 py-3">
                {/* Cow info */}
                <div className="d-flex align-items-center gap-3 p-3 rounded mb-3"
                  style={{ background: 'var(--bs-light, #f8f9fa)' }}>
                  <span className="avatar flex-shrink-0">
                    <span className="avatar-initial rounded-circle bg-label-primary">
                      <i className="ri ri-profile-line"></i>
                    </span>
                  </span>
                  <div>
                    <div className="fw-semibold small">{modal.cow.name}</div>
                    <div className="text-body-secondary" style={{ fontSize: 12 }}>
                      Selecting a tracker will assign its Board ID as the tag number.
                    </div>
                  </div>
                </div>

                {/* Tracker list */}
                <div className="small fw-medium mb-2">
                  Available Trackers
                  <span className="text-body-secondary fw-normal ms-1">(Active &amp; unassigned)</span>
                </div>
                {modal.trackers.length === 0 ? (
                  <div className="alert alert-warning d-flex align-items-center gap-2 py-2 small mb-0">
                    <i className="ri ri-information-line flex-shrink-0"></i>
                    No active trackers available. Activate a tracker first.
                  </div>
                ) : (
                  <div style={{ maxHeight: 220, overflowY: 'auto' }} className="d-flex flex-column gap-2">
                    {modal.trackers.map(t => {
                      const selected = selectedTrackerId === String(t.id);
                      return (
                        <div key={t.id}
                          onClick={() => setSelectedTrackerId(String(t.id))}
                          className={`d-flex align-items-center gap-3 rounded border px-3 py-2
                            ${selected ? 'border-warning bg-label-warning' : 'border-light-subtle'}`}
                          style={{ cursor: 'pointer', transition: 'all .15s' }}>
                          <span className={`avatar avatar-sm flex-shrink-0`}>
                            <span className={`avatar-initial rounded-circle ${selected ? 'bg-warning' : 'bg-label-secondary'}`}>
                              <i className="ri ri-router-line" style={{ fontSize: 13 }}></i>
                            </span>
                          </span>
                          <div className="flex-grow-1 min-width-0">
                            <div className="fw-semibold font-monospace small">{t.board_id}</div>
                            <div className="text-body-secondary" style={{ fontSize: 11 }}>{t.mac_address}</div>
                          </div>
                          {selected && (
                            <i className="ri ri-checkbox-circle-fill text-warning flex-shrink-0"></i>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-sm btn-outline-secondary" onClick={closeModal} disabled={pairing}>Cancel</button>
                <button className="btn btn-sm btn-warning" onClick={handlePairSave}
                  disabled={pairing || !selectedTrackerId}>
                  {pairing && <span className="spinner-border spinner-border-sm me-1"></span>}
                  <i className="ri ri-link-m me-1"></i>Confirm Pair
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Unpair — warning notification */}
      {modal.type === 'confirm-unpair' && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm">
            <div className="modal-content border-warning" style={{ borderWidth: 2 }}>
              <div className="modal-body px-4 pt-4 pb-3">
                <div className="alert alert-warning d-flex align-items-start gap-2 py-2 small mb-3">
                  <i className="ri ri-error-warning-fill flex-shrink-0 mt-1"></i>
                  <span>This will remove the tracker tag from this cow.</span>
                </div>
                <div className="text-center">
                  <h6 className="fw-semibold mb-1">Confirm UnPair?</h6>
                  <p className="text-body-secondary small mb-0">
                    Cow: <strong>{modal.cow.name}</strong><br />
                    Tag: <strong className="font-monospace">{modal.cow.tag_number ?? '—'}</strong>
                  </p>
                </div>
              </div>
              <div className="modal-footer border-0 pt-0 justify-content-center gap-2 pb-4">
                <button className="btn btn-sm btn-outline-secondary" onClick={closeModal} disabled={unpairing}>Cancel</button>
                <button className="btn btn-sm btn-warning" onClick={handleUnpair} disabled={unpairing}>
                  {unpairing && <span className="spinner-border spinner-border-sm me-1"></span>}
                  <i className="ri ri-link-unlink me-1"></i>Yes, UnPair
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
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
                <h6 className="fw-semibold mb-1">Delete Cow Profile?</h6>
                <p className="text-body-secondary small mb-0">
                  <strong>{modal.cow.name}</strong> ({modal.cow.tag_number}) will be permanently removed. This action cannot be undone.
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
