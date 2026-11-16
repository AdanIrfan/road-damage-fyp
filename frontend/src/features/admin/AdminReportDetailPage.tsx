import { ChevronLeft, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ReasonDialog } from "../../components/Dialog";
import { RepairPill, ReportRef, SeverityIndicator, StatusPill } from "../../components/reports/indicators";
import {
  captureMethodLabel,
  damageClassLabel,
  formatAge,
  formatConfidence,
  formatDistance,
  locationStatusHelp,
  locationStatusLabel,
  reportTitle,
  severityLabel,
} from "../../components/reports/labels";
import { LocationMap } from "../../components/reports/LocationMap";
import { ProgressStepper } from "../../components/reports/ProgressStepper";
import { RepairAttempts } from "../../components/reports/RepairAttempts";
import { detectionColor, ReportPhoto } from "../../components/reports/ReportPhoto";
import { SeverityExplanation } from "../../components/reports/SeverityExplanation";
import { StatusTimeline } from "../../components/reports/StatusTimeline";
import { useToast } from "../../components/Toast";
import { Alert, Avatar, Badge, Button, buttonClass, Card, Skeleton, Spinner } from "../../components/ui";
import { ApiError, errorMessage } from "../../lib/api";
import type { AdminActionResult, AdminReport, PossibleDuplicates, SeverityLevel } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";
import { useNotifications } from "../notifications/NotificationsContext";
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
  const toast = useToast();
  const { refresh: refreshNotifications } = useNotifications();

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

  // Possible duplicates are a hint only. If the lookup fails the page works without it.
  const [duplicates, setDuplicates] = useState<PossibleDuplicates>();
  useEffect(() => {
    let cancelled = false;
    setDuplicates(undefined);
    adminReportsApi
      .possibleDuplicates(id)
      .then((result) => {
        if (!cancelled) setDuplicates(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);

  const [retrying, setRetrying] = useState(false);
  async function retryAnalysis() {
    if (report === undefined) return;
    setRetrying(true);
    setNotice(undefined);
    try {
      const result = await adminReportsApi.retryAnalysis(report.id);
      setReport(result.report);
      setConflict(false);
      if (result.analysis === "completed") {
        const found = result.report.analysis.detections.length;
        toast.success(found === 0 ? "Analysis completed. No damage was detected automatically." : `Analysis completed. ${found} detection${found === 1 ? "" : "s"} found.`);
      } else {
        setNotice({ tone: "error", text: "The automatic analysis failed again. The report is unchanged; you can try again later or review the photo manually." });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "ANALYSIS_NOT_RETRYABLE") {
        // Someone else already re-ran it: show the current state.
        void load();
      } else {
        setNotice({ tone: "error", text: errorMessage(err) });
      }
    } finally {
      setRetrying(false);
    }
  }

  /** Applies an action result; a 409 means the report changed (another admin, the engineer…). */
  function applyResult(result: AdminActionResult, message: string) {
    setReport(result.report);
    setDialog(undefined);
    setConflict(false);
    // The action may have created or cleared notifications for this admin.
    refreshNotifications();
    if (result.notification === "failed") {
      setNotice({ tone: "error", text: `${message} The SMS to the citizen could not be sent; the decision is saved.` });
    } else {
      setNotice(undefined);
      toast.success(result.notification === "sent" ? `${message} The citizen has been notified by SMS.` : message);
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
        <Link to="/admin/reports" className="text-sm font-semibold text-cobalt-600 hover:text-cobalt-700">
          Back to reports
        </Link>
        <Alert>{loadError}</Alert>
      </div>
    );
  }
  if (report === undefined) {
    return (
      <div className="space-y-5" role="status">
        <span className="sr-only">Loading report</span>
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const actions = report.allowedActions;
  const attempt = report.assignment.currentAttempt;
  const title = reportTitle(
    report.analysis.detections.map((d) => d.className).filter((name, index, all) => all.indexOf(name) === index),
    report.analysis.status,
  );
  const noActions = !actions.review && !actions.decide && !actions.assign && !actions.confirmCompletion;

  return (
    <div className="space-y-5">
      {/*
        Sticky header: the report's identity and every workflow action stay in view while the
        admin scrolls through the evidence. It sits directly under the app's top bar.
      */}
      <header className="sticky top-16 z-10 -mx-4 border-b border-ink-150 bg-white px-4 py-3 shadow-[0_2px_8px_rgba(14,26,43,0.06)] sm:-mx-6 sm:px-6 lg:top-14 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[13px] text-ink-500">
              <Link to="/admin/reports" className="inline-flex items-center gap-0.5 font-semibold text-cobalt-600 hover:text-cobalt-700">
                <ChevronLeft className="size-4" aria-hidden="true" />
                Reports
              </Link>
              <span aria-hidden="true">/</span>
              <ReportRef id={report.id} className="text-ink-900" />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
              <StatusPill status={report.status} />
              {report.assignment.repairStatus !== null && <RepairPill status={report.assignment.repairStatus} attempt={attempt} />}
            </div>
            <p className="mt-0.5 text-[13px] text-ink-500">
              {captureMethodLabel[report.captureMethod]} · submitted {formatDate(report.createdAt)}
              {report.status !== "COMPLETED" && report.status !== "REJECTED" && ` · open for ${formatAge(report.createdAt)}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions.review && (
              <Button size="lg" loading={busy} onClick={() => runDirect(() => adminReportsApi.review(report.id), "The report is now under review.")}>
                Start review
              </Button>
            )}
            {actions.decide && (
              <>
                <button type="button" onClick={() => setDialog("reject")} className={buttonClass("secondary", "lg", "text-danger-700! ring-danger-200!")}>
                  Reject
                </button>
                <Button size="lg" variant="secondary" onClick={() => setDialog("delay")}>
                  {report.status === "DELAYED" ? "Keep delayed" : "Delay"}
                </Button>
                <Button size="lg" onClick={() => setDialog("accept")}>
                  Accept report
                </Button>
              </>
            )}
            {actions.feedback && (
              <Button size="lg" variant="secondary" onClick={() => setDialog("feedback")}>
                Needs more work
              </Button>
            )}
            {actions.assign && (
              <Button size="lg" variant={report.assignment.engineer === null ? "primary" : "secondary"} onClick={() => setDialog("assign")}>
                {report.assignment.engineer === null ? "Assign engineer" : "Reassign"}
              </Button>
            )}
            {actions.confirmCompletion && (
              <Button size="lg" onClick={() => setDialog("confirm")}>
                Confirm repair completed
              </Button>
            )}
            {noActions && (
              <p className="text-[13px] text-ink-500">
                {report.status === "COMPLETED" ? "This report is completed." : report.status === "REJECTED" ? "This report was rejected." : "No actions are available right now."}
              </p>
            )}
          </div>
        </div>
      </header>

      {conflict && (
        <Alert>
          This report was changed in the meantime (by another admin or the engineer).{" "}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Reload the latest version
          </button>
        </Alert>
      )}
      {notice !== undefined && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {actions.confirmCompletion && (
        <Alert tone="info">The engineer marked attempt {attempt} as completed. Check its photos under Repair work, then confirm, or ask for more work.</Alert>
      )}
      {report.assignment.engineer?.status === "DEACTIVATED" && <Alert>The assigned engineer's account is deactivated. Reassign this report.</Alert>}

      {duplicates !== undefined && duplicates.matches.length > 0 && (
        <section role="note" className="rounded-xl border border-ink-150 bg-white px-5 py-4 shadow-[inset_0_3px_0_var(--color-road-400)]">
          <h2 className="text-sm font-bold text-ink-900">
            Possible duplicate{duplicates.matches.length === 1 ? "" : "s"}: {duplicates.matches.length} other report{duplicates.matches.length === 1 ? "" : "s"} nearby
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-500">
            Within {duplicates.criteria.radiusMeters} m of this location and submitted within {duplicates.criteria.windowDays} days of it. This is a hint
            for your decision only: nothing is merged or rejected automatically.
          </p>
          <ul className="mt-2 divide-y divide-ink-100">
            {duplicates.matches.map((match) => (
              <li key={match.id}>
                <Link to={`/admin/reports/${match.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[13px] text-ink-900 hover:bg-canvas">
                  <ReportRef id={match.id} className="text-ink-900" />
                  <span className="font-semibold">{reportTitle(match.analysis.damageClasses, match.analysis.status)}</span>
                  <StatusPill status={match.status} />
                  <span className="font-mono text-ink-600">{formatDistance(match.distanceMeters)} away</span>
                  <span className="text-ink-500">{formatDate(match.createdAt)}</span>
                  <span className="ml-auto font-semibold text-cobalt-600">Open</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-ink-150 bg-white px-5 py-4">
        <ProgressStepper
          status={report.status}
          repairActive={report.assignment.engineer !== null}
          notes={{
            0: formatDate(report.createdAt),
            3: report.assignment.engineer === null ? "Assign an engineer" : `${report.assignment.engineer.fullName}${attempt !== null ? ` · attempt ${attempt}` : ""}`,
            4: "After you confirm the repair",
          }}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Card title="Evidence and detections">
            {report.image === null ? <p className="text-sm text-ink-500">No photo.</p> : <ReportPhoto image={report.image} detections={report.analysis.detections} />}
            {report.analysis.status === "FAILED" ? (
              <div className="mt-4 space-y-3">
                <Alert tone="info">
                  The automatic analysis failed ({report.analysis.errorCode ?? "unknown reason"}). Review the photo manually, or run the analysis again.
                </Alert>
                {actions.retryAnalysis && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="secondary" loading={retrying} onClick={() => void retryAnalysis()}>
                      <RefreshCw className="size-4" aria-hidden="true" />
                      {retrying ? "Analysing the photo…" : "Retry analysis"}
                    </Button>
                    <span className="text-xs text-ink-500">Only the automatic results are updated. The status and your severity correction are not changed.</span>
                  </div>
                )}
              </div>
            ) : report.analysis.detections.length === 0 ? (
              <p className="mt-4 text-sm text-ink-600">No damage was detected automatically.</p>
            ) : (
              <ul className="mt-4 divide-y divide-ink-100 text-sm">
                {report.analysis.detections.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2">
                    <span className="flex flex-1 items-center gap-2 font-semibold text-ink-900">
                      <span className="size-3 shrink-0 border-[3px] border-ink-900" style={{ backgroundColor: detectionColor(d.className) }} aria-hidden="true" />
                      {damageClassLabel(d.className)}
                    </span>
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-150" aria-hidden="true">
                      <span className="block h-full bg-ink-900" style={{ width: `${d.confidence * 100}%` }} />
                    </span>
                    <span className="w-28 text-right font-mono text-[13px] text-ink-600">{formatConfidence(d.confidence)} confidence</span>
                  </li>
                ))}
              </ul>
            )}
            {report.description !== null && (
              <p className="mt-4 rounded-lg bg-canvas px-3 py-2.5 text-sm whitespace-pre-line text-ink-600">
                <span className="font-semibold text-ink-900">Citizen's description: </span>
                {report.description}
              </p>
            )}
          </Card>
          <Card title="Repair work" description="Grouped by attempt. Earlier attempts are kept as evidence.">
            <RepairAttempts attempts={report.repairAttempts} />
          </Card>
          <Card title="Status history">
            <StatusTimeline entries={report.statusHistory} />
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <SeverityCard report={report} onSave={(severity) => run(() => adminReportsApi.setSeverity(report.id, severity), "Severity updated.")} />
          <Card
            title="Location"
            flush
            actions={<Badge tone={report.location.needsReview ? "amber" : "green"}>{locationStatusLabel[report.location.verificationStatus]}</Badge>}
          >
            <LocationMap
              value={{ latitude: report.location.latitude, longitude: report.location.longitude }}
              accuracyMeters={report.location.gpsAccuracyMeters}
              comparison={report.location.exif === null ? null : { ...report.location.exif, label: "Location stored in the photo (EXIF)" }}
              className="h-64 rounded-none! border-x-0!"
            />
            <div className="space-y-2 px-5 py-4 text-[13px]">
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full bg-cobalt-600" aria-hidden="true" />
                <span className="text-ink-600">{report.captureMethod === "LIVE_CAMERA" ? "Device GPS (marker)" : "Selected by the citizen (marker)"}</span>
                <span className="ml-auto font-mono text-ink-600">
                  {report.location.latitude.toFixed(5)}, {report.location.longitude.toFixed(5)}
                </span>
              </div>
              {report.location.exif !== null && (
                <div className="flex items-center gap-2">
                  <span className="size-3 rounded-full border-2 border-danger-700 bg-danger-200" aria-hidden="true" />
                  <span className="text-ink-600">
                    Stored in the photo (EXIF){report.location.exif.distanceMeters !== null && ` · ${formatDistance(report.location.exif.distanceMeters)} away`}
                  </span>
                  <span className="ml-auto font-mono text-ink-600">
                    {report.location.exif.latitude.toFixed(5)}, {report.location.exif.longitude.toFixed(5)}
                  </span>
                </div>
              )}
              {report.location.gpsAccuracyMeters !== null && <p className="text-ink-500">GPS accuracy: about {Math.round(report.location.gpsAccuracyMeters)} m</p>}
              <p className="text-ink-500">{locationStatusHelp[report.location.verificationStatus]}</p>
              <p className="text-xs text-ink-500">Location findings only flag a report for your check; nothing is rejected automatically.</p>
            </div>
          </Card>
          <section className="space-y-4 rounded-xl border border-ink-150 bg-white p-5">
            <div className="flex items-center gap-3">
              <Avatar name={report.citizen.fullName} />
              <div className="min-w-0">
                <div className="text-xs text-ink-500">Citizen</div>
                <div className="font-semibold text-ink-900">{report.citizen.fullName}</div>
                <div className="font-mono text-xs text-ink-600">{report.citizen.mobileNumber}</div>
              </div>
            </div>
            <div className="border-t border-ink-100 pt-4">
              <div className="text-xs text-ink-500">Assignment</div>
              {report.assignment.engineer === null ? (
                <>
                  <div className="font-semibold text-ink-900">Not assigned</div>
                  {!actions.assign && report.status !== "COMPLETED" && report.status !== "REJECTED" && (
                    <div className="text-[13px] text-ink-500">You can assign an engineer once the report is accepted.</div>
                  )}
                </>
              ) : (
                <div className="text-sm">
                  <Link to={`/admin/engineers/${report.assignment.engineer.id}`} className="font-semibold text-cobalt-600 hover:text-cobalt-700">
                    {report.assignment.engineer.fullName}
                  </Link>
                  <p className="text-[13px] text-ink-500">
                    Assigned {formatDate(report.assignment.assignedAt)} · attempt {attempt}
                  </p>
                  <Link to={`/chat?with=${report.assignment.engineer.id}`} className="mt-1 inline-block text-[13px] font-semibold text-cobalt-600 hover:text-cobalt-700">
                    Message engineer
                  </Link>
                </div>
              )}
              {report.assignmentHistory.length > 1 && (
                <ol className="mt-3 space-y-1 border-t border-ink-100 pt-3 text-xs text-ink-500">
                  {report.assignmentHistory.map((a) => (
                    <li key={a.id}>
                      Attempt {a.attempt}: {a.engineer.fullName} by {a.assignedBy.fullName}, {formatDate(a.createdAt)}
                      {a.reason !== null && ` — ${a.reason}`}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
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


function SeverityCard({ report, onSave }: { report: AdminReport; onSave: (severity: SeverityLevel) => Promise<void> }) {
  const [saving, setSaving] = useState<SeverityLevel>();
  const [error, setError] = useState<string>();

  async function save(value: SeverityLevel) {
    if (value === report.severity.admin) return;
    setSaving(value);
    setError(undefined);
    try {
      await onSave(value);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(undefined);
    }
  }

  return (
    <Card title="Estimated severity" actions={<SeverityIndicator level={report.severity.ai} estimated size="lg" />}>
      <SeverityExplanation status={report.analysis.status} level={report.severity.ai} score={report.analysis.severityScore} detections={report.analysis.detections} />
      <div className="mt-4 border-t border-ink-100 pt-4">
        <div className="mb-2 text-sm font-semibold text-ink-900">
          Admin severity{" "}
          <span className="font-normal text-ink-500">
            ·{" "}
            {report.severity.admin === null
              ? "not set"
              : `${severityLabel[report.severity.admin]}${report.severity.adminSetBy !== null ? `, set by ${report.severity.adminSetBy.fullName}` : ""}`}
          </span>
        </div>
        <div role="group" aria-label="Set admin severity" className="flex gap-2">
          {(["LOW", "MEDIUM", "HIGH"] as const).map((level) => {
            const selected = report.severity.admin === level;
            return (
              <button
                key={level}
                type="button"
                aria-pressed={selected}
                disabled={saving !== undefined}
                onClick={() => void save(level)}
                className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-60 ${
                  selected ? "border-ink-900 bg-ink-900 text-white" : "border-ink-300 bg-white text-ink-900 hover:bg-ink-100"
                }`}
              >
                {saving === level && <Spinner className="size-4" />}
                {severityLabel[level]}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-500">Your correction is used everywhere; the automatic estimate is kept alongside it.</p>
        {error !== undefined && (
          <div className="mt-2">
            <Alert>{error}</Alert>
          </div>
        )}
      </div>
    </Card>
  );
}
