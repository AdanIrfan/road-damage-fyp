import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { Link } from "react-router";
import { OSM_ATTRIBUTION, OSM_MAX_ZOOM, OSM_REFERRER_POLICY, OSM_TILE_URL } from "../../lib/map";
import type { SeverityLevel } from "../../lib/reportTypes";

export interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
  severity: SeverityLevel | null;
  title: string;
  subtitle: string;
  /** Page that opens this report for the current role. */
  href: string;
}

const FILL: Record<SeverityLevel, string> = { HIGH: "#b42318", MEDIUM: "#e8a317", LOW: "#0f766e" };
/** Bigger markers for higher severity, so the map does not rely on colour alone. */
const RADIUS: Record<SeverityLevel, number> = { HIGH: 11, MEDIUM: 9, LOW: 7 };

/** Zooms to show every point (or the world when there are none). */
function FitPoints({ points }: { points: MapPoint[] }) {
  const map = useMap();
  const key = points.map((p) => p.id).join(",");
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(
      points.map((p) => [p.latitude, p.longitude] as [number, number]),
      { padding: [40, 40], maxZoom: 16 },
    );
    // `key` identifies the set of points.
  }, [map, key]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/**
 * Many reports on one OpenStreetMap map. The caller decides which reports the current user may
 * see (the backend enforces it); this component only draws what it is given.
 */
export function ReportsOverviewMap({ points, className = "h-[28rem]" }: { points: MapPoint[]; className?: string }) {
  const first = points[0];
  const center = useMemo<[number, number]>(() => (first === undefined ? [20, 0] : [first.latitude, first.longitude]), [first]);
  return (
    <div className={`overflow-hidden ${className}`}>
      <MapContainer center={center} zoom={first === undefined ? 2 : 13} scrollWheelZoom className="h-full w-full">
        <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} maxZoom={OSM_MAX_ZOOM} referrerPolicy={OSM_REFERRER_POLICY} />
        {points.map((point) => (
          <CircleMarker
            key={point.id}
            center={[point.latitude, point.longitude]}
            radius={point.severity === null ? 7 : RADIUS[point.severity]}
            pathOptions={{
              color: point.severity === null ? "#5b6675" : "#ffffff",
              weight: point.severity === null ? 3 : 2.5,
              fillColor: point.severity === null ? "#ffffff" : FILL[point.severity],
              fillOpacity: 1,
            }}
          >
            <Popup>
              <div className="min-w-40 font-sans">
                <div className="text-sm font-bold text-ink-900">{point.title}</div>
                <div className="text-xs text-ink-500">{point.subtitle}</div>
                <Link to={point.href} className="mt-1.5 inline-block text-[13px] font-semibold">
                  Open
                </Link>
              </div>
            </Popup>
          </CircleMarker>
        ))}
        <FitPoints points={points} />
      </MapContainer>
    </div>
  );
}

export function SeverityLegend() {
  const item = (label: string, style: string) => (
    <span className="flex items-center gap-1.5">
      <span className={`rounded-full ${style}`} aria-hidden="true" />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
      {item("High", "size-3.5 bg-sev-high")}
      {item("Medium", "size-3 bg-sev-medium")}
      {item("Low", "size-2.5 bg-sev-low")}
      {item("Not estimated", "size-2.5 border-2 border-ink-500 bg-white")}
    </div>
  );
}
