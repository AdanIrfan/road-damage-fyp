import { Check, ChevronLeft, MapPin } from "lucide-react";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { ReasonDialog } from "../../components/Dialog";
import { RepairPill, ReportRef, SeverityIndicator } from "../../components/reports/indicators";
import { damageClassLabel, formatConfidence } from "../../components/reports/labels";
import { LocationMap } from "../../components/reports/LocationMap";
import { PhotoUploader } from "../../components/reports/PhotoUploader";
import { RepairAttempts } from "../../components/reports/RepairAttempts";
import { detectionColor, ReportPhoto } from "../../components/reports/ReportPhoto";
import { SeverityNote } from "../../components/reports/SeverityNote";
import { Alert, Badge, Button, buttonClass, Card, fieldClass, Skeleton } from "../../components/ui";
import { ApiError, errorMessage } from "../../lib/api";
import type { EngineerJob } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";
import { useNotifications } from "../notifications/NotificationsContext";
import { engineerJobsApi } from "./engineerJobsApi";

export function EngineerJobDetailPage() {
  const { id = "" } = useParams();
  const noteId = useId();
  const [job, setJob] = useState<EngineerJob>();
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string }>();
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [confirmReopen, setConfirmReopen] = useState(false);
  const { refresh: refreshNotifications } = useNotifications();

  const load = useCallback(async () => {
    setConflict(false);
    try {
      setJob((await engineerJobsApi.get(id)).job);
      setLoadError(undefined);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 404 ? "This job is not (or no longer) assigned to you." : errorMessage(err),
      );
    }
  }, [id]);

  useEffect(() => {
    setJob(undefined);
    void load();
  }, [load]);

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 409 && err.code === "REPORT_STATE_CONFLICT") {
      setConflict(true);
    } else if (err instanceof ApiError && err.status === 404) {
      void load();
    } else {
      setNotice({ tone: "error", text: errorMessage(err) });
    }
  }

  async function changeStatus(status: "WORKING" | "COMPLETED", message: string, text?: string) {
    if (job?.repair.currentAttempt == null) return;
    setBusy(true);
    setNotice(undefined);
    try {
      setJob((await engineerJobsApi.setRepairStatus(job.id, status, job.repair.currentAttempt, text)).job);
      setNotice({ tone: "success", text: message });
      refreshNotifications();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (job?.repair.currentAttempt == null || note.trim() === "") return;
    setBusy(true);
    setNotice(undefined);
    try {
      setJob((await engineerJobsApi.addNote(job.id, note.trim(), job.repair.currentAttempt)).job);
      setNote("");
      setNotice({ tone: "success", text: "Note added." });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(file: File) {
    if (job?.repair.currentAttempt == null) return;
    try {
      await engineerJobsApi.addPhoto(job.id, file, job.repair.currentAttempt);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "REPORT_STATE_CONFLICT" || err.status === 404)) {
        fail(err);
        return;
      }
      throw err;
    }
    setJob((await engineerJobsApi.get(job.id)).job);
  }

  if (loadError !== undefined) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert>{loadError}</Alert>
      </div>
    );
  }
  if (job === undefined) {
    return (
      <div className="mx-auto max-w-5xl space-y-5" role="status">
        <span className="sr-only">Loading job</span>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  const r = job.repair;
  const attempt = r.currentAttempt;
  const open = job.status === "ACCEPTED";
  const canStart = r.allowedTransitions.includes("WORKING") && r.status === "PENDING";
  const canComplete = r.allowedTransitions.includes("COMPLETED");
  const canReopen = r.allowedTransitions.includes("WORKING") && r.status === "COMPLETED";
  const hasPhoto = r.currentAttemptPhotoCount > 0;
  const title = job.analysis.detections.length > 0
    ? job.analysis.detections.map((d) => d.className).filter((name, index, all) => all.indexOf(name) === index).map(damageClassLabel).join(", ")
    : "Road damage";
  const mapsUrl = `https://www.openstreetmap.org/?mlat=${job.location.latitude}&mlon=${job.location.longitude}#map=18/${job.location.latitude}/${job.location.longitude}`;
  // The three things to do on an attempt, in order.
  const steps = [
    { label: "Start work", done: r.status !== "PENDING", hint: r.status === "PENDING" ? "Tell the administrator you have begun." : undefined },
    { label: `Add repair photos (${r.currentAttemptPhotoCount} of ${r.maxPhotosPerAttempt})`, done: hasPhoto, hint: hasPhoto ? undefined : "At least one photo of this attempt is needed." },
    { label: "Mark completed", done: r.status === "COMPLETED", hint: r.status === "COMPLETED" ? "An administrator checks the repair and confirms it." : undefined },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <ReportRef id={job.id} />
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
          <p className="mt-1 text-[13px] text-ink-500">
            Reported {formatDate(job.createdAt)} · assigned {formatDate(job.assignedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SeverityIndicator level={job.severity.effective} estimated={job.severity.admin === null} />
          {r.status !== null && <RepairPill status={r.status} attempt={attempt} />}
          {job.status === "COMPLETED" && <Badge tone="green">Confirmed by admin</Badge>}
        </div>
      </div>

      {conflict && (
        <Alert>
          This job was changed in the meantime (for example by an administrator).{" "}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Reload the latest version
          </button>
        </Alert>
      )}
      {notice !== undefined && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {r.latestFeedback !== null && r.status === "COMPLETED" && open && (
        <section className="rounded-xl border border-ink-150 bg-white p-4 shadow-[inset_0_3px_0_var(--color-road-400)]">
          <h2 className="text-sm font-bold text-ink-900">An administrator asked for more work</h2>
          <p className="mt-1.5 rounded-lg bg-canvas px-3 py-2 text-sm whitespace-pre-line text-ink-600">{r.latestFeedback.note}</p>
          <p className="mt-2 text-xs text-ink-500">Reopening starts attempt {(attempt ?? 0) + 1}. You will need new photos for it; earlier photos stay as evidence.</p>
        </section>
      )}

      {open && (
        <section className="rounded-xl border border-ink-150 bg-white p-4 sm:p-5">
          <h2 className="text-base font-bold text-ink-900">Attempt {attempt ?? "–"}</h2>
          <ol className="mt-3 space-y-2">
            {steps.map((step, index) => (
              <li key={step.label} className="flex items-start gap-2.5 text-sm">
                <span
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    step.done ? "bg-ink-900 text-white" : "border-2 border-ink-300 text-ink-500"
                  }`}
                  aria-hidden="true"
                >
                  {step.done ? <Check className="size-3" strokeWidth={3} /> : index + 1}
                </span>
                <span>
                  <span className={step.done ? "font-semibold text-ink-900" : "font-medium text-ink-600"}>
                    {step.label}
                    {step.done && <span className="sr-only"> (done)</span>}
                  </span>
                  {step.hint !== undefined && <span className="block text-xs text-ink-500">{step.hint}</span>}
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-4 space-y-4 border-t border-ink-100 pt-4">
            {(r.status === "PENDING" || r.status === "WORKING") && (
              <PhotoUploader label="Repair photos" count={r.currentAttemptPhotoCount} max={r.maxPhotosPerAttempt} onUpload={uploadPhoto} />
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              {canStart && (
                <Button size="lg" loading={busy} onClick={() => void changeStatus("WORKING", "Work started.")} className="w-full sm:w-auto">
                  Start work
                </Button>
              )}
              {canComplete && (
                <Button
                  size="lg"
                  loading={busy}
                  disabled={!hasPhoto}
                  onClick={() => void changeStatus("COMPLETED", "Marked as completed. An administrator will check it.")}
                  className="w-full sm:w-auto"
                >
                  Mark completed
                </Button>
              )}
              {canReopen && (
                <Button size="lg" variant={r.latestFeedback !== null ? "primary" : "secondary"} loading={busy} onClick={() => setConfirmReopen(true)} className="w-full sm:w-auto">
                  Reopen as attempt {(attempt ?? 0) + 1}
                </Button>
              )}
            </div>
            {canComplete && !hasPhoto && <p className="text-[13px] text-warning-800">Upload at least one photo of this attempt before marking it completed.</p>}
            {r.status === "COMPLETED" && r.latestFeedback === null && <p className="text-[13px] text-ink-500">Waiting for an administrator to confirm the repair.</p>}

            <form onSubmit={(e) => void addNote(e)} className="space-y-2">
              <label htmlFor={noteId} className="block text-sm font-semibold text-ink-900">
                Progress note <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <textarea id={noteId} value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} className={fieldClass} />
              <Button type="submit" variant="secondary" loading={busy} disabled={note.trim() === ""}>
                Add note
              </Button>
            </form>
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Card title="Reported damage">
            {job.image === null ? <p className="text-sm text-ink-500">No photo.</p> : <ReportPhoto image={job.image} detections={job.analysis.detections} />}
            {job.analysis.detections.length > 0 && (
              <ul className="mt-4 divide-y divide-ink-100 text-sm">
                {job.analysis.detections.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="flex items-center gap-2 font-medium text-ink-900">
                      <span className="size-3 shrink-0 border-[3px] border-ink-900" style={{ backgroundColor: detectionColor(d.className) }} aria-hidden="true" />
                      {damageClassLabel(d.className)}
                    </span>
                    <span className="font-mono text-[13px] text-ink-600">{formatConfidence(d.confidence)} confidence</span>
                  </li>
                ))}
              </ul>
            )}
            {job.description !== null && <p className="mt-4 rounded-lg bg-canvas px-3 py-2.5 text-sm whitespace-pre-line text-ink-600">{job.description}</p>}
            <div className="mt-3">
              <SeverityNote />
            </div>
          </Card>
          <Card title="Repair work" description="All attempts on this job. Earlier attempts are kept as evidence.">
            <RepairAttempts attempts={job.attempts} />
          </Card>
        </div>
        <div className="space-y-5 lg:col-span-2">
          <Card title="Location" flush>
            <LocationMap value={{ latitude: job.location.latitude, longitude: job.location.longitude }} className="h-64 rounded-none! border-x-0!" />
            <div className="space-y-3 px-5 py-4">
              <div className="font-mono text-[13px] text-ink-600">
                {job.location.latitude.toFixed(5)}, {job.location.longitude.toFixed(5)}
              </div>
              <a className={buttonClass("secondary", "lg", "w-full")} href={mapsUrl} target="_blank" rel="noreferrer">
                <MapPin className="size-4" aria-hidden="true" />
                Open in OpenStreetMap
              </a>
            </div>
          </Card>
        </div>
      </div>

      {confirmReopen && attempt !== null && (
        <ReasonDialog
          title={`Reopen repair (start attempt ${attempt + 1})`}
          description="The repair goes back to Working as a new attempt. Photos from earlier attempts stay as evidence; you need at least one new photo before completing again."
          label="Note"
          required={false}
          maxLength={1000}
          confirmLabel="Reopen"
          onClose={() => setConfirmReopen(false)}
          onConfirm={async (text) => {
            setConfirmReopen(false);
            await changeStatus("WORKING", `Attempt ${attempt + 1} started.`, text);
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/engineer" className="-ml-1 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-cobalt-600 hover:text-cobalt-700">
      <ChevronLeft className="size-4" aria-hidden="true" />
      My jobs
    </Link>
  );
}
