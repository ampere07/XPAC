/**
 * Google Maps styling for the app's two themes.
 *
 * The dark array used to be pasted inline in every screen that mounted a map, and it
 * was applied unconditionally — so a user on the light theme got a light page wrapped
 * around a near-black map. These are the same colours, in one place, plus the light
 * counterpart, which is deliberately empty: Google's default basemap already is the
 * light theme, and re-tinting it only ever made it worse.
 *
 * Typed as the Maps SDK's own style array so `new google.maps.Map({ styles })` and
 * `setOptions({ styles })` take it without a cast at every call site.
 */
export type MapStyle = google.maps.MapTypeStyle[];

export const DARK_MAP_STYLE: MapStyle = [
  {
    featureType: 'all',
    elementType: 'geometry',
    stylers: [{ color: '#1f2937' }]
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#0f172a' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#374151' }]
  },
  {
    featureType: 'poi',
    stylers: [{ visibility: 'off' }]
  },
  {
    featureType: 'transit',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }]
  },
  {
    featureType: 'road',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }]
  },
  {
    elementType: 'labels.text.fill',
    stylers: [{ color: '#9ca3af' }]
  },
  {
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#111827' }]
  }
];

/** Google's own basemap, unmodified. */
export const LIGHT_MAP_STYLE: MapStyle = [];

/** The style for a theme, for `new google.maps.Map({ styles })` and `setOptions`. */
export const mapStyleFor = (isDarkMode: boolean): MapStyle =>
  (isDarkMode ? DARK_MAP_STYLE : LIGHT_MAP_STYLE);

/**
 * Whether the app is currently in dark mode, read from the same key the pages'
 * `isDarkMode` state watches.
 *
 * Needed because a map is initialised from the Maps script's load callback, outside
 * React's render — closing over the state value there pins whatever it was when the
 * page mounted, which is how the map ended up ignoring a theme switch.
 */
export const isDarkThemeActive = (): boolean => localStorage.getItem('theme') !== 'light';
