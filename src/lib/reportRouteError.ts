import { supabase } from "@/integrations/supabase/client";
import type { RouteErrorDiagnostic } from "../../supabase/functions/_shared/route-error-diagnostic";
export type ReportStatus = "pending" | "sent" | "not_confirmed" | "local_only";
export async function reportRouteError(diagnostic: RouteErrorDiagnostic): Promise<ReportStatus> {
  if (diagnostic.route !== "/admin/deals") return "local_only";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      send(diagnostic),
      new Promise<ReportStatus>(resolve => { timer = setTimeout(() => resolve("not_confirmed"), 5000); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function send(diagnostic: RouteErrorDiagnostic): Promise<ReportStatus> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return "local_only";
    const { data, error } = await supabase.functions.invoke("report-client-error", { body: diagnostic, timeout: 4000 });
    return !error && data?.ok === true && data?.id === diagnostic.id ? "sent" : "not_confirmed";
  } catch { return "not_confirmed"; } // Never recurse on a failed report.
}
