import { api } from "../../lib/api";
import type { Paginated, User } from "../../lib/types";

export interface EngineerQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: "ACTIVE" | "DEACTIVATED";
}

export const engineersApi = {
  list: (query: EngineerQuery) => {
    const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
    if (query.search !== undefined && query.search !== "") params.set("search", query.search);
    if (query.status !== undefined) params.set("status", query.status);
    return api.get<Paginated<User>>(`/api/v1/admin/engineers?${params.toString()}`);
  },
  get: (id: string) => api.get<{ engineer: User }>(`/api/v1/admin/engineers/${encodeURIComponent(id)}`),
  create: (input: { fullName: string; mobileNumber: string; temporaryPassword: string }) =>
    api.post<{ engineer: User }>("/api/v1/admin/engineers", input),
  update: (id: string, input: { fullName?: string; mobileNumber?: string }) =>
    api.patch<{ engineer: User }>(`/api/v1/admin/engineers/${encodeURIComponent(id)}`, input),
  setStatus: (id: string, status: "ACTIVE" | "DEACTIVATED") =>
    api.patch<{ engineer: User }>(`/api/v1/admin/engineers/${encodeURIComponent(id)}/status`, { status }),
};
