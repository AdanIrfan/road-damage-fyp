/**
 * Leaflet setup shared by every map: stylesheet, marker icons and the OpenStreetMap tile layer.
 */
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import "leaflet/dist/leaflet.css";

// Leaflet builds default marker URLs as `imagePath + iconUrl`, where imagePath is auto-detected
// from leaflet.css. Vite already gives full asset URLs, so the detected folder was prepended a
// second time (".../images//node_modules/leaflet/dist/images/marker-icon.png" → 404, no marker).
// A string imagePath (even empty) switches the detection off; the imported URLs are used as-is.
L.Icon.Default.imagePath = "";
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

/** The tile URL recommended by the OSM tile usage policy (the a/b/c subdomains are legacy). */
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
/**
 * OSM refuses tile requests without a Referer. Setting the policy on the tiles themselves keeps
 * the Referer (origin only) even if the page is later served with "Referrer-Policy: no-referrer"
 * (Helmet's default), which would otherwise block every tile.
 */
export const OSM_REFERRER_POLICY = "strict-origin-when-cross-origin" as const;
export const OSM_MAX_ZOOM = 19;
