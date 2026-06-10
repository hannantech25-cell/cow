'use client';

import { useEffect, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Farm {
  id: number;
  name: string;
  address: string | null;
  center_lat: number | null;
  center_lng: number | null;
}

interface FarmPoint {
  id: number;
  farm_id: number;
  sequence: number;
  latitude: number;
  longitude: number;
}

function getToken() {
  return localStorage.getItem('token') ?? sessionStorage.getItem('token') ?? '';
}

function calcCenter(points: FarmPoint[]): [number, number] | null {
  if (!points.length) return null;
  return [
    points.reduce((s, p) => s + Number(p.latitude),  0) / points.length,
    points.reduce((s, p) => s + Number(p.longitude), 0) / points.length,
  ];
}

export default function FarmsClient() {
  const [farms, setFarms]               = useState<Farm[]>([]);
  const [selectedFarm, setSelectedFarm] = useState<Farm | null>(null);
  const [points, setPoints]             = useState<FarmPoint[]>([]);
  const [saving, setSaving]             = useState(false);
  const [searchQuery, setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [searching, setSearching]       = useState(false);
  const [showModal, setShowModal]       = useState(false);
  const [isEdit, setIsEdit]             = useState(false);
  const [formName, setFormName]         = useState('');
  const [formAddress, setFormAddress]   = useState('');
  const [formError, setFormError]       = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Leaflet refs
  const containerRef   = useRef<HTMLDivElement>(null);
  const mapRef         = useRef<any>(null);
  const LRef           = useRef<any>(null);
  const markersRef     = useRef<any[]>([]);
  const polygonRef     = useRef<any>(null);

  // Keep fresh refs for map click handler (avoids stale closure)
  const selectedFarmRef = useRef<Farm | null>(null);
  const pointsRef       = useRef<FarmPoint[]>([]);
  useEffect(() => { selectedFarmRef.current = selectedFarm; }, [selectedFarm]);
  useEffect(() => { pointsRef.current = points; },           [points]);

  // ── API helpers ────────────────────────────────────────────────────────────

  async function loadFarms() {
    const r = await fetch(`${API}/api/farms`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (r.ok) setFarms(await r.json());
  }

  async function loadPoints(farmId: number) {
    const r = await fetch(`${API}/api/farms/${farmId}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (r.ok) {
      const data = await r.json();
      setPoints((data.points ?? []).map((p: any) => ({
        ...p, latitude: Number(p.latitude), longitude: Number(p.longitude),
      })));
    }
  }

  useEffect(() => { loadFarms(); }, []);

  // ── Leaflet CSS (must be in <head> before map init) ───────────────────────

  useEffect(() => {
    if (document.querySelector('link[data-leaflet]')) return;
    const link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.setAttribute('data-leaflet', '1');
    document.head.appendChild(link);
  }, []);

  // ── Map initialisation ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    let mounted = true;

    import('leaflet').then(L => {
      if (!mounted || !containerRef.current) return;
      if ((containerRef.current as any)._leaflet_id) return;

      LRef.current = L;
      const map = L.map(containerRef.current).setView([1.5934, 103.7569], 15);
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

      map.on('click', (e: any) => {
        const farm = selectedFarmRef.current;
        const pts  = pointsRef.current;
        if (!farm || pts.length >= 20) return;

        fetch(`${API}/api/farms/${farm.id}/points`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: e.latlng.lat, longitude: e.latlng.lng }),
        }).then(r => { if (r.ok) loadPoints(farm.id); });
      });
    });

    return () => {
      mounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Redraw map when points change ──────────────────────────────────────────

  useEffect(() => {
    const L   = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Clear old polygon
    if (polygonRef.current) { polygonRef.current.remove(); polygonRef.current = null; }

    if (!points.length) return;

    // Draw polygon (≥ 3 points)
    if (points.length >= 3) {
      polygonRef.current = L.polygon(
        points.map(p => [p.latitude, p.longitude]),
        { color: '#696cff', fillColor: '#696cff', fillOpacity: 0.15, weight: 2 }
      ).addTo(map);
    }

    // Add numbered draggable markers
    points.forEach(pt => {
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:26px;height:26px;border-radius:50%;background:#696cff;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">${pt.sequence}</div>`,
        iconSize: [26, 26], iconAnchor: [13, 13],
      });

      const marker = L.marker([pt.latitude, pt.longitude], { icon, draggable: true }).addTo(map);

      marker.on('dragend', (e: any) => {
        const { lat, lng } = e.target.getLatLng();
        const farm = selectedFarmRef.current;
        if (!farm) return;
        fetch(`${API}/api/farms/${farm.id}/points/${pt.id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: lat, longitude: lng }),
        }).then(r => { if (r.ok) loadPoints(farm.id); });
      });

      markersRef.current.push(marker);
    });

    // Auto-center map on polygon centroid
    const center = calcCenter(points);
    if (center) map.setView(center, map.getZoom());

  }, [points]);

  // ── Farm selection ─────────────────────────────────────────────────────────

  async function handleSelectFarm(farmId: number) {
    if (!farmId) { setSelectedFarm(null); setPoints([]); return; }
    const farm = farms.find(f => f.id === farmId) ?? null;
    setSelectedFarm(farm);
    if (farm) {
      await loadPoints(farmId);
      if (farm.center_lat && farm.center_lng && mapRef.current) {
        mapRef.current.setView([farm.center_lat, farm.center_lng], 16);
      }
    }
  }

  // ── Point actions ──────────────────────────────────────────────────────────

  async function handleDeletePoint(pt: FarmPoint) {
    if (!selectedFarm) return;
    await fetch(`${API}/api/farms/${selectedFarm.id}/points/${pt.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
    });
    loadPoints(selectedFarm.id);
  }

  async function handleClearPoints() {
    if (!selectedFarm) return;
    await fetch(`${API}/api/farms/${selectedFarm.id}/points`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
    });
    setPoints([]);
  }

  // ── Save geofence (update center) ─────────────────────────────────────────

  async function handleSave() {
    if (!selectedFarm || points.length < 4) return;
    setSaving(true);
    const center = calcCenter(points);
    await fetch(`${API}/api/farms/${selectedFarm.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: selectedFarm.name, address: selectedFarm.address,
        center_lat: center?.[0] ?? null, center_lng: center?.[1] ?? null,
      }),
    });
    await loadFarms();
    setSaving(false);
  }

  // ── Farm modal ─────────────────────────────────────────────────────────────

  function openAdd() {
    setIsEdit(false); setFormName(''); setFormAddress(''); setFormError(''); setShowModal(true);
  }

  function openEdit() {
    if (!selectedFarm) return;
    setIsEdit(true); setFormName(selectedFarm.name); setFormAddress(selectedFarm.address ?? '');
    setFormError(''); setShowModal(true);
  }

  async function handleModalSave() {
    if (!formName.trim()) { setFormError('Farm name is required.'); return; }
    if (isEdit && selectedFarm) {
      await fetch(`${API}/api/farms/${selectedFarm.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(), address: formAddress.trim() || null,
          center_lat: selectedFarm.center_lat, center_lng: selectedFarm.center_lng,
        }),
      });
      setSelectedFarm(f => f ? { ...f, name: formName.trim(), address: formAddress.trim() || null } : f);
    } else {
      const r = await fetch(`${API}/api/farms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), address: formAddress.trim() || null }),
      });
      if (r.ok) {
        const { id } = await r.json();
        await loadFarms();
        handleSelectFarm(id);
      }
    }
    await loadFarms();
    setShowModal(false);
  }

  // ── Delete farm ────────────────────────────────────────────────────────────

  async function handleDeleteFarm() {
    if (!selectedFarm) return;
    await fetch(`${API}/api/farms/${selectedFarm.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
    });
    setSelectedFarm(null); setPoints([]); setConfirmDelete(false);
    await loadFarms();
  }

  // ── Location search (Nominatim) ────────────────────────────────────────────

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await r.json();
      setSearchResults(data);
    } catch {}
    setSearching(false);
  }

  function handleSelectResult(result: { display_name: string; lat: string; lon: string }) {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);
    if (mapRef.current) mapRef.current.setView([lat, lon], 17);
    setSearchResults([]);
    setSearchQuery(result.display_name.split(',')[0]);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const center     = calcCenter(points);
  const canSave    = points.length >= 4;
  const pointsLeft = Math.max(0, 4 - points.length);

  return (
    <div className="container-xxl flex-grow-1 container-p-y">

      {/* Page header */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2">
        <div>
          <h4 className="fw-semibold mb-1">Farm Management</h4>
          <p className="text-muted mb-0 small">Configure farm geofence boundary on the map</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          <i className="ri ri-add-line me-1"></i>Add Farm
        </button>
      </div>

      {/* Farm selector bar */}
      <div className="card mb-4">
        <div className="card-body py-3 d-flex align-items-center flex-wrap gap-3">
          <div className="d-flex align-items-center gap-2">
            <i className="ri ri-community-line text-primary" style={{ fontSize: 18 }}></i>
            <span className="fw-semibold text-nowrap">Farm :</span>
            <select
              className="form-select form-select-sm"
              style={{ minWidth: 220 }}
              value={selectedFarm?.id ?? ''}
              onChange={e => handleSelectFarm(Number(e.target.value))}
            >
              <option value="">— Select farm —</option>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>

          {selectedFarm && (
            <>
              {selectedFarm.address && (
                <small className="text-muted">
                  <i className="ri ri-map-pin-line me-1"></i>{selectedFarm.address}
                </small>
              )}
              <div className="d-flex gap-2 ms-auto">
                <button className="btn btn-sm btn-outline-primary" onClick={openEdit}>
                  <i className="ri ri-pencil-line me-1"></i>Edit
                </button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => setConfirmDelete(true)}>
                  <i className="ri ri-delete-bin-line me-1"></i>Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main content — always rendered so map container stays in DOM */}
      <div className="row g-4">

        {/* Map card */}
        <div className="col-lg-8">
          <div className="card">
            <div className="card-header py-3 d-flex align-items-center justify-content-between flex-wrap gap-2">
              <div className="d-flex align-items-center gap-2">
                <i className="ri ri-map-2-line text-primary"></i>
                <span className="fw-semibold">Geofence Map</span>
                {selectedFarm && <small className="text-muted">— click map to add a point</small>}
              </div>
              {selectedFarm && (
                <div className="d-flex gap-2">
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    onClick={handleClearPoints}
                    disabled={!points.length}
                  >
                    <i className="ri ri-delete-bin-line me-1"></i>Clear All
                  </button>
                  <button
                    className="btn btn-sm btn-success"
                    onClick={handleSave}
                    disabled={!canSave || saving}
                  >
                    {saving
                      ? <span className="spinner-border spinner-border-sm me-1" />
                      : <i className="ri ri-save-line me-1"></i>
                    }
                    Save Geofence
                  </button>
                </div>
              )}
            </div>

            {/* Map wrapper — always in DOM */}
            <div style={{ position: 'relative' }}>

              {/* Search box — floats over map */}
              <div style={{
                position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
                width: 360, zIndex: 1000, pointerEvents: selectedFarm ? 'auto' : 'none',
                opacity: selectedFarm ? 1 : 0,
              }}>
                <div className="input-group input-group-sm shadow">
                  <span className="input-group-text bg-white border-end-0">
                    <i className="ri ri-search-line text-muted"></i>
                  </span>
                  <input
                    type="text"
                    className="form-control border-start-0 border-end-0"
                    placeholder="Search location…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleSearch} disabled={searching}>
                    {searching ? <span className="spinner-border spinner-border-sm" /> : 'Go'}
                  </button>
                </div>
                {searchResults.length > 0 && (
                  <div className="list-group shadow mt-1" style={{ maxHeight: 220, overflowY: 'auto' }}>
                    {searchResults.map((r, i) => (
                      <button
                        key={i}
                        className="list-group-item list-group-item-action py-2 px-3 text-start"
                        style={{ fontSize: 12 }}
                        onClick={() => handleSelectResult(r)}
                      >
                        <i className="ri ri-map-pin-line text-primary me-1"></i>
                        {r.display_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Map container — always in DOM */}
              <div ref={containerRef} style={{ height: 460, width: '100%', position: 'relative', zIndex: 1 }} />

              {/* Overlay when no farm selected */}
              {!selectedFarm && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 20,
                  background: 'rgba(255,255,255,0.82)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div className="text-center text-muted">
                    <i className="ri ri-community-line d-block mb-2" style={{ fontSize: 40, opacity: 0.3 }}></i>
                    <span className="small">Select or add a farm to configure its geofence</span>
                  </div>
                </div>
              )}
            </div>

            <div className="card-footer py-2 d-flex justify-content-between align-items-center flex-wrap gap-1">
              {center ? (
                <small className="text-muted">
                  <i className="ri ri-crosshair-2-line me-1"></i>
                  Center: {center[0].toFixed(6)}, {center[1].toFixed(6)}
                </small>
              ) : <span />}
              {!canSave && points.length > 0 && (
                <small className="text-warning">
                  <i className="ri ri-error-warning-line me-1"></i>
                  {pointsLeft} more point{pointsLeft > 1 ? 's' : ''} needed to save
                </small>
              )}
              {canSave && (
                <small className="text-success">
                  <i className="ri ri-checkbox-circle-line me-1"></i>
                  Ready to save — {points.length} points
                </small>
              )}
            </div>
          </div>
        </div>

        {/* Points table */}
        <div className="col-lg-4">
          <div className="card h-100">
            <div className="card-header py-3 d-flex align-items-center justify-content-between">
              <span className="fw-semibold">Polygon Points</span>
              <span className={`badge rounded-pill ${canSave ? 'bg-label-success' : 'bg-label-warning'}`}>
                {points.length} / 20
              </span>
            </div>

              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0" style={{ fontSize: 12 }}>
                  <thead className="table-light">
                    <tr>
                      <th className="ps-3">Seq</th>
                      <th>Latitude</th>
                      <th>Longitude</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center text-muted py-5">
                          <i className="ri ri-map-pin-add-line d-block mb-1" style={{ fontSize: 28, opacity: 0.3 }}></i>
                          Click on the map to add points
                        </td>
                      </tr>
                    ) : points.map(pt => (
                      <tr key={pt.id}>
                        <td className="ps-3">
                          <span className="badge bg-label-primary rounded-pill">{pt.sequence}</span>
                        </td>
                        <td className="font-monospace">{pt.latitude.toFixed(6)}</td>
                        <td className="font-monospace">{pt.longitude.toFixed(6)}</td>
                        <td>
                          <button
                            className="btn btn-sm btn-icon btn-outline-danger border-0"
                            title="Remove point"
                            onClick={() => handleDeletePoint(pt)}
                          >
                            <i className="ri ri-delete-bin-line" style={{ fontSize: 13 }}></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

      {/* ── Add / Edit Farm Modal ────────────────────────────────────────────── */}
      {showModal && (
        <>
          <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">
                    <i className={`ri ${isEdit ? 'ri-edit-line' : 'ri-add-circle-line'} me-2 text-primary`}></i>
                    {isEdit ? 'Edit Farm' : 'Add Farm'}
                  </h5>
                  <button className="btn-close" onClick={() => setShowModal(false)} />
                </div>
                <div className="modal-body px-4 py-4">
                  {formError && (
                    <div className="alert alert-danger d-flex align-items-center gap-2 py-2 small mb-3">
                      <i className="ri ri-error-warning-line"></i>{formError}
                    </div>
                  )}
                  <div className="mb-3">
                    <label className="form-label fw-semibold">
                      Farm Name <span className="text-danger">*</span>
                    </label>
                    <input
                      className="form-control"
                      placeholder="e.g. Ladang Hijau"
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label fw-semibold">Address</label>
                    <input
                      className="form-control"
                      placeholder="e.g. Jalan Parit Raja, Batu Pahat"
                      value={formAddress}
                      onChange={e => setFormAddress(e.target.value)}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowModal(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={handleModalSave}
                    disabled={!formName.trim()}
                  >
                    <i className="ri ri-save-line me-1"></i>
                    {isEdit ? 'Update' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" style={{ zIndex: 1050 }} onClick={() => setShowModal(false)} />
        </>
      )}

      {/* ── Confirm Delete Farm Modal ────────────────────────────────────────── */}
      {confirmDelete && selectedFarm && (
        <>
          <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1100 }}>
            <div className="modal-dialog modal-dialog-centered modal-sm">
              <div className="modal-content">
                <div className="modal-body px-4 py-4 text-center">
                  <i className="ri ri-error-warning-line text-danger d-block mb-2" style={{ fontSize: 36 }}></i>
                  <h6 className="fw-semibold mb-1">Delete Farm?</h6>
                  <p className="text-muted small mb-0">
                    <strong>{selectedFarm.name}</strong> and all its geofence points will be permanently removed.
                  </p>
                </div>
                <div className="modal-footer justify-content-center gap-2">
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={handleDeleteFarm}>
                    <i className="ri ri-delete-bin-line me-1"></i>Yes, Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" style={{ zIndex: 1050 }} onClick={() => setConfirmDelete(false)} />
        </>
      )}
    </div>
  );
}
