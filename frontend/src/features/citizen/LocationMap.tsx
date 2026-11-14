import { useEffect, useState } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Button } from "../../components/ui";
import { OSM_ATTRIBUTION, OSM_MAX_ZOOM, OSM_REFERRER_POLICY, OSM_TILE_URL } from "../../lib/map";
import type { Coordinates } from "./types";

const WORLD_VIEW = { center: [20, 0] as [number, number], zoom: 2 };
const PICKED_ZOOM = 17;

interface LocationMapProps {
  value: Coordinates | null;
  /** When given, the map is editable: clicking places the marker. */
  onChange?: (value: Coordinates) => void;
  /** Draws the GPS accuracy circle (live camera). */
  accuracyMeters?: number | null;
  className?: string;
}

/** OpenStreetMap map showing one location; optionally lets the user pick it by clicking. */
export function LocationMap({ value, onChange, accuracyMeters, className = "h-72" }: LocationMapProps) {
  const [recenterTo, setRecenterTo] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string>();
  const [tiles, setTiles] = useState({ loaded: 0, failed: 0 });
  const editable = onChange !== undefined;

  function goToMyLocation() {
    if (!("geolocation" in navigator)) {
      setLocateError("Your browser cannot share its location.");
      return;
    }
    setLocating(true);
    setLocateError(undefined);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        // Only moves the map; the citizen still clicks the exact spot of the damage.
        setRecenterTo({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => {
        setLocating(false);
        setLocateError("Could not get your location. Move the map and click the place instead.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  return (
    <div className="space-y-2">
      <div className={`overflow-hidden rounded-lg border border-slate-200 ${className}`}>
        <MapContainer
          center={value === null ? WORLD_VIEW.center : [value.latitude, value.longitude]}
          zoom={value === null ? WORLD_VIEW.zoom : PICKED_ZOOM}
          scrollWheelZoom={editable}
          className="h-full w-full"
        >
          <TileLayer
            url={OSM_TILE_URL}
            attribution={OSM_ATTRIBUTION}
            maxZoom={OSM_MAX_ZOOM}
            referrerPolicy={OSM_REFERRER_POLICY}
            eventHandlers={{
              tileload: () => setTiles((t) => ({ ...t, loaded: t.loaded + 1 })),
              tileerror: () => setTiles((t) => ({ ...t, failed: t.failed + 1 })),
            }}
          />
          {value !== null && <Marker position={[value.latitude, value.longitude]} />}
          {value !== null && accuracyMeters != null && (
            <Circle center={[value.latitude, value.longitude]} radius={accuracyMeters} pathOptions={{ color: "#2563eb", weight: 1, fillOpacity: 0.1 }} />
          )}
          {editable && <ClickToPick onPick={onChange} />}
          <Recenter to={recenterTo} />
          <FollowContainerSize />
        </MapContainer>
      </div>
      {tiles.failed > 0 && tiles.loaded === 0 && (
        <p className="text-sm text-amber-700">
          The map background could not be loaded from OpenStreetMap (no internet connection, or the tile server is blocked by a
          network filter or browser extension). The location marker is still correct.
        </p>
      )}
      {editable && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-slate-500">
            {value === null
              ? "Click on the map where the damage is."
              : `Selected: ${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}`}
          </span>
          <Button type="button" variant="secondary" className="px-3 py-1.5" loading={locating} onClick={goToMyLocation}>
            Go to my location
          </Button>
        </div>
      )}
      {locateError !== undefined && <p className="text-sm text-amber-700">{locateError}</p>}
    </div>
  );
}

function ClickToPick({ onPick }: { onPick: (value: Coordinates) => void }) {
  useMapEvents({
    click: (event) => onPick({ latitude: event.latlng.lat, longitude: event.latlng.wrap().lng }),
  });
  return null;
}

/**
 * Leaflet measures its container once. If the container changes size later (layout shifts, a
 * scrollbar appearing, a card expanding), tiles would only cover the old area; re-measure.
 */
function FollowContainerSize() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function Recenter({ to }: { to: Coordinates | null }) {
  const map = useMap();
  useEffect(() => {
    if (to !== null) {
      map.setView([to.latitude, to.longitude], PICKED_ZOOM);
    }
  }, [map, to]);
  return null;
}
