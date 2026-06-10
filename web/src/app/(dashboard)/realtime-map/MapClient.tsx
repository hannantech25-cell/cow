'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { CowLocation } from './RealtimeMapClient';

interface Props {
  center: [number, number];
  zoom?: number;
  cows: CowLocation[];
  farmBoundary: [number, number][];
  farmName?: string;
}

export interface MapHandle {
  centerMap: () => void;
}

const MapClient = forwardRef<MapHandle, Props>(function MapClient(
  { center, zoom = 15, cows, farmBoundary, farmName },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const markersRef   = useRef<any[]>([]);
  const polygonRef   = useRef<any>(null);

  // Expose centerMap() to parent via ref
  useImperativeHandle(ref, () => ({
    centerMap() {
      const map = mapRef.current;
      if (!map) return;
      if (polygonRef.current) {
        map.fitBounds(polygonRef.current.getBounds(), { padding: [40, 40], maxZoom: 17 });
      } else {
        map.setView(center, zoom);
      }
    },
  }));

  // Init map once on mount
  useEffect(() => {
    if (!containerRef.current) return;
    let mounted = true;

    import('leaflet').then(L => {
      if (!mounted || !containerRef.current) return;
      if ((containerRef.current as any)._leaflet_id) return;

      const map = L.map(containerRef.current).setView(center, zoom);
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

  // Farm boundary polygon — redraws and auto-fits whenever the farm changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    import('leaflet').then(L => {
      // Remove old polygon
      if (polygonRef.current) {
        map.removeLayer(polygonRef.current);
        polygonRef.current = null;
      }

      if (farmBoundary.length >= 3) {
        const poly = L.polygon(farmBoundary, {
          color: '#696cff', fillColor: '#696cff',
          fillOpacity: 0.08, weight: 2, dashArray: '6,4',
        })
          .addTo(map)
          .bindPopup(`<strong>${farmName ?? 'Farm Boundary'}</strong>`);
        polygonRef.current = poly;
        // Fit map to show the entire farm polygon
        map.fitBounds(poly.getBounds(), { padding: [40, 40], maxZoom: 17 });
      } else {
        // No farm selected — return to default center
        map.setView(center, zoom);
      }
    });
  }, [farmBoundary, farmName, center, zoom]);

  // Cow markers — updates on every poll without touching zoom/pan
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    import('leaflet').then(L => {
      // Clear existing markers
      markersRef.current.forEach(m => map.removeLayer(m));
      markersRef.current = [];

      cows.forEach(c => {
        if (c.latitude == null || c.longitude == null) return;

        const bat    = c.battery_mv ?? 0;
        const lowBat = bat < 3500;
        const color  = lowBat ? '#ffc107' : '#28a745';

        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:32px;height:32px;border-radius:50%;
            background:${color};border:3px solid #fff;
            box-shadow:0 2px 6px rgba(0,0,0,0.3);
            display:flex;align-items:center;justify-content:center;font-size:15px;">🐄</div>`,
          iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -18],
        });

        const lastSeen = c.last_seen
          ? new Date(c.last_seen).toLocaleString()
          : 'No data';

        const marker = L.marker([c.latitude, c.longitude], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="min-width:170px">
              <strong style="font-size:14px">🐄 ${c.cow_name ?? c.tracker_id}</strong><br>
              <small style="color:#888">Board ID: <code>${c.board_id}</code></small>
              ${c.farm_name ? `<br><small style="color:#888">Farm: ${c.farm_name}</small>` : ''}
              <hr style="margin:6px 0">
              🔋 Battery: <strong>${(bat / 1000).toFixed(1)}V</strong><br>
              🕐 <small>${lastSeen}</small>
            </div>
          `);

        markersRef.current.push(marker);
      });
    });
  }, [cows]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div
        ref={containerRef}
        style={{ height: '520px', width: '100%', borderRadius: '0 0 0.5rem 0.5rem', zIndex: 1 }}
      />
    </>
  );
});

export default MapClient;
