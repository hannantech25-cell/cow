'use client';

import { useEffect, useState } from 'react';
import HistoricalMapClient from './HistoricalMapClient';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Farm {
  id: number;
  name: string;
  center_lat: number | null;
  center_lng: number | null;
}

interface FarmPoint {
  latitude: number;
  longitude: number;
}

interface Cow {
  id: number;
  name: string;
  farm_id: number | null;
  tag_number: string | null;
  status: 'Pair' | 'Unpair';
}

export interface TrackPoint {
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  battery_percent?: number;
  battery_mv?: number;
  rssi?: number;
  fix_valid?: boolean;
  time: string;
}

function getToken() {
  return localStorage.getItem('token') ?? sessionStorage.getItem('token') ?? '';
}

function authFetch(url: string) {
  return fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// Ray-casting point-in-polygon for farm fence
function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  const n = polygon.length;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

function getFenceStatus(lat: number, lng: number, boundary: [number, number][]): 'Inside' | 'Outside' | 'Unknown' {
  if (boundary.length < 3) return 'Unknown';
  return pointInPolygon(lat, lng, boundary) ? 'Inside' : 'Outside';
}

// LiPo single-cell: 4200 mV = 100 %, 3000 mV = 0 %
function batteryPercent(mv: number | null | undefined): number | null {
  if (mv == null) return null;
  return Math.min(100, Math.max(0, Math.round((mv - 3000) / (4200 - 3000) * 100)));
}

function formatTimeKL(utcStr: string) {
  return new Date(utcStr).toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

export default function HistoricalLocationClient() {
  const [farms, setFarms]                       = useState<Farm[]>([]);
  const [cows, setCows]                         = useState<Cow[]>([]);
  const [selectedFarmId, setSelectedFarmId]     = useState('');
  const [selectedCowId, setSelectedCowId]       = useState('');
  const [selectedDate, setSelectedDate]         = useState(todayStr());
  const [selectedDateTo, setSelectedDateTo]     = useState('');
  const [farmBoundary, setFarmBoundary]         = useState<[number, number][]>([]);
  const [farmName, setFarmName]                 = useState('');
  const [points, setPoints]                     = useState<TrackPoint[]>([]);
  const [loading, setLoading]                   = useState(false);
  const [applied, setApplied]                   = useState(false);
  const [error, setError]                       = useState('');

  // Table state
  const [pageSize, setPageSize]                 = useState<20 | 50 | 100>(20);
  const [currentPage, setCurrentPage]           = useState(1);

  // Reset to page 1 whenever results change
  useEffect(() => { setCurrentPage(1); }, [points]);

  useEffect(() => {
    authFetch(`${API}/api/farms`)
      .then(r => r.ok ? r.json() : [])
      .then(setFarms)
      .catch(() => {});

    authFetch(`${API}/api/cows`)
      .then(r => r.ok ? r.json() : [])
      .then((all: Cow[]) => setCows(all.filter(c => c.status === 'Pair' && c.tag_number)))
      .catch(() => {});
  }, []);

  const filteredCows = selectedFarmId
    ? cows.filter(c => String(c.farm_id) === selectedFarmId)
    : cows;

  function handleFarmChange(farmId: string) {
    setSelectedFarmId(farmId);
    setSelectedCowId('');
    setFarmBoundary([]);
    setFarmName('');
    if (!farmId) return;
    authFetch(`${API}/api/farms/${farmId}`)
      .then(r => r.ok ? r.json() : null)
      .then(farm => {
        if (!farm) return;
        setFarmName(farm.name);
        const pts: [number, number][] = (farm.points as FarmPoint[] ?? [])
          .map((p: FarmPoint) => [Number(p.latitude), Number(p.longitude)]);
        setFarmBoundary(pts);
      })
      .catch(() => {});
  }

  async function handleApply() {
    const cow = cows.find(c => String(c.id) === selectedCowId);
    if (!cow?.tag_number) { setError('Please select a paired cow.'); return; }
    if (!selectedDate)    { setError('Please select a date.'); return; }
    setError('');
    setLoading(true);
    setApplied(true);
    try {
      let url = `${API}/api/realtime/history?board_id=${encodeURIComponent(cow.tag_number)}&date=${selectedDate}`;
      if (selectedDateTo) url += `&date_to=${selectedDateTo}`;
      const res = await authFetch(url);
      if (res.ok) {
        setPoints(await res.json());
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to load history.');
        setPoints([]);
      }
    } catch {
      setError('Network error. Please try again.');
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }

  // --- CSV export ---
  function exportCSV() {
    const cow  = cows.find(c => String(c.id) === selectedCowId);
    const name = cow?.name ?? 'cow';
    const range = selectedDateTo ? `${selectedDate}_to_${selectedDateTo}` : selectedDate;
    const header = ['#', 'Time Stamp', 'Latitude', 'Longitude', 'Battery (V)', 'Battery (%)', 'RSSI (dBm)', 'Fence'];
    const rows = points.map((p, i) => [
      i + 1,
      `"${formatTimeKL(p.time)}"`,
      p.latitude.toFixed(6),
      p.longitude.toFixed(6),
      p.battery_mv != null ? (p.battery_mv / 1000).toFixed(2) : '',
      batteryPercent(p.battery_mv) ?? '',
      p.rssi ?? '',
      getFenceStatus(p.latitude, p.longitude, farmBoundary),
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `track_${name}_${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- PDF export (styled print window) ---
  function exportPDF() {
    const cow  = cows.find(c => String(c.id) === selectedCowId);
    const farm = farms.find(f => String(f.id) === selectedFarmId);
    const tableRows = points.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${formatTimeKL(p.time)}</td>
        <td>${p.latitude.toFixed(6)}</td>
        <td>${p.longitude.toFixed(6)}</td>
        <td>${p.battery_mv != null ? (p.battery_mv / 1000).toFixed(2) + ' V' : '-'}</td>
        <td>${batteryPercent(p.battery_mv) != null ? batteryPercent(p.battery_mv) + '%' : '-'}</td>
        <td>${p.rssi != null ? p.rssi + ' dBm' : '-'}</td>
        <td>${getFenceStatus(p.latitude, p.longitude, farmBoundary)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Track Data - ${cow?.name ?? 'Cow'}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Arial,sans-serif; font-size:11px; padding:28px; color:#222; }
    .hdr { border-bottom:2px solid #696cff; padding-bottom:10px; margin-bottom:16px; }
    .hdr h2 { font-size:15px; color:#696cff; margin-bottom:5px; }
    .hdr p  { color:#555; margin-top:3px; }
    table { width:100%; border-collapse:collapse; }
    thead th { background:#696cff; color:#fff; padding:7px 10px; text-align:left; }
    tbody td { padding:5px 10px; border-bottom:1px solid #eee; }
    tbody tr:nth-child(even) td { background:#f5f4ff; }
    .ftr { margin-top:12px; font-size:9px; color:#aaa; text-align:right; }
    @media print { body { padding:12px; } }
  </style>
</head>
<body>
  <div class="hdr">
    <h2>Historical Track Data</h2>
    <p>Cow: <strong>${cow?.name ?? '-'}</strong> &nbsp;|&nbsp; Tracker: ${cow?.tag_number ?? '-'} &nbsp;|&nbsp; Farm: ${farm?.name ?? farmName ?? '-'}</p>
    <p>Period: ${selectedDate}${selectedDateTo ? ' to ' + selectedDateTo : ''} &nbsp;|&nbsp; ${points.length} data points</p>
  </div>
  <table>
    <thead><tr><th>#</th><th>Time Stamp</th><th>Latitude</th><th>Longitude</th><th>Battery (V)</th><th>Battery (%)</th><th>RSSI (dBm)</th><th>Fence</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="ftr">Generated ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })} KL</div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); }<\/script>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=860,height=700');
    if (win) { win.document.write(html); win.document.close(); }
  }

  // --- Pagination helpers ---
  const totalPages  = Math.max(1, Math.ceil(points.length / pageSize));
  const safePageSize = pageSize as number;
  const pageStart   = (currentPage - 1) * safePageSize;
  const pageRows    = points.slice(pageStart, pageStart + safePageSize);

  function buildPageNums() {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | null)[] = [];
    pages.push(1);
    if (currentPage > 3) pages.push(null);
    for (let p = Math.max(2, currentPage - 1); p <= Math.min(totalPages - 1, currentPage + 1); p++) pages.push(p);
    if (currentPage < totalPages - 2) pages.push(null);
    pages.push(totalPages);
    return pages;
  }

  const selectedCow  = cows.find(c => String(c.id) === selectedCowId);
  const selectedFarm = farms.find(f => String(f.id) === selectedFarmId);

  return (
    <>
      {/* Page Header */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-3">
        <div>
          <h4 className="mb-1 fw-semibold">Historical Location</h4>
          <p className="mb-0 text-body-secondary small">Replay a cow&apos;s movement path for any selected day</p>
        </div>
      </div>

      {/* Filter Card */}
      <div className="card mb-4">
        <div className="card-body">
          {error && (
            <div className="alert alert-danger d-flex align-items-center gap-2 py-2 small mb-3">
              <i className="ri ri-error-warning-line flex-shrink-0"></i>{error}
            </div>
          )}
          <div className="row g-3 align-items-end">
            <div className="col-sm-6 col-md-3">
              <label className="form-label fw-medium small mb-1">
                <i className="ri ri-map-pin-2-line me-1 text-primary"></i>Farm
              </label>
              <select
                className="form-select form-select-sm"
                value={selectedFarmId}
                onChange={e => handleFarmChange(e.target.value)}>
                <option value="">All Farms</option>
                {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>

            <div className="col-sm-6 col-md-3">
              <label className="form-label fw-medium small mb-1">
                <i className="ri ri-profile-line me-1 text-primary"></i>Cow
              </label>
              <select
                className="form-select form-select-sm"
                value={selectedCowId}
                onChange={e => setSelectedCowId(e.target.value)}>
                <option value="">— Select Cow —</option>
                {filteredCows.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.tag_number ? ` (${c.tag_number})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-sm-6 col-md-2">
              <label className="form-label fw-medium small mb-1">
                <i className="ri ri-calendar-line me-1 text-primary"></i>From
              </label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={selectedDate}
                max={todayStr()}
                onChange={e => setSelectedDate(e.target.value)} />
            </div>

            <div className="col-sm-6 col-md-2">
              <label className="form-label fw-medium small mb-1">
                <i className="ri ri-calendar-2-line me-1 text-primary"></i>To
              </label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={selectedDateTo}
                max={todayStr()}
                onChange={e => setSelectedDateTo(e.target.value)} />
            </div>

            <div className="col-sm-6 col-md-2">
              <button
                className="btn btn-sm btn-primary w-100"
                onClick={handleApply}
                disabled={loading || !selectedCowId || !selectedDate}>
                {loading
                  ? <><span className="spinner-border spinner-border-sm me-1"></span>Loading…</>
                  : <><i className="ri ri-route-line me-1"></i>Show Movement</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Map Card */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center justify-content-between flex-wrap gap-3">
          <div className="d-flex align-items-center gap-2">
            <i className="ri ri-route-line text-primary"></i>
            <h5 className="card-title m-0">
              {applied && selectedCow
                ? <>Movement Path &mdash; {selectedCow.name}</>
                : 'Movement Path'}
            </h5>
          </div>
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <span className="d-flex align-items-center gap-1 small">
              <span className="point-dot" style={{ background: '#1C1C1C' }}></span> Start
            </span>
            <span className="d-flex align-items-center gap-1 small">
              <span style={{ display: 'inline-block', width: 24, height: 3, background: '#696cff', borderRadius: 2 }}></span> Path
            </span>
            <span className="d-flex align-items-center gap-1 small">
              <span className="point-dot" style={{ background: '#dc3545' }}></span> End
            </span>
            <span className="d-flex align-items-center gap-1 small">
              <span className="point-dot" style={{ background: '#28a745' }}></span> Waypoint
            </span>
          </div>
        </div>
        <HistoricalMapClient
          points={points}
          farmBoundary={farmBoundary}
          farmName={farmName || selectedFarm?.name}
          loading={loading}
          applied={applied}
        />
      </div>

      {/* Raw Data Table */}
      <div className="card">
        <div className="card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div className="d-flex align-items-center gap-2">
            <i className="ri ri-table-line text-primary"></i>
            <h5 className="card-title m-0">Raw Data</h5>
            {applied && (
              <span className="badge bg-label-secondary ms-1">
                {points.length} record{points.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {applied && points.length > 0 && (
            <div className="d-flex align-items-center gap-2">
              <button
                className="btn btn-sm btn-outline-success d-flex align-items-center gap-1"
                onClick={exportCSV}
                title="Download as CSV">
                <i className="ri ri-file-excel-2-line"></i>
                <span>CSV</span>
              </button>
              <button
                className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1"
                onClick={exportPDF}
                title="Download as PDF">
                <i className="ri ri-file-pdf-2-line"></i>
                <span>PDF</span>
              </button>
            </div>
          )}
        </div>

        {/* Rows-per-page control */}
        {applied && points.length > 0 && (
          <div className="px-3 pt-3 pb-1 d-flex align-items-center gap-2">
            <span className="small text-body-secondary">Rows per page:</span>
            {([20, 50, 100] as const).map(n => (
              <button
                key={n}
                className={`btn btn-xs px-2 py-0 ${pageSize === n ? 'btn-primary' : 'btn-outline-secondary'}`}
                style={{ fontSize: '0.75rem', lineHeight: '1.6' }}
                onClick={() => { setPageSize(n); setCurrentPage(1); }}>
                {n}
              </button>
            ))}
            <span className="small text-body-secondary ms-auto">
              Showing {points.length === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + safePageSize, points.length)} of {points.length}
            </span>
          </div>
        )}

        {/* Table */}
        {!applied ? (
          <div className="text-center py-5">
            <i className="ri ri-table-line text-body-secondary" style={{ fontSize: 36 }}></i>
            <p className="text-body-secondary small mt-2 mb-0">Select a cow and date range, then click Show Movement.</p>
          </div>
        ) : loading ? (
          <div className="text-center py-5">
            <div className="spinner-border text-primary" style={{ width: 28, height: 28 }}></div>
            <p className="text-body-secondary small mt-2 mb-0">Loading data…</p>
          </div>
        ) : points.length === 0 ? (
          <div className="text-center py-5">
            <i className="ri ri-inbox-line text-body-secondary" style={{ fontSize: 36 }}></i>
            <p className="text-body-secondary small mt-2 mb-0">No records found for the selected range.</p>
          </div>
        ) : (
          <>
            <div className="table-responsive">
              <table className="table table-hover table-sm mb-0">
                <thead className="table-light">
                  <tr>
                    <th className="ps-3" style={{ width: 52 }}>#</th>
                    <th>Time Stamp</th>
                    <th>Latitude</th>
                    <th>Longitude</th>
                    <th>Battery (V)</th>
                    <th>Battery (%)</th>
                    <th>RSSI (dBm)</th>
                    <th>Fence</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p, idx) => {
                    const fence = getFenceStatus(p.latitude, p.longitude, farmBoundary);
                    return (
                    <tr key={p.time + idx}>
                      <td className="ps-3 text-body-secondary small">{pageStart + idx + 1}</td>
                      <td className="small">{formatTimeKL(p.time)}</td>
                      <td className="small font-monospace">{p.latitude.toFixed(6)}</td>
                      <td className="small font-monospace">{p.longitude.toFixed(6)}</td>
                      <td className="small">{p.battery_mv != null ? `${(p.battery_mv / 1000).toFixed(2)} V` : '—'}</td>
                      <td className="small">
                        {batteryPercent(p.battery_mv) != null ? (
                          <span className={
                            batteryPercent(p.battery_mv)! >= 50 ? 'text-success fw-medium' :
                            batteryPercent(p.battery_mv)! >= 20 ? 'text-warning fw-medium' :
                                                                   'text-danger fw-medium'
                          }>
                            {batteryPercent(p.battery_mv)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="small">
                        {p.rssi != null ? (
                          <span className={
                            p.rssi >= -70 ? 'text-success fw-medium' :
                            p.rssi >= -80 ? 'text-warning fw-medium' :
                                            'text-danger fw-medium'
                          }>
                            {p.rssi} dBm
                          </span>
                        ) : '—'}
                      </td>
                      <td className="small">
                        <span className={
                          fence === 'Inside'  ? 'text-success fw-medium' :
                          fence === 'Outside' ? 'text-danger fw-medium'  :
                                               'text-body-secondary'
                        }>
                          {fence}
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="card-footer d-flex align-items-center justify-content-between flex-wrap gap-2 py-2">
                <span className="small text-body-secondary">
                  Page {currentPage} of {totalPages}
                </span>
                <nav>
                  <ul className="pagination pagination-sm mb-0">
                    <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
                      <button className="page-link" onClick={() => setCurrentPage(1)} title="First">
                        <i className="ri ri-skip-back-line"></i>
                      </button>
                    </li>
                    <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
                      <button className="page-link" onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>
                        <i className="ri ri-arrow-left-s-line"></i>
                      </button>
                    </li>
                    {buildPageNums().map((pg, i) =>
                      pg === null ? (
                        <li key={`ellipsis-${i}`} className="page-item disabled">
                          <span className="page-link px-2">…</span>
                        </li>
                      ) : (
                        <li key={pg} className={`page-item ${currentPage === pg ? 'active' : ''}`}>
                          <button className="page-link" onClick={() => setCurrentPage(pg)}>{pg}</button>
                        </li>
                      )
                    )}
                    <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
                      <button className="page-link" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
                        <i className="ri ri-arrow-right-s-line"></i>
                      </button>
                    </li>
                    <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
                      <button className="page-link" onClick={() => setCurrentPage(totalPages)} title="Last">
                        <i className="ri ri-skip-forward-line"></i>
                      </button>
                    </li>
                  </ul>
                </nav>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
