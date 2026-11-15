import { Link } from "react-router";
import { Badge } from "../../components/ui";
import {
  damageClassLabel,
  repairStatusTone,
  repairStatusWithAttempt,
  reportStatusLabel,
  reportStatusTone,
  severityLabel,
  severityTone,
} from "../../components/reports/labels";
import type { AdminReportListItem } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";

/** Reports table for admins (list page, dashboard, engineer page). Each row links to the detail page. */
export function AdminReportTable({ items, dimmed = false, showCitizen = true }: { items: AdminReportListItem[]; dimmed?: boolean; showCitizen?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className={`min-w-full divide-y divide-slate-200 text-sm ${dimmed ? "opacity-60" : ""}`}>
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4">Report</th>
            {showCitizen && <th className="hidden py-2 pr-4 md:table-cell">Citizen</th>}
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Severity</th>
            <th className="hidden py-2 pr-4 lg:table-cell">Checks</th>
            <th className="py-2">Repair</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="py-3 pr-4">
                <Link to={`/admin/reports/${r.id}`} className="font-medium text-blue-700 hover:underline">
                  {r.analysis.damageClasses.length > 0 ? r.analysis.damageClasses.map(damageClassLabel).join(", ") : "No damage detected"}
                </Link>
                <div className="text-xs text-slate-500">{formatDate(r.createdAt)}</div>
              </td>
              {showCitizen && <td className="hidden py-3 pr-4 text-slate-700 md:table-cell">{r.citizen.fullName}</td>}
              <td className="py-3 pr-4">
                <Badge tone={reportStatusTone[r.status]}>{reportStatusLabel[r.status]}</Badge>
              </td>
              <td className="py-3 pr-4">
                {r.severity.effective === null ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <Badge tone={severityTone[r.severity.effective]}>
                    {severityLabel[r.severity.effective]}
                    {r.severity.admin === null ? " (est.)" : ""}
                  </Badge>
                )}
              </td>
              <td className="hidden py-3 pr-4 lg:table-cell">
                <div className="flex flex-wrap gap-1">
                  {r.location.needsReview && <Badge tone="amber">Location</Badge>}
                  {r.analysis.status === "FAILED" && <Badge tone="red">AI failed</Badge>}
                </div>
              </td>
              <td className="py-3">
                {r.assignment.repairStatus === null ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <div>
                    <Badge tone={repairStatusTone[r.assignment.repairStatus]}>
                      {repairStatusWithAttempt(r.assignment.repairStatus, r.assignment.currentAttempt)}
                    </Badge>
                    {r.assignment.engineer !== null && <div className="mt-1 text-xs text-slate-500">{r.assignment.engineer.fullName}</div>}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
