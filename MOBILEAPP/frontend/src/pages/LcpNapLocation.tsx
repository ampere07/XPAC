import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, Pressable, useWindowDimensions, ActivityIndicator, TextInput, StyleSheet, Modal, Alert, ScrollView } from 'react-native';
import { MapPin, Search, Plus, Navigation, Check, X } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoLocation from 'expo-location';
import { ensureLocationPermission } from '../services/locationConsent';
import MapView, { Marker, Circle, UrlTile } from 'react-native-maps';
import { FlashList } from '@shopify/flash-list';
import AddLcpNapLocationModal from '../modals/AddLcpNapLocationModal';
import LcpNapLocationDetails from '../components/LcpNapLocationDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';
import axios from 'axios';

// ─── Interfaces ────────────────────────────────────────────────────────────────

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
  inactive_sessions?: number;
  offline_sessions?: number;
  blocked_sessions?: number;
  not_found_sessions?: number;
  total_technical_details?: number;
  _dist?: number;
}

interface LcpNapGroup {
  lcpnap_id: number;
  lcpnap_name: string;
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

// ─── Constants & Pure Helpers ──────────────────────────────────────────────────

const parseCoordinates = (coordString: string): { latitude: number; longitude: number } | null => {
  if (!coordString) return null;
  const coords = coordString.split(',').map(c => c.trim());
  if (coords.length !== 2) return null;
  const latitude = parseFloat(coords[0]);
  const longitude = parseFloat(coords[1]);
  return (isNaN(latitude) || isNaN(longitude)) ? null : { latitude, longitude };
};

const getPinSize = (delta: number) => {
  if (delta < 0.005) return 26;
  if (delta < 0.02) return 22;
  if (delta < 0.1) return 18;
  if (delta < 0.5) return 15;
  if (delta < 2) return 12;
  return 10;
};

// ─── Photon Geocoding (free, no API key, powered by OpenStreetMap data) ──────────
// Photon by Komoot: https://photon.komoot.io — designed for app usage, no rate limit issues

const photonSearch = async (query: string): Promise<any[]> => {
  try {
    // bbox: min_lon,min_lat,max_lon,max_lat (Philippines bounding box)
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&bbox=114.1,4.4,126.6,21.1`;
    const response = await axios.get(url);
    return response.data?.features || [];
  } catch (err) {
    console.error('Photon geocoding error:', err);
    return [];
  }
};

// ─── Sub-components ────────────────────────────────────────────────────────────

const CustomMarker = React.memo<{
  location: LocationMarker;
  pinSize: number;
  onPress: (location: LocationMarker) => void;
}>(({ location, pinSize, onPress }) => {
  const isFull = (location.total_technical_details || 0) >= (location.port_total || 0) && (location.port_total || 0) > 0;

  // tracksViewChanges=false after the very first render.
  const [tracksViewChanges, setTracksViewChanges] = React.useState(true);
  const hasSettled = React.useRef(false);

  React.useEffect(() => {
    if (hasSettled.current) return;
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
      hasSettled.current = true;
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Marker
      coordinate={{ latitude: location.latitude, longitude: location.longitude }}
      title={location.lcpnap_name}
      description={`LCP: ${location.lcp_name} | NAP: ${location.nap_name} | Used: ${location.total_technical_details || 0}/${location.port_total || 0}`}
      onPress={() => onPress(location)}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
    >
      <View style={[styles.markerPin, {
        width: pinSize,
        height: pinSize,
        borderRadius: pinSize / 2,
        borderWidth: pinSize > 10 ? 1.5 : 0.5,
        backgroundColor: isFull ? '#ef4444' : '#22c55e',
      }]} />
    </Marker>
  );
});

const LcpNapSidebarItem = React.memo<{
  item: LcpNapItem;
  isSelected: boolean;
  primaryColor: string;
  onPress: (id: number | string) => void;
}>(({ item, isSelected, primaryColor, onPress }) => {
  const textColor = isSelected ? primaryColor : '#374151';
  return (
    <Pressable
      onPress={() => onPress(item.id === 0 ? 'all' : item.id)}
      style={[
        styles.locationItem,
        isSelected && { backgroundColor: `${primaryColor}15` }
      ]}
    >
      <View style={styles.locationItemContent}>
        <MapPin size={16} color={textColor} style={styles.iconMargin} />
        <Text style={[styles.locationItemText, { color: textColor, fontWeight: isSelected ? '600' : '400' }]}>
          {item.name}
        </Text>
      </View>
      {item.count > 0 && (
        <View style={[styles.badge, { backgroundColor: isSelected ? primaryColor : '#e5e7eb' }]}>
          <Text style={[styles.badgeText, { color: isSelected ? 'white' : '#374151' }]}>
            {item.count}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

// ─── Main Component ────────────────────────────────────────────────────────────

const LcpNapLocation: React.FC = () => {
  const isDarkMode = false;
  const [markers, setMarkers] = useState<LocationMarker[]>([]);
  const [selectedLcpNapId, setSelectedLcpNapId] = useState<number | string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Pin-drop: the Add action arms the map instead of opening the form.
  const [isPlacingPin, setIsPlacingPin] = useState(false);
  const [pinCoords, setPinCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  // The confirmation card's measured height. Measured rather than assumed
  // because the card grows with its content — "Waiting for the map…" and a
  // coordinate pair are different heights — and the map's action buttons have to
  // clear whatever it actually is.
  const [pinBarHeight, setPinBarHeight] = useState(0);
  const [pinnedCoordinates, setPinnedCoordinates] = useState<string | null>(null);
  const [searchSuggestions, setSearchSuggestions] = useState<any[]>([]);
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationMarker | null>(null);
  const [editLocation, setEditLocation] = useState<LocationMarker | null>(null);
  const [userRole, setUserRole] = useState<number | null>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [currentDelta, setCurrentDelta] = useState(12);
  const [pinLimit, setPinLimit] = useState<string>('25');
  const [currentRegion, setCurrentRegion] = useState({
    latitude: 12.8797,
    longitude: 121.7740,
    latitudeDelta: 12,
    longitudeDelta: 12
  });
  const [mapCenter, setMapCenter] = useState<{ latitude: number, longitude: number }>({
    latitude: 12.8797,
    longitude: 121.7740
  });
  const [headerHeight, setHeaderHeight] = useState(0);
  // Pin dropped at the searched place so the user can see exactly where they navigated to
  const [searchedPlacePin, setSearchedPlacePin] = useState<{ latitude: number; longitude: number; title: string } | null>(null);

  const mapRef = useRef<MapView>(null);
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const primaryColor = colorPalette?.primary || '#7c3aed';

  const pendingRegionRef = useRef({
    latitude: 12.8797,
    longitude: 121.7740,
    latitudeDelta: 12,
    longitudeDelta: 12,
  });

  const skipShowSuggestionsRef = useRef(false);

  // Initialization
  useEffect(() => {
    const initData = async () => {
      try {
        const [activePalette, authData] = await Promise.all([
          settingsColorPaletteService.getActive(),
          AsyncStorage.getItem('authData')
        ]);
        setColorPalette(activePalette);
        if (authData) {
          const parsedUser = JSON.parse(authData);
          setUserRole(parsedUser.role_id);
        }
      } catch (err) {
        console.error('Initialization error:', err);
      }
    };
    initData();
    // No location permission is requested on mount. Google Play requires a runtime
    // permission request to be immediately preceded by a user action and an in-app
    // disclosure, so location is only ever asked for from handleGetMyLocation(), which
    // the user triggers themselves by pressing the locate button.
  }, []);

  // Combined search using local markers + Nominatim (free OSM geocoding)
  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchSuggestions([]);
      setShowSuggestions(false);
      setDebouncedSearch(query);
      if (query.length === 0) setSearchedPlacePin(null);
      return;
    }

    const fetchSuggestions = async () => {
      setIsSearchingSuggestions(true);

      if (!skipShowSuggestionsRef.current) {
        setShowSuggestions(true);
      }
      skipShowSuggestionsRef.current = false;

      // Local LCP-NAP markers search
      const localMatches = markers
        .filter(m =>
          m.lcpnap_name.toLowerCase().includes(query.toLowerCase()) ||
          (m.lcp_name || '').toLowerCase().includes(query.toLowerCase()) ||
          (m.nap_name || '').toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 5)
        .map(m => ({
          type: 'lcpnap',
          id: `marker-${m.id}`,
          title: m.lcpnap_name,
          subtitle: `LCP: ${m.lcp_name} | NAP: ${m.nap_name}`,
          data: m
        }));

      // Photon by Komoot — free geocoding powered by OSM data, no API key needed
      let placeMatches: any[] = [];
      try {
        const features = await photonSearch(query);
        placeMatches = features
          .filter((f: any) => f.geometry?.coordinates?.length === 2)
          .map((f: any) => {
            const props = f.properties || {};
            const name = props.name || props.city || props.district || query;
            const parts = [props.city, props.state, props.country].filter(Boolean);
            return {
              type: 'place',
              id: `photon-${f.properties?.osm_id || Math.random()}`,
              title: name,
              subtitle: parts.join(', ') || 'Philippines',
              latitude: f.geometry.coordinates[1],  // Photon returns [lon, lat]
              longitude: f.geometry.coordinates[0],
            };
          });
      } catch (err) {
        console.error('Photon geocoding error:', err);
      }

      const results = [];
      if (localMatches.length > 0) {
        results.push({ type: 'header', id: 'h-local', title: 'LCP/NAP Matches' });
        results.push(...localMatches);
      }
      if (placeMatches.length > 0) {
        results.push({ type: 'header', id: 'h-places', title: 'Nearby Places' });
        results.push(...placeMatches);
      }

      setSearchSuggestions(results);
      setIsSearchingSuggestions(false);
      setDebouncedSearch(query);
    };

    const handler = setTimeout(fetchSuggestions, 400);
    return () => clearTimeout(handler);
  }, [searchQuery, markers]);

  const processMarkers = (data: any[]): LocationMarker[] =>
    data.map((item: any) => ({
      ...item,
      latitude: typeof item.latitude === 'number' ? item.latitude : parseCoordinates(item.coordinates)?.latitude || 0,
      longitude: typeof item.longitude === 'number' ? item.longitude : parseCoordinates(item.coordinates)?.longitude || 0,
      lcpnap_name: item.lcpnap_name || 'Unnamed'
    })).filter(m => m.latitude !== 0 && m.longitude !== 0);

  const fitMap = useCallback((locationData: LocationMarker[]) => {
    if (locationData.length > 0 && mapRef.current) {
      const sample = locationData.length > 200
        ? locationData.filter((_, i) => i % Math.ceil(locationData.length / 200) === 0)
        : locationData;
      mapRef.current.fitToCoordinates(
        sample.map(loc => ({ latitude: loc.latitude, longitude: loc.longitude })),
        { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true }
      );
    }
  }, []);

  const loadLocations = useCallback(async () => {
    setIsLoading(true);
    try {
      const minRes = await apiClient.get<ApiResponse<any[]>>('/lcp-nap-locations?minimal=1');
      if (minRes.data.success && minRes.data.data) {
        const pinData = processMarkers(minRes.data.data);
        setMarkers(pinData);
        fitMap(pinData);
        setIsLoading(false);

        try {
          const fullRes = await apiClient.get<ApiResponse<any[]>>('/lcp-nap-locations');
          if (fullRes.data.success && fullRes.data.data) {
            const fullData = processMarkers(fullRes.data.data);
            const fullMap = new Map(fullData.map(m => [m.id, m]));
            setMarkers(prev => prev.map(m => fullMap.get(m.id) || m));
          }
        } catch (enrichErr) {
          console.warn('Delayed enrichment failed:', enrichErr);
        }
        return;
      }
    } catch (e) {
      console.error('Initial load failed:', e);
    } finally {
      setIsLoading(false);
    }
  }, [fitMap]);

  useEffect(() => { loadLocations(); }, [loadLocations]);

  const lcpNapGroups = useMemo(() => {
    const grouped: { [key: string]: LcpNapGroup } = {};
    markers.forEach(marker => {
      const name = marker.lcpnap_name;
      if (!grouped[name]) grouped[name] = { lcpnap_id: marker.id, lcpnap_name: name, locations: [], count: 0 };
      grouped[name].locations.push(marker);
      grouped[name].count++;
    });
    return Object.values(grouped).sort((a, b) => a.lcpnap_name.localeCompare(b.lcpnap_name));
  }, [markers]);

  const lcpNapItems = useMemo(() => [
    { id: 0, name: 'All', count: markers.length },
    ...lcpNapGroups.map(g => ({ id: g.lcpnap_id, name: g.lcpnap_name, count: g.count }))
  ], [markers.length, lcpNapGroups]);

  const markersToDisplay = useMemo((): LocationMarker[] => {
    let filtered = markers;
    if (selectedLcpNapId !== 'all') {
      const group = lcpNapGroups.find(g => g.lcpnap_id === selectedLcpNapId);
      filtered = group ? group.locations : [];
    }

    const query = debouncedSearch.trim().toLowerCase();
    const isPlaceActive = !!(searchedPlacePin && query === searchedPlacePin.title.toLowerCase());

    if (query && !isPlaceActive) {
      filtered = filtered.filter(m =>
        m.lcpnap_name.toLowerCase().includes(query) ||
        (m.lcp_name || '').toLowerCase().includes(query) ||
        (m.nap_name || '').toLowerCase().includes(query)
      );
      return filtered.slice(0, 100);
    }

    // Viewport culling — only render markers in view + 50% buffer
    const latSpan = currentRegion.latitudeDelta * 1.5;
    const lngSpan = currentRegion.longitudeDelta * 1.5;
    const latMin = currentRegion.latitude - latSpan / 2;
    const latMax = currentRegion.latitude + latSpan / 2;
    const lngMin = currentRegion.longitude - lngSpan / 2;
    const lngMax = currentRegion.longitude + lngSpan / 2;

    const visible = filtered.filter(m =>
      m.latitude >= latMin && m.latitude <= latMax &&
      m.longitude >= lngMin && m.longitude <= lngMax
    );

    const limit = parseInt(pinLimit) || 50;
    if (visible.length <= limit) return visible;

    const cLat = mapCenter.latitude;
    const cLng = mapCenter.longitude;
    return visible
      .map(m => ({ m, d: Math.abs(m.latitude - cLat) + Math.abs(m.longitude - cLng) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map(x => x.m);
  }, [markers, selectedLcpNapId, lcpNapGroups, debouncedSearch, mapCenter, pinLimit, currentRegion, searchedPlacePin]);


  // ---- Pin-drop placement ------------------------------------------------

  /**
   * Arm the map instead of opening the form.
   *
   * The technician frames the pole on the map and confirms; only then does the form
   * open, with those coordinates already filled and locked. Typing a lat/lng into a
   * blank form was the step this replaces.
   */
  const startPinPlacement = useCallback(() => {
    setPinCoords({ latitude: mapCenter.latitude, longitude: mapCenter.longitude });
    setSelectedLocation(null);
    setIsPlacingPin(true);
  }, [mapCenter]);

  const cancelPinPlacement = useCallback(() => {
    setIsPlacingPin(false);
    setPinCoords(null);
  }, []);

  /** Lock the point in and hand it to the form. */
  const confirmPinPlacement = useCallback(() => {
    if (!pinCoords) return;
    setPinnedCoordinates(`${pinCoords.latitude.toFixed(6)}, ${pinCoords.longitude.toFixed(6)}`);
    setIsPlacingPin(false);
    setShowAddModal(true);
  }, [pinCoords]);

  const handleLcpNapSelect = useCallback((id: number | string) => {
    setSelectedLcpNapId(id);
    const target = id === 'all' ? markers : lcpNapGroups.find(g => g.lcpnap_id === id)?.locations || [];
    if (target.length > 0 && mapRef.current) {
      mapRef.current.fitToCoordinates(target.map(l => ({ latitude: l.latitude, longitude: l.longitude })), {
        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
        animated: true
      });
    }
  }, [markers, lcpNapGroups]);

  const handleLocationSelect = useCallback((loc: LocationMarker) => {
    mapRef.current?.animateToRegion({
      latitude: loc.latitude,
      longitude: loc.longitude,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005
    }, 1000);
    setSelectedLocation(loc);
  }, []);

  const handleEdit = useCallback((loc: LocationMarker) => {
    setEditLocation(loc);
    setShowAddModal(true);
    setSelectedLocation(null);
  }, []);

  const handleGetMyLocation = useCallback(async () => {
    try {
      // Shows the in-app location disclosure before the OS prompt, then requests.
      const granted = await ensureLocationPermission();
      if (!granted) return Alert.alert('Permission denied', 'Location permission is required.');
      const loc = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
      mapRef.current?.animateToRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01
      }, 1000);
    } catch (e) {
      Alert.alert('Error', 'Unable to get location.');
    }
  }, []);

  // Handle suggestion selection — works for both LCP-NAP markers and Nominatim place results
  const handleSuggestionSelect = useCallback(async (suggestion: any) => {
    skipShowSuggestionsRef.current = true;
    setSearchQuery(suggestion.title);
    setDebouncedSearch(suggestion.title);
    setShowSuggestions(false);

    if (suggestion.type === 'lcpnap') {
      setSearchedPlacePin(null);
      handleLocationSelect(suggestion.data);
    } else {
      // Nominatim already returns coordinates directly — no second API call needed
      const lat = suggestion.latitude;
      const lng = suggestion.longitude;
      if (lat && lng) {
        setSearchedPlacePin({ latitude: lat, longitude: lng, title: suggestion.title });
        mapRef.current?.animateToRegion({
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01
        }, 1000);
        setMapCenter({ latitude: lat, longitude: lng });
      }
    }
  }, [handleLocationSelect]);

  const pinSize = getPinSize(currentDelta);

  return (
    <View style={[styles.container, { backgroundColor: '#f9fafb', flexDirection: isTablet ? 'row' : 'column' }]}>
      {isTablet && userRole !== 2 && (
        <View style={[styles.sidebar, { backgroundColor: '#ffffff', borderColor: '#e5e7eb' }]}>
          <View style={[styles.sidebarHeader, { borderColor: '#e5e7eb' }]}>
            <Text style={[styles.sidebarTitle, { color: '#111827' }]}>LCP/NAP Locations</Text>
          </View>
          <View style={styles.flex1}>
            <FlashList
              data={lcpNapItems}
              keyExtractor={i => String(i.id)}
              renderItem={({ item }) => (
                <LcpNapSidebarItem
                  item={item}
                  isSelected={(item.id === 0 && selectedLcpNapId === 'all') || (item.id !== 0 && selectedLcpNapId === item.id)}
                  primaryColor={primaryColor}
                  onPress={handleLcpNapSelect}
                />
              )}
            />
          </View>
        </View>
      )}

      <View style={[styles.flex1, { backgroundColor: '#ffffff' }]}>
        <View style={styles.flexColumnFull}>
          <View
            style={[styles.searchContainer, { backgroundColor: '#ffffff', borderColor: '#e5e7eb', paddingTop: isTablet ? 16 : 60 }]}
            onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
          >
            <View style={styles.headerInputsRow}>
              <View style={[styles.searchWrapper, { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb', flex: 1 }]}>
                <View style={styles.flex1}>
                  <TextInput
                    style={[styles.searchInput, { color: '#111827' }]}
                    placeholder="Search LCP-NAP or Places..."
                    placeholderTextColor="#9ca3af"
                    value={searchQuery}
                    onChangeText={(text) => {
                      skipShowSuggestionsRef.current = false;
                      setSearchQuery(text);
                    }}
                    onFocus={() => searchQuery.length >= 2 && setShowSuggestions(true)}
                  />
                  {isSearchingSuggestions && (
                    <View style={styles.searchingLoader}>
                      <ActivityIndicator size="small" color={primaryColor} />
                    </View>
                  )}
                </View>
              </View>

              <View style={[styles.limitWrapper, { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb' }]}>
                <MapPin size={18} color={primaryColor} style={styles.iconMargin} />
                <TextInput
                  style={[styles.limitInput, { color: '#111827' }]}
                  placeholder="Limit"
                  placeholderTextColor="#9ca3af"
                  value={pinLimit}
                  onChangeText={v => setPinLimit(v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  maxLength={4}
                />
              </View>
            </View>
          </View>

          <View style={styles.mapContainer}>
            {!showAddModal ? (
              <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={{ latitude: 12.8797, longitude: 121.7740, latitudeDelta: 12, longitudeDelta: 12 }}
                minZoomLevel={5.8}
                maxZoomLevel={19}
                showsUserLocation
                showsMyLocationButton={false}
                onUserLocationChange={e => e.nativeEvent.coordinate && setUserLocation(e.nativeEvent.coordinate)}
                onRegionChangeComplete={r => {
                  pendingRegionRef.current = r;
                  setCurrentRegion(r);
                  setCurrentDelta(r.latitudeDelta);
                  setMapCenter({ latitude: r.latitude, longitude: r.longitude });
                  // While placing, the map centre *is* the provisional coordinate, so
                  // panning moves the pin under the fixed crosshair.
                  if (isPlacingPin) setPinCoords({ latitude: r.latitude, longitude: r.longitude });
                }}
                onPress={e => {
                  // A tap re-centres on the tapped point so crosshair and pin agree.
                  if (!isPlacingPin || !e.nativeEvent?.coordinate) return;
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  setPinCoords({ latitude, longitude });
                  mapRef.current?.animateToRegion({
                    latitude,
                    longitude,
                    latitudeDelta: pendingRegionRef.current.latitudeDelta,
                    longitudeDelta: pendingRegionRef.current.longitudeDelta,
                  }, 250);
                }}
                mapType="none"
                showsPointsOfInterest={false}
                // Disable Google-specific props
                showsBuildings={false}
                showsTraffic={false}
                showsIndoors={false}
              >
                {/* ESRI ArcGIS World Light Gray Base — free tiles, no API key, designed for app use, hides POIs */}
                <UrlTile
                  urlTemplate="https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                  maximumZ={19}
                  flipY={false}
                  tileSize={256}
                  // @ts-ignore
                  zIndex={-2}
                />
                {/* ESRI ArcGIS World Light Gray Reference — provides clean labels without POIs */}
                <UrlTile
                  urlTemplate="https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
                  maximumZ={19}
                  flipY={false}
                  tileSize={256}
                  // @ts-ignore
                  zIndex={-1}
                />

                {/* Provisional pin, drawn under the crosshair while placing. */}
                {isPlacingPin && pinCoords && (
                  <Marker
                    coordinate={pinCoords}
                    title="New LCP/NAP location"
                    pinColor={primaryColor}
                    tracksViewChanges={false}
                    zIndex={2000}
                  />
                )}

                {userLocation && <Circle center={userLocation} radius={100} fillColor="rgba(59, 130, 246, 0.1)" strokeColor="rgba(59, 130, 246, 0.4)" strokeWidth={2} />}

                {markersToDisplay.map(loc => (
                  <CustomMarker key={loc.id} location={loc} pinSize={pinSize} onPress={handleLocationSelect} />
                ))}

                {/* Place search result pin — visually distinct */}
                {searchedPlacePin && searchedPlacePin.latitude !== 0 && (
                  <Marker
                    coordinate={{ latitude: searchedPlacePin.latitude, longitude: searchedPlacePin.longitude }}
                    title={searchedPlacePin.title}
                    description="Searched location"
                    pinColor="#ef4444"
                    tracksViewChanges={false}
                  />
                )}
              </MapView>
            ) : (
              <View style={[styles.map, styles.pausedMap, { backgroundColor: '#f3f4f6' }]}>
                <ActivityIndicator size="large" color={primaryColor} />
                <Text style={{ marginTop: 12, color: '#6b7280' }}>Map paused...</Text>
              </View>
            )}

            {showSuggestions && searchSuggestions.length > 0 && (
              <>
                <Pressable
                  style={styles.dropdownBackdrop}
                  onPress={() => setShowSuggestions(false)}
                />
                <View style={[styles.suggestionsDropdown, { top: 0, backgroundColor: '#ffffff', borderColor: '#e5e7eb' }]}>
                  <ScrollView keyboardShouldPersistTaps="always">
                    {searchSuggestions.map((item) => {
                      if (item.type === 'header') {
                        return (
                          <View key={item.id} style={[styles.suggestionHeader, { backgroundColor: '#f9fafb', borderBottomColor: '#f3f4f6' }]}>
                            <Text style={[styles.suggestionHeaderText, { color: '#6b7280' }]}>
                              {item.title}
                            </Text>
                          </View>
                        );
                      }
                      return (
                        <Pressable
                          key={item.id}
                          style={[styles.suggestionItem, { borderBottomColor: '#f3f4f6' }]}
                          onPress={() => handleSuggestionSelect(item)}
                        >
                          <View style={styles.suggestionIcon}>
                            {item.type === 'lcpnap' ? (
                              <MapPin size={18} color={primaryColor} />
                            ) : (
                              <Navigation size={18} color="#9ca3af" />
                            )}
                          </View>
                          <View style={styles.suggestionText}>
                            <Text style={[styles.suggestionTitle, { color: '#111827' }]} numberOfLines={1}>
                              {item.title}
                            </Text>
                            {item.subtitle && (
                              <Text style={[styles.suggestionSubtitle, { color: '#6b7280' }]} numberOfLines={1}>
                                {item.subtitle}
                              </Text>
                            )}
                          </View>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              </>
            )}

            {/* Pin-drop crosshair. Fixed to the centre of the map and click-through, so
                the map underneath still pans and zooms normally. */}
            {isPlacingPin && (
              <View style={styles.crosshairOverlay} pointerEvents="none">
                <View style={[styles.crosshairRing, { borderColor: primaryColor }]} />
                <View style={[styles.crosshairVertical, { backgroundColor: primaryColor }]} />
                <View style={[styles.crosshairHorizontal, { backgroundColor: primaryColor }]} />
              </View>
            )}

            {/* Floating confirmation bar for the pin-drop. */}
            {isPlacingPin && (
              <View
                style={styles.pinBar}
                onLayout={(e) => setPinBarHeight(e.nativeEvent.layout.height)}
              >
                <View style={styles.pinBarHeader}>
                  <MapPin size={16} color={primaryColor} />
                  <View style={styles.pinBarText}>
                    <Text style={styles.pinBarTitle}>Position the pin</Text>
                    <Text style={styles.pinBarHint}>Pan the map or tap a spot, then confirm.</Text>
                    <Text style={styles.pinBarCoords}>
                      {pinCoords
                        ? `${pinCoords.latitude.toFixed(6)}, ${pinCoords.longitude.toFixed(6)}`
                        : 'Waiting for the map…'}
                    </Text>
                  </View>
                </View>

                <View style={styles.pinBarActions}>
                  <Pressable
                    onPress={confirmPinPlacement}
                    disabled={!pinCoords}
                    style={[styles.pinBarButton, { backgroundColor: primaryColor, opacity: pinCoords ? 1 : 0.5 }]}
                  >
                    <Check size={16} color="white" />
                    <Text style={styles.pinBarButtonText}>Confirm</Text>
                  </Pressable>
                  <Pressable onPress={cancelPinPlacement} style={[styles.pinBarButton, styles.pinBarCancel]}>
                    <X size={16} color="#374151" />
                    <Text style={[styles.pinBarButtonText, { color: '#374151' }]}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* While the confirmation card is up, these move above it. Raising
                the card above the tab bar put it where these buttons already
                were, so without this they would sit behind it. */}
            <View
              style={[
                styles.mapActionButtons,
                isPlacingPin && pinBarHeight > 0
                  ? { bottom: TAB_BAR_TOP + 12 + pinBarHeight + 12 }
                  : null,
              ]}
            >
              <Pressable onPress={startPinPlacement} style={[styles.mapActionButton, { backgroundColor: primaryColor }]}>
                <Plus size={24} color="white" />
              </Pressable>
              <Pressable onPress={handleGetMyLocation} style={[styles.mapActionButton, { backgroundColor: '#ffffff', marginTop: 12 }]}>
                <Navigation size={24} color={'#111827'} />
              </Pressable>
            </View>

            {/* Map attribution — required by tile provider */}
            <View style={styles.osmAttribution}>
              <Text style={styles.osmAttributionText}>Powered by Esri | © OpenStreetMap</Text>
            </View>

            {isLoading && (
              <View style={[styles.loaderOverlay, { backgroundColor: 'rgba(243, 244, 246, 0.7)' }]}>
                <View style={styles.loaderContent}>
                  <ActivityIndicator size="large" color="#f97316" />
                  <Text style={{ fontSize: 14, color: '#111827' }}>Loading map data...</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </View>

      <AddLcpNapLocationModal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setEditLocation(null);
          // The pin is consumed by the form; dropping it here means reopening Add starts
          // a fresh placement rather than silently reusing the last point.
          setPinnedCoordinates(null);
          setPinCoords(null);
        }}
        onSave={() => loadLocations()}
        editData={editLocation}
        initialCoordinates={pinnedCoordinates ?? undefined}
        lockCoordinates={pinnedCoordinates !== null}
      />

      {selectedLocation && (
        <Modal visible={!!selectedLocation} animationType="slide" transparent onRequestClose={() => setSelectedLocation(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.mobileDetailsContainer, isTablet && { width: 500, alignSelf: 'center', marginBottom: 40, borderRadius: 20 }]}>
              <LcpNapLocationDetails
                location={selectedLocation!}
                onClose={() => setSelectedLocation(null)}
                onEdit={() => handleEdit(selectedLocation!)}
                isMobile={!isTablet}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

/**
 * The bottom tab bar's geometry, mirrored from pages/Sidebar.tsx.
 *
 * Anything anchored to the bottom of the map has to clear it. Kept here as named
 * values so a change to the bar has one obvious place to be reflected.
 */
const TAB_BAR_BOTTOM_OFFSET = 25;   // Sidebar: position absolute, bottom: 25
const TAB_BAR_HEIGHT = 68;          // Sidebar: collapsed container height
const TAB_BAR_TOP = TAB_BAR_BOTTOM_OFFSET + TAB_BAR_HEIGHT;   // 93

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  flex1: { flex: 1 },
  flexColumnFull: { flexDirection: 'column', flex: 1 },
  sidebar: { width: 256, borderRightWidth: 1, flexShrink: 0 },
  sidebarHeader: { padding: 16, borderBottomWidth: 1 },
  sidebarTitle: { fontSize: 18, fontWeight: '700' },
  locationItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  locationItemContent: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  locationItemText: { fontSize: 14, flex: 1 },
  iconMargin: { marginRight: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  searchContainer: { padding: 16, borderBottomWidth: 1, zIndex: 100 },
  searchWrapper: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1 },
  headerInputsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  limitWrapper: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, width: 100 },
  limitInput: { flex: 1, fontSize: 14, padding: 0, textAlign: 'center' },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  mapContainer: { flex: 1, position: 'relative' },
  map: { ...StyleSheet.absoluteFillObject },
  pausedMap: { alignItems: 'center', justifyContent: 'center' },
  crosshairOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 600 },
  crosshairRing: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, opacity: 0.7 },
  crosshairVertical: { position: 'absolute', width: 2, height: 32 },
  crosshairHorizontal: { position: 'absolute', height: 2, width: 32 },
  // Clear of the bottom tab bar. That bar (pages/Sidebar.tsx) is positioned
  // absolute at bottom: 25 with a collapsed height of 68, so it occupies 25-93px
  // from the screen edge. At bottom: 24 this card sat entirely underneath it and
  // the Confirm button could not be reached — the map's own action buttons at
  // bottom: 100 were already compensating for the same bar.
  //
  // No safe-area inset is added: the tab bar uses a fixed 25px offset rather
  // than insets, so matching its geometry is what keeps the two aligned on every
  // device. Adding an inset here would lift this card away from the bar instead.
  pinBar: { position: 'absolute', left: 16, right: 16, bottom: TAB_BAR_TOP + 12, backgroundColor: '#ffffff', borderRadius: 14, borderWidth: 1, borderColor: '#e5e7eb', padding: 12, zIndex: 700, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 6 },
  pinBarHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  pinBarText: { flex: 1, marginLeft: 8 },
  pinBarTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  pinBarHint: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  pinBarCoords: { fontSize: 12, color: '#374151', marginTop: 4, fontVariant: ['tabular-nums'] },
  pinBarActions: { flexDirection: 'row', marginTop: 12 },
  pinBarButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 8 },
  pinBarCancel: { marginLeft: 8, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff' },
  pinBarButtonText: { color: 'white', fontSize: 14, fontWeight: '600', marginLeft: 6 },
  mapActionButtons: { position: 'absolute', bottom: 100, right: 24, alignItems: 'center' },
  mapActionButton: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84 },
  loaderOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  loaderContent: { alignItems: 'center', gap: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'flex-end' },
  mobileDetailsContainer: { height: '85%', backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  markerPin: { backgroundColor: '#22c55e', borderColor: 'white', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2, elevation: 3 },
  suggestionsDropdown: { position: 'absolute', top: 68, left: 16, right: 16, maxHeight: 400, borderRadius: 12, borderWidth: 1, zIndex: 1000, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, overflow: 'hidden' },
  dropdownBackdrop: { position: 'absolute', top: -100, left: -100, right: -100, bottom: -2000, zIndex: 999 },
  suggestionItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1 },
  suggestionHeader: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  suggestionHeaderText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  suggestionIcon: { marginRight: 12 },
  suggestionText: { flex: 1 },
  suggestionTitle: { fontSize: 14, fontWeight: '600' },
  suggestionSubtitle: { fontSize: 12, marginTop: 2 },
  searchingLoader: { position: 'absolute', right: 0, top: 0, bottom: 0, justifyContent: 'center' },
  osmAttribution: { position: 'absolute', bottom: 4, left: 8, zIndex: 5 },
  osmAttributionText: { fontSize: 9, color: '#4b5563', backgroundColor: 'rgba(255,255,255,0.75)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
});

export default LcpNapLocation;
