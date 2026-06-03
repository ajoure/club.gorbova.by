// Phase 2 — Stripe events table from provider_events
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface EventRow {
  id: string;
  account_code: string;
  event_id: string;
  event_type: string;
  processing_status: string;
  processed_at: string | null;
  signature_valid: boolean;
  related_order_id: string | null;
  related_payment_id: string | null;
  created_at: string;
  processing_error: string | null;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    received: "bg-blue-500/15 text-blue-600",
    processed: "bg-emerald-500/15 text-emerald-600",
    skipped_duplicate: "bg-muted text-muted-foreground",
    failed: "bg-destructive/15 text-destructive",
    manual_review: "bg-amber-500/15 text-amber-700",
  };
  return <Badge variant="outline" className={map[status] ?? ""}>{status}</Badge>;
}

export function StripeEventsTab() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke("stripe-list-events", {
        body: {},
      });
      setEvents(data?.events ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Stripe events (provider_events)</CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Событий пока нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Время</th>
                  <th className="py-2 pr-3">Тип события</th>
                  <th className="py-2 pr-3">Статус</th>
                  <th className="py-2 pr-3">Order ID</th>
                  <th className="py-2 pr-3">Event ID</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {format(new Date(e.created_at), "yyyy-MM-dd HH:mm:ss")}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{e.event_type}</td>
                    <td className="py-2 pr-3">{statusBadge(e.processing_status)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {e.related_order_id?.slice(0, 8) ?? "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                      {e.event_id.slice(0, 16)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
