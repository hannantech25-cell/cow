'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import MapClient, { type MapHandle } from './MapClient';

const API            = process.env.NEXT_PUBLIC_API_URL ?? '';
const POLL_INTERVAL  = 10_000;
const DEFAULT_CENTER: [number, number] = [1.8600, 102.9300];

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

export interface CowLocation {
  mac_address: string;
  tracker_id: string;
  board_id: string;
  location: string;
  status: string;
  battery_threshold: number;
  cow_id: number | null;
  cow_name: string | null;
  farm_id: number | null;
  farm_name: string | null;
  latitude: number | null;
  longitude: number | null;
  battery_mv: number | null;
  last_seen: string | null;
}

function getToken() {
  return localStorage.getItem('token') ?? sessionStorage.getItem('token') ?? '';
}

function authFetch(url: string) {
  return fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
}

export default function RealtimeMapClient() {
  const [farms, setFarms]                   = useState<Farm[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState<string>('');
  const [farmBoundary, setFarmBoundary]     = useState<[number, number][]>([]);
  const [mapCenter, setMapCenter]           = useState<[number, number]>(DEFAULT_CENTER);
  const [cows, setCows]                     = useState<CowLocation[]>([]);
  const [filterStatus, setFilterStatus]     = useState<'All' | 'Active' | 'Inactive'>('All');
  const [loading, setLoading]               = useState(true);
  const [lastUpdate, setLastUpdate]         = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapRef   = useRef<MapHandle>(null);

  // Load farms on mount
  useEffect(() => {
    authFetch(`${API}/api/farms`)
      .then(r => r.ok ? r.json() : [])
      .then(setFarms)
      .catch(() => {});
  }, []);

  // Fetch cow locations from backend (MySQL + InfluxDB merged)
  const fetchLocations = useCallback(async (farmId: string) => {
    try {
      const url = farmId
        ? `${API}/api/realtime/locations?farm_id=${farmId}`
        : `${API}/api/realtime/locations`;
      const res = await authFetch(url);
      if (res.ok) {
        setCows(await res.json());
        setLastUpdate(new Date());
      }
    } catch {}
    setLoading(false);
  }, []);

  // Fetch farm boundary polygon when farm selection changes
  useEffect(() => {
    if (!selectedFarmId) {
      setFarmBoundary([]);
      setMapCenter(DEFAULT_CENTER);
      return;
    }
    authFetch(`${API}/api/farms/${selectedFarmId}`)
      .then(r => r.ok ? r.json() : null)
      .then(farm => {
        if (!farm) return;
        const pts: [number, number][] = (farm.points as FarmPoint[] ?? [])
          .map((p: FarmPoint) => [Number(p.latitude), Number(p.longitude)]);
        setFarmBoundary(pts);
        if (farm.center_lat != null && farm.center_lng != null) {
          setMapCenter([Number(farm.center_lat), Number(farm.center_lng)]);
        }
      })
      .catch(() => {});
  }, [selectedFarmId]);

  // Poll locations every 10 s, restart timer when farm changes
  useEffect(() => {
    setLoading(true);
    fetchLocations(selectedFarmId);
    timerRef.current = setInterval(() => fetchLocations(selectedFarmId), POLL_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [selectedFarmId, fetchLocations]);

  // Point-in-polygon (ray casting)
  function pointInPolygon(lat: number, lng: number, polygon: [number, number][]) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      if ((yi > lng) !== (yj > lng) && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  const filtered    = filterStatus === 'All' ? cows : cows.filter(c => c.status === filterStatus);
  const selectedFarm = farms.find(f => String(f.id) === selectedFarmId);

  // Compute zone status for each tracker (used by stat cards)
  const getZone = (c: CowLocation): 'In Farm' | 'Out of Farm' | 'Unknown' => {
    if (c.latitude == null || c.longitude == null) return 'Unknown';
    if (farmBoundary.length < 3) return 'Unknown';
    return pointInPolygon(c.latitude, c.longitude, farmBoundary) ? 'In Farm' : 'Out of Farm';
  };

  return (
    <>
      {/* Page Header */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-3">
        <div>
          <h4 className="mb-1 fw-semibold">Real-Time Location</h4>
          <p className="mb-0 text-body-secondary small">Live GPS tracking for all active trackers</p>
        </div>
        <div className="d-flex align-items-center gap-3">
          {lastUpdate && (
            <small className="text-body-secondary">
              Updated: {lastUpdate.toLocaleTimeString()}
            </small>
          )}
          <div className="live-badge">
            <span className="live-dot"></span>
            <span className="badge bg-label-success fw-medium">Live Tracking Active</span>
          </div>
        </div>
      </div>

      {/* Farm Selector */}
      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <label className="form-label mb-0 fw-medium small text-nowrap">
              <i className="ri ri-map-pin-2-line me-1 text-primary"></i>
              Filter by Farm:
            </label>
            <select
              className="form-select form-select-sm"
              style={{ width: 180 }}
              value={selectedFarmId}
              onChange={e => { setSelectedFarmId(e.target.value); setLoading(true); }}>
              <option value="">All Farms</option>
              {farms.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <label className="form-label mb-0 fw-medium small text-nowrap ms-2">
              <i className="ri ri-filter-3-line me-1 text-primary"></i>
              Status:
            </label>
            <select
              className="form-select form-select-sm"
              style={{ width: 130 }}
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}>
              <option value="All">All</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => { setLoading(true); fetchLocations(selectedFarmId); }}>
              <i className="ri ri-refresh-line me-1"></i>Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="row g-4 mb-4">
        <div className="col-4">
          <div className="card mb-0 h-100">
            <div className="card-body d-flex align-items-center gap-4">
              <div className="stat-icon bg-label-success">
                <i className="ri ri-check-double-line text-success"></i>
              </div>
              <div>
                <p className="mb-0 text-body-secondary small">Inside The Fence</p>
                <h4 className="mb-0 fw-bold">
                  {loading ? '—' : filtered.filter(c => getZone(c) === 'In Farm').length}
                </h4>
              </div>
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card mb-0 h-100">
            <div className="card-body d-flex align-items-center gap-4">
              <div className="stat-icon bg-label-warning">
                <i className="ri ri-alert-line text-warning"></i>
              </div>
              <div>
                <p className="mb-0 text-body-secondary small">Outside The Fence</p>
                <h4 className="mb-0 fw-bold">
                  {loading ? '—' : filtered.filter(c => getZone(c) === 'Out of Farm').length}
                </h4>
              </div>
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card mb-0 h-100">
            <div className="card-body d-flex align-items-center gap-4">
              <div className="stat-icon bg-label-secondary">
                <i className="ri ri-question-line text-secondary"></i>
              </div>
              <div>
                <p className="mb-0 text-body-secondary small">Unknown</p>
                <h4 className="mb-0 fw-bold">
                  {loading ? '—' : filtered.filter(c => getZone(c) === 'Unknown').length}
                </h4>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Map Card */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div className="d-flex align-items-center gap-2">
            <i className="ri ri-map-2-line text-primary"></i>
            <h5 className="card-title m-0">
              Live Tracker Map
              {selectedFarm && (
                <small className="fw-normal text-body-secondary ms-2">— {selectedFarm.name}</small>
              )}
            </h5>
          </div>
          <div className="d-flex align-items-center gap-2">
            {loading && (
              <span className="spinner-border spinner-border-sm text-primary" role="status"></span>
            )}
            <button
              className="btn btn-sm btn-outline-primary"
              title="Center map to farm"
              onClick={() => mapRef.current?.centerMap()}>
              <i className="ri ri-focus-3-line me-1"></i>Center
            </button>
          </div>
        </div>
        <MapClient
          ref={mapRef}
          center={mapCenter}
          cows={filtered}
          farmBoundary={farmBoundary}
          farmName={selectedFarm?.name}
        />
      </div>

    </>
  );
}
