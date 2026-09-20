import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import MapView, { Marker, Polyline, Circle, PROVIDER_DEFAULT } from 'react-native-maps';
import { X } from 'lucide-react-native';
import apiClient from '../config/api';
import { ColorPalette } from '../services/settingsColorPaletteService';

/**
 * Where the field technicians are right now.
 *
 * The web portal draws this with Leaflet; a phone has a real map view, so this
 * is react-native-maps with the same rules rather than a WebView wrapping the
 * other one. Everything that decides WHAT is drawn — the live status a marker
 * takes its colour from, the GPS fixes that are rejected as noise, the trail —
 * is ported as-is from components/TechLiveLocationMap.tsx on the web, because
 * those rules are about the data and not about the renderer.
 *
 * What is deliberately not ported is the marker animation. The web version
 * eases each marker between polls with requestAnimationFrame; react-native-maps
 * moves a Marker by re-rendering its coordinate, and driving that at 60fps from
 * JS costs more than the smoothness is worth on a phone.
 */

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
  isDarkMode?: boolean;
  colorPalette?: ColorPalette | null;
  /** How tall the map draws. The widget card gives it a fixed box. */
  height?: number;
}

// Must match the backend stale window (TechnicianLocationController::STALE_SECONDS).
const STALE_MS = 2 * 60 * 1000;

/** Manila, used until there is a technician to centre on. */
const MANILA = { latitude: 14.5995, longitude: 120.9842, latitudeDelta: 0.35, longitudeDelta: 0.35 };

const STATUS_COLORS: Record<string, string> = {
  online: '#22c55e',
  stale: '#f59e0b',
  offline: '#9ca3af',
};

/** Derive a live status from the last update time so markers age between polls. */
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
const ACCURACY_LIMIT_M = 150;
const MAX_PLAUSIBLE_SPEED_MS = 70; // ~250 km/h
const JUMP_GUARD_MIN_M = 200;

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
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Whether an incoming fix should replace the technician's current position. */
function shouldAcceptFix(incoming: TechLocation, prev?: TechLocation): boolean {
  if (!isValidCoord(incoming.latitude, incoming.longitude)) return false;
  if (typeof incoming.accuracy === 'number' && isFinite(incoming.accuracy) && incoming.accuracy > ACCURACY_LIMIT_M) {
    return false;
  }
  if (prev && isValidCoord(prev.latitude, prev.longitude)) {
    const dt = (tsMs(incoming.last_updated_at) - tsMs(prev.last_updated_at)) / 1000;
    const dist = metersBetween(
      prev.latitude as number,
      prev.longitude as number,
      incoming.latitude as number,
      incoming.longitude as number
    );
    if (isFinite(dt) && dt > 0 && dist > JUMP_GUARD_MIN_M && dist / dt > MAX_PLAUSIBLE_SPEED_MS) {
      return false;
    }
  }
  return true;
}

/**
 * Merge an incoming record: accept a good fix, otherwise keep the last good
 * position while still updating non-positional metadata (status, timestamp).
 */
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

const TechLiveLocationMap: React.FC<Props> = ({ data, colorPalette, height = 340 }) => {
  const primaryColor = colorPalette?.primary || '#7c3aed';

  /**
   * The last accepted position for each technician.
   *
   * Held across polls so a rejected fix leaves the marker where it was rather
   * than dropping it off the map — mergeFix needs the previous value to judge
   * the next one.
   */
  const [techs, setTechs] = useState<Record<number, TechLocation>>({});
  const [selectedTechId, setSelectedTechId] = useState<number | null>(null);
  const [trail, setTrail] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [trailLoading, setTrailLoading] = useState(false);

  // Re-render on a timer so a marker ages from online to stale between polls,
  // the way the web version does.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const mapRef = useRef<MapView | null>(null);
  const hasFitted = useRef(false);

  useEffect(() => {
    setTechs((prev) => {
      const next: Record<number, TechLocation> = { ...prev };
      (data || []).forEach((incoming) => {
        if (incoming && typeof incoming.user_id === 'number') {
          next[incoming.user_id] = mergeFix(prev[incoming.user_id], incoming);
        }
      });
      return next;
    });
  }, [data]);

  /** Only technicians with a usable position can be drawn. */
  const plotted = useMemo(
    () => Object.values(techs).filter((t) => isValidCoord(t.latitude, t.longitude)),
    [techs]
  );

  // Frame everyone once, the first time there is anybody to frame. Not on every
  // poll: refitting while somebody is panning the map fights them for control.
  useEffect(() => {
    if (hasFitted.current || plotted.length === 0 || !mapRef.current) return;
    hasFitted.current = true;

    if (plotted.length === 1) {
      mapRef.current.animateToRegion(
        {
          latitude: plotted[0].latitude as number,
          longitude: plotted[0].longitude as number,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        600
      );
      return;
    }

    mapRef.current.fitToCoordinates(
      plotted.map((t) => ({ latitude: t.latitude as number, longitude: t.longitude as number })),
      { edgePadding: { top: 48, right: 48, bottom: 48, left: 48 }, animated: true }
    );
  }, [plotted]);

  const loadTrail = async (userId: number) => {
    setTrailLoading(true);
    try {
      const res: any = await apiClient.get(`/technician-locations/${userId}/trail`, {
        params: { scope: 'today' },
      });
      const points = ((res.data && res.data.data) || [])
        .filter((p: any) => isValidCoord(p.latitude, p.longitude))
        .map((p: any) => ({ latitude: p.latitude as number, longitude: p.longitude as number }));
      // Two points make a line; one does not, and drawing it would put a dot
      // under the marker that reads as a second technician.
      setTrail(points.length >= 2 ? points : []);
    } catch (e) {
      // A missing trail is not worth an error state — the live position is
      // still on screen and that is what the widget is for.
      setTrail([]);
    } finally {
      setTrailLoading(false);
    }
  };

  const handleSelect = (tech: TechLocation) => {
    if (selectedTechId === tech.user_id) {
      setSelectedTechId(null);
      setTrail([]);
      return;
    }
    setSelectedTechId(tech.user_id);
    loadTrail(tech.user_id);
  };

  const selected = selectedTechId !== null ? techs[selectedTechId] : null;

  const counts = useMemo(() => {
    const out = { online: 0, stale: 0, offline: 0 };
    Object.values(techs).forEach((t) => {
      out[liveStatus(t, now)] += 1;
    });
    return out;
  }, [techs, now]);

  return (
    <View style={{ gap: 8 }}>
      <View style={{ height, borderRadius: 10, overflow: 'hidden', backgroundColor: '#e5e7eb' }}>
        <MapView
          ref={(r) => {
            mapRef.current = r;
          }}
          provider={PROVIDER_DEFAULT}
          style={{ flex: 1 }}
          initialRegion={MANILA}
          showsUserLocation={false}
          toolbarEnabled={false}
        >
          {plotted.map((tech) => {
            const status = liveStatus(tech, now);
            const color = STATUS_COLORS[status];
            const isSelected = tech.user_id === selectedTechId;

            return (
              <React.Fragment key={tech.user_id}>
                {/* The reported accuracy, when it is worth showing. A fix good
                    to a few metres draws a circle too small to see, and one
                    worse than the limit was rejected before it got here. */}
                {isSelected && typeof tech.accuracy === 'number' && tech.accuracy > 20 && (
                  <Circle
                    center={{ latitude: tech.latitude as number, longitude: tech.longitude as number }}
                    radius={tech.accuracy}
                    strokeColor={`${color}99`}
                    fillColor={`${color}22`}
                    strokeWidth={1}
                  />
                )}
                <Marker
                  coordinate={{ latitude: tech.latitude as number, longitude: tech.longitude as number }}
                  onPress={() => handleSelect(tech)}
                  tracksViewChanges={false}
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View
                    style={{
                      width: isSelected ? 22 : 16,
                      height: isSelected ? 22 : 16,
                      borderRadius: 999,
                      backgroundColor: color,
                      borderWidth: isSelected ? 3 : 2,
                      borderColor: '#ffffff',
                    }}
                  />
                </Marker>
              </React.Fragment>
            );
          })}

          {trail.length >= 2 && (
            <Polyline coordinates={trail} strokeColor={primaryColor} strokeWidth={4} />
          )}
        </MapView>
      </View>

      {/* Legend and counts, so the colours mean something without tapping. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        {(['online', 'stale', 'offline'] as const).map((key) => (
          <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: STATUS_COLORS[key] }} />
            <Text style={{ fontSize: 11, color: '#6b7280', textTransform: 'capitalize' }}>
              {key} {counts[key]}
            </Text>
          </View>
        ))}
        {plotted.length === 0 && (
          <Text style={{ fontSize: 11, color: '#9ca3af' }}>No technician has reported a position yet.</Text>
        )}
      </View>

      {/* The selected technician. A callout would be clipped by the widget
          card, so the detail sits under the map where it has room. */}
      {selected && (
        <View
          style={{
            padding: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: '#e5e7eb',
            backgroundColor: '#ffffff',
            gap: 4,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
              <View
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  backgroundColor: STATUS_COLORS[liveStatus(selected, now)],
                }}
              />
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#111827' }} numberOfLines={1}>
                {selected.full_name}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setSelectedTechId(null);
                setTrail([]);
              }}
            >
              <X size={16} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          <Text style={{ fontSize: 11, color: '#6b7280' }}>
            Last seen {timeAgo(selected.last_updated_at)}
            {typeof selected.accuracy === 'number' ? `  ·  ±${Math.round(selected.accuracy)}m` : ''}
          </Text>

          {trailLoading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <ActivityIndicator size="small" color={primaryColor} />
              <Text style={{ fontSize: 11, color: '#9ca3af' }}>Loading today's trail...</Text>
            </View>
          ) : (
            <Text style={{ fontSize: 11, color: '#9ca3af' }}>
              {trail.length >= 2 ? `Today's trail: ${trail.length} points` : 'No trail recorded today'}
            </Text>
          )}
        </View>
      )}
    </View>
  );
};

export default TechLiveLocationMap;
