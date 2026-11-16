import type { RepairAttempt } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";
import { Badge } from "../ui";
import { repairStatusLabel, repairUpdateKindLabel } from "./labels";
import { ReportPhoto } from "./ReportPhoto";

/**
 * Repair work grouped by attempt, newest first. The current attempt is open; earlier attempts
 * are collapsed but always available as evidence.
 */
export function RepairAttempts({ attempts }: { attempts: RepairAttempt[] }) {
  if (attempts.length === 0) {
    return <p className="text-sm text-ink-500">No repair work has been assigned yet.</p>;
  }
  return (
    <div className="space-y-3">
      {attempts.map((attempt) => (
        <details key={attempt.attempt} open={attempt.isCurrent} className="rounded-lg border border-ink-150 bg-white">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="font-semibold text-ink-900">Attempt {attempt.attempt}</span>
            {attempt.isCurrent && <Badge tone="blue">Current</Badge>}
            {attempt.engineer !== null && <span className="text-ink-500">· {attempt.engineer.fullName}</span>}
            <span className="text-ink-500">
              · {attempt.photos.length} photo{attempt.photos.length === 1 ? "" : "s"}
            </span>
          </summary>
          <div className="space-y-3 border-t border-ink-100 px-3 py-3">
            {attempt.photos.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {attempt.photos.map((photo) => (
                  <figure key={photo.id}>
                    <ReportPhoto image={photo} />
                    <figcaption className="mt-1 text-xs text-ink-500">
                      {photo.uploadedBy.fullName} · {formatDate(photo.createdAt)}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-500">No photos for this attempt yet.</p>
            )}
            {attempt.updates.length > 0 && (
              <ol className="space-y-2">
                {attempt.updates.map((update) => (
                  <li
                    key={update.id}
                    className={`rounded-lg px-3 py-2 text-sm ${update.kind === "ADMIN_FEEDBACK" ? "border border-road-400 bg-road-100" : "bg-canvas"}`}
                  >
                    <div className="font-medium text-ink-900">
                      {update.kind === "STATUS_CHANGE" && update.toStatus !== null
                        ? `${update.fromStatus === null ? "" : `${repairStatusLabel[update.fromStatus]} → `}${repairStatusLabel[update.toStatus]}`
                        : repairUpdateKindLabel[update.kind]}
                    </div>
                    <div className="text-xs text-ink-500">
                      {update.author.fullName} · {formatDate(update.createdAt)}
                    </div>
                    {update.note !== null && <p className="mt-1 whitespace-pre-line text-ink-600">{update.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
