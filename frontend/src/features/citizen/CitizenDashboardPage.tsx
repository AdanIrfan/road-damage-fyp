import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, Card, Spinner } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import type { Paginated } from "../../lib/types";
import { formatDate } from "../../utils/format";
import {
  analysisStatusLabel,
  captureMethodLabel,
  damageClassLabel,
  REPORT_STATUSES,
  reportStatusLabel,
  reportStatusTone,
  severityLabel,
  severityTone,
} from "./labels";
import { reportsApi, type ReportQuery } from "./reportsApi";
import type { ReportListItem, ReportStatus, ReportSummary } from "./types";

const PAGE_SIZE = 10;
/** Statuses shown as tiles; the rest are included in the total. */
const SUMMARY_TILES: ReportStatus[] = ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "COMPLETED"];

export function CitizenDashboardPage() {
  const [query, setQuery] = useState<ReportQuery>({ page: 1, pageSize: PAGE_SIZE, sort: "newest" });
  const [result, setResult] = useState<Paginated<ReportListItem>>();
  const [summary, setSummary] = useState<ReportSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async (current: ReportQuery) => {
    setLoading(true);
    setError(undefined);
    try {
      const [list, { summary: counts }] = await Promise.all([reportsApi.list(current), reportsApi.summary()]);
      setResult(list);
      setSummary(counts);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(query);
  }, [load, query]);

  const totalPages = result === undefined ? 1 : Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">My reports</h1>
          <p className="mt-1 text-sm text-slate-500">Road damage you have reported and its progress.</p>
        </div>
        <Link
          to="/reports/new"
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          Report damage
        </Link>
      </div>

      {error !== undefined && <Alert>{error}</Alert>}

      {summary !== undefined && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <SummaryTile label="Total" value={summary.total} />
          {SUMMARY_TILES.map((status) => (
            <SummaryTile key={status} label={reportStatusLabel[status]} value={summary.byStatus[status]} />
          ))}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Filter by status"
            value={query.status ?? ""}
            onChange={(e) => {
              const value = REPORT_STATUSES.find((s) => s === e.target.value);
              setQuery((current) => {
                const { status: _status, ...rest } = current;
                return value === undefined ? { ...rest, page: 1 } : { ...rest, page: 1, status: value };
              });
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="">All statuses</option>
            {REPORT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {reportStatusLabel[status]}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort"
            value={query.sort ?? "newest"}
            onChange={(e) => setQuery((current) => ({ ...current, page: 1, sort: e.target.value === "oldest" ? "oldest" : "newest" }))}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>

        <div className="mt-4">
          {loading && result === undefined ? (
            <div className="flex justify-center py-10 text-blue-600">
              <Spinner />
            </div>
          ) : result !== undefined && result.items.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              {query.status === undefined ? (
                <>
                  You have not reported any road damage yet.{" "}
                  <Link to="/reports/new" className="font-medium text-blue-700 hover:underline">
                    Report damage
                  </Link>
                </>
              ) : (
                "No reports with this status."
              )}
            </div>
          ) : (
            <ul className={`divide-y divide-slate-100 ${loading ? "opacity-60" : ""}`}>
              {result?.items.map((report) => (
                <li key={report.id}>
                  <Link to={`/reports/${report.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">
                        {report.analysis.damageClasses.length > 0
                          ? report.analysis.damageClasses.map(damageClassLabel).join(", ")
                          : report.analysis.status === "FAILED"
                            ? analysisStatusLabel.FAILED
                            : "No damage detected automatically"}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-slate-500">
                        {formatDate(report.createdAt)} · {captureMethodLabel[report.captureMethod]}
                        {report.description !== null && ` · ${report.description}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {report.analysis.estimatedSeverity !== null && (
                        <Badge tone={severityTone[report.analysis.estimatedSeverity]}>
                          Est. {severityLabel[report.analysis.estimatedSeverity].toLowerCase()} severity
                        </Badge>
                      )}
                      <Badge tone={reportStatusTone[report.status]}>{reportStatusLabel[report.status]}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {result !== undefined && result.total > 0 && (
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm text-slate-600">
            <span>
              {result.total} report{result.total === 1 ? "" : "s"} · page {result.page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" className="px-3 py-1.5" disabled={query.page <= 1 || loading} onClick={() => setQuery((c) => ({ ...c, page: c.page - 1 }))}>
                Previous
              </Button>
              <Button variant="secondary" className="px-3 py-1.5" disabled={query.page >= totalPages || loading} onClick={() => setQuery((c) => ({ ...c, page: c.page + 1 }))}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
