import { Camera, ChevronLeft, ChevronRight, CircleCheck, Images, MapPin, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { LocationMap } from "../../components/reports/LocationMap";
import { Alert, Button, fieldClass } from "../../components/ui";
import { ApiError, errorMessage } from "../../lib/api";
import type { CaptureMethod, Coordinates, ReportDraft } from "../../lib/reportTypes";
import { GalleryPicker } from "./GalleryPicker";
import { LiveCameraCapture, type LiveCapture } from "./LiveCameraCapture";
import { DESCRIPTION_MAX_LENGTH, GPS_ACCURACY_WARNING_METERS, reportsApi } from "./reportsApi";

type Step = 1 | 2 | 3;
const STEP_LABELS = ["Method", "Photo and location", "Review"] as const;

/**
 * Guided report submission in three steps:
 *   1. choose live camera or gallery upload
 *   2. take or choose the photo and fix the location (camera: device GPS; gallery: map)
 *   3. review, add an optional description, submit
 * The capture components and the submit call are unchanged; this page only arranges them.
 */
export function NewReportPage() {
  const navigate = useNavigate();
  const descriptionId = useId();
  const [step, setStep] = useState<Step>(1);
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

  function chooseMethod(next: CaptureMethod) {
    setMethod(next);
    setLive(null);
    setGalleryPhoto(null);
    setGalleryLocation(null);
    setError(undefined);
    setStep(2);
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

  const back = step === 1 ? undefined : () => setStep((step - 1) as Step);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {back === undefined ? (
            <Link to="/reports" aria-label="Back to your reports" className="-ml-2 flex size-11 items-center justify-center rounded-lg text-ink-900 hover:bg-ink-100">
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Link>
          ) : (
            <button type="button" onClick={back} disabled={submitting} aria-label="Previous step" className="-ml-2 flex size-11 items-center justify-center rounded-lg text-ink-900 hover:bg-ink-100">
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
          )}
          <h1 className="flex-1 text-xl font-bold tracking-tight text-ink-900 sm:text-2xl">Report road damage</h1>
          <span className="text-[13px] text-ink-500">Step {step} of 3</span>
        </div>
        <ol aria-label="Steps" className="flex gap-1.5">
          {STEP_LABELS.map((label, index) => {
            const number = index + 1;
            return (
              <li key={label} aria-current={number === step ? "step" : undefined} className="flex flex-1 flex-col gap-1">
                <span className={`h-1 rounded-full ${number < step ? "bg-ink-900" : number === step ? "bg-cobalt-600" : "bg-ink-150"}`} aria-hidden="true" />
                <span className={`text-xs ${number === step ? "font-bold text-cobalt-600" : number < step ? "font-semibold text-ink-900" : "font-medium text-ink-500"}`}>{label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {step === 1 && (
        <div className="space-y-3.5">
          <div>
            <h2 className="text-lg font-bold text-ink-900">How do you want to add the photo?</h2>
            <p className="mt-1 text-sm text-ink-500">Either way, the photo is analysed automatically and reviewed by an administrator.</p>
          </div>
          <MethodCard
            icon={<Camera className="size-6" strokeWidth={1.6} />}
            title="Take a photo now"
            badge="Recommended"
            primary
            description="Uses your camera. Your device location is recorded with the photo, so you do not pick it on a map."
            onClick={() => chooseMethod("LIVE_CAMERA")}
          />
          <MethodCard
            icon={<Images className="size-6" strokeWidth={1.6} />}
            title="Upload from gallery"
            description="Choose an existing photo, then select the place on a map. If the photo stores a location, it is compared with your choice."
            onClick={() => chooseMethod("GALLERY_UPLOAD")}
          />
          <section className="rounded-xl border border-ink-150 bg-white p-4">
            <h3 className="text-sm font-bold text-ink-900">For a useful report</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink-600">
              <li>Stand safely off the road.</li>
              <li>Keep the whole damaged area in the frame, in daylight if you can.</li>
              <li>One JPEG or PNG photo, up to 10 MB.</li>
            </ul>
          </section>
          <p className="text-xs text-ink-500">Your camera and location are used only for this report, and only with your permission.</p>
        </div>
      )}

      {step === 2 && method !== null && (
        <div className="space-y-4">
          <section className="rounded-xl border border-ink-150 bg-white p-4 sm:p-5">
            <h2 className="mb-3 text-base font-bold text-ink-900">{method === "LIVE_CAMERA" ? "Take the photo" : "Choose the photo and the place"}</h2>
            {method === "LIVE_CAMERA" ? (
              <LiveCameraCapture value={live} onCapture={setLive} onReset={() => setLive(null)} />
            ) : (
              <GalleryPicker photo={galleryPhoto} location={galleryLocation} onPhotoChange={setGalleryPhoto} onLocationChange={setGalleryLocation} />
            )}
          </section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => setStep(1)} className="min-h-11 rounded-lg px-2 text-sm font-semibold text-cobalt-600 hover:text-cobalt-700">
              Use {method === "LIVE_CAMERA" ? "gallery upload" : "the camera"} instead
            </button>
            <div className="flex items-center gap-3">
              {draft === null && (
                <span className="text-[13px] text-ink-500">{method === "LIVE_CAMERA" ? "Take a photo to continue." : "Choose a photo and select the place."}</span>
              )}
              <Button type="button" size="lg" disabled={draft === null} onClick={() => setStep(3)}>
                Continue
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && draft !== null && (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <section className="overflow-hidden rounded-xl border border-ink-150 bg-white">
            <PhotoPreview photo={draft.photo} />
            <div className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="text-[13px] text-ink-500">{draft.captureMethod === "LIVE_CAMERA" ? "Taken with the live camera" : "Uploaded from your gallery"}</span>
              <button type="button" onClick={() => setStep(2)} disabled={submitting} className="min-h-11 rounded-lg px-2 text-[13px] font-semibold text-cobalt-600 hover:text-cobalt-700">
                Change
              </button>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-ink-150 bg-white">
            <LocationMap value={draft.location} accuracyMeters={draft.gpsAccuracyMeters ?? null} className="h-44 rounded-none! border-0!" />
            <div className="flex items-start gap-3 px-4 py-3">
              <MapPin className="mt-0.5 size-5 shrink-0 text-ink-900" strokeWidth={1.6} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink-900">{draft.captureMethod === "LIVE_CAMERA" ? "Location from your device" : "Location you selected"}</div>
                <div className="font-mono text-xs text-ink-600">
                  {draft.location.latitude.toFixed(5)}, {draft.location.longitude.toFixed(5)}
                  {draft.gpsAccuracyMeters !== undefined && ` · about ${Math.round(draft.gpsAccuracyMeters)} m`}
                </div>
                {draft.gpsAccuracyMeters !== undefined && draft.gpsAccuracyMeters > GPS_ACCURACY_WARNING_METERS && (
                  <div className="mt-1 text-[13px] text-warning-800">Low location accuracy. You can still submit: an administrator will check the location.</div>
                )}
              </div>
              {draft.gpsAccuracyMeters !== undefined && draft.gpsAccuracyMeters > GPS_ACCURACY_WARNING_METERS ? (
                <TriangleAlert className="size-5 shrink-0 text-warning-800" role="img" aria-label="Low accuracy" />
              ) : (
                <CircleCheck className="size-5 shrink-0 text-sev-low" role="img" aria-label="Location set" />
              )}
            </div>
          </section>

          <div className="space-y-1.5">
            <label htmlFor={descriptionId} className="block text-sm font-semibold text-ink-900">
              Description <span className="font-normal text-ink-500">(optional)</span>
            </label>
            <textarea
              id={descriptionId}
              value={description}
              maxLength={DESCRIPTION_MAX_LENGTH}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="For example: large pothole in the left lane near the bus stop"
              className={fieldClass}
            />
            <p className="text-right font-mono text-xs text-ink-500">
              {description.length} / {DESCRIPTION_MAX_LENGTH}
            </p>
          </div>

          <section className="rounded-xl border border-ink-150 bg-white p-4">
            <h2 className="text-sm font-bold text-ink-900">What happens next</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-ink-600">
              <li>Your photo is analysed automatically for visible damage.</li>
              <li>An administrator reviews every report.</li>
              <li>You get updates here in the app and by SMS.</li>
            </ol>
          </section>

          {error !== undefined && <Alert>{error}</Alert>}

          <Button type="submit" size="lg" loading={submitting} className="w-full">
            {submitting ? "Submitting and analysing…" : "Submit report"}
          </Button>
          {submitting && (
            <p className="text-center text-[13px] text-ink-500" role="status">
              This can take up to half a minute while the photo is analysed. Please keep this page open.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function PhotoPreview({ photo }: { photo: Blob }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const objectUrl = URL.createObjectURL(photo);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photo]);
  return url === undefined ? <div className="h-56 bg-ink-100" /> : <img src={url} alt="Your photo of the damage" className="max-h-72 w-full bg-ink-100 object-contain" />;
}

function MethodCard({
  icon,
  title,
  description,
  badge,
  primary = false,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  badge?: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3.5 rounded-2xl bg-white p-4 text-left transition-colors hover:bg-cobalt-50 ${primary ? "border-2 border-cobalt-600" : "border border-ink-200"}`}
    >
      <span className={`flex size-13 shrink-0 items-center justify-center rounded-xl ${primary ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-900"}`} aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold text-ink-900">{title}</span>
          {badge !== undefined && <span className="rounded bg-road-100 px-1.5 py-0.5 text-[11px] font-bold text-road-900">{badge}</span>}
        </span>
        <span className="mt-0.5 block text-[13px] text-ink-500">{description}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-500" aria-hidden="true" />
    </button>
  );
}
