import { useEffect, useState } from "react";
import { Pagination } from "../../components/Pagination";
import { History } from "lucide-react";
import { Alert, EmptyState, PageHeader, SkeletonList } from "../../components/ui";
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
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Work history" description={jobs === undefined ? "Repairs confirmed as completed." : `${jobs.total} repair${jobs.total === 1 ? "" : "s"} confirmed as completed.`} />
      {error !== undefined && <Alert>{error}</Alert>}
      {loading && jobs === undefined ? (
        <div className="rounded-xl border border-ink-150 bg-white p-5">
          <SkeletonList rows={3} />
        </div>
      ) : jobs !== undefined && jobs.items.length === 0 ? (
        <div className="rounded-xl border border-ink-150 bg-white">
          <EmptyState icon={<History className="size-6" />} title="No completed jobs yet" description="A job moves here once an administrator confirms your repair." />
        </div>
      ) : (
        jobs !== undefined && (
          <div className={loading ? "opacity-60" : ""}>
            <EngineerJobList jobs={jobs.items} history />
          </div>
        )
      )}
      {jobs !== undefined && <Pagination page={jobs.page} pageSize={jobs.pageSize} total={jobs.total} loading={loading} noun="job" onPage={setPage} />}
    </div>
  );
}
