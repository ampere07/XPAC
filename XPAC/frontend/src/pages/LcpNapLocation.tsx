import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, MapPin, Search, X, ChevronLeft } from 'lucide-react';
import AddLcpNapLocationModal from '../modals/AddLcpNapLocationModal';
import LcpNapLocationDetails from '../components/LcpNapLocationDetails';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  createBasemap,
  PH_BOUNDS,
  selectedPinIcon,
  provisionalPinIcon,
  photonSearch,
  isDarkThemeActive,
  AddressSuggestion,
} from '../config/osmMap';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getAllLCPNAPsForMap, clearLCPNAPMapCache } from '../services/lcpnapService';
import apiClient from '../config/api';

interface LocationMarker {
  id: number;
  lcpnap_name: string;
  lcp_name: string;
  nap_name: string;
  coordinates: string;
  latitude: number;
  longitude: number;
  street?: string;
  city?: string;
  region?: string;
  barangay?: string;
  port_total?: number;
  reading_image_url?: string;
  image1_url?: string;
  image2_url?: string;
  modified_by?: string;
  modified_date?: string;
  active_sessions?: number;
  restricted_sessions?: number;
  offline_sessions?: number;
  disconnected_sessions?: number;
  not_found_sessions?: number;
  total_technical_details?: number;
  organization_id?: number | null;
}

interface LcpNapGroup {
  lcp_name: string;
  locations: LocationMarker[];
  count: number;
}

interface LcpNapItem {
  id: number;
  name: string;
  count: number;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}



const LcpNapLocation: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
  const [mobileViewMode, setMobileViewMode] = useState<'sidebar' | 'map'>('sidebar');
  const [markers, setMarkers] = useState<LocationMarker[]>([]);
  const [lcpNapGroups, setLcpNapGroups] = useState<LcpNapGroup[]>([]);
  const [selectedLcpNapId, setSelectedLcpNapId] = useState<number | string>('all');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<number | null>(() => {
    try {
      const authData = JSON.parse(localStorage.getItem('authData') || '{}');
      return authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;
    } catch {
      return null;
    }
  });
  const [showAddModal, setShowAddModal] = useState(false);

  // Pin-drop: the Add action arms the map instead of opening the form. `pinCoords`
  // tracks the provisional point under the crosshair; `pinnedCoordinates` is the value
  // the operator confirmed, handed to the modal read-only.
  const [isPlacingPin, setIsPlacingPin] = useState(false);
  const [pinCoords, setPinCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pinnedCoordinates, setPinnedCoordinates] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
  const [isMapReady, setIsMapReady] = useState<boolean>(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationMarker | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  /** The basemap layer, kept so the theme switch can swap its tiles in place. */
  const tileLayerRef = useRef<L.LayerGroup | null>(null);
  const sidebarStartXRef = useRef<number>(0);
  const sidebarStartWidthRef = useRef<number>(0);
  const searchMarkerRef = useRef<L.Marker | null>(null);
  /** The provisional marker shown while a pin is being placed. */
  const pinMarkerRef = useRef<L.Marker | null>(null);
  const allMarkersMapRef = useRef<Map<number, L.CircleMarker>>(new Map());
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  /**
   * Cap on how many pins are drawn at once, matching the mobile page.
   *
   * Kept as a string so the input can be cleared while typing; parsed with a
   * fallback at the point of use.
   */
  const [pinLimit, setPinLimit] = useState<string>('25');

  /**
   * Current map viewport, refreshed whenever the map stops moving.
   *
   * Needed so the cap keeps the pins NEAREST to wherever the user is looking
   * rather than an arbitrary first-N of the dataset — pan somewhere new and the
   * pins there load in.
   */
  const [mapViewport, setMapViewport] = useState<{
    center: { lat: number; lng: number };
    bounds: { north: number; south: number; east: number; west: number } | null;
  } | null>(null);


  const filteredMarkers = React.useMemo(() => {
    return markers.filter(m => {
      if (currentUserOrgId) {
        // User belongs to an org: only show markers assigned to that same org
        return m.organization_id === currentUserOrgId;
      } else {
        // User has no org: only show markers that have no org assigned
        const markerOrg = m.organization_id === undefined ? null : m.organization_id;
        return markerOrg === null;
      }
    });
  }, [markers, currentUserOrgId]);

  /**
   * The pins actually drawn on the map, after the limit is applied.
   *
   * Mirrors the mobile page: start from the active set (all markers, or just the
   * selected LCP/NAP group), cull to the viewport plus a 50% buffer, then keep
   * only the N closest to the map centre.
   *
   * Distance uses a plain lat/lng delta rather than a great-circle calculation —
   * this only needs a relative ordering over a few kilometres, and it avoids
   * thousands of trig calls on every pan.
   */
  const visibleMarkers = React.useMemo(() => {
    const active = selectedLcpNapId === 'all'
      ? filteredMarkers
      : (lcpNapGroups.find(g => g.lcp_name === selectedLcpNapId)?.locations ?? filteredMarkers);

    const limit = Math.max(1, parseInt(pinLimit, 10) || 25);

    // Before the first `idle` there is no viewport to measure against, so fall
    // back to a plain cap instead of rendering everything.
    if (!mapViewport) return active.slice(0, limit);

    const { center, bounds } = mapViewport;

    let candidates = active;
    if (bounds) {
      const latBuffer = (bounds.north - bounds.south) * 0.25;
      const lngBuffer = (bounds.east - bounds.west) * 0.25;

      candidates = active.filter(m =>
        m.latitude >= bounds.south - latBuffer &&
        m.latitude <= bounds.north + latBuffer &&
        m.longitude >= bounds.west - lngBuffer &&
        m.longitude <= bounds.east + lngBuffer
      );

      // Nothing in view (the user panned away from every pin): fall back to the
      // nearest ones overall so the map is never mysteriously empty.
      if (candidates.length === 0) candidates = active;
    }

    if (candidates.length <= limit) return candidates;

    return candidates
      .map(m => ({
        m,
        d: Math.abs(m.latitude - center.lat) + Math.abs(m.longitude - center.lng),
      }))
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map(x => x.m);
  }, [filteredMarkers, selectedLcpNapId, lcpNapGroups, pinLimit, mapViewport]);

  const searchResults = React.useMemo(() => {
    if (!searchQuery) return [];
    const query = searchQuery.toLowerCase();
    return filteredMarkers.filter(marker =>
      marker.lcpnap_name.toLowerCase().includes(query) ||
      (marker.lcp_name && marker.lcp_name.toLowerCase().includes(query)) ||
      (marker.nap_name && marker.nap_name.toLowerCase().includes(query))
    ).slice(0, 5);
  }, [filteredMarkers, searchQuery]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme !== 'light');
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    const theme = localStorage.getItem('theme');
    setIsDarkMode(theme !== 'light');

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchColorPalette = async () => {
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();
  }, []);

  useEffect(() => {
    if (!searchQuery) {
      setAddressSuggestions([]);
      return;
    }

    // Debounced the same 300ms the Google call was, so a fast typist still
    // makes one request per pause rather than one per keystroke.
    let cancelled = false;
    const handler = setTimeout(async () => {
      if (!showSuggestions) return;
      const results = await photonSearch(searchQuery);
      if (!cancelled) setAddressSuggestions(results);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(handler);
    };
  }, [searchQuery, showSuggestions]);

  useEffect(() => {
    initializeMap();
    loadLocations();

    return () => {
      clearMarkers();
      // Leaflet holds DOM listeners and a tile pipeline; remove() is what
      // releases them. Dropping the ref alone leaks the map on every remount.
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
      setIsMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (filteredMarkers.length > 0) {
      groupLocationsByLcpNap();
    }
  }, [filteredMarkers]);

  // Build the marker pool from the FULL set — initializeAllMarkers creates the
  // Leaflet marker objects (detached) and updateMapMarkers just toggles which
  // are attached. Limiting here instead would mean re-creating markers on every
  // pan rather than simply showing different ones.
  useEffect(() => {
    if (isMapReady && isDataLoaded && selectedLcpNapId === 'all') {
      initializeAllMarkers(filteredMarkers);
      // Frame the FULL coverage area, as before — the limit is applied by the
      // effect below once the resulting `idle` reports a real viewport. Framing
      // the capped set here would zoom to an arbitrary first-N instead.
      updateMapMarkers(filteredMarkers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMapReady, isDataLoaded, filteredMarkers]);

  /**
   * Re-attach the displayed pins whenever the limited set changes — a pan, a zoom
   * or a new limit value.
   *
   * Never refits the camera (see updateMapMarkers): doing so here would fight the
   * user's own panning and loop through `idle`.
   */
  useEffect(() => {
    if (!isMapReady || !isDataLoaded) return;

    updateMapMarkers(visibleMarkers, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleMarkers, isMapReady, isDataLoaded]);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingSidebar) return;

      const diff = e.clientX - sidebarStartXRef.current;
      const newWidth = Math.max(200, Math.min(500, sidebarStartWidthRef.current + diff));

      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  const initializeMap = () => {
    if (!mapRef.current || mapInstanceRef.current) return;

    try {
      const map = L.map(mapRef.current, {
        center: [12.8797, 121.7740],
        zoom: 6,
        minZoom: 6,
        // The same hard bounds the Google build set with strictBounds, so the
        // reader cannot pan away from the country the data is in.
        maxBounds: PH_BOUNDS,
        maxBoundsViscosity: 1.0,
        zoomControl: true,
      });

      // Read the theme at creation rather than from isDarkMode: this runs once,
      // and the effect below keeps it in step from then on.
      tileLayerRef.current = createBasemap(isDarkThemeActive()).addTo(map);

      mapInstanceRef.current = map;

      // Recompute which pins are nearest whenever the camera settles, so panning
      // to a new area loads that area's pins within the configured limit.
      //
      // 'moveend' plus 'zoomend' is Leaflet's equivalent of Google's single
      // 'idle' event: it has no combined "camera has stopped" event of its own.
      const syncViewport = () => {
        const center = map.getCenter();
        const bounds = map.getBounds();

        setMapViewport({
          center: { lat: center.lat, lng: center.lng },
          bounds: {
            north: bounds.getNorth(),
            east: bounds.getEast(),
            south: bounds.getSouth(),
            west: bounds.getWest(),
          },
        });
      };

      map.on('moveend', syncViewport);
      map.on('zoomend', syncViewport);
      syncViewport();

      setIsMapReady(true);
    } catch (error) {
      console.error('Error initializing map:', error);
      setIsMapReady(false);
    }
  };

  /**
   * Keep the basemap on the app's theme.
   *
   * The map is its own canvas, so a Tailwind class switch does not reach it —
   * without this, flipping to the light theme left a near-black map inside a
   * white page. Only the tile source changes; the map, its markers and the
   * current view are untouched.
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!isMapReady || !map) return;

    tileLayerRef.current?.remove();
    tileLayerRef.current = createBasemap(isDarkMode).addTo(map);
  }, [isDarkMode, isMapReady]);

  /**
   * Tell the map its box changed.
   *
   * Leaflet measures the container once and does not watch it, so a resized
   * sidebar or a switch from the list to the map on a phone leaves grey,
   * untiled space where the map grew. Google's canvas re-measured itself; this
   * is the one thing that has to be said out loud instead.
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!isMapReady || !map) return;

    // After the layout has settled, not during it — the container still has its
    // old width on the frame the state changes.
    const raf = requestAnimationFrame(() => map.invalidateSize());
    return () => cancelAnimationFrame(raf);
  }, [isMapReady, sidebarWidth, mobileViewMode, isMobile]);

  const parseCoordinates = (coordString: string): { latitude: number; longitude: number } | null => {
    if (!coordString) return null;

    const coords = coordString.split(',').map(c => c.trim());
    if (coords.length !== 2) return null;

    const latitude = parseFloat(coords[0]);
    const longitude = parseFloat(coords[1]);

    if (isNaN(latitude) || isNaN(longitude)) return null;

    return { latitude, longitude };
  };

  const loadLocations = async (forceRefresh: boolean = false) => {
    setIsLoading(true);
    try {
      const response = await getAllLCPNAPsForMap(forceRefresh);
      const data = response;

      if (data.success && data.data) {
        const locationData = data.data
          .map((item: any) => {
            const coords = parseCoordinates(item.coordinates);
            if (!coords) return null;

            return {
              id: item.id,
              lcpnap_name: item.lcpnap_name,
              lcp_name: item.lcp_name || 'N/A',
              nap_name: item.nap_name || 'N/A',
              coordinates: item.coordinates,
              latitude: coords.latitude,
              longitude: coords.longitude,
              street: item.street,
              city: item.city,
              region: item.region,
              barangay: item.barangay,
              port_total: item.port_total,
              reading_image_url: item.reading_image_url,
              image1_url: item.image1_url,
              image2_url: item.image2_url,
              modified_by: item.modified_by,
              modified_date: item.modified_date,
              active_sessions: item.active_sessions,
              restricted_sessions: item.restricted_sessions,
              offline_sessions: item.offline_sessions,
              disconnected_sessions: item.disconnected_sessions,
              not_found_sessions: item.not_found_sessions,
              total_technical_details: item.total_technical_details,
              organization_id: item.organization_id
            } as LocationMarker;
          })
          .filter((marker): marker is LocationMarker => marker !== null);

        setMarkers(locationData);
        setIsDataLoaded(true);

        // Pre-create markers after data is loaded and map is ready
        if (mapInstanceRef.current) {
          initializeAllMarkers(locationData);
        }
      }
    } catch (error) {
      console.error('Error loading locations:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const initializeAllMarkers = (locations: LocationMarker[]) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    allMarkersMapRef.current.forEach(m => m.remove());
    allMarkersMapRef.current.clear();

    locations.forEach(location => {
      const isFull = location.port_total && location.total_technical_details !== undefined && location.total_technical_details >= location.port_total;
      const markerColor = isFull ? '#ef4444' : '#22c55e'; // Red if full, Green otherwise

      // circleMarker rather than a pin image: it is the same dot the Google
      // build drew with a CIRCLE symbol, and it stays one screen size at every
      // zoom, which is what keeps a dense NAP cluster readable.
      const marker = L.circleMarker([location.latitude, location.longitude], {
        radius: 8,
        fillColor: markerColor,
        fillOpacity: 1,
        color: '#ffffff',
        weight: 1,
      });

      marker.on('click', () => setSelectedLocation(location));

      const addressParts = [
        location.street,
        location.barangay,
        location.city,
        location.region
      ].filter(Boolean);

      const address = addressParts.length > 0
        ? addressParts.join(', ')
        : 'No address available';

      // Bound once rather than built on every hover, as the shared InfoWindow
      // had to be — Leaflet gives each marker its own.
      marker.bindTooltip(
        `
            <div style="padding: 8px; min-width: 200px;">
              <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #1f2937;">
                ${location.lcpnap_name}
              </h3>
              <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">
                <strong>LCP:</strong> ${location.lcp_name}
              </div>
              <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">
                <strong>NAP:</strong> ${location.nap_name}
              </div>
              <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">
                <strong>Ports:</strong> ${location.total_technical_details || 0} / ${location.port_total || 0}
              </div>
              <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
                <div style="font-size: 11px;">
                  <span style="color: #22c55e;">On: ${location.active_sessions || 0}</span> | 
                  <span style="color: #f59e0b;">Off: ${location.offline_sessions || 0}</span> | 
                  <span style="color: #ef4444;">Disc: ${location.disconnected_sessions || 0}</span>
                </div>
              </div>
              <div style="font-size: 11px; color: #9ca3af; margin-top: 4px;">
                ${address}
              </div>
            </div>
          `,
        { direction: 'top', opacity: 1, sticky: false }
      );

      allMarkersMapRef.current.set(location.id, marker);
    });
  };

  const groupLocationsByLcpNap = () => {
    const grouped: { [key: string]: LcpNapGroup } = {};

    filteredMarkers.forEach(marker => {
      const groupKey = marker.lcp_name || 'Others';
      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          lcp_name: groupKey,
          locations: [],
          count: 0
        };
      }
      grouped[groupKey].locations.push(marker);
      grouped[groupKey].count++;
    });

    const groupArray = Object.values(grouped).sort((a, b) =>
      a.lcp_name.localeCompare(b.lcp_name)
    );

    setLcpNapGroups(groupArray);
  };

  const clearMarkers = () => {
    allMarkersMapRef.current.forEach(marker => marker.remove());
    if (searchMarkerRef.current) {
      searchMarkerRef.current.remove();
      searchMarkerRef.current = null;
    }
  };

  /**
   * Show exactly `locations` on the map and hide everything else.
   *
   * @param shouldFitBounds Move the camera to frame the given pins. MUST stay
   *   false for updates driven by the pin limit: fitBounds moves the viewport →
   *   fires `moveend` → recomputes the limited set → would call fitBounds again,
   *   looping forever and making the map impossible to pan. Only deliberate user
   *   actions (picking a group, choosing a search result) reframe the camera.
   */
  const updateMapMarkers = (locations: LocationMarker[], shouldFitBounds: boolean = true) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const locationIds = new Set(locations.map(l => l.id));
    const points: L.LatLngExpression[] = [];

    allMarkersMapRef.current.forEach((marker, id) => {
      if (locationIds.has(id)) {
        marker.addTo(map);
        points.push(marker.getLatLng());
      } else {
        marker.remove();
      }
    });

    if (shouldFitBounds && points.length > 0) {
      // A single result has no extent to fit, and fitBounds on one point zooms
      // to the maximum — so it is centred at a readable zoom instead.
      if (points.length === 1) {
        map.setView(points[0], 18);
      } else {
        map.fitBounds(L.latLngBounds(points), { padding: [50, 50] });
      }
    }
  };

  const handleLcpNapSelect = (lcpName: string) => {
    setSelectedLcpNapId(lcpName);

    if (lcpName === 'all') {
      updateMapMarkers(filteredMarkers);
    } else {
      const selectedGroup = lcpNapGroups.find(g => g.lcp_name === lcpName);
      if (selectedGroup) {
        updateMapMarkers(selectedGroup.locations);
      }
    }

    if (isMobile) {
      setMobileViewMode('map');
    }
  };

  /**
   * Arm the map instead of opening the form.
   *
   * The operator frames the pole on the map and confirms; only then does the form open,
   * with those coordinates already filled and locked. Typing a lat/lng into a blank form
   * was the step this replaces.
   */
  const startPinPlacement = () => {
    if (!mapInstanceRef.current) return;

    // Leaflet's LatLng exposes lat/lng as numbers, not the accessor methods the
    // Google LatLng had.
    const center = mapInstanceRef.current.getCenter();
    setPinCoords({ lat: center.lat, lng: center.lng });

    setSelectedLocation(null);
    setIsPlacingPin(true);
    if (isMobile) setMobileViewMode('map');
  };

  const cancelPinPlacement = () => {
    setIsPlacingPin(false);
    setPinCoords(null);
  };

  /** Lock the point in and hand it to the form. */
  const confirmPinPlacement = () => {
    if (!pinCoords) return;
    setPinnedCoordinates(`${pinCoords.lat.toFixed(6)}, ${pinCoords.lng.toFixed(6)}`);
    setIsPlacingPin(false);
    setShowAddModal(true);
  };

  /**
   * While placing, the map centre *is* the provisional coordinate — panning moves the
   * pin under the fixed crosshair, and a tap re-centres on the tapped point so the two
   * never disagree. Listeners are torn down the moment the mode ends.
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!isPlacingPin || !map) return;

    const syncFromCenter = () => {
      const center = map.getCenter();
      setPinCoords({ lat: center.lat, lng: center.lng });
    };

    const onClick = (event: L.LeafletMouseEvent) => {
      map.panTo(event.latlng);
      setPinCoords({ lat: event.latlng.lat, lng: event.latlng.lng });
    };

    // 'move' rather than 'moveend': the crosshair is fixed to the centre, so the
    // coordinate under it has to track the pan as it happens, not after it stops.
    map.on('move', syncFromCenter);
    map.on('click', onClick);

    syncFromCenter();

    return () => {
      map.off('move', syncFromCenter);
      map.off('click', onClick);
    };
  }, [isPlacingPin]);

  /** The provisional marker itself, drawn under the crosshair while placing. */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!isPlacingPin || !pinCoords) {
      if (pinMarkerRef.current) {
        pinMarkerRef.current.remove();
        pinMarkerRef.current = null;
      }
      return;
    }

    if (!pinMarkerRef.current) {
      pinMarkerRef.current = L.marker([pinCoords.lat, pinCoords.lng], {
        zIndexOffset: 2000,
        title: 'New LCP/NAP location',
        icon: provisionalPinIcon,
      }).addTo(map);
    } else {
      pinMarkerRef.current.setLatLng([pinCoords.lat, pinCoords.lng]);
    }
  }, [isPlacingPin, pinCoords]);

  const toggleGroup = (groupName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupName)) {
      newExpanded.delete(groupName);
    } else {
      newExpanded.add(groupName);
    }
    setExpandedGroups(newExpanded);
  };

  const handleLocationSelect = (location: LocationMarker) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    searchMarkerRef.current?.remove();

    map.setView([location.latitude, location.longitude], 18);

    searchMarkerRef.current = L.marker([location.latitude, location.longitude], {
      title: location.lcpnap_name,
      icon: selectedPinIcon,
    }).addTo(map);

    // Straight off the id. The old version searched a markersRef array that
    // initializeAllMarkers never filled, so this lookup always missed and the
    // tooltip never opened.
    allMarkersMapRef.current.get(location.id)?.openTooltip();
  };

  /**
   * A Photon result already carries its coordinates, so picking one moves the
   * map immediately — Google needed a second getDetails round trip first.
   */
  const handleAddressSelect = (suggestion: AddressSuggestion) => {
    setSearchQuery(suggestion.description);
    setShowSuggestions(false);

    const map = mapInstanceRef.current;
    if (!map) return;

    map.setView([suggestion.lat, suggestion.lon], 18);

    searchMarkerRef.current?.remove();
    searchMarkerRef.current = L.marker([suggestion.lat, suggestion.lon], {
      title: suggestion.description,
      icon: selectedPinIcon,
    })
      .addTo(map)
      .bindTooltip(
        `
              <div style="padding: 8px; min-width: 150px;">
                <h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: #1f2937;">Selected Location</h3>
                <p style="margin: 0; font-size: 12px; color: #6b7280;">${suggestion.description}</p>
              </div>
            `,
        { direction: 'top', opacity: 1 }
      )
      .openTooltip();
  };

  const handleMouseDownSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    sidebarStartXRef.current = e.clientX;
    sidebarStartWidthRef.current = sidebarWidth;
  };

  const handleSaveLocation = () => {
    clearLCPNAPMapCache();
    loadLocations(true);
  };

  const lcpNapItems = lcpNapGroups;


  return (
    <div className={`${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      } h-full flex overflow-hidden`}>
      <div className={`${
        isMobile
          ? mobileViewMode === 'sidebar' ? 'flex w-full' : 'hidden'
          : 'flex-shrink-0 flex flex-col border-r relative'
      } ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`} style={!isMobile ? { width: `${sidebarWidth}px` } : undefined}>
        <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
          }`}>
          <div className="flex items-center justify-between mb-1">
            <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>LCP/NAP Locations</h2>
            {isMobile && (
              <button
                onClick={() => setMobileViewMode('map')}
                className="px-3 py-1.5 text-xs text-white rounded transition-colors"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
              >
                View Map
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <button
            onClick={() => handleLcpNapSelect('all')}
            className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
              } ${selectedLcpNapId === 'all'
                ? 'font-medium'
                : isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}
            style={selectedLcpNapId === 'all' ? {
              backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(124, 58, 237, 0.2)',
              color: colorPalette?.primary || '#7c3aed'
            } : {}}
          >
            <div className="flex items-center">
              <span>All Locations</span>
            </div>
            <span className={`px-2 py-1 rounded-full text-xs ${selectedLcpNapId === 'all'
              ? 'text-white'
              : isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
              }`}
              style={selectedLcpNapId === 'all' ? {
                backgroundColor: colorPalette?.primary || '#7c3aed'
              } : {}}
            >
              {filteredMarkers.length}
            </span>
          </button>

          {lcpNapItems.map((group) => (
            <div key={group.lcp_name}>
              <button
                onClick={() => handleLcpNapSelect(group.lcp_name)}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors group/lp ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                  } ${selectedLcpNapId === group.lcp_name
                    ? 'font-medium'
                    : isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}
                style={selectedLcpNapId === group.lcp_name ? {
                  backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(124, 58, 237, 0.2)',
                  color: colorPalette?.primary || '#7c3aed'
                } : {}}
              >
                <div className="flex items-center overflow-hidden">
                  <div 
                    onClick={(e) => toggleGroup(group.lcp_name, e)}
                    className={`mr-2 p-1 rounded hover:bg-black/10 transition-colors`}
                  >
                    {expandedGroups.has(group.lcp_name) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </div>
                  <MapPin className="h-4 w-4 mr-2 flex-shrink-0" />
                  <span className="truncate">{group.lcp_name}</span>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs ${selectedLcpNapId === group.lcp_name
                  ? 'text-white'
                  : isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                  }`}
                  style={selectedLcpNapId === group.lcp_name ? {
                    backgroundColor: colorPalette?.primary || '#7c3aed'
                  } : {}}
                >
                  {group.count}
                </span>
              </button>

              {expandedGroups.has(group.lcp_name) && (
                <div className={`${isDarkMode ? 'bg-gray-900/50' : 'bg-gray-50'}`}>
                  {group.locations.sort((a,b) => a.lcpnap_name.localeCompare(b.lcpnap_name)).map((loc) => (
                    <button
                      key={loc.id}
                      onClick={() => {
                        setSelectedLocation(loc);
                        handleLocationSelect(loc);
                        if (isMobile) {
                          setMobileViewMode('map');
                        }
                      }}
                      className={`w-full flex items-center justify-between pl-12 pr-4 py-2 text-xs transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400 hover:text-white' : 'hover:bg-gray-200 text-gray-600 hover:text-gray-900'
                        } ${selectedLocation?.id === loc.id ? 'font-bold bg-black/5' : ''}`}
                      style={selectedLocation?.id === loc.id ? {
                        color: colorPalette?.primary || '#7c3aed'
                      } : {}}
                    >
                      <span className="truncate">{loc.lcpnap_name}</span>
                      {loc.total_technical_details !== undefined && (
                        <span className="opacity-60">
                           {loc.total_technical_details}/{loc.port_total}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-10"
          style={{
            backgroundColor: 'transparent'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onMouseDown={handleMouseDownSidebarResize}
        />
      </div>

      <div className={`${
        isMobile && mobileViewMode !== 'map' ? 'hidden' : 'flex-1'
      } overflow-hidden ${isDarkMode ? 'bg-gray-900' : 'bg-white'
        }`}>
        <div className="flex flex-col h-full">
          <div className={`p-4 border-b flex-shrink-0 relative z-10 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center justify-between">
                <h3 className={`text-lg font-semibold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                  {isMobile && mobileViewMode === 'map' && (
                    <button
                      onClick={() => setMobileViewMode('sidebar')}
                      className={`p-1 mr-1 rounded-lg transition-colors ${
                        isDarkMode ? 'hover:bg-gray-800 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      <ChevronLeft size={20} />
                    </button>
                  )}
                  Map View
                </h3>
                {isMobile && (
                  <button
                    onClick={startPinPlacement}
                    disabled={isPlacingPin}
                    title="Drop a pin on the map to add an LCP/NAP location"
                    className="p-2 text-white rounded flex items-center justify-center transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: colorPalette?.primary || '#7c3aed'
                    }}
                  >
                    <MapPin className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="flex-1 max-w-md relative sm:mx-4" ref={searchRef}>
                <div className="relative">
                  <Search className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                  <input
                    type="text"
                    placeholder="Search location..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    className={`w-full pl-10 pr-10 py-2 rounded-lg border text-sm transition-colors focus:outline-none ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white focus:border-gray-600'
                      : 'bg-white border-gray-300 text-gray-900 focus:border-gray-400'
                      }`}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setShowSuggestions(false);
                      }}
                      className={`absolute right-3 top-1/2 transform -translate-y-1/2 p-0.5 rounded-full transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {showSuggestions && searchQuery && (searchResults.length > 0 || addressSuggestions.length > 0) && (
                  <div className={`absolute top-full left-0 mt-1 w-full rounded-md shadow-lg border overflow-hidden z-[1001] max-h-96 overflow-y-auto ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                    }`}>
                    {searchResults.length > 0 && (
                      <div className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-400 bg-gray-900 border-b border-gray-700' : 'text-gray-500 bg-gray-50 border-b border-gray-200'}`}>
                        LCP / NAP Locations
                      </div>
                    )}
                    {searchResults.map(result => (
                      <button
                        key={result.id}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors border-b last:border-0 ${isDarkMode
                          ? 'border-gray-700 hover:bg-gray-700 text-gray-200'
                          : 'border-gray-100 hover:bg-gray-50 text-gray-800'
                          }`}
                        onClick={() => {
                          setSearchQuery(result.lcpnap_name);
                          setShowSuggestions(false);
                          handleLocationSelect(result);
                        }}
                      >
                        <div className="font-medium">{result.lcpnap_name}</div>
                        <div className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          LCP: {result.lcp_name} • NAP: {result.nap_name}
                        </div>
                      </button>
                    ))}

                    {addressSuggestions.length > 0 && (
                      <div className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-400 bg-gray-900 border-b border-gray-700' : 'text-gray-500 bg-gray-50 border-b border-gray-200'}`}>
                        Address Suggestions
                      </div>
                    )}
                    {addressSuggestions.map(suggestion => (
                      <button
                        key={suggestion.id}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors border-b last:border-0 ${isDarkMode
                          ? 'border-gray-700 hover:bg-gray-700 text-gray-200'
                          : 'border-gray-100 hover:bg-gray-50 text-gray-800'
                          }`}
                        onClick={() => handleAddressSelect(suggestion)}
                      >
                        <div className="flex items-start gap-2">
                          <MapPin className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                          <span className="font-medium">{suggestion.description}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Pin limit — caps how many markers are drawn, keeping the ones
                  closest to the map centre. Mirrors the mobile page's control. */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className={`flex items-center rounded-lg border px-2.5 py-1.5 ${isDarkMode
                  ? 'bg-gray-800 border-gray-700'
                  : 'bg-gray-50 border-gray-200'
                  }`}>
                  <MapPin className="h-4 w-4 mr-1.5 flex-shrink-0" style={{ color: colorPalette?.primary || '#7c3aed' }} />
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="Maximum pins to display"
                    title="Maximum number of pins drawn on the map"
                    placeholder="Limit"
                    value={pinLimit}
                    // Digits only, so the parse at point of use can never see junk.
                    onChange={(e) => setPinLimit(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                    className={`w-14 bg-transparent text-sm text-center focus:outline-none ${isDarkMode
                      ? 'text-white placeholder-gray-500'
                      : 'text-gray-900 placeholder-gray-400'
                      }`}
                  />
                </div>
                <span className={`text-xs whitespace-nowrap ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {visibleMarkers.length.toLocaleString()} / {filteredMarkers.length.toLocaleString()} pins
                </span>
              </div>

              {!isMobile && (
                <button
                  onClick={startPinPlacement}
                  disabled={isPlacingPin}
                  title="Drop a pin on the map to add an LCP/NAP location"
                  className="px-4 py-2 text-white rounded flex items-center gap-2 text-sm transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    if (colorPalette?.accent) {
                      e.currentTarget.style.backgroundColor = colorPalette.accent;
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                  }}
                >
                  <MapPin className="h-4 w-4" />
                  Add LCPNAP
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 relative z-0">
            <div
              ref={mapRef}
              className="absolute inset-0 w-full h-full z-0"
            />

            {/* Pin-drop crosshair. Fixed to the centre of the viewport and click-through,
                so the map underneath still pans and zooms normally. */}
            {isPlacingPin && (
              <div className="absolute inset-0 z-[600] pointer-events-none flex items-center justify-center">
                <div className="relative">
                  <div
                    className="w-10 h-10 rounded-full border-2 opacity-70"
                    style={{ borderColor: colorPalette?.primary || '#7c3aed' }}
                  />
                  <div
                    className="absolute left-1/2 top-1/2 w-[2px] h-8 -translate-x-1/2 -translate-y-1/2"
                    style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                  />
                  <div
                    className="absolute left-1/2 top-1/2 h-[2px] w-8 -translate-x-1/2 -translate-y-1/2"
                    style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                  />
                </div>
              </div>
            )}

            {/* Floating confirmation bar for the pin-drop. */}
            {isPlacingPin && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[700] w-[min(92%,30rem)]">
                <div
                  className={`rounded-xl shadow-2xl border p-3 flex flex-col gap-3 ${
                    isDarkMode ? 'bg-gray-900/95 border-gray-700' : 'bg-white/95 border-gray-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <MapPin
                      className="h-4 w-4 mt-0.5 flex-shrink-0"
                      style={{ color: colorPalette?.primary || '#7c3aed' }}
                    />
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        Position the pin
                      </p>
                      <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Pan the map or tap a spot, then confirm.
                      </p>
                      <p className={`text-xs font-mono mt-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {pinCoords
                          ? `${pinCoords.lat.toFixed(6)}, ${pinCoords.lng.toFixed(6)}`
                          : 'Waiting for the map…'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={confirmPinPlacement}
                      disabled={!pinCoords}
                      className="flex-1 px-4 py-2 text-white rounded flex items-center justify-center gap-2 text-sm transition-colors disabled:opacity-50"
                      style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                    >
                      <Check className="h-4 w-4" />
                      Confirm
                    </button>
                    <button
                      onClick={cancelPinPlacement}
                      className={`flex-1 px-4 py-2 rounded flex items-center justify-center gap-2 text-sm border transition-colors ${
                        isDarkMode
                          ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <X className="h-4 w-4" />
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isLoading && (
              <div className={`absolute inset-0 bg-opacity-75 flex items-center justify-center z-[1000] ${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'
                }`}>
                <div className="flex flex-col items-center gap-3">
                  <Loader2
                    className="h-8 w-8 animate-spin"
                    style={{ color: colorPalette?.primary || '#7c3aed' }}
                  />
                  <p className={`text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>Loading map...</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <AddLcpNapLocationModal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          // Drop the confirmed point on close so the next Add starts from a fresh pin
          // rather than silently reusing the last one.
          setPinnedCoordinates(null);
          setPinCoords(null);
        }}
        onSave={handleSaveLocation}
        initialCoordinates={pinnedCoordinates ?? undefined}
        lockCoordinates={pinnedCoordinates !== null}
      />

      {selectedLocation && (
        <div className="fixed inset-0 z-50 md:relative md:inset-auto md:z-auto md:flex-shrink-0 md:overflow-hidden">
          <LcpNapLocationDetails
            location={selectedLocation}
            onClose={() => setSelectedLocation(null)}
            onSave={handleSaveLocation}
            isMobile={isMobile}
          />
        </div>
      )}
    </div>
  );
};

export default LcpNapLocation;
