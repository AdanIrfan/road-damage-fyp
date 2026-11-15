import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { Pagination } from "../../components/Pagination";
import { Alert, Button, Card, Spinner } from "../../components/ui";
import { REPORT_STATUSES, reportStatusLabel } from "../../components/reports/labels";
import { errorMessage } from "../../lib/api";
import type { AdminReportListItem } from "../../lib/reportTypes";
import type { Paginated } from "../../lib/types";
import { adminReportsApi, type AdminReportFilters } from "./adminReportsApi";
import { AdminReportTable } from "./AdminReportTable";

const FILTER_KEYS: (keyof AdminReportFilters)[] = [
  "page",
  "sort",
  "search",
  "status",
  "severity",
  "from",
  "to",
  "captureMethod",
  "needsLocationReview",
  "aiStatus",
  "assignment",
  "engineerId",
  "repairStatus",
];

const selectClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

export function AdminReportsPage() {
  const [params, setParams] = useSearchParams();
  const filters: AdminReportFilters = Object.fromEntries(FILTER_KEYS.flatMap((k) => (params.get(k) ? [[k, params.get(k) ?? ""]] : [])));
  const key = params.toString();
  const [result, setResult] = useState<Paginated<AdminReportListItem>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState(filters.search ?? "");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    adminReportsApi
      .list({ ...Object.fromEntries(new URLSearchParams(key)), pageSize: "20" })
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
  }, [key]);

  /** Changes one filter and goes back to page 1 (except when changing the page itself). */
  function setFilter(name: keyof AdminReportFilters, value: string) {
    const next = new URLSearchParams(params);
    if (value === "") next.delete(name);
    else next.set(name, value);
    if (name !== "page") next.delete("page");
    setParams(next);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setFilter("search", search.trim());
  }

  const active = FILTER_KEYS.some((k) => k !== "page" && k !== "sort" && filters[k] !== undefined);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <p className="mt-1 text-sm text-slate-500">All road damage reports. Opening a report does not change its status.</p>
      </div>

      <Card>
        <form onSubmit={submitSearch} className="flex gap-2">
          <input
            type="search"
            aria-label="Search reports"
            placeholder="Citizen name or mobile, description, or full report id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
          <select aria-label="Status" value={filters.status ?? ""} onChange={(e) => setFilter("status", e.target.value)} className={selectClass}>
            <option value="">All statuses</option>
            {REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {reportStatusLabel[s]}
              </option>
            ))}
          </select>
          <select aria-label="Severity" value={filters.severity ?? ""} onChange={(e) => setFilter("severity", e.target.value)} className={selectClass}>
            <option value="">Any severity</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <select aria-label="Assignment" value={filters.assignment ?? ""} onChange={(e) => setFilter("assignment", e.target.value)} className={selectClass}>
            <option value="">Assigned or not</option>
            <option value="unassigned">Unassigned</option>
            <option value="assigned">Assigned</option>
          </select>
          <select aria-label="Repair status" value={filters.repairStatus ?? ""} onChange={(e) => setFilter("repairStatus", e.target.value)} className={selectClass}>
            <option value="">Any repair status</option>
            <option value="PENDING">Pending</option>
            <option value="WORKING">Working</option>
            <option value="COMPLETED">Completed (awaiting confirmation)</option>
          </select>
          <select
            aria-label="Location check"
            value={filters.needsLocationReview ?? ""}
            onChange={(e) => setFilter("needsLocationReview", e.target.value)}
            className={selectClass}
          >
            <option value="">Any location check</option>
            <option value="true">Location needs checking</option>
            <option value="false">Location OK</option>
          </select>
          <select aria-label="Sort" value={filters.sort ?? "newest"} onChange={(e) => setFilter("sort", e.target.value)} className={selectClass}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <label className="flex flex-col text-xs text-slate-500">
            From
            <input type="date" value={filters.from ?? ""} onChange={(e) => setFilter("from", e.target.value)} className={selectClass} />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            To
            <input type="date" value={filters.to ?? ""} onChange={(e) => setFilter("to", e.target.value)} className={selectClass} />
          </label>
          <select aria-label="Capture method" value={filters.captureMethod ?? ""} onChange={(e) => setFilter("captureMethod", e.target.value)} className={selectClass}>
            <option value="">Camera or gallery</option>
            <option value="LIVE_CAMERA">Live camera</option>
            <option value="GALLERY_UPLOAD">Gallery upload</option>
          </select>
          <select aria-label="Analysis" value={filters.aiStatus ?? ""} onChange={(e) => setFilter("aiStatus", e.target.value)} className={selectClass}>
            <option value="">Any analysis</option>
            <option value="COMPLETED">Analysed</option>
            <option value="FAILED">Analysis failed</option>
          </select>
          {active && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch("");
                setParams(new URLSearchParams());
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        <div className="mt-4">
          {error !== undefined && <Alert>{error}</Alert>}
          {loading && result === undefined ? (
            <div className="flex justify-center py-10 text-blue-600">
              <Spinner />
            </div>
          ) : result !== undefined && result.items.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">{active ? "No reports match these filters." : "No reports yet."}</p>
          ) : (
            result !== undefined && <AdminReportTable items={result.items} dimmed={loading} />
          )}
        </div>
        {result !== undefined && (
          <Pagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            loading={loading}
            noun="report"
            onPage={(page) => setFilter("page", String(page))}
          />
        )}
      </Card>
    </div>
  );
}
