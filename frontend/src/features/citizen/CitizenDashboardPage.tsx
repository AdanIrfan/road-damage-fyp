import { FileText, List, Map as MapIcon, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Pagination } from "../../components/Pagination";
import { ReportRef, SeverityIndicator, StatusPill } from "../../components/reports/indicators";
import { captureMethodLabel, REPORT_STATUSES, reportStatusLabel, reportTitle } from "../../components/reports/labels";
import { ProgressBar } from "../../components/reports/ProgressStepper";
import { ReportThumb } from "../../components/reports/ReportPhoto";
import { ReportsOverviewMap, SeverityLegend, type MapPoint } from "../../components/reports/ReportsOverviewMap";
import { Alert, buttonClass, EmptyState, fieldClass, PageHeader, SkeletonList } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import type { ReportListItem, ReportStatus, ReportSummary } from "../../lib/reportTypes";
import type { Paginated } from "../../lib/types";
import { formatDate } from "../../utils/format";
import { citizenStageText, repairBegun } from "./citizenLabels";
import { reportsApi, type ReportQuery } from "./reportsApi";

const PAGE_SIZE = 10;
/** The map shows the newest reports up to the list endpoint's maximum page size. */
const MAP_PAGE_SIZE = 50;

export function CitizenDashboardPage() {
  const [query, setQuery] = useState<ReportQuery>({ page: 1, pageSize: PAGE_SIZE, sort: "newest" });
  const [view, setView] = useState<"list" | "map">("list");
  const [result, setResult] = useState<Paginated<ReportListItem>>();
  const [summary, setSummary] = useState<ReportSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async (current: ReportQuery, mode: "list" | "map") => {
    setLoading(true);
    setError(undefined);
    try {
      const listQuery = mode === "map" ? { ...current, page: 1, pageSize: MAP_PAGE_SIZE } : current;
      const [list, { summary: counts }] = await Promise.all([reportsApi.list(listQuery), reportsApi.summary()]);
      setResult(list);
      setSummary(counts);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(query, view);
  }, [load, query, view]);

  const setStatus = (status: ReportStatus | undefined) =>
    setQuery((current) => {
      const { status: _previous, ...rest } = current;
      return status === undefined ? { ...rest, page: 1 } : { ...rest, page: 1, status };
    });

  const chips: { label: string; status: ReportStatus | undefined; count: number | undefined }[] = [
    { label: "All", status: undefined, count: summary?.total },
    ...REPORT_STATUSES.map((status) => ({ label: reportStatusLabel[status], status, count: summary?.byStatus[status] })),
  ];

  const points: MapPoint[] = (result?.items ?? []).map((report) => ({
    id: report.id,
    latitude: report.location.latitude,
    longitude: report.location.longitude,
    severity: report.analysis.estimatedSeverity,
    title: reportTitle(report.analysis.damageClasses, report.analysis.status),
    subtitle: `${reportStatusLabel[report.status]} · ${formatDate(report.createdAt)}`,
    href: `/reports/${report.id}`,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Your reports"
        description={
          summary === undefined
            ? "Road damage you have reported and its progress."
            : `${summary.total} report${summary.total === 1 ? "" : "s"} · ${summary.byStatus.ACCEPTED} accepted · ${summary.byStatus.COMPLETED} repaired`
        }
        actions={
          <Link to="/reports/new" className={buttonClass("primary", "lg", "w-full sm:w-auto")}>
            <Plus className="size-5" aria-hidden="true" />
            Report road damage
          </Link>
        }
      />

      {error !== undefined && <Alert>{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter by status">
          {chips
            .filter((chip) => chip.status === undefined || chip.count === undefined || chip.count > 0 || chip.status === query.status)
            .map((chip) => {
              const active = query.status === chip.status;
              return (
                <button
                  key={chip.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatus(chip.status)}
                  className={`min-h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                    active ? "border-ink-900 bg-ink-900 text-white" : "border-ink-300 bg-white text-ink-900 hover:bg-ink-100"
                  }`}
                >
                  {chip.label}
                  {chip.count !== undefined && <span className={`ml-1.5 font-mono text-xs ${active ? "text-ink-on-dark" : "text-ink-500"}`}>{chip.count}</span>}
                </button>
              );
            })}
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Sort"
            value={query.sort ?? "newest"}
            onChange={(e) => setQuery((current) => ({ ...current, page: 1, sort: e.target.value === "oldest" ? "oldest" : "newest" }))}
            className={`${fieldClass} min-h-10 w-auto`}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <div className="flex rounded-lg border border-ink-300 bg-white p-0.5" role="group" aria-label="View">
            {(
              [
                ["list", "List", List],
                ["map", "Map", MapIcon],
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
                className={`flex min-h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold ${view === mode ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100"}`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && result === undefined ? (
        <div className="rounded-xl border border-ink-150 bg-white p-5">
          <SkeletonList rows={4} />
        </div>
      ) : result !== undefined && result.items.length === 0 ? (
        <div className="rounded-xl border border-ink-150 bg-white">
          {query.status === undefined ? (
            <EmptyState
              icon={<FileText className="size-6" />}
              title="No reports yet"
              description="When you report road damage it appears here, and you can follow it until it is repaired."
              action={
                <Link to="/reports/new" className={buttonClass("primary")}>
                  Report road damage
                </Link>
              }
            />
          ) : (
            <EmptyState title="No reports with this status" description="Choose another status to see your other reports." />
          )}
        </div>
      ) : view === "map" ? (
        <section className="overflow-hidden rounded-xl border border-ink-150 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <p className="text-sm text-ink-600">
              {result !== undefined && result.total > result.items.length
                ? `Showing your ${result.items.length} newest of ${result.total} reports.`
                : "Only your own reports are shown."}
            </p>
            <SeverityLegend />
          </div>
          <ReportsOverviewMap points={points} className="h-[26rem]" />
        </section>
      ) : (
        <ul className={`space-y-2.5 ${loading ? "opacity-60" : ""}`}>
          {result?.items.map((report) => (
            <li key={report.id}>
              <Link
                to={`/reports/${report.id}`}
                className="flex flex-col gap-2.5 rounded-xl border border-ink-150 bg-white p-3 transition-colors hover:border-ink-300 sm:p-4"
              >
                <span className="flex gap-3">
                  <ReportThumb image={report.image} className="size-16" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-bold text-ink-900">{reportTitle(report.analysis.damageClasses, report.analysis.status)}</span>
                      <ReportRef id={report.id} className="shrink-0 pt-0.5" />
                    </span>
                    <span className="truncate text-xs text-ink-500">
                      {formatDate(report.createdAt)} · {captureMethodLabel[report.captureMethod]}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <SeverityIndicator level={report.analysis.estimatedSeverity} estimated />
                      <StatusPill status={report.status} />
                    </span>
                  </span>
                </span>
                <span className="flex flex-col gap-1.5">
                  <ProgressBar status={report.status} repairActive={repairBegun(report.repairProgress)} />
                  <span className={`text-[13px] font-semibold ${report.status === "REJECTED" ? "text-ink-500" : report.status === "COMPLETED" ? "text-ink-900" : "text-cobalt-600"}`}>
                    {citizenStageText(report.status, report.repairProgress)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {view === "list" && result !== undefined && (
        <Pagination page={result.page} pageSize={result.pageSize} total={result.total} loading={loading} noun="report" onPage={(page) => setQuery((c) => ({ ...c, page }))} />
      )}
    </div>
  );
}
