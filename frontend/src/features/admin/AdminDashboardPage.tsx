import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, Card, Spinner } from "../../components/ui";
import { reportStatusLabel, severityLabel } from "../../components/reports/labels";
import { errorMessage } from "../../lib/api";
import type { AdminDashboard, ReportStatus, SeverityLevel } from "../../lib/reportTypes";
import { adminReportsApi } from "./adminReportsApi";
import { AdminReportTable } from "./AdminReportTable";

const STATUS_ORDER: ReportStatus[] = ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "DELAYED", "REJECTED", "COMPLETED"];
const SEVERITY_ORDER: (SeverityLevel | "NONE")[] = ["HIGH", "MEDIUM", "LOW", "NONE"];
const SEVERITY_BAR: Record<SeverityLevel | "NONE", string> = {
  HIGH: "bg-red-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-green-500",
  NONE: "bg-slate-300",
};

export function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboard>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    adminReportsApi
      .dashboard()
      .then(({ dashboard }) => {
        if (!cancelled) setData(dashboard);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== undefined) return <Alert>{error}</Alert>;
  if (data === undefined) {
    return (
      <div className="flex justify-center py-16 text-blue-600">
        <Spinner />
      </div>
    );
  }

  const q = data.queues;
  const queues: { label: string; value: number; to: string; tone?: string }[] = [
    { label: "New, to review", value: q.awaitingReview, to: "/admin/reports?status=SUBMITTED" },
    { label: "Under review", value: q.underReview, to: "/admin/reports?status=UNDER_REVIEW" },
    { label: "Delayed", value: q.delayed, to: "/admin/reports?status=DELAYED" },
    { label: "To assign", value: q.awaitingAssignment, to: "/admin/reports?status=ACCEPTED&assignment=unassigned" },
    { label: "Repair in progress", value: q.inProgress, to: "/admin/reports?status=ACCEPTED&assignment=assigned" },
    { label: "Awaiting confirmation", value: q.awaitingConfirmation, to: "/admin/reports?status=ACCEPTED&repairStatus=COMPLETED" },
  ];
  const maxSeverity = Math.max(1, ...SEVERITY_ORDER.map((s) => data.bySeverity[s]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data.total} report{data.total === 1 ? "" : "s"} in total · {data.activeEngineers} active engineer{data.activeEngineers === 1 ? "" : "s"}
          </p>
        </div>
        <Link to="/admin/analytics" className="text-sm font-medium text-blue-700 hover:underline">
          Charts and trends →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {queues.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-blue-400"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{item.value}</div>
          </Link>
        ))}
      </div>

      {(q.locationFlagged > 0 || q.aiFailed > 0 || q.jobsOnDeactivatedEngineers > 0) && (
        <div className="space-y-2">
          {q.locationFlagged > 0 && (
            <Alert tone="info">
              {q.locationFlagged} open report{q.locationFlagged === 1 ? " has a location" : "s have locations"} to check.{" "}
              <Link to="/admin/reports?needsLocationReview=true" className="font-medium underline">
                Show
              </Link>
            </Alert>
          )}
          {q.aiFailed > 0 && (
            <Alert tone="info">
              The automatic analysis failed for {q.aiFailed} open report{q.aiFailed === 1 ? "" : "s"}.{" "}
              <Link to="/admin/reports?aiStatus=FAILED" className="font-medium underline">
                Show
              </Link>
            </Alert>
          )}
          {q.jobsOnDeactivatedEngineers > 0 && (
            <Alert>
              {q.jobsOnDeactivatedEngineers} accepted report{q.jobsOnDeactivatedEngineers === 1 ? " is" : "s are"} assigned to a deactivated engineer and
              should be reassigned.
            </Alert>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Reports by status">
          <ul className="divide-y divide-slate-100 text-sm">
            {STATUS_ORDER.map((status) => (
              <li key={status} className="flex items-center justify-between py-2">
                <Link to={`/admin/reports?status=${status}`} className="text-slate-700 hover:text-blue-700">
                  {reportStatusLabel[status]}
                </Link>
                <span className="font-semibold text-slate-900">{data.byStatus[status]}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Reports by severity" description="Admin-corrected severity where set, otherwise the automatic estimate.">
          <ul className="space-y-3 text-sm">
            {SEVERITY_ORDER.map((level) => (
              <li key={level}>
                <div className="flex justify-between text-slate-700">
                  <span>{level === "NONE" ? "Not estimated" : severityLabel[level]}</span>
                  <span className="font-semibold text-slate-900">{data.bySeverity[level]}</span>
                </div>
                <div className="mt-1 h-2 rounded bg-slate-100" aria-hidden="true">
                  <div className={`h-2 rounded ${SEVERITY_BAR[level]}`} style={{ width: `${(data.bySeverity[level] / maxSeverity) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card
        title="Recent reports"
        actions={
          <Link to="/admin/reports" className="text-sm font-medium text-blue-700 hover:underline">
            All reports →
          </Link>
        }
      >
        {data.recent.length === 0 ? <p className="text-sm text-slate-500">No reports yet.</p> : <AdminReportTable items={data.recent} />}
      </Card>
    </div>
  );
}
