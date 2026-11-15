import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Alert, Badge, Card, Spinner } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { formatDate } from "../../utils/format";
import {
  captureMethodLabel,
  damageClassLabel,
  formatConfidence,
  formatDistance,
  locationStatusHelp,
  locationStatusLabel,
  repairProgressLabel,
  reportStatusLabel,
  reportStatusTone,
  severityLabel,
  severityTone,
} from "../../components/reports/labels";
import { LocationMap } from "../../components/reports/LocationMap";
import { ReportPhoto } from "../../components/reports/ReportPhoto";
import { reportsApi } from "./reportsApi";
import { SeverityNote } from "../../components/reports/SeverityNote";
import type { Report } from "../../lib/reportTypes";

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
    <div className="space-y-6">
      <Link to="/reports" className="text-sm text-blue-700 hover:underline">
        ← My reports
      </Link>

      {error !== undefined && <Alert>{error}</Alert>}
      {report === undefined && error === undefined && (
        <div className="flex justify-center py-16 text-blue-600">
          <Spinner />
        </div>
      )}

      {report !== undefined && (
        <>
          {justSubmitted && <Alert tone="success">Thank you. Your report has been submitted.</Alert>}

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Road damage report</h1>
              <p className="mt-1 text-sm text-slate-500">
                {captureMethodLabel[report.captureMethod]} · submitted {formatDate(report.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={reportStatusTone[report.status]}>{reportStatusLabel[report.status]}</Badge>
              {report.repairProgress !== null && report.status !== "COMPLETED" && (
                <Badge tone="blue">{repairProgressLabel[report.repairProgress]}</Badge>
              )}
            </div>
          </div>

          {report.decisionReason !== null && (
            <Alert tone={report.status === "REJECTED" ? "error" : "info"}>
              <strong>{report.status === "REJECTED" ? "Reason for rejection:" : "Reason for the delay:"}</strong> {report.decisionReason}
            </Alert>
          )}
          {report.status === "COMPLETED" && <Alert tone="success">The damage you reported has been repaired. Thank you!</Alert>}

          <div className="grid gap-6 lg:grid-cols-5">
            <div className="space-y-6 lg:col-span-3">
              <Card title="Photo">
                {report.image === null ? (
                  <p className="text-sm text-slate-500">No photo.</p>
                ) : (
                  <ReportPhoto image={report.image} detections={report.analysis.detections} />
                )}
                {report.description !== null && <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{report.description}</p>}
              </Card>
            </div>

            <div className="space-y-6 lg:col-span-2">
              <AnalysisCard report={report} />
              <Card title="Location">
                <LocationMap
                  value={{ latitude: report.location.latitude, longitude: report.location.longitude }}
                  accuracyMeters={report.location.gpsAccuracyMeters}
                  className="h-56"
                />
                <div className="mt-3 space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge tone={report.location.needsReview ? "amber" : "green"}>{locationStatusLabel[report.location.verificationStatus]}</Badge>
                    {report.location.needsReview && <span className="text-xs text-amber-700">Will be checked by an administrator</span>}
                  </div>
                  <p className="text-slate-600">{locationStatusHelp[report.location.verificationStatus]}</p>
                  {report.location.exifDistanceMeters !== null && (
                    <p className="text-slate-500">Distance between photo location and selected place: {formatDistance(report.location.exifDistanceMeters)}</p>
                  )}
                  {report.location.gpsAccuracyMeters !== null && (
                    <p className="text-slate-500">GPS accuracy: about {Math.round(report.location.gpsAccuracyMeters)} m</p>
                  )}
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
          The automatic analysis was not available when you submitted this report. Your report has been saved and will be reviewed by
          an administrator.
        </Alert>
      </Card>
    );
  }

  return (
    <Card title="Automatic analysis">
      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated severity</div>
          <div className="mt-1">
            {analysis.estimatedSeverity === null ? (
              <span className="text-sm text-slate-600">Not estimated: no damage was detected automatically.</span>
            ) : (
              <Badge tone={severityTone[analysis.estimatedSeverity]}>{severityLabel[analysis.estimatedSeverity]} (estimated)</Badge>
            )}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detected damage</div>
          {analysis.detections.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">
              No damage was detected automatically. This does not mean there is no damage; an administrator will look at your photo.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {analysis.detections.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-1.5">
                  <span className="text-slate-800">{damageClassLabel(d.className)}</span>
                  <span className="text-slate-500">confidence {formatConfidence(d.confidence)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <SeverityNote />
      </div>
    </Card>
  );
}
