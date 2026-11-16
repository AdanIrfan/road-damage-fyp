import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { Pagination } from "../../components/Pagination";
import { Search, SlidersHorizontal } from "lucide-react";
import { Alert, Button, EmptyState, fieldClass, PageHeader, SkeletonList } from "../../components/ui";
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

const selectClass = `${fieldClass} min-h-10`;

/** One-click queues. Each is just a set of URL filters, so it can be bookmarked and shared. */
const QUICK_VIEWS: { label: string; query: string }[] = [
  { label: "All", query: "" },
  { label: "Longest waiting", query: "sort=waiting" },
  { label: "Highest severity", query: "sort=severity" },
  { label: "New", query: "status=SUBMITTED&sort=oldest" },
  { label: "Under review", query: "status=UNDER_REVIEW&sort=oldest" },
  { label: "To assign", query: "status=ACCEPTED&assignment=unassigned&sort=oldest" },
  { label: "Awaiting confirmation", query: "status=ACCEPTED&repairStatus=COMPLETED" },
  { label: "Location to check", query: "needsLocationReview=true" },
  { label: "AI failed", query: "aiStatus=FAILED" },
];

/** Same filters regardless of their order in the URL (the page number is ignored). */
function sameView(a: URLSearchParams, query: string): boolean {
  const normalise = (params: URLSearchParams) =>
    [...params.entries()]
      .filter(([name]) => name !== "page")
      .map(([name, value]) => `${name}=${value}`)
      .sort()
      .join("&");
  return normalise(a) === normalise(new URLSearchParams(query));
}

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
      <PageHeader
        title="Reports"
        description={
          result === undefined
            ? "All road damage reports. Opening a report does not change its status."
            : `${result.total} report${result.total === 1 ? "" : "s"}${active ? " match these filters" : ""}. Opening a report does not change its status.`
        }
        actions={
          <Link to={`/admin/map${filters.status !== undefined ? `?status=${filters.status}` : ""}`} className="text-[13px] font-semibold text-cobalt-600 hover:text-cobalt-700">
            Show on map
          </Link>
        }
      />

      <nav aria-label="Quick views" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {QUICK_VIEWS.map((view) => {
          const current = sameView(params, view.query);
          return (
            <Link
              key={view.label}
              to={`/admin/reports${view.query === "" ? "" : `?${view.query}`}`}
              aria-current={current ? "page" : undefined}
              className={`flex min-h-9 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                current ? "border-ink-900 bg-ink-900 text-white" : "border-ink-300 bg-white text-ink-900 hover:bg-ink-100"
              }`}
            >
              {view.label}
            </Link>
          );
        })}
      </nav>

      <section className="overflow-hidden rounded-xl border border-ink-150 bg-white">
        <div className="space-y-3 p-4 sm:p-5">
        <form onSubmit={submitSearch} className="flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search reports</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-500" aria-hidden="true" />
            <input
              type="search"
              placeholder="Citizen name or mobile, description, or full report id"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${fieldClass} min-h-10 pl-9`}
            />
          </label>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        <details className="group" open={active}>
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-[13px] font-semibold text-cobalt-600">
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Filters and sorting
          </summary>
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
            <option value="severity">Highest severity first</option>
            <option value="waiting">Longest waiting (open reports)</option>
          </select>
          <label className="flex flex-col text-xs text-ink-500">
            From
            <input type="date" value={filters.from ?? ""} onChange={(e) => setFilter("from", e.target.value)} className={selectClass} />
          </label>
          <label className="flex flex-col text-xs text-ink-500">
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
        </details>
        {error !== undefined && <Alert>{error}</Alert>}
        </div>

        <div className="border-t border-ink-100">
          {loading && result === undefined ? (
            <div className="p-5">
              <SkeletonList rows={6} />
            </div>
          ) : result !== undefined && result.items.length === 0 ? (
            <EmptyState
              title={active ? "No reports match these filters" : "No reports yet"}
              description={active ? "Clear or change the filters to see more reports." : "New reports from citizens will be listed here."}
            />
          ) : (
            result !== undefined && <AdminReportTable items={result.items} dimmed={loading} />
          )}
        </div>
        <div className="px-5 pb-4">
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
        </div>
      </section>
    </div>
  );
}
