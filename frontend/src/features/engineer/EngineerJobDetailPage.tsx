import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { ReasonDialog } from "../../components/Dialog";
import { Alert, Badge, Button, Card, Spinner } from "../../components/ui";
import {
  damageClassLabel,
  formatConfidence,
  repairStatusLabel,
  repairStatusTone,
  severityLabel,
  severityTone,
} from "../../components/reports/labels";
import { LocationMap } from "../../components/reports/LocationMap";
import { PhotoUploader } from "../../components/reports/PhotoUploader";
import { RepairAttempts } from "../../components/reports/RepairAttempts";
import { ReportPhoto } from "../../components/reports/ReportPhoto";
import { SeverityNote } from "../../components/reports/SeverityNote";
import { ApiError, errorMessage } from "../../lib/api";
import type { EngineerJob } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";
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
      <div className="flex justify-center py-16 text-blue-600">
        <Spinner />
      </div>
    );
  }

  const r = job.repair;
  const attempt = r.currentAttempt;
  const open = job.status === "ACCEPTED";
  const canComplete = r.allowedTransitions.includes("COMPLETED");
  const hasPhoto = r.currentAttemptPhotoCount > 0;

  return (
    <div className="space-y-6">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Repair job</h1>
          <p className="mt-1 text-sm text-slate-500">
            Reported {formatDate(job.createdAt)} · assigned {formatDate(job.assignedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {attempt !== null && <Badge tone="slate">Attempt {attempt}</Badge>}
          {r.status !== null && <Badge tone={repairStatusTone[r.status]}>{repairStatusLabel[r.status]}</Badge>}
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
      {r.latestFeedback !== null && r.status === "COMPLETED" && (
        <Alert tone="info">
          <strong>An administrator asked for more work:</strong> {r.latestFeedback.note}
          <span className="block text-xs">Reopen the repair to start attempt {(attempt ?? 0) + 1}. You will need new photos for it.</span>
        </Alert>
      )}

      {open && (
        <Card title={`Attempt ${attempt ?? "–"}`}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {r.allowedTransitions.includes("WORKING") && r.status === "PENDING" && (
                <Button loading={busy} onClick={() => void changeStatus("WORKING", "Work started.")}>
                  Start work
                </Button>
              )}
              {canComplete && (
                <Button loading={busy} disabled={!hasPhoto} onClick={() => void changeStatus("COMPLETED", "Marked as completed. An administrator will check it.")}>
                  Mark completed
                </Button>
              )}
              {r.allowedTransitions.includes("WORKING") && r.status === "COMPLETED" && (
                <Button variant="secondary" loading={busy} onClick={() => setConfirmReopen(true)}>
                  Reopen repair
                </Button>
              )}
              {r.status === "COMPLETED" && r.latestFeedback === null && (
                <span className="text-sm text-slate-500">Waiting for an administrator to confirm the repair.</span>
              )}
            </div>
            {canComplete && !hasPhoto && (
              <p className="text-sm text-amber-700">Upload at least one photo of this attempt before marking it completed.</p>
            )}
            {(r.status === "PENDING" || r.status === "WORKING") && (
              <PhotoUploader label="Repair photos" count={r.currentAttemptPhotoCount} max={r.maxPhotosPerAttempt} onUpload={uploadPhoto} />
            )}
            <form onSubmit={(e) => void addNote(e)} className="space-y-2">
              <label htmlFor={noteId} className="block text-sm font-medium text-slate-700">
                Progress note
              </label>
              <textarea
                id={noteId}
                value={note}
                maxLength={1000}
                rows={2}
                onChange={(e) => setNote(e.target.value)}
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <Button type="submit" variant="secondary" loading={busy} disabled={note.trim() === ""}>
                Add note
              </Button>
            </form>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card title="Reported damage">
            {job.image === null ? <p className="text-sm text-slate-500">No photo.</p> : <ReportPhoto image={job.image} detections={job.analysis.detections} />}
            {job.description !== null && <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{job.description}</p>}
          </Card>
          <Card title="Repair work" description="All attempts on this job. Earlier attempts are kept as evidence.">
            <RepairAttempts attempts={job.attempts} />
          </Card>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <Card title="Severity and damage">
            <div className="text-sm">
              {job.severity.effective === null ? (
                <span className="text-slate-600">Not estimated.</span>
              ) : (
                <Badge tone={severityTone[job.severity.effective]}>
                  {severityLabel[job.severity.effective]}
                  {job.severity.admin === null ? " (estimated)" : ""}
                </Badge>
              )}
              {job.analysis.detections.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-100">
                  {job.analysis.detections.map((d) => (
                    <li key={d.id} className="flex justify-between py-1.5">
                      <span>{damageClassLabel(d.className)}</span>
                      <span className="text-slate-500">{formatConfidence(d.confidence)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <SeverityNote />
              </div>
            </div>
          </Card>
          <Card title="Location">
            <LocationMap value={{ latitude: job.location.latitude, longitude: job.location.longitude }} className="h-64" />
            <a
              className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline"
              href={`https://www.openstreetmap.org/?mlat=${job.location.latitude}&mlon=${job.location.longitude}#map=18/${job.location.latitude}/${job.location.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in OpenStreetMap
            </a>
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
    <Link to="/engineer" className="text-sm font-medium text-blue-600 hover:text-blue-700">
      ← My jobs
    </Link>
  );
}
