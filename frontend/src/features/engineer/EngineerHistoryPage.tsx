import { useEffect, useState } from "react";
import { Pagination } from "../../components/Pagination";
import { Alert, Card, Spinner } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import type { EngineerJobListItem } from "../../lib/reportTypes";
import type { Paginated } from "../../lib/types";
import { EngineerJobList } from "./EngineerJobList";
import { engineerJobsApi } from "./engineerJobsApi";

/** Jobs confirmed as completed by an administrator while assigned to this engineer. */
export function EngineerHistoryPage() {
  const [page, setPage] = useState(1);
  const [jobs, setJobs] = useState<Paginated<EngineerJobListItem>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    engineerJobsApi
      .list("history", page)
      .then((list) => {
        if (!cancelled) setJobs(list);
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
        <h1 className="text-2xl font-semibold text-slate-900">Work history</h1>
        <p className="mt-1 text-sm text-slate-500">Repairs confirmed as completed.</p>
      </div>
      {error !== undefined && <Alert>{error}</Alert>}
      <Card>
        {loading && jobs === undefined ? (
          <div className="flex justify-center py-10 text-blue-600">
            <Spinner />
          </div>
        ) : jobs !== undefined && jobs.items.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">No completed jobs yet.</p>
        ) : (
          jobs !== undefined && <EngineerJobList jobs={jobs.items} history />
        )}
        {jobs !== undefined && (
          <Pagination page={jobs.page} pageSize={jobs.pageSize} total={jobs.total} loading={loading} noun="job" onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
