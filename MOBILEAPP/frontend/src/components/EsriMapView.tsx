import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { ESRI_ATTRIBUTION, ESRI_BASEMAP_JS, LEAFLET_HEAD, MAX_ZOOM, PH_BOUNDS_JS } from '../config/esriMap';

/**
 * A map on ESRI tiles, drawn by Leaflet inside a WebView.
 *
 * Replaces react-native-maps, which on Android always runs on the Google Maps SDK
 * and so needs a Google API key even when every visible tile comes from ESRI.
 *
 * The API deliberately mirrors the react-native-maps pieces the app used —
 * regions with lat/lng deltas, animateToRegion, fitToCoordinates — so screens
 * could switch without rethinking their state.
 *
 * Everything the map shows is passed as props and re-sent whole on change. That
 * is cheap at the sizes this app draws (a pin limit of tens, not thousands) and
 * means the WebView never holds state React doesn't know about.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Region extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface EsriMarker extends LatLng {
  id: string;
  /** 'dot' is a filled circle (cheap, for many markers); 'pin' is a teardrop. */
  kind: 'dot' | 'pin';
  color: string;
  /** Diameter in px, dots only. */
  size?: number;
  /** Pins only. */
  draggable?: boolean;
}

export interface EsriCircle extends LatLng {
  id: string;
  /** Metres. */
  radius: number;
  fillColor: string;
  strokeColor: string;
}

export interface EsriMapHandle {
  animateToRegion: (region: Region, durationMs?: number) => void;
  fitToCoordinates: (coords: LatLng[], paddingPx?: number) => void;
}

interface EsriMapViewProps {
  initialRegion: Region;
  markers?: EsriMarker[];
  circles?: EsriCircle[];
  isDark?: boolean;
  minZoom?: number;
  maxZoom?: number;
  /** Keep panning inside the Philippines, the only country the data covers. */
  restrictToPhilippines?: boolean;
  onPress?: (coord: LatLng) => void;
  onMarkerPress?: (id: string) => void;
  onMarkerDragEnd?: (id: string, coord: LatLng) => void;
  /** Fired once the map settles after any pan or zoom, and once on load. */
  onRegionChangeComplete?: (region: Region) => void;
  style?: StyleProp<ViewStyle>;
  showAttribution?: boolean;
}

type Command =
  | { type: 'animateToRegion'; region: Region; duration: number }
  | { type: 'fitToCoordinates'; coords: LatLng[]; padding: number };

const buildHtml = (initialRegion: Region, isDark: boolean, minZoom: number, maxZoom: number, restrict: boolean) => `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  ${LEAFLET_HEAD}
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: ${isDark ? '#1f2937' : '#e5e7eb'}; }
    .leaflet-control-attribution { display: none; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    ${ESRI_BASEMAP_JS}
    function post(msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
    function regionBounds(r) {
      return [[r.latitude - r.latitudeDelta / 2, r.longitude - r.longitudeDelta / 2],
              [r.latitude + r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2]];
    }

    var map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      minZoom: ${minZoom},
      maxZoom: ${maxZoom},
      ${restrict ? `maxBounds: L.latLngBounds(${PH_BOUNDS_JS}).pad(0.2), maxBoundsViscosity: 1.0,` : ''}
    });
    map.fitBounds(regionBounds(${JSON.stringify(initialRegion)}), { animate: false });

    var basemap = window.__esriBasemap(map, ${isDark});
    var overlay = L.layerGroup().addTo(map);

    function pinIcon(fill) {
      return L.divIcon({
        className: '',
        html: '<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">' +
              '<path d="M13 0C5.82 0 0 5.82 0 13c0 9.2 11.6 20.1 12.1 20.6a1.3 1.3 0 0 0 1.8 0C14.4 33.1 26 22.2 26 13 26 5.82 20.18 0 13 0z" fill="' + fill + '"/>' +
              '<circle cx="13" cy="13" r="5" fill="#ffffff"/></svg>',
        iconSize: [26, 34],
        iconAnchor: [13, 34]
      });
    }

    function emitRegion() {
      var b = map.getBounds(), c = map.getCenter();
      post({ type: 'region', latitude: c.lat, longitude: c.lng,
             latitudeDelta: b.getNorth() - b.getSouth(), longitudeDelta: b.getEast() - b.getWest() });
    }

    function setState(s) {
      overlay.clearLayers();
      (s.circles || []).forEach(function (c) {
        L.circle([c.latitude, c.longitude], { radius: c.radius, color: c.strokeColor, weight: 2,
          fillColor: c.fillColor, fillOpacity: 1, interactive: false }).addTo(overlay);
      });
      (s.markers || []).forEach(function (m) {
        var layer;
        if (m.kind === 'dot') {
          var size = m.size || 12;
          layer = L.circleMarker([m.latitude, m.longitude], { radius: size / 2, color: '#ffffff',
            weight: size > 10 ? 1.5 : 0.5, fillColor: m.color, fillOpacity: 1 });
        } else {
          layer = L.marker([m.latitude, m.longitude], { icon: pinIcon(m.color), draggable: !!m.draggable, zIndexOffset: 1000 });
          layer.on('dragend', function () {
            var p = layer.getLatLng();
            post({ type: 'dragEnd', id: m.id, latitude: p.lat, longitude: p.lng });
          });
        }
        layer.on('click', function (e) {
          L.DomEvent.stopPropagation(e);
          post({ type: 'markerPress', id: m.id });
        });
        layer.addTo(overlay);
      });
    }

    function setTheme(isDark) {
      map.removeLayer(basemap);
      basemap = window.__esriBasemap(map, isDark);
      document.body.style.background = isDark ? '#1f2937' : '#e5e7eb';
    }

    function run(cmd) {
      if (cmd.type === 'animateToRegion') {
        map.flyToBounds(regionBounds(cmd.region), { duration: Math.max(cmd.duration, 1) / 1000 });
      } else if (cmd.type === 'fitToCoordinates' && cmd.coords.length) {
        if (cmd.coords.length === 1) {
          map.flyTo([cmd.coords[0].latitude, cmd.coords[0].longitude], 17);
        } else {
          map.flyToBounds(cmd.coords.map(function (c) { return [c.latitude, c.longitude]; }),
                          { padding: [cmd.padding, cmd.padding] });
        }
      }
    }

    // One entry point for React Native, so injected code stays a single call.
    window.__rn = function (msg) {
      if (msg.state) setState(msg.state);
      if (msg.theme !== undefined) setTheme(msg.theme);
      (msg.commands || []).forEach(run);
    };

    map.on('click', function (e) { post({ type: 'press', latitude: e.latlng.lat, longitude: e.latlng.lng }); });
    map.on('moveend', emitRegion);

    post({ type: 'ready' });
    emitRegion();
  </script>
</body>
</html>`;

// Stable empties, so an omitted prop doesn't count as a change on every render.
const NO_MARKERS: EsriMarker[] = [];
const NO_CIRCLES: EsriCircle[] = [];

const EsriMapView = forwardRef<EsriMapHandle, EsriMapViewProps>(({
  initialRegion,
  markers = NO_MARKERS,
  circles = NO_CIRCLES,
  isDark = false,
  minZoom = 5,
  maxZoom = MAX_ZOOM,
  restrictToPhilippines = true,
  onPress,
  onMarkerPress,
  onMarkerDragEnd,
  onRegionChangeComplete,
  style,
  showAttribution = true,
}, ref) => {
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  // Commands issued before Leaflet has loaded (e.g. fitting freshly-fetched data)
  // would otherwise be lost; they run as soon as the page reports ready.
  const pendingCommands = useRef<Command[]>([]);

  // Built once: regenerating the HTML would reload the WebView and the map with it.
  // Later changes to theme/markers go through injected calls instead.
  const [html] = useState(() => buildHtml(initialRegion, isDark, minZoom, maxZoom, restrictToPhilippines));

  const send = useCallback((msg: object) => {
    webViewRef.current?.injectJavaScript(`window.__rn && window.__rn(${JSON.stringify(msg)}); true;`);
  }, []);

  const runCommand = useCallback((cmd: Command) => {
    if (readyRef.current) send({ commands: [cmd] });
    else pendingCommands.current.push(cmd);
  }, [send]);

  useImperativeHandle(ref, () => ({
    animateToRegion: (region, durationMs = 1000) =>
      runCommand({ type: 'animateToRegion', region, duration: durationMs }),
    fitToCoordinates: (coords, paddingPx = 50) =>
      runCommand({ type: 'fitToCoordinates', coords, padding: paddingPx }),
  }), [runCommand]);

  // Latest overlay state, re-sent whenever it changes and again once the page is ready.
  const stateRef = useRef({ markers, circles });
  stateRef.current = { markers, circles };

  useEffect(() => {
    if (readyRef.current) send({ state: { markers, circles } });
  }, [markers, circles, send]);

  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) { firstTheme.current = false; return; }
    if (readyRef.current) send({ theme: isDark });
  }, [isDark, send]);

  // Handlers read through a ref so the WebView's onMessage never goes stale.
  const handlers = useRef({ onPress, onMarkerPress, onMarkerDragEnd, onRegionChangeComplete });
  handlers.current = { onPress, onMarkerPress, onMarkerDragEnd, onRegionChangeComplete };

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    const h = handlers.current;
    switch (msg.type) {
      case 'ready':
        readyRef.current = true;
        send({ state: stateRef.current, commands: pendingCommands.current });
        pendingCommands.current = [];
        break;
      case 'press':
        h.onPress?.({ latitude: msg.latitude, longitude: msg.longitude });
        break;
      case 'markerPress':
        h.onMarkerPress?.(msg.id);
        break;
      case 'dragEnd':
        h.onMarkerDragEnd?.(msg.id, { latitude: msg.latitude, longitude: msg.longitude });
        break;
      case 'region':
        h.onRegionChangeComplete?.({
          latitude: msg.latitude,
          longitude: msg.longitude,
          latitudeDelta: msg.latitudeDelta,
          longitudeDelta: msg.longitudeDelta,
        });
        break;
    }
  }, [send]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        // Lets the map take pan gestures when it sits inside a ScrollView (Android).
        nestedScrollEnabled
        overScrollMode="never"
        onMessage={onMessage}
        // If Android kills the WebView's renderer, reload; the page re-reports ready and
        // gets the current state re-sent.
        onRenderProcessGone={() => webViewRef.current?.reload()}
        style={styles.webView}
      />
      {showAttribution && (
        <View style={styles.attribution} pointerEvents="none">
          <Text style={styles.attributionText}>{ESRI_ATTRIBUTION}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  webView: { flex: 1, backgroundColor: 'transparent' },
  attribution: { position: 'absolute', bottom: 4, left: 8 },
  attributionText: {
    fontSize: 9,
    color: '#4b5563',
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
});

export default EsriMapView;
