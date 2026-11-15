import { api } from "../../lib/api";
import type {
  AdminActionResult,
  AdminDashboard,
  AdminReport,
  AdminReportListItem,
  EngineerSuggestion,
  SeverityLevel,
} from "../../lib/reportTypes";
import type { Paginated } from "../../lib/types";

/** Filters for GET /admin/reports. Kept as strings so they map 1:1 to the URL query. */
export interface AdminReportFilters {
  page?: string;
  pageSize?: string;
  sort?: string;
  search?: string;
  status?: string;
  severity?: string;
  from?: string;
  to?: string;
  captureMethod?: string;
  needsLocationReview?: string;
  aiStatus?: string;
  assignment?: string;
  engineerId?: string;
  repairStatus?: string;
}

const base = (id: string) => `/api/v1/admin/reports/${encodeURIComponent(id)}`;

export const adminReportsApi = {
  dashboard: () => api.get<{ dashboard: AdminDashboard }>("/api/v1/admin/dashboard"),
  list: (filters: AdminReportFilters) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "") params.set(key, value);
    }
    return api.get<Paginated<AdminReportListItem>>(`/api/v1/admin/reports?${params.toString()}`);
  },
  get: (id: string) => api.get<{ report: AdminReport }>(base(id)),
  review: (id: string) => api.post<AdminActionResult>(`${base(id)}/review`),
  decide: (id: string, decision: "ACCEPT" | "REJECT" | "DELAY", reason?: string) =>
    api.post<AdminActionResult>(`${base(id)}/decision`, reason === undefined || reason === "" ? { decision } : { decision, reason }),
  setSeverity: (id: string, severity: SeverityLevel) => api.patch<AdminActionResult>(`${base(id)}/severity`, { severity }),
  suggestions: (id: string) => api.get<{ engineers: EngineerSuggestion[] }>(`${base(id)}/engineer-suggestions`),
  assign: (id: string, engineerId: string, reason?: string) =>
    api.post<AdminActionResult>(`${base(id)}/assignment`, reason === undefined || reason === "" ? { engineerId } : { engineerId, reason }),
  feedback: (id: string, note: string, expectedAttempt: number) =>
    api.post<AdminActionResult>(`${base(id)}/feedback`, { note, expectedAttempt }),
  confirmCompletion: (id: string, expectedAttempt: number, note?: string) =>
    api.post<AdminActionResult>(`${base(id)}/confirm-completion`, note === undefined || note === "" ? { expectedAttempt } : { expectedAttempt, note }),
};
