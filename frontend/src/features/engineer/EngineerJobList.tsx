import { Link } from "react-router";
import { Badge } from "../../components/ui";
import { damageClassLabel, repairStatusTone, repairStatusWithAttempt, severityLabel, severityTone } from "../../components/reports/labels";
import type { EngineerJobListItem } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";

/** Job cards for the engineer dashboard and history. */
export function EngineerJobList({ jobs, history = false }: { jobs: EngineerJobListItem[]; history?: boolean }) {
  return (
    <ul className="divide-y divide-slate-100">
      {jobs.map((job) => (
        <li key={job.id}>
          <Link to={`/engineer/jobs/${job.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-slate-50">
            <div className="min-w-0">
              <div className="font-medium text-slate-900">
                {job.damageClasses.length > 0 ? job.damageClasses.map(damageClassLabel).join(", ") : "Road damage"}
              </div>
              <div className="mt-0.5 truncate text-sm text-slate-500">
                {history ? "Completed" : `Assigned ${formatDate(job.assignedAt)}`}
                {job.description !== null && ` · ${job.description}`}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {job.needsMoreWork && <Badge tone="amber">Needs more work</Badge>}
              {job.severity !== null && <Badge tone={severityTone[job.severity]}>{severityLabel[job.severity]} severity</Badge>}
              {!history && job.repairStatus !== null && (
                <Badge tone={repairStatusTone[job.repairStatus]}>{repairStatusWithAttempt(job.repairStatus, job.currentAttempt)}</Badge>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
