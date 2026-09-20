import L from 'leaflet';

/**
 * The OpenStreetMap setup the LCP/NAP screens share.
 *
 * Both the map page and the add-location form draw the same country on the same
 * basemaps with the same pins, so the tiles, bounds, icons and geocoder live
 * here rather than being written out twice and drifting.
 *
 * Nothing here needs an API key. That is the point: the screens used to load
 * the Google Maps JS API, which meant a billable key provisioned, restricted
 * and rotated for two screens that draw dots on a map of one country.
 */

/**
 * Light and dark basemaps: ESRI's Canvas services, which need no API key.
 *
 * Two layers per theme, not one. Canvas keeps geography and labels in separate
 * services, and drawing the base without the reference is what leaves a map
 * with no place names; drawing both is what gives clean labels without the
 * commercial points of interest a general-purpose basemap carries.
 *
 * CARTO was used here first and had to be replaced: its basemaps now stamp
 * "API KEY REQUIRED" into the tile image itself. The request still succeeds, so
 * there is nothing to catch in code — the watermark just appears on the map.
 *
 * No {s} subdomain placeholder: these services are served from one host, and
 * leaving it in produces requests to hosts that do not exist.
 */
const ARCGIS = 'https://services.arcgisonline.com/ArcGIS/rest/services';
const ESRI = `${ARCGIS}/Canvas`;

export const BASEMAPS = {
  light: {
    base: `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    reference: `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  },
  dark: {
    base: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    reference: `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  },
} as const;

/** Aerial photography, and the road and place-name overlay that pairs with it. */
const AERIAL = `${ARCGIS}/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const AERIAL_LABELS = `${ARCGIS}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`;

/**
 * How deep each service actually has tiles over the Philippines.
 *
 * Measured against each service's own placeholder image, not read off the
 * advertised tiling scheme — every one of these claims 23 levels, and past its
 * real data each answers 200 with "Map data not yet available" drawn into the
 * tile. Nothing errors, so the only symptom is that text tiled across the map.
 *
 * Canvas is the strict one: it simply stops at 16, which is below the zoom the
 * page uses to frame a chosen location.
 */
const CANVAS_MAX_ZOOM = 16;
/** Aerial has 18 everywhere in the country and 19 only over the metros. */
const AERIAL_NATIVE_MAX = 18;
/** The label overlay thins out a level sooner than the imagery under it. */
const LABELS_NATIVE_MAX = 17;

/** As far as the map lets anyone zoom. */
export const MAX_ZOOM = 19;

/** Credit required by the tile service. */
export const TILE_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community';

/** Takes the glare off the aerial tiles so they sit in a dark page. */
const DARK_AERIAL_CLASS = 'lcpnap-aerial-dark';

const ensureDarkAerialStyle = () => {
  const id = 'lcpnap-aerial-dark-style';
  if (document.getElementById(id)) return;

  const style = document.createElement('style');
  style.id = id;
  // On the layer container, so it dims the photography without touching the
  // markers — those live in a different Leaflet pane.
  style.textContent = `.${DARK_AERIAL_CLASS} { filter: brightness(0.72) saturate(0.85); }`;
  document.head.appendChild(style);
};

/**
 * The basemap for a theme, as one removable unit.
 *
 * A LayerGroup rather than loose layers so the theme switch stays a single add
 * and a single remove — miss one and the old labels stay printed over the new
 * map.
 *
 * Two tiers, because no single free service covers the whole range. The grey
 * canvas is the better overview and is what the country-wide view shows, but it
 * has nothing below z16; from z17 the aerial takes over, which is also the more
 * useful thing to be looking at when the job is placing a pole. Each layer is
 * capped at the zoom it genuinely has, and maxNativeZoom stretches the last real
 * tile for the rest — so a missing tile is never requested and that placeholder
 * can no longer appear.
 */
export const createBasemap = (isDark: boolean): L.LayerGroup => {
  const theme = isDark ? BASEMAPS.dark : BASEMAPS.light;
  if (isDark) ensureDarkAerialStyle();

  return L.layerGroup([
    L.tileLayer(theme.base, { attribution: TILE_ATTRIBUTION, maxZoom: CANVAS_MAX_ZOOM }),
    L.tileLayer(theme.reference, { maxZoom: CANVAS_MAX_ZOOM }),
    L.tileLayer(AERIAL, {
      minZoom: CANVAS_MAX_ZOOM + 1,
      maxZoom: MAX_ZOOM,
      maxNativeZoom: AERIAL_NATIVE_MAX,
      className: isDark ? DARK_AERIAL_CLASS : '',
    }),
    L.tileLayer(AERIAL_LABELS, {
      minZoom: CANVAS_MAX_ZOOM + 1,
      maxZoom: MAX_ZOOM,
      maxNativeZoom: LABELS_NATIVE_MAX,
    }),
  ]);
};

/**
 * The Philippines, as the old Google `restriction.latLngBounds` described it.
 * Applied as maxBounds so the reader cannot pan away from the only country the
 * data covers.
 */
export const PH_BOUNDS = L.latLngBounds([4.3, 114.0], [21.5, 127.5]);

/**
 * A map pin, drawn inline.
 *
 * Leaflet's default marker resolves its images relative to the stylesheet,
 * which a bundler rewrites — the well-known result is markers that render as
 * broken images. An SVG in the markup has nothing to resolve.
 */
export const pinIcon = (fill: string) =>
  L.divIcon({
    className: '',
    html: `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 0C5.82 0 0 5.82 0 13c0 9.2 11.6 20.1 12.1 20.6a1.3 1.3 0 0 0 1.8 0C14.4 33.1 26 22.2 26 13 26 5.82 20.18 0 13 0z" fill="${fill}"/>
      <circle cx="13" cy="13" r="5" fill="#ffffff"/>
    </svg>`,
    iconSize: [26, 34],
    // Anchored at the point of the pin rather than its middle, so it marks the
    // spot it is standing on.
    iconAnchor: [13, 34],
    tooltipAnchor: [0, -34],
  });

/** A saved or selected location. */
export const selectedPinIcon = pinIcon('#0d9488');

/** A location being placed but not yet confirmed — never the same colour. */
export const provisionalPinIcon = pinIcon('#f59e0b');

/** One address the geocoder matched. */
export interface AddressSuggestion {
  /** Stable enough to key a list: Photon has no place id of its own. */
  id: string;
  description: string;
  lat: number;
  lon: number;
}

/**
 * Address search on Photon — OpenStreetMap data, free, no API key.
 *
 * Google's autocomplete returned a prediction that then needed a second
 * getDetails call to resolve into coordinates. A Photon feature already carries
 * its geometry, so choosing a suggestion needs no further request.
 */
export const photonSearch = async (query: string): Promise<AddressSuggestion[]> => {
  try {
    // bbox: min_lon,min_lat,max_lon,max_lat — the same country restriction the
    // Google call made with componentRestrictions: { country: 'ph' }.
    const response = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&bbox=114.1,4.4,126.6,21.1`
    );
    if (!response.ok) return [];

    const body = await response.json();
    return (body?.features ?? [])
      .filter((f: any) => Array.isArray(f?.geometry?.coordinates))
      .map((f: any, index: number) => {
        const p = f.properties ?? {};
        const description = [p.name, p.street, p.city, p.state, p.country]
          .filter(Boolean)
          .join(', ');
        const [lon, lat] = f.geometry.coordinates;
        return {
          id: `${p.osm_type ?? 'f'}:${p.osm_id ?? index}:${index}`,
          description: description || p.name || 'Unnamed place',
          lat,
          lon,
        };
      });
  } catch (err) {
    console.error('Photon geocoding error:', err);
    return [];
  }
};

/**
 * Is the app on its dark theme right now?
 *
 * Read from the DOM rather than from React state for the one call that happens
 * outside render — creating the map — where a closed-over value would be
 * whatever it was when the component mounted.
 */
export const isDarkThemeActive = (): boolean =>
  document.documentElement.classList.contains('dark') || localStorage.getItem('theme') === 'dark';
