import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  BroadcastTemplateCard,
  type BroadcastTemplate,
} from "./BroadcastTemplateCard";
import { BroadcastTemplateDialog } from "./BroadcastTemplateDialog";
import { BroadcastSendDialog } from "./BroadcastSendDialog";

interface BroadcastFilters {
  hasActiveSubscription: boolean;
  hasTelegram: boolean;
  hasEmail: boolean;
  productId: string;
  tariffId: string;
  clubId: string;
}

export function BroadcastTemplatesSection() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"draft" | "scheduled" | "sent" | "archived">("draft");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<BroadcastTemplate | null>(null);

  // Fetch templates
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

  // Save template mutation
  const saveMutation = useMutation({
    mutationFn: async (data: Partial<BroadcastTemplate>) => {
      if (data.id) {
        const { error } = await supabase
          .from("broadcast_templates")
          .update({
            name: data.name,
            channel: data.channel,
            message_text: data.message_text,
            button_text: data.button_text,
            button_url: data.button_url,
            email_subject: data.email_subject,
            email_body_html: data.email_body_html,
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("broadcast_templates").insert({
          name: data.name,
          channel: data.channel,
          message_text: data.message_text,
          button_text: data.button_text,
          button_url: data.button_url,
          email_subject: data.email_subject,
          email_body_html: data.email_body_html,
          status: "draft",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Шаблон сохранён");
      setEditDialogOpen(false);
      setSelectedTemplate(null);
      queryClient.invalidateQueries({ queryKey: ["broadcast-templates"] });
    },
    onError: (error) => {
      toast.error("Ошибка сохранения: " + (error as Error).message);
    },
  });

  // Archive template mutation
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
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  // Send broadcast mutation
  const sendMutation = useMutation({
    mutationFn: async ({
      template,
      filters,
    }: {
      template: BroadcastTemplate;
      filters: BroadcastFilters;
    }) => {
      if (template.channel === "telegram") {
        const { data, error } = await supabase.functions.invoke(
          "telegram-mass-broadcast",
          {
            body: {
              message: template.message_text,
              include_button: !!template.button_url,
              button_text: template.button_text,
              button_url: template.button_url,
              filters,
            },
          }
        );
        if (error) throw error;

        // Update template stats
        await supabase
          .from("broadcast_templates")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            sent_count: data.sent || 0,
            failed_count: data.failed || 0,
          })
          .eq("id", template.id);

        return data;
      } else {
        const { data, error } = await supabase.functions.invoke(
          "email-mass-broadcast",
          {
            body: {
              subject: template.email_subject,
              html: template.email_body_html,
              filters,
            },
          }
        );
        if (error) throw error;

        // Update template stats
        await supabase
          .from("broadcast_templates")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            sent_count: data.sent || 0,
            failed_count: data.failed || 0,
          })
          .eq("id", template.id);

        return data;
      }
    },
    onSuccess: (data) => {
      toast.success(`Отправлено: ${data.sent}, ошибок: ${data.failed}`);
      setSendDialogOpen(false);
      setSelectedTemplate(null);
      queryClient.invalidateQueries({ queryKey: ["broadcast-templates"] });
      queryClient.invalidateQueries({ queryKey: ["broadcast-history"] });
    },
    onError: (error) => {
      toast.error("Ошибка отправки: " + (error as Error).message);
    },
  });

  const handleEdit = (template: BroadcastTemplate) => {
    setSelectedTemplate(template);
    setEditDialogOpen(true);
  };

  const handleSend = (template: BroadcastTemplate) => {
    setSelectedTemplate(template);
    setSendDialogOpen(true);
  };

  const handleArchive = (template: BroadcastTemplate) => {
    archiveMutation.mutate(template);
  };

  const handleCreate = () => {
    setSelectedTemplate(null);
    setEditDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">📋 Шаблоны рассылок</h2>
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Создать шаблон
        </Button>
      </div>

      <Tabs
        value={statusFilter}
        onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
      >
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
                  onEdit={handleEdit}
                  onSend={handleSend}
                  onArchive={handleArchive}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <BroadcastTemplateDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        template={selectedTemplate}
        onSave={(data) => saveMutation.mutateAsync(data)}
        isSaving={saveMutation.isPending}
      />

      <BroadcastSendDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        template={selectedTemplate}
        onSend={(template, filters) =>
          sendMutation.mutateAsync({ template, filters })
        }
        isSending={sendMutation.isPending}
      />
    </div>
  );
}
