import { ChevronLeft, CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ReportRef, SeverityIndicator, StatusPill } from "../../components/reports/indicators";
import { captureMethodLabel, damageClassLabel, formatConfidence, formatDistance, locationStatusHelp, locationStatusLabel, reportTitle } from "../../components/reports/labels";
import { LocationMap } from "../../components/reports/LocationMap";
import { ProgressStepper } from "../../components/reports/ProgressStepper";
import { detectionColor, ReportPhoto } from "../../components/reports/ReportPhoto";
import { SeverityExplanation } from "../../components/reports/SeverityExplanation";
import { Alert, Badge, Card, Skeleton } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import type { Report } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";
import { citizenStageText, repairBegun } from "./citizenLabels";
import { reportsApi } from "./reportsApi";

export function ReportDetailPage() {
  const { id = "" } = useParams();
  const justSubmitted = (useLocation().state as { justSubmitted?: boolean } | null)?.justSubmitted === true;
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setReport(undefined);
    setError(undefined);
    reportsApi
      .get(id)
      .then(({ report: loaded }) => {
        if (!cancelled) setReport(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link to="/reports" className="-ml-1 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-cobalt-600 hover:text-cobalt-700">
        <ChevronLeft className="size-4" aria-hidden="true" />
        Your reports
      </Link>

      {error !== undefined && <Alert>{error}</Alert>}
      {report === undefined && error === undefined && (
        <div className="space-y-4" role="status">
          <span className="sr-only">Loading report</span>
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      )}

      {report !== undefined && (
        <>
          {justSubmitted && (
            <div role="status" className="flex items-center gap-2.5 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm font-semibold text-success-800">
              <CircleCheck className="size-5 shrink-0" aria-hidden="true" />
              Thank you. Your report has been submitted.
            </div>
          )}

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <ReportRef id={report.id} />
              <h1 className="text-2xl font-bold tracking-tight text-ink-900">{reportTitle(report.analysis.detections.map((d) => d.className).filter((c, i, all) => all.indexOf(c) === i), report.analysis.status)}</h1>
              <p className="mt-1 text-sm text-ink-500">
                {captureMethodLabel[report.captureMethod]} · submitted {formatDate(report.createdAt)}
              </p>
            </div>
            <StatusPill status={report.status} />
          </div>

          {report.decisionReason !== null && (
            <Alert tone={report.status === "REJECTED" ? "error" : "info"}>
              <strong>{report.status === "REJECTED" ? "Reason your report was not accepted:" : "Reason for the delay:"}</strong> {report.decisionReason}
            </Alert>
          )}
          {report.status === "COMPLETED" && <Alert tone="success">The damage you reported has been repaired and confirmed. Thank you!</Alert>}

          <Card title="Progress" description={citizenStageText(report.status, report.repairProgress)}>
            <ProgressStepper
              status={report.status}
              repairActive={repairBegun(report.repairProgress)}
              notes={{
                0: formatDate(report.createdAt),
                1: "An administrator checks every report",
                2: report.status === "DELAYED" || report.status === "REJECTED" ? "See the reason above" : "Accept, delay or not accept",
                3: "Scheduled, in progress, then checked",
                4: "Confirmed by an administrator",
              }}
            />
          </Card>

          <div className="grid gap-5 lg:grid-cols-5">
            <div className="space-y-5 lg:col-span-3">
              <Card title="Your photo">
                {report.image === null ? <p className="text-sm text-ink-500">No photo.</p> : <ReportPhoto image={report.image} detections={report.analysis.detections} />}
                {report.description !== null && <p className="mt-4 text-sm whitespace-pre-line text-ink-600">{report.description}</p>}
              </Card>
            </div>

            <div className="space-y-5 lg:col-span-2">
              <AnalysisCard report={report} />
              <Card title="Location" flush>
                <LocationMap
                  value={{ latitude: report.location.latitude, longitude: report.location.longitude }}
                  accuracyMeters={report.location.gpsAccuracyMeters}
                  className="h-56 rounded-none! border-x-0!"
                />
                <div className="space-y-1.5 px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={report.location.needsReview ? "amber" : "green"}>{locationStatusLabel[report.location.verificationStatus]}</Badge>
                    {report.location.needsReview && <span className="text-xs text-warning-800">Will be checked by an administrator</span>}
                  </div>
                  <p className="text-ink-600">{locationStatusHelp[report.location.verificationStatus]}</p>
                  {report.location.exifDistanceMeters !== null && (
                    <p className="text-ink-500">Distance between the photo's location and the selected place: {formatDistance(report.location.exifDistanceMeters)}</p>
                  )}
                  {report.location.gpsAccuracyMeters !== null && <p className="text-ink-500">GPS accuracy: about {Math.round(report.location.gpsAccuracyMeters)} m</p>}
                  <p className="text-xs text-ink-500">A report is never rejected automatically because of its location.</p>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AnalysisCard({ report }: { report: Report }) {
  const { analysis } = report;

  if (analysis.status === "FAILED") {
    return (
      <Card title="Automatic analysis">
        <Alert tone="info">
          The automatic analysis was not available when you submitted this report. Your report is saved and an administrator will review the photo.
        </Alert>
      </Card>
    );
  }

  return (
    <Card title="Automatic analysis" actions={<SeverityIndicator level={analysis.estimatedSeverity} estimated size="lg" />}>
      <div className="space-y-4">
        {analysis.detections.length === 0 ? (
          <p className="text-sm text-ink-600">No damage was detected automatically. This does not mean there is no damage; an administrator will look at your photo.</p>
        ) : (
          <ul className="divide-y divide-ink-100 text-sm">
            {analysis.detections.map((d) => (
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
        <details className="rounded-lg border border-ink-150">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[13px] font-semibold text-cobalt-600">How is severity estimated?</summary>
          <div className="border-t border-ink-150 p-3">
            <SeverityExplanation status={analysis.status} level={analysis.estimatedSeverity} score={analysis.severityScore} detections={analysis.detections} audience="citizen" />
          </div>
        </details>
      </div>
    </Card>
  );
}
