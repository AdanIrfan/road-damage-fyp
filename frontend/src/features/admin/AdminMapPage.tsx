import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { REPORT_STATUSES, reportStatusLabel, reportTitle } from "../../components/reports/labels";
import { ReportsOverviewMap, SeverityLegend, type MapPoint } from "../../components/reports/ReportsOverviewMap";
import { Alert, EmptyState, fieldClass, PageHeader, Skeleton } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import type { AdminReportListItem } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";
import { adminReportsApi } from "./adminReportsApi";

/** Geographic overview of reports for administrators, with status and severity filters in the URL. */
export function AdminMapPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const severity = params.get("severity") ?? "";
  const [result, setResult] = useState<{ points: AdminReportListItem[]; total: number; truncated: boolean }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    adminReportsApi
      .map({ status, severity })
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, severity]);

  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === "") next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  };

  const points: MapPoint[] = (result?.points ?? []).map((p) => ({
    id: p.id,
    latitude: p.location.latitude,
    longitude: p.location.longitude,
    severity: p.severity.effective,
    title: reportTitle(p.analysis.damageClasses, p.analysis.status),
    subtitle: `${reportStatusLabel[p.status]} · ${formatDate(p.createdAt)}`,
    href: `/admin/reports/${p.id}`,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Map"
        description={
          result === undefined
            ? "Where road damage has been reported."
            : result.truncated
              ? `Showing the ${result.points.length} newest of ${result.total} matching reports.`
              : `${result.total} report${result.total === 1 ? "" : "s"} shown.`
        }
        actions={
          <>
            <select aria-label="Status" value={status} onChange={(e) => setFilter("status", e.target.value)} className={`${fieldClass} min-h-10 w-auto`}>
              <option value="">All statuses</option>
              {REPORT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {reportStatusLabel[s]}
                </option>
              ))}
            </select>
            <select aria-label="Severity" value={severity} onChange={(e) => setFilter("severity", e.target.value)} className={`${fieldClass} min-h-10 w-auto`}>
              <option value="">Any severity</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </>
        }
      />
      {error !== undefined && <Alert>{error}</Alert>}
      <section className={`overflow-hidden rounded-xl border border-ink-150 bg-white ${loading && result !== undefined ? "opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          <p className="text-[13px] text-ink-500">Marker size and colour show the severity. Select a marker to open the report.</p>
          <SeverityLegend />
        </div>
        {result === undefined ? (
          <Skeleton className="h-[34rem] w-full rounded-none" />
        ) : points.length === 0 ? (
          <EmptyState title="No reports match these filters" description="Change the status or severity to see more reports." />
        ) : (
          <ReportsOverviewMap points={points} className="h-[min(70vh,40rem)]" />
        )}
      </section>
    </div>
  );
}
