/**
 * ScheduledBroadcastsSection
 *
 * Под-вкладка «Запланированные рассылки» внутри tab=broadcasts.
 *  - Dispatcher status panel наверху
 *  - Список scheduled / recurring / sent шаблонов из broadcast_templates
 *  - Кнопка «Создать запланированную»
 *  - Карточки с next_run_at, recurrence, last_run_at, total_runs
 *
 * НЕ ТРОГАЕТ «Быструю рассылку» и «Шаблоны» (старые секции).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Calendar as CalendarIcon, Repeat, Loader2, Edit2, Trash2, Clock, MessageCircle, Mail } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import { DispatcherStatusPanel } from "./DispatcherStatusPanel";
import { ScheduledBroadcastWizard } from "./ScheduledBroadcastWizard";

type StatusFilter = "scheduled" | "recurring" | "sent";

interface SchedRow {
  id: string;
  name: string;
  status: string;
  send_mode: string;
  channels: string[];
  next_run_at: string | null;
  last_run_at: string | null;
  total_runs: number;
  message_text: string | null;
  email_subject: string | null;
}

export function ScheduledBroadcastsSection() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("scheduled");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["scheduled-broadcasts", statusFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("broadcast_templates")
        .select("id, name, status, send_mode, channels, next_run_at, last_run_at, total_runs, message_text, email_subject")
        .eq("status", statusFilter)
        .order("next_run_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as SchedRow[];
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("broadcast_templates")
        .update({ status: "draft", send_mode: "manual", next_run_at: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Снято с расписания");
      qc.invalidateQueries({ queryKey: ["scheduled-broadcasts"] });
    },
    onError: (e) => toast.error("Ошибка: " + (e as Error).message),
  });

  const handleCreate = () => {
    setEditId(null);
    setWizardOpen(true);
  };

  const handleEdit = (id: string) => {
    setEditId(id);
    setWizardOpen(true);
  };

  return (
    <div className="space-y-4">
      <DispatcherStatusPanel />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <CalendarIcon className="h-5 w-5" />
          Запланированные рассылки
        </h2>
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Создать запланированную
        </Button>
      </div>

      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="scheduled" className="gap-1">
            <Clock className="h-3 w-3" /> Однократные
          </TabsTrigger>
          <TabsTrigger value="recurring" className="gap-1">
            <Repeat className="h-3 w-3" /> Повторяющиеся
          </TabsTrigger>
          <TabsTrigger value="sent">Завершённые</TabsTrigger>
        </TabsList>

        <TabsContent value={statusFilter} className="mt-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows?.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                {statusFilter === "scheduled" && "Нет однократных рассылок. Создайте новую."}
                {statusFilter === "recurring" && "Нет повторяющихся рассылок."}
                {statusFilter === "sent" && "Нет завершённых рассылок."}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {rows?.map((r) => (
                <Card key={r.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{r.name}</CardTitle>
                      <div className="flex flex-wrap gap-1">
                        {r.channels?.includes("telegram") && (
                          <Badge variant="secondary" className="gap-1">
                            <MessageCircle className="h-3 w-3" /> TG
                          </Badge>
                        )}
                        {r.channels?.includes("email") && (
                          <Badge variant="secondary" className="gap-1">
                            <Mail className="h-3 w-3" /> Email
                          </Badge>
                        )}
                        {r.send_mode === "recurring" && (
                          <Badge variant="outline" className="gap-1">
                            <Repeat className="h-3 w-3" /> recurring
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {r.message_text || r.email_subject}
                    </p>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {r.next_run_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Следующий: {format(new Date(r.next_run_at), "dd MMM, HH:mm", { locale: ru })}
                        </span>
                      )}
                      {r.last_run_at && (
                        <span>
                          Последний: {format(new Date(r.last_run_at), "dd MMM, HH:mm", { locale: ru })}
                        </span>
                      )}
                      {r.total_runs > 0 && <span>Запусков: {r.total_runs}</span>}
                    </div>

                    <div className="flex gap-2 pt-1">
                      {statusFilter !== "sent" && (
                        <>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => handleEdit(r.id)}>
                            <Edit2 className="h-3 w-3" /> Изменить
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-destructive"
                            onClick={() => {
                              if (window.confirm("Снять с расписания и вернуть в черновики?")) {
                                cancelMutation.mutate(r.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3" /> Снять
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ScheduledBroadcastWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        templateId={editId}
      />
    </div>
  );
}
