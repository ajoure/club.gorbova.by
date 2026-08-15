import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { BroadcastTemplateCard, type BroadcastTemplate } from "./BroadcastTemplateCard";

interface BroadcastTemplatesSectionProps {
  onCreate: () => void;
  onEdit: (id: string) => void;
  onUse: (id: string) => void;
}

/**
 * Каталог шаблонов. Создание, редактирование, предпросмотр и отправка выполняются
 * единым редактором BroadcastsTabContent, чтобы настройки аудитории и медиа не
 * расходились между «быстрой рассылкой» и «шаблонами».
 */
export function BroadcastTemplatesSection({ onCreate, onEdit, onUse }: BroadcastTemplatesSectionProps) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"draft" | "scheduled" | "sent" | "archived">("draft");

  const { data: templates, isLoading } = useQuery({
    queryKey: ["broadcast-templates", statusFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("broadcast_templates")
        .select("*")
        .eq("status", statusFilter)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as BroadcastTemplate[];
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (template: BroadcastTemplate) => {
      const { error } = await supabase
        .from("broadcast_templates")
        .update({ status: "archived" })
        .eq("id", template.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Шаблон перемещён в архив");
      queryClient.invalidateQueries({ queryKey: ["broadcast-templates"] });
    },
    onError: () => toast.error("Не удалось переместить шаблон в архив"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">📋 Шаблоны рассылок</h2>
          <p className="text-sm text-muted-foreground">
            Шаблон использует тот же редактор, медиа, предпросмотр и аудиторию, что и обычная рассылка.
          </p>
        </div>
        <Button onClick={onCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Создать шаблон
        </Button>
      </div>

      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
        <TabsList>
          <TabsTrigger value="draft">Черновики</TabsTrigger>
          <TabsTrigger value="scheduled">Запланированные</TabsTrigger>
          <TabsTrigger value="sent">Отправленные</TabsTrigger>
          <TabsTrigger value="archived">Архив</TabsTrigger>
        </TabsList>

        <TabsContent value={statusFilter} className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : templates?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {statusFilter === "draft" && "Нет черновиков. Создайте новый шаблон."}
              {statusFilter === "scheduled" && "Нет запланированных рассылок."}
              {statusFilter === "sent" && "Нет отправленных рассылок."}
              {statusFilter === "archived" && "Архив пуст."}
            </div>
          ) : (
            <div className="grid gap-4">
              {templates?.map((template) => (
                <BroadcastTemplateCard
                  key={template.id}
                  template={template}
                  onEdit={() => onEdit(template.id)}
                  onSend={() => onUse(template.id)}
                  onArchive={() => archiveMutation.mutate(template)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
