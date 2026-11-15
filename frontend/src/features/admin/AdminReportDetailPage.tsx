import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ReasonDialog } from "../../components/Dialog";
import { Alert, Badge, Button, Card, Spinner } from "../../components/ui";
import {
  captureMethodLabel,
  damageClassLabel,
  formatConfidence,
  formatDistance,
  locationStatusHelp,
  locationStatusLabel,
  repairStatusLabel,
  repairStatusTone,
  reportStatusLabel,
  reportStatusTone,
  severityLabel,
  severityTone,
} from "../../components/reports/labels";
import { LocationMap } from "../../components/reports/LocationMap";
import { RepairAttempts } from "../../components/reports/RepairAttempts";
import { ReportPhoto } from "../../components/reports/ReportPhoto";
import { SeverityNote } from "../../components/reports/SeverityNote";
import { StatusTimeline } from "../../components/reports/StatusTimeline";
import { ApiError, errorMessage } from "../../lib/api";
import type { AdminActionResult, AdminReport, SeverityLevel } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";
import { adminReportsApi } from "./adminReportsApi";
import { AssignEngineerDialog } from "./AssignEngineerDialog";

type DialogKind = "accept" | "reject" | "delay" | "feedback" | "confirm" | "assign";

export function AdminReportDetailPage() {
  const { id = "" } = useParams();
  const [report, setReport] = useState<AdminReport>();
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<{ tone: "success" | "info" | "error"; text: string }>();
  const [conflict, setConflict] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(undefined);
    setConflict(false);
    try {
      setReport((await adminReportsApi.get(id)).report);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    setReport(undefined);
    void load();
  }, [load]);

  /** Applies an action result; a 409 means the report changed (another admin, the engineer…). */
  function applyResult(result: AdminActionResult, message: string) {
    setReport(result.report);
    setDialog(undefined);
    setConflict(false);
    if (result.notification === "failed") {
      setNotice({ tone: "error", text: `${message} The SMS to the citizen could not be sent; the decision is saved.` });
    } else {
      setNotice({ tone: "success", text: result.notification === "sent" ? `${message} The citizen has been notified by SMS.` : message });
    }
  }

  async function run(action: () => Promise<AdminActionResult>, message: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      applyResult(await action(), message);
    } catch (err) {
      handleError(err);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  function handleError(err: unknown) {
    if (err instanceof ApiError && err.status === 409) {
      setConflict(true);
      setDialog(undefined);
    }
  }

  /** For buttons without a dialog: show the error instead of rethrowing. */
  function runDirect(action: () => Promise<AdminActionResult>, message: string) {
    run(action, message).catch((err: unknown) => {
      if (!(err instanceof ApiError && err.status === 409)) setNotice({ tone: "error", text: errorMessage(err) });
    });
  }

  if (loadError !== undefined) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert>{loadError}</Alert>
      </div>
    );
  }
  if (report === undefined) {
    return (
      <div className="flex justify-center py-16 text-blue-600">
        <Spinner />
      </div>
    );
  }

  const actions = report.allowedActions;
  const attempt = report.assignment.currentAttempt;

  return (
    <div className="space-y-6">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Road damage report</h1>
          <p className="mt-1 text-sm text-slate-500">
            {captureMethodLabel[report.captureMethod]} · submitted {formatDate(report.createdAt)} by {report.citizen.fullName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={reportStatusTone[report.status]}>{reportStatusLabel[report.status]}</Badge>
          {report.assignment.repairStatus !== null && (
            <Badge tone={repairStatusTone[report.assignment.repairStatus]}>
              Repair: {repairStatusLabel[report.assignment.repairStatus]}
              {attempt !== null && attempt > 1 ? ` · attempt ${attempt}` : ""}
            </Badge>
          )}
        </div>
      </div>

      {conflict && (
        <Alert>
          This report was changed in the meantime (by another admin or the engineer).{" "}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Reload the latest version
          </button>
        </Alert>
      )}
      {notice !== undefined && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <Card title="Actions">
        <div className="flex flex-wrap gap-2">
          {actions.review && (
            <Button loading={busy} onClick={() => runDirect(() => adminReportsApi.review(report.id), "The report is now under review.")}>
              Start review
            </Button>
          )}
          {actions.decide && (
            <>
              <Button onClick={() => setDialog("accept")}>Accept</Button>
              <Button variant="danger" onClick={() => setDialog("reject")}>
                Reject
              </Button>
              <Button variant="secondary" onClick={() => setDialog("delay")}>
                {report.status === "DELAYED" ? "Keep delayed" : "Delay"}
              </Button>
            </>
          )}
          {actions.assign && (
            <Button variant={report.assignment.engineer === null ? "primary" : "secondary"} onClick={() => setDialog("assign")}>
              {report.assignment.engineer === null ? "Assign engineer" : "Reassign"}
            </Button>
          )}
          {actions.confirmCompletion && <Button onClick={() => setDialog("confirm")}>Confirm repair completed</Button>}
          {actions.feedback && (
            <Button variant="secondary" onClick={() => setDialog("feedback")}>
              Needs more work
            </Button>
          )}
          {!actions.review && !actions.decide && !actions.assign && !actions.confirmCompletion && (
            <p className="text-sm text-slate-500">
              {report.status === "COMPLETED"
                ? "This report is completed."
                : report.status === "REJECTED"
                  ? "This report was rejected."
                  : "No actions are available right now."}
            </p>
          )}
        </div>
        {actions.confirmCompletion && (
          <p className="mt-3 text-sm text-slate-600">
            The engineer marked attempt {attempt} as completed. Check its photos below, then confirm, or ask for more work.
          </p>
        )}
        {report.assignment.engineer?.status === "DEACTIVATED" && (
          <Alert>The assigned engineer's account is deactivated. Reassign this report.</Alert>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card title="Photo">
            {report.image === null ? <p className="text-sm text-slate-500">No photo.</p> : <ReportPhoto image={report.image} detections={report.analysis.detections} />}
            {report.description !== null && <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{report.description}</p>}
          </Card>
          <Card title="Repair work" description="Grouped by attempt. Earlier attempts are kept as evidence.">
            <RepairAttempts attempts={report.repairAttempts} />
          </Card>
          <Card title="Status history">
            <StatusTimeline entries={report.statusHistory} />
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <SeverityCard report={report} onSave={(severity) => run(() => adminReportsApi.setSeverity(report.id, severity), "Severity updated.")} />
          <Card title="Automatic analysis">
            {report.analysis.status === "FAILED" ? (
              <Alert tone="info">The automatic analysis failed ({report.analysis.errorCode ?? "unknown reason"}). Review the photo manually.</Alert>
            ) : report.analysis.detections.length === 0 ? (
              <p className="text-sm text-slate-600">No damage was detected automatically.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {report.analysis.detections.map((d) => (
                  <li key={d.id} className="flex justify-between py-1.5">
                    <span>{damageClassLabel(d.className)}</span>
                    <span className="text-slate-500">confidence {formatConfidence(d.confidence)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Location">
            <LocationMap
              value={{ latitude: report.location.latitude, longitude: report.location.longitude }}
              accuracyMeters={report.location.gpsAccuracyMeters}
              comparison={report.location.exif === null ? null : { ...report.location.exif, label: "Location stored in the photo (EXIF)" }}
              className="h-64"
            />
            <div className="mt-3 space-y-1 text-sm">
              <Badge tone={report.location.needsReview ? "amber" : "green"}>{locationStatusLabel[report.location.verificationStatus]}</Badge>
              <p className="text-slate-600">{locationStatusHelp[report.location.verificationStatus]}</p>
              {report.location.exif !== null && (
                <p className="text-slate-500">
                  Red point: location stored in the photo
                  {report.location.exif.distanceMeters !== null && ` (${formatDistance(report.location.exif.distanceMeters)} away)`}.
                </p>
              )}
              {report.location.gpsAccuracyMeters !== null && <p className="text-slate-500">GPS accuracy: about {Math.round(report.location.gpsAccuracyMeters)} m</p>}
            </div>
          </Card>
          <Card title="Citizen">
            <p className="text-sm text-slate-800">{report.citizen.fullName}</p>
            <p className="text-sm text-slate-500">{report.citizen.mobileNumber}</p>
          </Card>
          <Card title="Assignment">
            {report.assignment.engineer === null ? (
              <p className="text-sm text-slate-500">Not assigned.</p>
            ) : (
              <div className="text-sm">
                <Link to={`/admin/engineers/${report.assignment.engineer.id}`} className="font-medium text-blue-700 hover:underline">
                  {report.assignment.engineer.fullName}
                </Link>
                <p className="text-slate-500">
                  Assigned {formatDate(report.assignment.assignedAt)} · attempt {attempt}
                </p>
              </div>
            )}
            {report.assignmentHistory.length > 1 && (
              <ol className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
                {report.assignmentHistory.map((a) => (
                  <li key={a.id}>
                    Attempt {a.attempt}: {a.engineer.fullName} by {a.assignedBy.fullName}, {formatDate(a.createdAt)}
                    {a.reason !== null && ` — ${a.reason}`}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      {dialog === "accept" && (
        <ReasonDialog
          title="Accept report"
          label="Note"
          required={false}
          maxLength={500}
          confirmLabel="Accept"
          onClose={() => setDialog(undefined)}
          onConfirm={(text) => run(() => adminReportsApi.decide(report.id, "ACCEPT", text), "Report accepted.")}
        />
      )}
      {dialog === "reject" && (
        <ReasonDialog
          title="Reject report"
          description="The citizen will see this reason and receive it by SMS."
          label="Reason"
          required
          maxLength={500}
          tone="danger"
          confirmLabel="Reject"
          onClose={() => setDialog(undefined)}
          onConfirm={(text) => run(() => adminReportsApi.decide(report.id, "REJECT", text), "Report rejected.")}
        />
      )}
      {dialog === "delay" && (
        <ReasonDialog
          title={report.status === "DELAYED" ? "Keep delayed" : "Delay report"}
          description={
            report.status === "DELAYED"
              ? "Record a new reason. The citizen sees it in the app; no SMS is sent because the status does not change."
              : "The citizen will see this reason and receive it by SMS."
          }
          label="Reason"
          required
          maxLength={500}
          confirmLabel={report.status === "DELAYED" ? "Keep delayed" : "Delay"}
          onClose={() => setDialog(undefined)}
          onConfirm={(text) =>
            run(() => adminReportsApi.decide(report.id, "DELAY", text), report.status === "DELAYED" ? "New delay reason recorded." : "Report delayed.")
          }
        />
      )}
      {dialog === "feedback" && attempt !== null && (
        <ReasonDialog
          title="Ask for more work"
          description={`The engineer will see this note on attempt ${attempt} and can reopen the repair. A new attempt then needs new photos.`}
          label="What needs to be done"
          required
          maxLength={1000}
          confirmLabel="Send feedback"
          onClose={() => setDialog(undefined)}
          onConfirm={(text) => run(() => adminReportsApi.feedback(report.id, text, attempt), "Feedback sent to the engineer.")}
        />
      )}
      {dialog === "confirm" && attempt !== null && (
        <ReasonDialog
          title="Confirm repair completed"
          description={`This marks the report as Completed (final) based on attempt ${attempt}, and notifies the citizen by SMS.`}
          label="Note"
          required={false}
          maxLength={500}
          confirmLabel="Confirm completion"
          onClose={() => setDialog(undefined)}
          onConfirm={(text) => run(() => adminReportsApi.confirmCompletion(report.id, attempt, text), "Repair confirmed. The report is completed.")}
        />
      )}
      {dialog === "assign" && (
        <AssignEngineerDialog
          reportId={report.id}
          isReassignment={report.assignment.engineer !== null}
          onClose={() => setDialog(undefined)}
          onAssigned={(result) => applyResult(result, report.assignment.engineer === null ? "Engineer assigned." : "Report reassigned.")}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/admin/reports" className="text-sm font-medium text-blue-600 hover:text-blue-700">
      ← All reports
    </Link>
  );
}

function SeverityCard({ report, onSave }: { report: AdminReport; onSave: (severity: SeverityLevel) => Promise<void> }) {
  const [value, setValue] = useState<SeverityLevel | "">(report.severity.admin ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    if (value === "") return;
    setSaving(true);
    setError(undefined);
    try {
      await onSave(value);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Severity">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-slate-500">Automatic estimate</dt>
        <dd>
          {report.severity.ai === null ? "Not estimated" : <Badge tone={severityTone[report.severity.ai]}>{severityLabel[report.severity.ai]}</Badge>}
        </dd>
        <dt className="text-slate-500">Admin severity</dt>
        <dd>
          {report.severity.admin === null ? (
            "—"
          ) : (
            <>
              <Badge tone={severityTone[report.severity.admin]}>{severityLabel[report.severity.admin]}</Badge>
              {report.severity.adminSetBy !== null && <span className="block text-xs text-slate-500">by {report.severity.adminSetBy.fullName}</span>}
            </>
          )}
        </dd>
      </dl>
      <div className="mt-3 flex gap-2">
        <select
          aria-label="Set severity"
          value={value}
          onChange={(e) => setValue(e.target.value as SeverityLevel | "")}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        >
          <option value="">Choose…</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
        </select>
        <Button variant="secondary" loading={saving} disabled={value === "" || value === report.severity.admin} onClick={() => void save()}>
          Save
        </Button>
      </div>
      {error !== undefined && <div className="mt-2"><Alert>{error}</Alert></div>}
      <div className="mt-3">
        <SeverityNote />
      </div>
    </Card>
  );
}
