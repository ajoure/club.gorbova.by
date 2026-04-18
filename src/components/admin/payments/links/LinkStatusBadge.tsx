import { Badge } from "@/components/ui/badge";
import type { PaymentLinkRow } from "@/hooks/usePaymentLinks";

export function LinkStatusBadge({ link }: { link: PaymentLinkRow }) {
  if (link.status === "invalidated") {
    return <Badge variant="destructive">Недействительна</Badge>;
  }
  if (link.is_expired) {
    return <Badge variant="outline" className="text-muted-foreground">Истекла</Badge>;
  }
  if (link.is_exhausted) {
    return <Badge variant="secondary">Исчерпана</Badge>;
  }
  if (link.status === "active") {
    return <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 border-emerald-500/30">Активна</Badge>;
  }
  return <Badge variant="outline">{link.status}</Badge>;
}
