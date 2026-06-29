// ============================================================================
// AdminUnresolvedCalls
// ----------------------------------------------------------------------------
// VOCHI Phase 2 — список звонков с link_status in ('unresolved', 'ambiguous').
// Менеджер вручную привязывает звонок к контакту (через ContactPickerDialog),
// после чего link_status → 'resolved'. Сделку привязать в этом MVP нельзя:
// сначала контакт, потом сделка — типичный CRM-флоу.
// ============================================================================

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ContactPickerDialog,
  type PickedContact,
} from "@/components/admin/shared/pickers/ContactPickerDialog";

interface UnresolvedCallRow {
  id: string;
  public_id: string | null;
  direction: string;
  status: string;
  link_status: string;
  started_at: string | null;
  duration_seconds: number | null;
  phone_from_e164: string | null;
  phone_to_e164: string | null;
}

const LINK_STATUS_LABEL: Record<string, string> = {
  unresolved: "Не распознан",
};

function formatDuration(s: number | null) {
  if (!s || s <= 0) return "—";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function AdminUnresolvedCalls() {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerForCallId, setPickerForCallId] = useState<string | null>(null);
  const [pickerInitialQuery, setPickerInitialQuery] = useState<string | null>(null);
  const [busyCallId, setBusyCallId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["calls-unresolved"],
    queryFn: async (): Promise<UnresolvedCallRow[]> => {
      const { data, error } = await supabase
        .from("calls")
        .select(
          "id, public_id, direction, status, link_status, started_at, duration_seconds, phone_from_e164, phone_to_e164"
        )
        .in("link_status", ["unresolved", "ambiguous"])
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as UnresolvedCallRow[];
    },
  });

  const rows = useMemo(() => data ?? [], [data]);

  const openPicker = (call: UnresolvedCallRow) => {
    setPickerForCallId(call.id);
    const phone = call.direction === "inbound" ? call.phone_from_e164 : call.phone_to_e164;
    setPickerInitialQuery(phone ?? null);
    setPickerOpen(true);
  };

  const handlePick = async (contact: PickedContact) => {
    if (!pickerForCallId) return;
    setBusyCallId(pickerForCallId);
    try {
      const { error } = await supabase
        .from("calls")
        .update({
          contact_id: contact.id,
          link_status: "resolved",
          updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        })
        .eq("id", pickerForCallId);
      if (error) throw error;
      toast.success("Звонок привязан к контакту");
      setPickerOpen(false);
      setPickerForCallId(null);
      queryClient.invalidateQueries({ queryKey: ["calls-unresolved"] });
      queryClient.invalidateQueries({ queryKey: ["calls-history"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось привязать звонок");
    } finally {
      setBusyCallId(null);
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Звонки без привязки</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Звонки, которые система не смогла автоматически связать с контактом.
          Привяжите вручную, чтобы они появились в карточке клиента.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">
            Нераспознанные звонки {rows.length > 0 && <span>({rows.length})</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Все звонки привязаны 🎉
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((call) => {
                const phone =
                  call.direction === "inbound" ? call.phone_from_e164 : call.phone_to_e164;
                const Icon =
                  call.status === "no_answer" || call.status === "busy"
                    ? PhoneMissed
                    : call.direction === "inbound"
                    ? PhoneIncoming
                    : PhoneOutgoing;
                const busy = busyCallId === call.id;
                return (
                  <div
                    key={call.id}
                    className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{phone ?? "—"}</span>
                        <Badge variant="outline" className="text-[10px] py-0 h-5">
                          {LINK_STATUS_LABEL[call.link_status] ?? call.link_status}
                        </Badge>
                        {call.public_id && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {call.public_id}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        {call.started_at && (
                          <span>
                            {format(new Date(call.started_at), "d MMM yyyy HH:mm", {
                              locale: ru,
                            })}
                          </span>
                        )}
                        <span>длит. {formatDuration(call.duration_seconds)}</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => openPicker(call)}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <UserPlus className="h-3.5 w-3.5 mr-1" />
                      )}
                      Привязать
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ContactPickerDialog
        open={pickerOpen}
        onOpenChange={(o) => {
          setPickerOpen(o);
          if (!o) setPickerForCallId(null);
        }}
        onPick={handlePick}
        options={{
          title: "Привязать звонок к контакту",
          initialQuery: pickerInitialQuery,
          helperText: "Поиск по имени, email или телефону",
        }}
      />
    </div>
  );
}
