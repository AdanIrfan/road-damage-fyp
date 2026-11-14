import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Spinner } from "../../components/ui";
import { LocationMap } from "./LocationMap";
import { GPS_ACCURACY_WARNING_METERS } from "./reportsApi";
import type { Coordinates } from "./types";

export interface LiveCapture {
  photo: Blob;
  location: Coordinates;
  /** Accuracy reported by the browser for exactly this reading, in metres. */
  accuracyMeters: number;
}

interface GpsReading {
  latitude: number;
  longitude: number;
  accuracy: number;
  /** When the device produced the reading (ms since epoch). */
  timestamp: number;
}

type GpsState =
  | { status: "waiting" }
  | { status: "ok"; best: GpsReading; latest: GpsReading }
  | { status: "error"; message: string; best?: GpsReading };

const JPEG_QUALITY = 0.92;
/** Give up waiting for a single reading after this long (the watch keeps trying). */
const GPS_TIMEOUT_MS = 30_000;
/** Readings older than this are not used for the photo (the citizen may have moved). */
const GPS_MAX_READING_AGE_MS = 30_000;

/**
 * Takes a photo with the device camera together with the device's location.
 *
 * Location: a fresh high-accuracy watch starts when this step opens (maximumAge 0: never a cached
 * position). Devices usually report a coarse Wi-Fi/IP-based fix first and improve over a few
 * seconds, so the citizen sees the live coordinates and accuracy, and the photo uses the most
 * precise reading the device reported in the last 30 seconds — always a real reading, unchanged.
 * Accuracy depends on the device: laptops and desktops often have no GPS and may stay hundreds of
 * metres off. Poor accuracy is shown honestly; the report is flagged for review, never rejected.
 *
 * Browsers allow camera and location only on HTTPS or localhost, and only with permission.
 */
export function LiveCameraCapture({ value, onCapture, onReset }: { value: LiveCapture | null; onCapture: (capture: LiveCapture) => void; onReset: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<"starting" | "ready" | "error">("starting");
  const [cameraError, setCameraError] = useState<string>();
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const { gps, readings, restart: restartGps } = useLiveLocation(value === null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Starts the camera while no photo has been taken. Each run can be cancelled: if the step is
  // left (or React StrictMode re-runs the effect) before the camera opens, the late stream is
  // stopped immediately instead of staying on and fighting over the <video> element.
  useEffect(() => {
    if (value !== null) return;
    let cancelled = false;
    setCameraState("starting");
    setCameraError(undefined);

    void (async () => {
      if (!window.isSecureContext || navigator.mediaDevices?.getUserMedia === undefined) {
        setCameraState("error");
        setCameraError("The camera is only available on a secure (HTTPS) connection. Use gallery upload instead.");
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (err) {
        if (cancelled) return;
        setCameraState("error");
        setCameraError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser settings, or use gallery upload."
            : "No camera could be started on this device. Use gallery upload instead.",
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video !== null) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          // play() is only interrupted when the element is reused; the stream itself is fine.
        }
      }
      if (!cancelled) setCameraState("ready");
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [value, cameraAttempt, stopCamera]);

  useEffect(() => {
    if (value === null) {
      setPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(value.photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  async function capture() {
    const video = videoRef.current;
    const reading = bestRecentReading(readings.current);
    if (video === null || video.videoWidth === 0 || reading === undefined) return;
    setCapturing(true);
    setCaptureError(undefined);

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const photo = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    setCapturing(false);
    if (photo === null) {
      setCaptureError("The photo could not be taken. Please try again.");
      return;
    }
    stopCamera();
    onCapture({
      photo,
      location: { latitude: reading.latitude, longitude: reading.longitude },
      accuracyMeters: reading.accuracy,
    });
  }

  if (value !== null && previewUrl !== undefined) {
    return (
      <div className="space-y-4">
        <img src={previewUrl} alt="Captured road damage" className="max-h-96 w-full rounded-lg bg-slate-100 object-contain" />
        <LocationMap value={value.location} accuracyMeters={value.accuracyMeters} className="h-56" />
        <LocationSummary latitude={value.location.latitude} longitude={value.location.longitude} accuracy={value.accuracyMeters} />
        <Button type="button" variant="secondary" onClick={onReset}>
          Retake photo
        </Button>
      </div>
    );
  }

  const hasLocation = gps.status === "ok" || (gps.status === "error" && gps.best !== undefined);
  const current = gps.status === "ok" ? gps.best : gps.status === "error" ? gps.best : undefined;

  return (
    <div className="space-y-4">
      {cameraError !== undefined && <Alert>{cameraError}</Alert>}
      {captureError !== undefined && <Alert>{captureError}</Alert>}
      <div className="relative overflow-hidden rounded-lg bg-slate-900">
        <video ref={videoRef} playsInline muted className="aspect-video w-full object-contain" />
        {cameraState === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <Spinner />
            <span className="sr-only">Starting camera</span>
          </div>
        )}
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm" aria-live="polite">
        {gps.status === "waiting" && (
          <div className="flex items-center gap-2 text-slate-600">
            <Spinner className="size-4 text-blue-600" /> Finding your location…
          </div>
        )}
        {current !== undefined && (
          <LocationSummary latitude={current.latitude} longitude={current.longitude} accuracy={current.accuracy} live />
        )}
        {gps.status === "error" && (
          <div className="mt-2 space-y-2">
            <p className="text-red-700">{gps.message}</p>
            <Button type="button" variant="secondary" className="px-3 py-1.5" onClick={restartGps}>
              Try location again
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void capture()} loading={capturing} disabled={cameraState !== "ready" || !hasLocation}>
          {hasLocation ? "Take photo" : "Waiting for location…"}
        </Button>
        {cameraState === "error" && (
          <Button type="button" variant="secondary" onClick={() => setCameraAttempt((n) => n + 1)}>
            Try camera again
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Your browser will ask for permission to use the camera and your location. Accuracy depends on your device: phones with GPS
        are usually most accurate outdoors; laptops often estimate the location from Wi-Fi.
      </p>
    </div>
  );
}

/** Shows the exact coordinates and the accuracy the browser reported, with an honest warning. */
function LocationSummary({ latitude, longitude, accuracy, live = false }: { latitude: number; longitude: number; accuracy: number; live?: boolean }) {
  const poor = accuracy > GPS_ACCURACY_WARNING_METERS;
  return (
    <div className="space-y-1 text-sm">
      <p className="text-slate-700">
        {live ? "Current location" : "Location recorded with the photo"}:{" "}
        <span className="font-mono">
          {latitude.toFixed(6)}, {longitude.toFixed(6)}
        </span>{" "}
        <span className={poor ? "font-medium text-amber-700" : "text-slate-500"}>(accuracy ±{Math.round(accuracy)} m)</span>
      </p>
      {poor && (
        <p className="text-amber-700">
          Your device reports low location accuracy. {live ? "Wait a few seconds, turn on precise location/GPS, or move outdoors. " : ""}
          You can still submit: an administrator will check the location.
        </p>
      )}
    </div>
  );
}

/** Watches the device position while `active`. Readings are fresh (maximumAge 0) and high accuracy. */
function useLiveLocation(active: boolean) {
  const [gps, setGps] = useState<GpsState>({ status: "waiting" });
  const readings = useRef<GpsReading[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) return;
    readings.current = [];
    setGps({ status: "waiting" });
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      setGps({ status: "error", message: "This browser cannot share your location here (location needs HTTPS). Use gallery upload instead." });
      return;
    }
    const startedAt = Date.now();
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        // Defensive: never use a position produced before this step started.
        if (position.timestamp < startedAt - 1000) return;
        const reading: GpsReading = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };
        readings.current = [...readings.current.slice(-19), reading];
        const best = bestRecentReading(readings.current) ?? reading;
        setGps({ status: "ok", best, latest: reading });
      },
      (error) => {
        setGps((current) => ({
          status: "error",
          message: geolocationErrorMessage(error),
          ...(current.status === "ok" ? { best: current.best } : current.status === "error" && current.best ? { best: current.best } : {}),
        }));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_TIMEOUT_MS },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [active, attempt]);

  const restart = useCallback(() => setAttempt((n) => n + 1), []);
  return { gps, readings, restart };
}

/** The most precise reading from the last GPS_MAX_READING_AGE_MS (falls back to the newest). */
function bestRecentReading(readings: readonly GpsReading[]): GpsReading | undefined {
  const newest = readings.at(-1);
  if (newest === undefined) return undefined;
  const recent = readings.filter((r) => newest.timestamp - r.timestamp <= GPS_MAX_READING_AGE_MS);
  return recent.reduce((best, r) => (r.accuracy < best.accuracy ? r : best), newest);
}

function geolocationErrorMessage(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission was denied. A live camera report needs your device location: allow location for this site in your browser settings and try again, or use gallery upload.";
    case error.POSITION_UNAVAILABLE:
      return "Your device could not determine its location. Check that location services are turned on, move to an open area, and try again — or use gallery upload.";
    case error.TIMEOUT:
      return "Finding your location is taking too long. Check that location services are on and try again, or use gallery upload.";
    default:
      return "Your location could not be determined. Try again or use gallery upload.";
  }
}
