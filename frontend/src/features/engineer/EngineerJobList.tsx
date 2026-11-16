import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { RepairPill, ReportRef, SeverityIndicator } from "../../components/reports/indicators";
import { damageClassLabel } from "../../components/reports/labels";
import { ReportThumb } from "../../components/reports/ReportPhoto";
import type { EngineerJobListItem } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";

/** What the engineer should do next on a job, in a few words. */
function nextAction(job: EngineerJobListItem, history: boolean): { label: string; primary: boolean } {
  if (history) return { label: "View job", primary: false };
  if (job.needsMoreWork) return { label: "Read the note and reopen", primary: true };
  if (job.repairStatus === "PENDING") return { label: "Start work", primary: true };
  if (job.repairStatus === "WORKING") return { label: "Add photos and complete", primary: true };
  return { label: "Waiting for the administrator's check", primary: false };
}

/** Job cards for the engineer dashboard and history: large touch targets, one next action each. */
export function EngineerJobList({ jobs, history = false }: { jobs: EngineerJobListItem[]; history?: boolean }) {
  return (
    <ul className="space-y-2.5">
      {jobs.map((job) => {
        const action = nextAction(job, history);
        return (
          <li key={job.id}>
            <Link
              to={`/engineer/jobs/${job.id}`}
              className={`flex flex-col gap-3 rounded-xl border bg-white p-3 transition-colors hover:border-ink-300 sm:p-4 ${
                job.needsMoreWork ? "border-ink-150 shadow-[inset_0_3px_0_var(--color-road-400)]" : "border-ink-150"
              }`}
            >
              <span className="flex gap-3">
                <ReportThumb image={job.image} className="size-16" />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-bold text-ink-900">{job.damageClasses.length > 0 ? job.damageClasses.map(damageClassLabel).join(", ") : "Road damage"}</span>
                    <ReportRef id={job.id} className="shrink-0 pt-0.5" />
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <SeverityIndicator level={job.severity} />
                    {job.needsMoreWork && <span className="rounded-full bg-road-100 px-2 py-0.5 text-xs font-bold text-road-900">Needs more work</span>}
                    {!history && job.repairStatus !== null && <RepairPill status={job.repairStatus} attempt={job.currentAttempt} />}
                  </span>
                  <span className="truncate text-xs text-ink-500">
                    {history ? "Confirmed as completed" : `Assigned ${formatDate(job.assignedAt)}`}
                    {job.description !== null && ` · ${job.description}`}
                  </span>
                </span>
              </span>
              <span
                className={`flex min-h-11 items-center justify-between gap-2 rounded-lg px-3.5 text-sm font-semibold ${
                  action.primary ? "bg-cobalt-600 text-white" : "bg-ink-100 text-ink-600"
                }`}
              >
                {action.label}
                <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
