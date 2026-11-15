import { useEffect, useState } from "react";
import { Pagination } from "../../components/Pagination";
import { Alert, Card, Spinner } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import type { EngineerJobListItem, EngineerSummary } from "../../lib/reportTypes";
import type { Paginated } from "../../lib/types";
import { EngineerJobList } from "./EngineerJobList";
import { engineerJobsApi } from "./engineerJobsApi";

/** The engineer's own open jobs (newest assignment first) with summary counts. */
export function EngineerDashboardPage() {
  const [page, setPage] = useState(1);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">My jobs</h1>
        <p className="mt-1 text-sm text-slate-500">Repair jobs assigned to you.</p>
      </div>
      {error !== undefined && <Alert>{error}</Alert>}
      {summary !== undefined && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="To do / in progress" value={summary.active} />
          <Tile label="Needs more work" value={summary.needsMoreWork} />
          <Tile label="Awaiting admin check" value={summary.awaitingConfirmation} />
          <Tile label="Completed" value={summary.completed} />
        </div>
      )}
      {summary !== undefined && summary.needsMoreWork > 0 && (
        <Alert tone="info">An administrator asked for more work on {summary.needsMoreWork === 1 ? "a job" : `${summary.needsMoreWork} jobs`}. Open it to read the note and reopen the repair.</Alert>
      )}
      <Card>
        {loading && jobs === undefined ? (
          <div className="flex justify-center py-10 text-blue-600">
            <Spinner />
          </div>
        ) : jobs !== undefined && jobs.items.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">You have no assigned jobs right now.</p>
        ) : (
          jobs !== undefined && <EngineerJobList jobs={jobs.items} />
        )}
        {jobs !== undefined && (
          <Pagination page={jobs.page} pageSize={jobs.pageSize} total={jobs.total} loading={loading} noun="job" onPage={setPage} />
        )}
      </Card>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
