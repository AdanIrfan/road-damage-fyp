import { Link } from "react-router";
import { RepairPill, ReportRef, SeverityIndicator, StatusPill } from "../../components/reports/indicators";
import { formatAge, reportTitle } from "../../components/reports/labels";
import { ReportThumb } from "../../components/reports/ReportPhoto";
import { Badge } from "../../components/ui";
import type { AdminReportListItem } from "../../lib/reportTypes";
import { formatDate } from "../../utils/format";

/** Reports still waiting for something; finished ones show their date instead of an age. */
const OPEN_STATUSES = new Set(["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "DELAYED"]);

/** Reports table for admins (list page, dashboard, engineer page). Each row links to the detail page. */
export function AdminReportTable({ items, dimmed = false, showCitizen = true }: { items: AdminReportListItem[]; dimmed?: boolean; showCitizen?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full min-w-[44rem] border-collapse text-[13px] ${dimmed ? "opacity-60" : ""}`}>
        <thead>
          <tr className="bg-canvas text-left text-[11px] tracking-wider text-ink-500 uppercase">
            <th className="px-5 py-2.5 font-semibold">Report</th>
            {showCitizen && <th className="hidden px-3 py-2.5 font-semibold md:table-cell">Citizen</th>}
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold">Severity</th>
            <th className="px-3 py-2.5 font-semibold">Age</th>
            <th className="hidden px-3 py-2.5 font-semibold lg:table-cell">Checks</th>
            <th className="px-5 py-2.5 font-semibold">Repair</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-t border-ink-100 align-middle hover:bg-canvas">
              <td className="px-5 py-3">
                <Link to={`/admin/reports/${r.id}`} className="flex items-center gap-3 text-ink-900">
                  <ReportThumb image={r.image} className="size-11" />
                  <span className="min-w-0">
                    <span className="block font-semibold">{reportTitle(r.analysis.damageClasses, r.analysis.status)}</span>
                    <ReportRef id={r.id} />
                  </span>
                </Link>
              </td>
              {showCitizen && <td className="hidden px-3 py-3 text-ink-600 md:table-cell">{r.citizen.fullName}</td>}
              <td className="px-3 py-3">
                <StatusPill status={r.status} />
              </td>
              <td className="px-3 py-3">
                <SeverityIndicator level={r.severity.effective} estimated={r.severity.admin === null} />
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-ink-600" title={formatDate(r.createdAt)}>
                {OPEN_STATUSES.has(r.status) ? <span className="font-mono">{formatAge(r.createdAt)}</span> : formatDate(r.createdAt)}
              </td>
              <td className="hidden px-3 py-3 lg:table-cell">
                <div className="flex flex-wrap gap-1">
                  {r.location.needsReview && <Badge tone="amber">Location to check</Badge>}
                  {r.analysis.status === "FAILED" && <Badge tone="red">AI failed</Badge>}
                  {!r.location.needsReview && r.analysis.status !== "FAILED" && <span className="text-ink-500">None</span>}
                </div>
              </td>
              <td className="px-5 py-3">
                {r.assignment.repairStatus === null ? (
                  <span className="text-ink-500">Unassigned</span>
                ) : (
                  <div>
                    <RepairPill status={r.assignment.repairStatus} attempt={r.assignment.currentAttempt} />
                    {r.assignment.engineer !== null && <div className="mt-1 text-xs text-ink-500">{r.assignment.engineer.fullName}</div>}
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
