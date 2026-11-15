import { api } from "../../lib/api";
import type { EngineerJob, EngineerJobListItem, EngineerSummary, RepairPhoto } from "../../lib/reportTypes";
import type { Paginated } from "../../lib/types";

const base = (id: string) => `/api/v1/engineer/jobs/${encodeURIComponent(id)}`;

/** Every call sends the attempt number shown on screen, so stale actions fail instead of hitting another attempt. */
export const engineerJobsApi = {
  summary: () => api.get<{ summary: EngineerSummary }>("/api/v1/engineer/summary"),
  list: (scope: "active" | "history", page: number, pageSize = 20) =>
    api.get<Paginated<EngineerJobListItem>>(`/api/v1/engineer/jobs?scope=${scope}&page=${page}&pageSize=${pageSize}`),
  get: (id: string) => api.get<{ job: EngineerJob }>(base(id)),
  setRepairStatus: (id: string, status: "WORKING" | "COMPLETED", expectedAttempt: number, note?: string) =>
    api.patch<{ job: EngineerJob }>(`${base(id)}/repair-status`, note ? { status, expectedAttempt, note } : { status, expectedAttempt }),
  addNote: (id: string, note: string, expectedAttempt: number) => api.post<{ job: EngineerJob }>(`${base(id)}/notes`, { note, expectedAttempt }),
  addPhoto: (id: string, file: File, expectedAttempt: number) => {
    const form = new FormData();
    form.append("expectedAttempt", String(expectedAttempt));
    form.append("image", file, file.type === "image/png" ? "repair.png" : "repair.jpg");
    return api.postForm<{ photo: RepairPhoto; currentAttemptPhotoCount: number }>(`${base(id)}/photos`, form);
  },
};
