import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { reportStatusLabel, reportTitle, severityLabel } from "../../components/reports/labels";
import { ReportsOverviewMap, SeverityLegend, type MapPoint } from "../../components/reports/ReportsOverviewMap";
import { Alert, buttonClass, Card, EmptyState, PageHeader, Skeleton } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import type { AdminDashboard, AdminReportListItem, SeverityLevel } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";
import { adminReportsApi } from "./adminReportsApi";
import { AdminReportTable } from "./AdminReportTable";
import { AiStatusPill } from "./AiStatusPill";

const SEVERITY_ORDER: (SeverityLevel | "NONE")[] = ["HIGH", "MEDIUM", "LOW", "NONE"];
const SEVERITY_BAR: Record<SeverityLevel | "NONE", string> = { HIGH: "bg-sev-high", MEDIUM: "bg-sev-medium", LOW: "bg-sev-low", NONE: "bg-ink-300" };
const OPEN = new Set(["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "DELAYED"]);

export function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboard>();
  const [points, setPoints] = useState<AdminReportListItem[]>();
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
    // The map is secondary: if it fails, the rest of the dashboard still works.
    adminReportsApi
      .map({})
      .then((result) => {
        if (!cancelled) setPoints(result.points);
      })
      .catch(() => {
        if (!cancelled) setPoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== undefined) return <Alert>{error}</Alert>;
  if (data === undefined) {
    return (
      <div className="space-y-6" role="status">
        <span className="sr-only">Loading dashboard</span>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-36 w-full rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-xl lg:col-span-2" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  const q = data.queues;
  const stages = [
    { label: "New, to review", value: q.awaitingReview, to: "/admin/reports?status=SUBMITTED&sort=oldest", dot: "bg-cobalt-600" },
    { label: "Under review", value: q.underReview, to: "/admin/reports?status=UNDER_REVIEW&sort=oldest", dot: "bg-[#6d4ad6]" },
    { label: "Delayed", value: q.delayed, to: "/admin/reports?status=DELAYED&sort=oldest", dot: "bg-ink-400" },
    { label: "To assign", value: q.awaitingAssignment, to: "/admin/reports?status=ACCEPTED&assignment=unassigned&sort=oldest", dot: "bg-sev-medium" },
    { label: "Repair in progress", value: q.inProgress, to: "/admin/reports?status=ACCEPTED&assignment=assigned", dot: "bg-[#0e7490]" },
    { label: "Awaiting confirmation", value: q.awaitingConfirmation, to: "/admin/reports?status=ACCEPTED&repairStatus=COMPLETED", dot: "bg-sev-low" },
  ];
  const attention = [
    { n: q.awaitingConfirmation, title: "Repairs awaiting confirmation", sub: "The engineer marked the repair completed", action: "Check", to: "/admin/reports?status=ACCEPTED&repairStatus=COMPLETED" },
    { n: q.locationFlagged, title: "Locations to check", sub: "Photo location differs, is missing, or GPS accuracy was poor", action: "Show", to: "/admin/reports?needsLocationReview=true" },
    { n: q.aiFailed, title: "Automatic analysis failed", sub: "Saved without detections; review the photo manually", action: "Show", to: "/admin/reports?aiStatus=FAILED" },
    { n: q.jobsOnDeactivatedEngineers, title: "Jobs on deactivated engineers", sub: "These reports need to be reassigned", action: "Show", to: "/admin/reports?status=ACCEPTED&assignment=assigned" },
  ].filter((item) => item.n > 0);
  const open = data.byStatus.SUBMITTED + data.byStatus.UNDER_REVIEW + data.byStatus.ACCEPTED + data.byStatus.DELAYED;
  const severityTotal = SEVERITY_ORDER.reduce((sum, level) => sum + data.bySeverity[level], 0);
  const mapPoints: MapPoint[] = (points ?? [])
    .filter((p) => OPEN.has(p.status))
    .map((p) => ({
      id: p.id,
      latitude: p.location.latitude,
      longitude: p.location.longitude,
      severity: p.severity.effective,
      title: reportTitle(p.analysis.damageClasses, p.analysis.status),
      subtitle: `${reportStatusLabel[p.status]} · ${formatDate(p.createdAt)}`,
      href: `/admin/reports/${p.id}`,
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations dashboard"
        description={`${open} open report${open === 1 ? "" : "s"} of ${data.total} · ${data.activeEngineers} active engineer${data.activeEngineers === 1 ? "" : "s"}`}
        actions={
          <>
            <Link to="/admin/reports" className={buttonClass("secondary")}>
              All reports
            </Link>
            <Link to="/admin/analytics" className={buttonClass("primary")}>
              Open analytics
            </Link>
          </>
        }
      />
      <AiStatusPill className="lg:hidden" />

      <section aria-label="Report pipeline" className="rounded-xl border border-ink-150 bg-white p-4 sm:p-5">
        <div className="mb-3.5 flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold tracking-wider text-ink-500 uppercase">Pipeline</h2>
          <span className="text-xs text-ink-500">Select a stage to open its queue</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {stages.map((stage) => (
            <Link key={stage.label} to={stage.to} className="flex flex-col gap-1 rounded-[10px] border border-ink-150 bg-canvas p-3.5 text-ink-900 transition-colors hover:border-cobalt-600">
              <span className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
                <span className={`size-2 shrink-0 rounded-full ${stage.dot}`} aria-hidden="true" />
                {stage.label}
              </span>
              <span className="text-3xl leading-tight font-bold tabular-nums">{stage.value}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="overflow-hidden rounded-xl border border-ink-150 bg-white lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
            <h2 className="text-base font-semibold text-ink-900">Open reports by location</h2>
            <div className="flex flex-wrap items-center gap-4">
              <SeverityLegend />
              <Link to="/admin/map" className="text-[13px] font-semibold text-cobalt-600 hover:text-cobalt-700">
                Full map
              </Link>
            </div>
          </div>
          {points === undefined ? (
            <Skeleton className="h-[22rem] w-full rounded-none" />
          ) : mapPoints.length === 0 ? (
            <EmptyState title="No open reports to show" description="Reports appear on the map as soon as citizens submit them." />
          ) : (
            <ReportsOverviewMap points={mapPoints} className="h-[22rem]" />
          )}
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border border-ink-150 bg-white px-5 py-4">
            <h2 className="mb-1 text-base font-semibold text-ink-900">Needs attention</h2>
            {attention.length === 0 ? (
              <p className="flex items-center gap-2 py-3 text-sm text-ink-600">
                <CircleCheck className="size-4 text-sev-low" aria-hidden="true" />
                Nothing needs your attention right now.
              </p>
            ) : (
              <ul>
                {attention.map((item) => (
                  <li key={item.title} className="border-t border-ink-100 first:border-t-0">
                    <Link to={item.to} className="flex items-center gap-3 py-2.5 text-ink-900">
                      <span className="w-7 text-xl font-bold tabular-nums">{item.n}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{item.title}</span>
                        <span className="block text-xs text-ink-500">{item.sub}</span>
                      </span>
                      <span className="text-[13px] font-semibold text-cobalt-600">{item.action}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-ink-150 bg-white px-5 py-4">
            <h2 className="text-base font-semibold text-ink-900">Severity of all reports</h2>
            <p className="mt-0.5 mb-3 text-xs text-ink-500">Admin correction where set, otherwise the automatic estimate</p>
            {severityTotal > 0 && (
              <div
                role="img"
                aria-label={SEVERITY_ORDER.map((level) => `${level === "NONE" ? "Not estimated" : severityLabel[level]} ${data.bySeverity[level]}`).join(", ")}
                className="flex h-3.5 gap-0.5 overflow-hidden rounded-full"
              >
                {SEVERITY_ORDER.filter((level) => data.bySeverity[level] > 0).map((level) => (
                  <div key={level} className={SEVERITY_BAR[level]} style={{ flex: data.bySeverity[level] }} />
                ))}
              </div>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              {SEVERITY_ORDER.map((level) => (
                <div key={level} className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-1.5 text-ink-600">
                    <span className={`size-2.5 rounded-sm ${SEVERITY_BAR[level]}`} aria-hidden="true" />
                    {level === "NONE" ? "Not estimated" : severityLabel[level]}
                  </dt>
                  <dd className="font-bold tabular-nums">{data.bySeverity[level]}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>

      <Card
        title="Recent reports"
        flush
        actions={
          <Link to="/admin/reports" className="text-[13px] font-semibold text-cobalt-600 hover:text-cobalt-700">
            All reports
          </Link>
        }
      >
        {data.recent.length === 0 ? <EmptyState title="No reports yet" description="New reports from citizens will be listed here." /> : <AdminReportTable items={data.recent} />}
      </Card>
    </div>
  );
}
