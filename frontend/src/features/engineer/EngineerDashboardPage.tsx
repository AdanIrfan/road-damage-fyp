import { useEffect, useState } from "react";
import { Pagination } from "../../components/Pagination";
import { Briefcase, List, Map as MapIcon } from "lucide-react";
import { damageClassLabel, repairStatusLabel } from "../../components/reports/labels";
import { ReportsOverviewMap, SeverityLegend, type MapPoint } from "../../components/reports/ReportsOverviewMap";
import { Alert, EmptyState, SkeletonList } from "../../components/ui";
import { roleLabel } from "../../utils/format";
import { useCurrentUser } from "../auth/AuthContext";
import { errorMessage } from "../../lib/api";
import type { EngineerJobListItem, EngineerSummary } from "../../lib/reportTypes";
import type { Paginated } from "../../lib/types";
import { EngineerJobList } from "./EngineerJobList";
import { engineerJobsApi } from "./engineerJobsApi";

/** The engineer's own open jobs (newest assignment first) with summary counts. */
export function EngineerDashboardPage() {
  const user = useCurrentUser();
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"list" | "map">("list");
  const [jobs, setJobs] = useState<Paginated<EngineerJobListItem>>();
  const [summary, setSummary] = useState<EngineerSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([engineerJobsApi.list("active", page), engineerJobsApi.summary()])
      .then(([list, { summary: counts }]) => {
        if (cancelled) return;
        setJobs(list);
        setSummary(counts);
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
  }, [page]);

  // The engineer's own open jobs (this page of the list), from data the job page already shows.
  const mapPoints: MapPoint[] = (jobs?.items ?? []).map((job) => ({
    id: job.id,
    latitude: job.location.latitude,
    longitude: job.location.longitude,
    severity: job.severity,
    title: job.damageClasses.length > 0 ? job.damageClasses.map(damageClassLabel).join(", ") : "Road damage",
    subtitle: job.repairStatus === null ? "Assigned" : `${repairStatusLabel[job.repairStatus]}${job.needsMoreWork ? " · needs more work" : ""}`,
    href: `/engineer/jobs/${job.id}`,
  }));

  const stats =
    summary === undefined
      ? []
      : [
          { label: "To do or working", value: summary.active },
          { label: "Needs more work", value: summary.needsMoreWork },
          { label: "Awaiting check", value: summary.awaitingConfirmation },
          { label: "Completed", value: summary.completed },
        ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Ink summary band: the engineer's workload at a glance. */}
      <section className="rounded-2xl bg-ink-900 p-4 text-white sm:p-5">
        <h1 className="text-2xl font-bold tracking-tight">My jobs</h1>
        <p className="mt-0.5 text-[13px] text-ink-on-dark">
          {user.fullName} · {roleLabel[user.role]}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {summary === undefined
            ? Array.from({ length: 4 }, (_, index) => <div key={index} className="h-[4.25rem] animate-pulse rounded-[10px] bg-ink-800" />)
            : stats.map((stat) => (
                <div key={stat.label} className="flex flex-col-reverse rounded-[10px] bg-ink-800 px-3 py-2">
                  <dt className="text-[11px] leading-tight text-ink-on-dark">{stat.label}</dt>
                  <dd className="text-2xl font-bold tabular-nums">{stat.value}</dd>
                </div>
              ))}
        </dl>
      </section>

      {error !== undefined && <Alert>{error}</Alert>}
      {summary !== undefined && summary.needsMoreWork > 0 && (
        <Alert tone="info">
          An administrator asked for more work on {summary.needsMoreWork === 1 ? "a job" : `${summary.needsMoreWork} jobs`}. Open it to read the note and reopen the repair.
        </Alert>
      )}

      {jobs !== undefined && jobs.items.length > 0 && (
        <div className="flex justify-end">
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
                className={`flex min-h-10 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-semibold ${view === mode ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100"}`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && jobs === undefined ? (
        <div className="rounded-xl border border-ink-150 bg-white p-5">
          <SkeletonList rows={3} />
        </div>
      ) : jobs !== undefined && jobs.items.length === 0 ? (
        <div className="rounded-xl border border-ink-150 bg-white">
          <EmptyState icon={<Briefcase className="size-6" />} title="No assigned jobs right now" description="New jobs appear here as soon as an administrator assigns them to you." />
        </div>
      ) : view === "map" && jobs !== undefined ? (
        <section className="overflow-hidden rounded-xl border border-ink-150 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <p className="text-[13px] text-ink-600">Only jobs assigned to you are shown. Select a marker to open the job.</p>
            <SeverityLegend />
          </div>
          <ReportsOverviewMap points={mapPoints} className="h-[26rem]" />
        </section>
      ) : (
        jobs !== undefined && (
          <div className={loading ? "opacity-60" : ""}>
            <EngineerJobList jobs={jobs.items} />
          </div>
        )
      )}
      {jobs !== undefined && <Pagination page={jobs.page} pageSize={jobs.pageSize} total={jobs.total} loading={loading} noun="job" onPage={setPage} />}
    </div>
  );
}
