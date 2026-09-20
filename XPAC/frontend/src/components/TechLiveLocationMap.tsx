import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import pusher from '../services/pusherService';
import apiClient from '../config/api';
import { ColorPalette } from '../services/settingsColorPaletteService';

export interface TechLocation {
  user_id: number;
  full_name: string;
  username?: string;
  email_address?: string;
  employee_id?: string | null;
  profile_picture?: string | null;
  role_id?: number;
  latitude: number | null;
  longitude: number | null;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  status?: string;
  last_updated_at?: string | null;
  age_seconds?: number | null;
}

interface Props {
  data: TechLocation[];
  isDarkMode: boolean;
  colorPalette?: ColorPalette | null;
}

// Must match the backend stale window (TechnicianLocationController::STALE_SECONDS).
const STALE_MS = 2 * 60 * 1000;
const MANILA: [number, number] = [14.5995, 120.9842];

const STATUS_COLORS: Record<string, string> = {
  online: '#22c55e',
  stale: '#f59e0b',
  offline: '#9ca3af',
};

// Derive a live status from the last update time so markers age between polls.
function liveStatus(tech: TechLocation, now: number): 'online' | 'stale' | 'offline' {
  if (tech.status === 'offline') return 'offline';
  if (!tech.last_updated_at) return 'stale';
  const ts = new Date(tech.last_updated_at.replace(' ', 'T')).getTime();
  if (isNaN(ts)) return 'stale';
  return now - ts <= STALE_MS ? 'online' : 'stale';
}

// ── GPS fix-quality filtering ────────────────────────────────────────────────
// Stops a single noisy device from scattering its marker across the map by
// rejecting invalid coordinates, coarse-accuracy fixes, and impossible jumps.
const ACCURACY_LIMIT_M = 150;        // discard fixes with a reported accuracy worse than this
const MAX_PLAUSIBLE_SPEED_MS = 70;   // ~250 km/h; a bigger implied speed is treated as noise
const JUMP_GUARD_MIN_M = 200;        // only teleport-guard jumps larger than this

function isValidCoord(lat: any, lng: any): boolean {
  return typeof lat === 'number' && typeof lng === 'number'
    && isFinite(lat) && isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0);
}

function tsMs(t?: string | null): number {
  if (!t) return NaN;
  return new Date(t.replace(' ', 'T')).getTime();
}

function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Whether an incoming fix should replace the technician's current position.
function shouldAcceptFix(incoming: TechLocation, prev?: TechLocation): boolean {
  if (!isValidCoord(incoming.latitude, incoming.longitude)) return false;
  if (typeof incoming.accuracy === 'number' && isFinite(incoming.accuracy) && incoming.accuracy > ACCURACY_LIMIT_M) {
    return false;
  }
  if (prev && isValidCoord(prev.latitude, prev.longitude)) {
    const dt = (tsMs(incoming.last_updated_at) - tsMs(prev.last_updated_at)) / 1000;
    const dist = metersBetween(prev.latitude as number, prev.longitude as number, incoming.latitude as number, incoming.longitude as number);
    if (isFinite(dt) && dt > 0 && dist > JUMP_GUARD_MIN_M && (dist / dt) > MAX_PLAUSIBLE_SPEED_MS) {
      return false;
    }
  }
  return true;
}

// Merge an incoming record: accept a good fix, otherwise keep the last good position
// while still updating non-positional metadata (status / last_updated_at).
function mergeFix(prev: TechLocation | undefined, incoming: TechLocation): TechLocation {
  if (shouldAcceptFix(incoming, prev)) {
    return { ...prev, ...incoming };
  }
  return {
    ...prev,
    ...incoming,
    latitude: prev?.latitude ?? null,
    longitude: prev?.longitude ?? null,
  };
}

function timeAgo(iso?: string | null): string {
  if (!iso) return 'never';
  const ts = new Date(iso.replace(' ', 'T')).getTime();
  if (isNaN(ts)) return iso;
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Smoothly slide a marker from its current position to `to` (Life360-style movement).
function animateMarker(marker: any, to: [number, number], duration = 900): void {
  const from = marker.getLatLng();
  if (from.lat === to[0] && from.lng === to[1]) return;
  if (marker._raf) cancelAnimationFrame(marker._raf);
  const start = performance.now();
  const step = (t: number) => {
    const p = Math.min(1, (t - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    marker.setLatLng([from.lat + (to[0] - from.lat) * eased, from.lng + (to[1] - from.lng) * eased]);
    if (p < 1) marker._raf = requestAnimationFrame(step);
  };
  marker._raf = requestAnimationFrame(step);
}

function markerHtml(color: string, status: string, initials: string, profilePic?: string | null): string {
  const inner = profilePic
    ? `<img src="${escapeHtml(profilePic)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
    : `<span style="font-size:11px;font-weight:700;color:#fff;">${escapeHtml(initials)}</span>`;
  return `
    <div style="position:relative;width:36px;height:36px;">
      <div style="width:36px;height:36px;border-radius:50%;background:${color};
        border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);
        display:flex;align-items:center;justify-content:center;overflow:hidden;">${inner}</div>
      ${status === 'online' ? `<span style="position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;
        border-radius:50%;background:${color};border:2px solid #fff;"></span>` : ''}
    </div>`;
}

function escapeHtml(v: any): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// How long the map must sit idle (no user pan/zoom) before auto-fit resumes.
const AUTOFIT_RESUME_MS = 4000;

const TechLiveLocationMap: React.FC<Props> = ({ data, isDarkMode, colorPalette }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const markersRef = useRef<Record<number, any>>({});
  const trailRef = useRef<any>(null);
  const leafletReady = useRef(false);
  const didFit = useRef(false);
  // Suppress auto-fit while the user is interacting with the map; resume when idle.
  const userMovingRef = useRef(false);
  const idleTimerRef = useRef<any>(null);
  const programmaticRef = useRef(false); // true while WE move the map (fit/setView)
  const [ready, setReady] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // Single-select technician whose daily trail is shown (null = none).
  const [selectedTechId, setSelectedTechId] = useState<number | null>(null);

  // Merge polled snapshots with live Pusher pushes into one map keyed by user_id.
  const [techs, setTechs] = useState<Record<number, TechLocation>>({});

  // 1) Load Leaflet (reuse the global if another component already loaded it).
  useEffect(() => {
    let cancelled = false;

    const init = () => {
      if (cancelled || mapObj.current || !mapRef.current) return;
      const L = (window as any).L;
      if (!L) return;

      const map = L.map(mapRef.current, { zoomControl: true, attributionControl: true })
        .setView(MANILA, 12);
      // Free OpenStreetMap tiles only — attribution is required by OSM's tile usage policy.
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);

      // Pause auto-fit the moment the user starts panning/zooming, and resume it only
      // after the map has been idle for AUTOFIT_RESUME_MS. Our own programmatic moves
      // (fitBounds/setView) are flagged so they don't count as user interaction.
      map.on('movestart zoomstart', () => {
        if (programmaticRef.current) return;
        userMovingRef.current = true;
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      });
      map.on('moveend zoomend', () => {
        if (programmaticRef.current) return;
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
          userMovingRef.current = false;
          setNowTick(Date.now()); // re-run the reconcile so auto-fit can resume
        }, AUTOFIT_RESUME_MS);
      });

      mapObj.current = map;
      leafletReady.current = true;
      setReady(true);
      setTimeout(() => map.invalidateSize(), 200);
    };

    if ((window as any).L) {
      init();
    } else {
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
      let script = document.getElementById('leaflet-js') as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement('script');
        script.id = 'leaflet-js';
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', init);
    }

    return () => {
      cancelled = true;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      Object.values(markersRef.current).forEach((m: any) => {
        if (m && m._raf) cancelAnimationFrame(m._raf);
      });
      markersRef.current = {};
      trailRef.current = null;
      if (mapObj.current) {
        mapObj.current.remove();
        mapObj.current = null;
      }
    };
  }, []);

  // 2) Seed / refresh from the polled `data` prop (authoritative snapshot).
  //    Filter each fix against the last good position so a noisy device stays put
  //    instead of scattering across the map.
  useEffect(() => {
    setTechs((prev) => {
      const next: Record<number, TechLocation> = {};
      (data || []).forEach((t) => {
        if (!t || t.user_id == null) return;
        next[t.user_id] = mergeFix(prev[t.user_id], t);
      });
      return next;
    });
  }, [data]);

  // 3) Live updates via Soketi/Pusher — upsert individual technicians instantly.
  useEffect(() => {
    const channel = pusher.subscribe('technician-locations');
    const onUpdate = (payload: TechLocation) => {
      if (!payload || payload.user_id == null) return;
      setTechs((prev) => ({ ...prev, [payload.user_id]: mergeFix(prev[payload.user_id], payload) }));
    };
    channel.bind('location-updated', onUpdate);
    return () => {
      channel.unbind('location-updated', onUpdate);
      pusher.unsubscribe('technician-locations');
    };
  }, []);

  // 4) Re-evaluate staleness periodically and keep the map sized to its container.
  useEffect(() => {
    const id = setInterval(() => {
      setNowTick(Date.now());
      if (mapObj.current) mapObj.current.invalidateSize();
    }, 20000);
    return () => clearInterval(id);
  }, []);

  const techList = useMemo(() => Object.values(techs), [techs]);

  // Draw / clear the breadcrumb trail for one technician (fetched on marker click).
  const clearTrail = () => {
    if (trailRef.current && mapObj.current) {
      mapObj.current.removeLayer(trailRef.current);
      trailRef.current = null;
    }
  };
  const loadTrail = async (userId: number) => {
    try {
      const L = (window as any).L;
      const res: any = await apiClient.get(`/technician-locations/${userId}/trail`, { params: { scope: 'today' } });
      const pts: [number, number][] = ((res.data && res.data.data) || [])
        .map((p: any) => [p.latitude, p.longitude] as [number, number]);
      clearTrail();
      if (pts.length >= 2 && mapObj.current && L) {
        trailRef.current = L.polyline(pts, {
          color: colorPalette?.primary || '#7c3aed',
          weight: 4,
          opacity: 0.75,
        }).addTo(mapObj.current);
      }
    } catch (e) {
      /* ignore trail fetch errors */
    }
  };

  // 5) Reconcile markers whenever data / theme / time changes — persistent markers are
  //    reused and animated to new positions (no clear-and-recreate), so movement is smooth.
  useEffect(() => {
    if (!ready || !mapObj.current || !layerRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    const bounds: [number, number][] = [];
    const seen = new Set<number>();

    techList.forEach((tech) => {
      if (tech.latitude == null || tech.longitude == null) return;
      seen.add(tech.user_id);
      const status = liveStatus(tech, nowTick);
      const color = STATUS_COLORS[status] || STATUS_COLORS.offline;
      // Initials = first letter of the first name + first two letters of the last name
      // (e.g. "John Smith" -> "JSm"). Falls back gracefully for single-word names.
      const nameParts = (tech.full_name || tech.username || '?')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      let initials: string;
      if (nameParts.length >= 2) {
        const first = nameParts[0];
        const last = nameParts[nameParts.length - 1];
        initials = first.charAt(0).toUpperCase()
          + last.charAt(0).toUpperCase()
          + last.charAt(1).toLowerCase();
      } else {
        const only = nameParts[0] || '?';
        initials = only.charAt(0).toUpperCase() + only.slice(1, 3).toLowerCase();
      }

      const icon = L.divIcon({
        html: markerHtml(color, status, initials, tech.profile_picture),
        className: 'tech-live-marker',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -18],
      });

      const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
      const lat6 = Number(tech.latitude).toFixed(6);
      const lng6 = Number(tech.longitude).toFixed(6);
      const coordStr = `${lat6}, ${lng6}`;
      const mapsUrl = `https://www.google.com/maps?q=${lat6},${lng6}`;
      const popup = `
        <div style="min-width:190px;font-family:system-ui,sans-serif;">
          <div style="font-weight:700;font-size:13px;margin-bottom:2px;">${escapeHtml(tech.full_name)}</div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">ID: ${escapeHtml(tech.employee_id || tech.username || tech.user_id)}</div>
          <div style="display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;
            padding:2px 8px;border-radius:9999px;color:#fff;background:${color};margin-bottom:6px;">${statusLabel}</div>
          <div style="font-size:11px;color:#374151;line-height:1.5;">
            <div>Lat: ${escapeHtml(lat6)}</div>
            <div>Lng: ${escapeHtml(lng6)}</div>
            <div style="margin-top:3px;">Address Coordinates:<br/>
              <a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer"
                style="color:#2563eb;text-decoration:underline;font-weight:600;">${escapeHtml(coordStr)}</a>
            </div>
            <div style="margin-top:3px;">Updated: ${escapeHtml(timeAgo(tech.last_updated_at))}</div>
          </div>
        </div>`;

      const existing = markersRef.current[tech.user_id];
      if (existing) {
        existing.setIcon(icon);
        existing.setPopupContent(popup);
        animateMarker(existing, [tech.latitude, tech.longitude]);
      } else {
        const marker = L.marker([tech.latitude, tech.longitude], { icon }).bindPopup(popup);
        layerRef.current.addLayer(marker);
        markersRef.current[tech.user_id] = marker;
      }
      bounds.push([tech.latitude, tech.longitude]);
    });

    // Remove markers for technicians no longer in the set.
    Object.keys(markersRef.current).forEach((key) => {
      const id = Number(key);
      if (!seen.has(id)) {
        const m = markersRef.current[id];
        if (m._raf) cancelAnimationFrame(m._raf);
        layerRef.current.removeLayer(m);
        delete markersRef.current[id];
      }
    });

    // Auto zoom-out to keep every technician in view. Fit on first data arrival,
    // and again whenever a technician is outside the current viewport (new tech joined
    // or moved off-screen). Skipped while a technician is selected so the trail/recenter
    // view isn't overridden.
    if (bounds.length > 0 && selectedTechId == null && !userMovingRef.current) {
      try {
        const anyOutside = bounds.some((b) => !mapObj.current.getBounds().contains(b));
        if (!didFit.current || anyOutside) {
          programmaticRef.current = true; // don't treat this move as user interaction
          if (bounds.length === 1) {
            mapObj.current.setView(bounds[0], Math.min(mapObj.current.getZoom() || 15, 15));
          } else {
            mapObj.current.fitBounds(bounds, { padding: [40, 40] });
          }
          didFit.current = true;
          setTimeout(() => { programmaticRef.current = false; }, 800);
        }
      } catch (e) {
        programmaticRef.current = false;
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techList, ready, nowTick, isDarkMode]);

  // 6) Draw the selected technician's daily trail; refresh it as new points arrive.
  useEffect(() => {
    if (!ready) return;
    if (selectedTechId == null) {
      clearTrail();
      return;
    }
    loadTrail(selectedTechId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTechId, ready, nowTick]);

  // 7) Recenter on the selected technician (only when the selection changes).
  useEffect(() => {
    if (selectedTechId == null || !mapObj.current) return;
    const t = techs[selectedTechId];
    if (t && t.latitude != null && t.longitude != null) {
      mapObj.current.setView([t.latitude, t.longitude], Math.max(mapObj.current.getZoom() || 13, 15));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTechId]);

  const counts = useMemo(() => {
    let online = 0, stale = 0, offline = 0;
    techList.forEach((t) => {
      const s = liveStatus(t, nowTick);
      if (s === 'online') online++;
      else if (s === 'stale') stale++;
      else offline++;
    });
    return { online, stale, offline, total: techList.length };
  }, [techList, nowTick]);

  return (
    <div className="relative w-full h-full" style={{ minHeight: 360 }}>
      <div
        ref={mapRef}
        className="w-full h-full rounded-lg overflow-hidden"
        style={{ minHeight: 360, zIndex: 1 }}
      />

      {!ready && (
        <div className={`absolute inset-0 flex items-center justify-center text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          <RefreshCw className="animate-spin mr-2" size={18} /> Loading map…
        </div>
      )}

      {/* Legend / live counts + single-select trail picker overlay */}
      <div
        className={`absolute top-2 left-2 z-[1000] rounded-lg shadow-md px-3 py-2 text-xs ${isDarkMode ? 'bg-gray-900/90 text-gray-200 border border-gray-700' : 'bg-white/95 text-gray-700 border border-gray-200'}`}
        style={{ backdropFilter: 'blur(4px)', maxWidth: '85%' }}
      >
        <div className="flex items-start gap-3">
          {/* Left: live counts + status legend */}
          <div>
            <div className="flex items-center gap-1.5 font-semibold mb-1">
              <Users size={13} style={{ color: colorPalette?.primary || '#7c3aed' }} />
              <span>{counts.total} technician{counts.total === 1 ? '' : 's'}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS.online }} />{counts.online}</span>
              <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS.stale }} />{counts.stale}</span>
              <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS.offline }} />{counts.offline}</span>
            </div>
          </div>

          {/* Right: pick ONE technician to show today's trail */}
          {counts.total > 0 && (
            <div className={`pl-3 border-l ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`} style={{ minWidth: 150 }}>
              <div className="font-semibold mb-1 opacity-80">Show trail (today)</div>
              <div className="overflow-y-auto pr-1 space-y-0.5" style={{ maxHeight: 150 }}>
                {techList.map((t) => {
                  const s = liveStatus(t, nowTick);
                  const checked = selectedTechId === t.user_id;
                  return (
                    <label key={t.user_id} className="flex items-center gap-1.5 cursor-pointer py-0.5">
                      <input
                        type="checkbox"
                        className="cursor-pointer"
                        checked={checked}
                        onChange={() => setSelectedTechId(checked ? null : t.user_id)}
                      />
                      <i className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[s] || STATUS_COLORS.offline }} />
                      <span className="truncate" style={{ maxWidth: 120 }}>{t.full_name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {ready && counts.total === 0 && (
        <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] rounded-full px-3 py-1 text-xs shadow ${isDarkMode ? 'bg-gray-900/90 text-gray-400' : 'bg-white/95 text-gray-500'}`}>
          No technicians reporting yet
        </div>
      )}
    </div>
  );
};

export default TechLiveLocationMap;
