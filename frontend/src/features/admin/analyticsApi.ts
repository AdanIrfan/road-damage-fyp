import { api } from "../../lib/api";
import type { AdminAnalytics, AnalyticsGranularity } from "../../lib/reportTypes";

export interface AnalyticsFilters {
  from?: string | undefined;
  to?: string | undefined;
  granularity?: AnalyticsGranularity | undefined;
}

export const analyticsApi = {
  get: (filters: AnalyticsFilters) => {
    const params = new URLSearchParams();
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.granularity) params.set("granularity", filters.granularity);
    const query = params.toString();
    return api.get<{ analytics: AdminAnalytics }>(`/api/v1/admin/analytics${query === "" ? "" : `?${query}`}`);
  },
};
