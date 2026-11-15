import type { AdminReport } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";
import { reportStatusLabel } from "./labels";

/** Report status history (oldest first): who changed what, when, and why. */
export function StatusTimeline({ entries }: { entries: AdminReport["statusHistory"] }) {
  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
          <div className="text-sm font-medium text-slate-900">
            {entry.fromStatus === null
              ? `Submitted`
              : entry.fromStatus === entry.toStatus
                ? `Kept ${reportStatusLabel[entry.toStatus].toLowerCase()}`
                : `${reportStatusLabel[entry.fromStatus]} → ${reportStatusLabel[entry.toStatus]}`}
          </div>
          <div className="text-xs text-slate-500">
            {formatDate(entry.createdAt)}
            {entry.changedBy !== null && ` · ${entry.changedBy.fullName}`}
          </div>
          {entry.note !== null && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{entry.note}</p>}
        </li>
      ))}
    </ol>
  );
}
