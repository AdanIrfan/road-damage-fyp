import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, Button, Card } from "../../components/ui";
import { ApiError, errorMessage } from "../../lib/api";
import { GalleryPicker } from "./GalleryPicker";
import { LiveCameraCapture, type LiveCapture } from "./LiveCameraCapture";
import { DESCRIPTION_MAX_LENGTH, reportsApi } from "./reportsApi";
import type { CaptureMethod, Coordinates, ReportDraft } from "../../lib/reportTypes";

export function NewReportPage() {
  const navigate = useNavigate();
  const descriptionId = useId();
  const [method, setMethod] = useState<CaptureMethod | null>(null);
  const [live, setLive] = useState<LiveCapture | null>(null);
  const [galleryPhoto, setGalleryPhoto] = useState<File | null>(null);
  const [galleryLocation, setGalleryLocation] = useState<Coordinates | null>(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const draft: ReportDraft | null =
    method === "LIVE_CAMERA" && live !== null
      ? { captureMethod: "LIVE_CAMERA", photo: live.photo, location: live.location, gpsAccuracyMeters: live.accuracyMeters, description }
      : method === "GALLERY_UPLOAD" && galleryPhoto !== null && galleryLocation !== null
        ? { captureMethod: "GALLERY_UPLOAD", photo: galleryPhoto, location: galleryLocation, description }
        : null;

  function chooseMethod(next: CaptureMethod | null) {
    setMethod(next);
    setLive(null);
    setGalleryPhoto(null);
    setGalleryLocation(null);
    setError(undefined);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft === null) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const { report } = await reportsApi.submit(draft);
      navigate(`/reports/${report.id}`, { state: { justSubmitted: true } });
    } catch (err) {
      const fields = err instanceof ApiError ? Object.values(err.fieldErrors).flat().filter(Boolean) : [];
      setError(fields.length > 0 ? fields.join(" ") : errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/reports" className="text-sm text-blue-700 hover:underline">
          ← My reports
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Report road damage</h1>
        <p className="mt-1 text-sm text-slate-500">Add a photo and the location. The photo is analysed automatically after you submit it.</p>
      </div>

      {method === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <MethodButton
            title="Take a photo now"
            description="Use your camera. Your device location is recorded with the photo."
            onClick={() => chooseMethod("LIVE_CAMERA")}
          />
          <MethodButton
            title="Upload from gallery"
            description="Choose an existing photo and select the location on a map."
            onClick={() => chooseMethod("GALLERY_UPLOAD")}
          />
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
          <Card
            title={method === "LIVE_CAMERA" ? "Live camera" : "Gallery upload"}
            actions={
              <Button type="button" variant="ghost" className="px-3 py-1.5" onClick={() => chooseMethod(null)} disabled={submitting}>
                Change method
              </Button>
            }
          >
            {method === "LIVE_CAMERA" ? (
              <LiveCameraCapture value={live} onCapture={setLive} onReset={() => setLive(null)} />
            ) : (
              <GalleryPicker
                photo={galleryPhoto}
                location={galleryLocation}
                onPhotoChange={setGalleryPhoto}
                onLocationChange={setGalleryLocation}
              />
            )}
          </Card>

          <Card>
            <label htmlFor={descriptionId} className="block text-sm font-medium text-slate-700">
              Description <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              id={descriptionId}
              value={description}
              maxLength={DESCRIPTION_MAX_LENGTH}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="For example: large pothole in the left lane near the bus stop"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <p className="mt-1 text-right text-xs text-slate-400">
              {description.length}/{DESCRIPTION_MAX_LENGTH}
            </p>
          </Card>

          {error !== undefined && <Alert>{error}</Alert>}

          <div className="flex items-center justify-end gap-3">
            {draft === null && (
              <span className="text-sm text-slate-500">
                {method === "LIVE_CAMERA" ? "Take a photo first." : "Choose a photo and select the location."}
              </span>
            )}
            <Button type="submit" loading={submitting} disabled={draft === null}>
              {submitting ? "Submitting and analysing…" : "Submit report"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function MethodButton({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-400 hover:shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    >
      <div className="font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{description}</div>
    </button>
  );
}
