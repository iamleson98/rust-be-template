/**
 * `GET /api/admin/system` for the admin system page. The response type is
 * the route's own (`@/lib/services/system-status`), imported as a type only.
 */
import { queryOptions } from "@tanstack/react-query";
import { client } from "@spa/api/generated/client.gen";
import type { SystemReport } from "@/lib/services/system-status";

export type { SystemReport };
export type VpsStatus = NonNullable<SystemReport["vps"]["status"]>;

/** The VPS samples CPU every 10 s; polling faster shows nothing new. */
export const SYSTEM_POLL_MS = 10_000;

export const systemReportOptions = () =>
  queryOptions({
    queryKey: ["adminSystem", "report"],
    queryFn: async ({ signal }) => {
      const { data } = await client.get({
        url: "/api/admin/system",
        signal,
        throwOnError: true,
      });
      return data as SystemReport;
    },
    refetchInterval: SYSTEM_POLL_MS,
  });
