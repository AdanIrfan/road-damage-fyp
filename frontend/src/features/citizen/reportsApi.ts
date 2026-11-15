import { api } from "../../lib/api";
import type { Paginated } from "../../lib/types";
import type { Report, ReportDraft, ReportListItem, ReportStatus, ReportSummary } from "../../lib/reportTypes";

export interface ReportQuery {
  page: number;
  pageSize: number;
  status?: ReportStatus;
  sort?: "newest" | "oldest";
}

/** Limits the backend enforces; checked here only to give quicker feedback. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png"];
export const DESCRIPTION_MAX_LENGTH = 1000;
/**
 * Used only to warn the citizen before submitting. The backend decides with its own configurable
 * GPS_ACCURACY_THRESHOLD_METERS (default 100 m) and flags such reports for review; it never rejects them.
 */
export const GPS_ACCURACY_WARNING_METERS = 100;

export const reportsApi = {
  list: (query: ReportQuery) => {
    const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
    if (query.status !== undefined) params.set("status", query.status);
    if (query.sort !== undefined) params.set("sort", query.sort);
    return api.get<Paginated<ReportListItem>>(`/api/v1/reports?${params.toString()}`);
  },
  summary: () => api.get<{ summary: ReportSummary }>("/api/v1/reports/summary"),
  get: (id: string) => api.get<{ report: Report }>(`/api/v1/reports/${encodeURIComponent(id)}`),
  submit: (draft: ReportDraft) => {
    const form = new FormData();
    form.append("captureMethod", draft.captureMethod);
    // Fixed precision keeps the fields short; 6 decimals is about 0.1 m.
    form.append("latitude", draft.location.latitude.toFixed(6));
    form.append("longitude", draft.location.longitude.toFixed(6));
    if (draft.gpsAccuracyMeters !== undefined) {
      form.append("gpsAccuracyMeters", draft.gpsAccuracyMeters.toFixed(1));
    }
    if (draft.description.trim() !== "") {
      form.append("description", draft.description.trim());
    }
    form.append("image", draft.photo, draft.photo.type === "image/png" ? "photo.png" : "photo.jpg");
    return api.postForm<{ report: Report }>("/api/v1/reports", form);
  },
};
