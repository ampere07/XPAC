/**
 * ESRI basemap setup shared by every map in the app — the mobile twin of the web
 * app's config/osmMap.ts, and the reason no screen needs a Google Maps API key.
 *
 * The maps run Leaflet inside a WebView, so this module hands out JavaScript
 * SOURCE rather than Leaflet objects: each screen's HTML inlines the snippet.
 *
 * Two tiers, because no single free service covers the whole zoom range. ESRI's
 * Canvas (grey) basemap is the better overview but has no tiles below z16; from
 * z17 the aerial imagery takes over, which is also the more useful view when
 * placing a pole. Each layer is capped at the zoom it genuinely has and
 * maxNativeZoom stretches the last real tile — past their real data these
 * services answer 200 with "Map data not yet available" drawn into the tile, so
 * requesting deeper tiles never errors, it just prints that text over the map.
 *
 * Canvas keeps geography and labels in separate services; drawing both is what
 * gives place names without a general-purpose basemap's commercial POIs.
 */

const ARCGIS = 'https://services.arcgisonline.com/ArcGIS/rest/services';

const BASEMAPS = {
  light: {
    base: `${ARCGIS}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    reference: `${ARCGIS}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  },
  dark: {
    base: `${ARCGIS}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    reference: `${ARCGIS}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  },
} as const;

const AERIAL = `${ARCGIS}/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const AERIAL_LABELS = `${ARCGIS}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`;

/** Canvas stops at 16 over the Philippines. */
const CANVAS_MAX_ZOOM = 16;
/** Aerial has 18 everywhere in the country (19 only over the metros). */
const AERIAL_NATIVE_MAX = 18;
/** The label overlay thins out a level sooner than the imagery under it. */
const LABELS_NATIVE_MAX = 17;

/** As far as any map lets anyone zoom. */
export const MAX_ZOOM = 19;

/** Leaflet 1.9.4 from the CDN the app's maps already load it from. */
export const LEAFLET_HEAD = `
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>`;

/** The Philippines, as [[south, west], [north, east]] — pan is kept inside it. */
export const PH_BOUNDS_JS = '[[4.3, 114.0], [21.5, 127.5]]';

/**
 * JavaScript that defines `window.__esriBasemap(map, isDark)`: adds the basemap
 * to `map` and returns it as one LayerGroup, so a theme switch is a single remove
 * and a single add — miss one layer and the old labels stay printed on the map.
 */
export const ESRI_BASEMAP_JS = `
  window.__esriBasemap = function (map, isDark) {
    var theme = isDark ? ${JSON.stringify(BASEMAPS.dark)} : ${JSON.stringify(BASEMAPS.light)};
    var group = L.layerGroup([
      L.tileLayer(theme.base, { maxZoom: ${CANVAS_MAX_ZOOM} }),
      L.tileLayer(theme.reference, { maxZoom: ${CANVAS_MAX_ZOOM} }),
      L.tileLayer('${AERIAL}', { minZoom: ${CANVAS_MAX_ZOOM + 1}, maxZoom: ${MAX_ZOOM}, maxNativeZoom: ${AERIAL_NATIVE_MAX} }),
      L.tileLayer('${AERIAL_LABELS}', { minZoom: ${CANVAS_MAX_ZOOM + 1}, maxZoom: ${MAX_ZOOM}, maxNativeZoom: ${LABELS_NATIVE_MAX} })
    ]);
    group.addTo(map);
    return group;
  };`;

/** Credit the tile service requires, shown as a small overlay on each map. */
export const ESRI_ATTRIBUTION = 'Powered by Esri | © OpenStreetMap contributors';
