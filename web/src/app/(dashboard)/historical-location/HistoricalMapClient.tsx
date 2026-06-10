'use client';

import { useEffect, useRef } from 'react';
import type { TrackPoint } from './HistoricalLocationClient';

interface Props {
  points: TrackPoint[];
  farmBoundary?: [number, number][];
  farmName?: string;
  loading?: boolean;
  applied?: boolean;
}

const DEFAULT_CENTER: [number, number] = [1.8600, 102.9300];
const DEFAULT_ZOOM = 14;

function makeCircle(color: string, size: number, label = '') {
  return `<div style="
    width:${size}px;height:${size}px;border-radius:50%;
    background:${color};border:2px solid #fff;
    box-shadow:0 2px 5px rgba(0,0,0,0.35);
    display:flex;align-items:center;justify-content:center;
    color:#fff;font-size:9px;font-weight:700;line-height:1;">
    ${label}
  </div>`;
}

export default function HistoricalMapClient({ points, farmBoundary = [], farmName, loading, applied }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const layersRef    = useRef<any[]>([]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current) return;
    let mounted = true;

    import('leaflet').then(L => {
      if (!mounted || !containerRef.current) return;
      if ((containerRef.current as any)._leaflet_id) return;

      const map = L.map(containerRef.current).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);
    });

    return () => {
      mounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw path + boundary whenever data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    import('leaflet').then(L => {
      // Clear all previous layers
      layersRef.current.forEach(l => map.removeLayer(l));
      layersRef.current = [];

      // Farm boundary polygon
      if (farmBoundary.length >= 3) {
        const poly = L.polygon(farmBoundary, {
          color: '#696cff', fillColor: '#696cff',
          fillOpacity: 0.08, weight: 2, dashArray: '6,4',
        })
          .addTo(map)
          .bindPopup(`<strong>${farmName ?? 'Farm Boundary'}</strong>`);
        layersRef.current.push(poly);
      }

      if (!points.length) {
        // No track data — just show farm boundary (if any) or default view
        if (farmBoundary.length >= 3) {
          const tempPoly = L.polygon(farmBoundary);
          map.fitBounds(tempPoly.getBounds(), { padding: [40, 40], maxZoom: 17 });
          map.removeLayer(tempPoly);
        } else {
          map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
        }
        return;
      }

      const latlngs: [number, number][] = points.map(p => [p.latitude, p.longitude]);

      // Path polyline
      const polyline = L.polyline(latlngs, {
        color: '#696cff', weight: 3, opacity: 0.85,
      }).addTo(map);
      layersRef.current.push(polyline);

      // Waypoint markers (intermediate points)
      points.slice(1, -1).forEach((p, i) => {
        const icon = L.divIcon({
          className: '',
          html: makeCircle('#28a745', 10),
          iconSize: [10, 10], iconAnchor: [5, 5], popupAnchor: [0, -8],
        });
        const time = new Date(p.time).toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit',
        });
        const m = L.marker([p.latitude, p.longitude], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="min-width:140px">
              <strong>Waypoint ${i + 2}</strong><br>
              🕐 ${time}<br>
              ⚡ Speed: ${p.speed != null ? p.speed.toFixed(2) + ' km/h' : '—'}<br>
              🔋 Battery: ${p.battery_mv != null ? p.battery_mv + ' mV' : p.battery_percent != null ? p.battery_percent + '%' : '—'}
            </div>
          `);
        layersRef.current.push(m);
      });

      // Start marker
      const first = points[0];
      const startTime = new Date(first.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const startIcon = L.divIcon({
        className: '',
        html: makeCircle('#1C1C1C', 16, 'S'),
        iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -10],
      });
      const startMarker = L.marker([first.latitude, first.longitude], { icon: startIcon })
        .addTo(map)
        .bindPopup(`
          <div style="min-width:140px">
            <strong>🟤 Start</strong><br>
            🕐 ${startTime}<br>
            ⚡ Speed: ${first.speed != null ? first.speed.toFixed(2) + ' km/h' : '—'}<br>
            🔋 Battery: ${first.battery_mv != null ? first.battery_mv + ' mV' : first.battery_percent != null ? first.battery_percent + '%' : '—'}
          </div>
        `);
      layersRef.current.push(startMarker);

      // End marker
      const last = points[points.length - 1];
      const endTime = new Date(last.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const endIcon = L.divIcon({
        className: '',
        html: makeCircle('#dc3545', 16, 'E'),
        iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -10],
      });
      const endMarker = L.marker([last.latitude, last.longitude], { icon: endIcon })
        .addTo(map)
        .bindPopup(`
          <div style="min-width:140px">
            <strong>🔴 End</strong><br>
            🕐 ${endTime}<br>
            ⚡ Speed: ${last.speed != null ? last.speed.toFixed(2) + ' km/h' : '—'}<br>
            🔋 Battery: ${last.battery_mv != null ? last.battery_mv + ' mV' : last.battery_percent != null ? last.battery_percent + '%' : '—'}
          </div>
        `);
      layersRef.current.push(endMarker);

      // Fit map to show the full path
      map.fitBounds(polyline.getBounds(), { padding: [48, 48], maxZoom: 17 });
    });
  }, [points, farmBoundary, farmName]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div style={{ position: 'relative' }}>
        {/* Overlay when not yet applied */}
        {!applied && !loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            background: 'rgba(255,255,255,0.75)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            borderRadius: '0 0 0.5rem 0.5rem',
          }}>
            <i className="ri ri-route-line text-body-secondary" style={{ fontSize: 40 }}></i>
            <p className="text-body-secondary small mt-2 mb-0 fw-medium">
              Select a farm, cow and date, then click Show Movement
            </p>
          </div>
        )}
        {/* Loading overlay */}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            background: 'rgba(255,255,255,0.75)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            borderRadius: '0 0 0.5rem 0.5rem',
          }}>
            <div className="spinner-border text-primary" style={{ width: 36, height: 36 }}></div>
            <p className="text-body-secondary small mt-2 mb-0">Loading movement data…</p>
          </div>
        )}
        <div
          ref={containerRef}
          style={{ height: '480px', width: '100%', borderRadius: '0 0 0.5rem 0.5rem', zIndex: 1 }}
        />
      </div>
    </>
  );
}
