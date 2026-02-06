import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Mail,
  Edit2,
  CheckCircle,
  XCircle,
  Eye,
  Loader2,
  Server,
  Send as SendIcon,
  MessageSquare,
  HardDrive,
  RefreshCw,
  Play,
  AlertTriangle,
} from "lucide-react";
import { OlegSettingsSection } from "./OlegSettingsSection";

interface EmailTemplate {
  id: string;
  code: string;
  name: string;
  subject: string;
  body_html: string;
  variables: string[];
  is_active: boolean;
}

interface EmailAccount {
  id: string;
  email: string;
  display_name: string | null;
  provider: string;
  is_default: boolean;
  is_active: boolean;
  imap_enabled: boolean;
}

export function CommunicationSettingsTabContent() {
  const queryClient = useQueryClient();
  const [templateDialog, setTemplateDialog] = useState<{
    open: boolean;
    template: EmailTemplate | null;
  }>({ open: false, template: null });
  
  const [previewDialog, setPreviewDialog] = useState<{
    open: boolean;
    html: string;
    subject: string;
  }>({ open: false, html: "", subject: "" });

  const [isRunningWorker, setIsRunningWorker] = useState(false);

  // Fetch email templates
  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ["email-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as EmailTemplate[];
    },
  });

  // Fetch email accounts
  const { data: accounts = [], isLoading: loadingAccounts } = useQuery({
    queryKey: ["email-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_accounts")
        .select("id, email, display_name, provider, is_default, is_active, imap_enabled")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as EmailAccount[];
    },
  });

  // Fetch media pipeline stats
  const { data: mediaStats, refetch: refetchMediaStats, isLoading: loadingMediaStats } = useQuery({
    queryKey: ["media-pipeline-stats"],
    queryFn: async () => {
      // Get all jobs for counting
      const { data: jobs } = await supabase
        .from("media_jobs")
        .select("status, locked_at, updated_at");
      
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const jobStats = {
        pending: jobs?.filter(j => j.status === 'pending').length || 0,
        processing: jobs?.filter(j => j.status === 'processing').length || 0,
        ok: jobs?.filter(j => j.status === 'ok').length || 0,
        error: jobs?.filter(j => j.status === 'error').length || 0,
        stuckProcessing: jobs?.filter(j => 
          j.status === 'processing' && 
          j.locked_at && 
          new Date(j.locked_at) < fiveMinAgo
        ).length || 0,
        errorsLast24h: jobs?.filter(j => 
          j.status === 'error' && 
          j.updated_at && 
          new Date(j.updated_at) > oneDayAgo
        ).length || 0,
      };
      
      // Get last worker run
      const { data: lastRun } = await supabase
        .from("audit_logs")
        .select("created_at, meta")
        .eq("actor_label", "telegram-media-worker")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      
      return { jobStats, lastRun };
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const handleRunWorker = async () => {
    setIsRunningWorker(true);
    try {
      const { error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { action: "process_media_jobs", limit: 10 }
      });
      if (error) {
        toast.error(`Ошибка: ${error.message}`);
      } else {
        toast.success("Worker запущен");
        setTimeout(() => refetchMediaStats(), 2000);
      }
    } catch (e) {
      toast.error("Ошибка вызова worker");
    } finally {
      setIsRunningWorker(false);
    }
  };

  // Save template mutation
  const saveTemplateMutation = useMutation({
    mutationFn: async (template: Partial<EmailTemplate>) => {
      const { error } = await supabase
        .from("email_templates")
        .update({
          subject: template.subject,
          body_html: template.body_html,
          is_active: template.is_active,
        })
        .eq("id", template.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-templates"] });
      setTemplateDialog({ open: false, template: null });
      toast.success("Шаблон сохранен");
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  const handlePreview = (template: EmailTemplate) => {
    let html = template.body_html;
    let subject = template.subject;
    
    const exampleValues: Record<string, string> = {
      name: "Иван Иванов",
      email: "ivan@example.com",
      tempPassword: "TempPass123!",
      loginLink: "https://example.com/auth",
      resetLink: "https://example.com/reset",
      appName: "Gorbova Club",
      orderId: "ORD-12345",
      amount: "99.00",
      currency: "BYN",
      productName: "Подписка Pro",
      roleName: "Администратор",
    };
    
    template.variables.forEach((v) => {
      const value = exampleValues[v] || `{${v}}`;
      html = html.replace(new RegExp(`{{${v}}}`, "g"), value);
      subject = subject.replace(new RegExp(`{{${v}}}`, "g"), value);
    });
    
    setPreviewDialog({ open: true, html, subject });
  };

  const getStatusBadge = (isActive: boolean) => {
    if (isActive) {
      return (
        <Badge variant="default" className="bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30">
          <CheckCircle className="w-3 h-3 mr-1" />
          Активен
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <XCircle className="w-3 h-3 mr-1" />
        Отключен
      </Badge>
    );
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 md:p-6 space-y-6">
        {/* Email Templates Section */}
        <GlassCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Email-шаблоны</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Настройте содержимое системных email-уведомлений
          </p>

          {loadingTemplates ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Нет шаблонов</p>
            </div>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {templates.map((template) => (
                <AccordionItem key={template.id} value={template.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{template.name}</span>
                      {getStatusBadge(template.is_active)}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3 pt-2">
                      <div>
                        <span className="text-xs text-muted-foreground">Код:</span>
                        <code className="ml-2 text-xs bg-muted px-2 py-1 rounded">
                          {template.code}
                        </code>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Тема:</span>
                        <p className="text-sm mt-1">{template.subject}</p>
                      </div>
                      {template.variables?.length > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground">Переменные:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {template.variables.map((v) => (
                              <code key={v} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                {`{{${v}}}`}
                              </code>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePreview(template)}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          Превью
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => setTemplateDialog({ open: true, template })}
                        >
                          <Edit2 className="w-4 h-4 mr-1" />
                          Редактировать
                        </Button>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </GlassCard>

        {/* Email Accounts Summary */}
        <GlassCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Почтовые ящики (SMTP/IMAP)</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Подключенные почтовые аккаунты для отправки писем
          </p>

          {loadingAccounts ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              <p className="text-sm">Нет подключенных ящиков</p>
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                >
                  <div className="flex items-center gap-3">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">{account.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {account.provider}
                        {account.is_default && " • По умолчанию"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {account.imap_enabled && (
                      <Badge variant="outline" className="text-xs">IMAP</Badge>
                    )}
                    {getStatusBadge(account.is_active)}
                  </div>
                </div>
              ))}
            </div>
          )}
          
          <p className="text-xs text-muted-foreground mt-4">
            Для полного управления почтовыми ящиками используйте раздел «Email» → страница AdminEmail
          </p>
        </GlassCard>

        {/* Telegram Notifications Info */}
        <GlassCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Telegram-уведомления</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Системные уведомления администраторам через Telegram
          </p>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div className="flex items-center gap-3">
                <SendIcon className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">Уведомление о новых заказах</p>
                  <p className="text-xs text-muted-foreground">
                    Отправляется всем админам с привязанным Telegram
                  </p>
                </div>
              </div>
              <Badge variant="default" className="bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30">
                <CheckCircle className="w-3 h-3 mr-1" />
                Активно
              </Badge>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div className="flex items-center gap-3">
                <SendIcon className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">Уведомление о новых тикетах</p>
                  <p className="text-xs text-muted-foreground">
                    Отправляется при создании нового обращения
                  </p>
                </div>
              </div>
              <Badge variant="default" className="bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30">
                <CheckCircle className="w-3 h-3 mr-1" />
                Активно
              </Badge>
            </div>
          </div>

          <p className="text-xs text-muted-foreground mt-4">
            Для привязки Telegram используйте профиль пользователя в разделе «Клиенты»
          </p>
        </GlassCard>

        {/* AI Bot "Oleg" Settings */}
        <OlegSettingsSection />

        {/* Media Pipeline Health */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Media Pipeline</h2>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => refetchMediaStats()}
              disabled={loadingMediaStats}
            >
              <RefreshCw className={cn("w-4 h-4", loadingMediaStats && "animate-spin")} />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Обработка медиафайлов из Telegram
          </p>

          {loadingMediaStats ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="text-center p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                    {mediaStats?.jobStats?.pending || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {mediaStats?.jobStats?.processing || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Processing</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {mediaStats?.jobStats?.ok || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">OK</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {mediaStats?.jobStats?.error || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Error</p>
                </div>
              </div>

              {/* Warnings */}
              {(mediaStats?.jobStats?.stuckProcessing || 0) > 0 && (
                <div className="flex items-center gap-2 p-2 mb-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                  <AlertTriangle className="w-4 h-4 text-orange-500" />
                  <span className="text-sm text-orange-600 dark:text-orange-400">
                    {mediaStats.jobStats.stuckProcessing} job(s) stuck in processing &gt;5 min
                  </span>
                </div>
              )}

              {/* Last run info */}
              {mediaStats?.lastRun ? (
                <p className="text-xs text-muted-foreground mb-3">
                  Последний запуск: {format(new Date(mediaStats.lastRun.created_at), "dd.MM.yyyy HH:mm:ss")}
                  {(mediaStats.lastRun.meta as { ms?: number })?.ms && 
                    ` (${(mediaStats.lastRun.meta as { ms?: number }).ms}ms)`}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mb-3">
                  Worker ещё не запускался
                </p>
              )}

              {/* Run worker button */}
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleRunWorker}
                disabled={isRunningWorker}
              >
                {isRunningWorker ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-1" />
                )}
                Run Worker Now
              </Button>
            </>
          )}
        </GlassCard>
      </div>

      {/* Template Edit Dialog */}
      <Dialog
        open={templateDialog.open}
        onOpenChange={(open) => !open && setTemplateDialog({ open: false, template: null })}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Редактирование шаблона: {templateDialog.template?.name}
            </DialogTitle>
          </DialogHeader>

          {templateDialog.template && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Тема письма</Label>
                <Input
                  value={templateDialog.template.subject}
                  onChange={(e) =>
                    setTemplateDialog((prev) => ({
                      ...prev,
                      template: prev.template
                        ? { ...prev.template, subject: e.target.value }
                        : null,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>HTML-содержимое</Label>
                <Textarea
                  className="font-mono text-xs min-h-[300px]"
                  value={templateDialog.template.body_html}
                  onChange={(e) =>
                    setTemplateDialog((prev) => ({
                      ...prev,
                      template: prev.template
                        ? { ...prev.template, body_html: e.target.value }
                        : null,
                    }))
                  }
                />
              </div>

              {templateDialog.template.variables?.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Доступные переменные:
                  </Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {templateDialog.template.variables.map((v) => (
                      <code key={v} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {`{{${v}}}`}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Switch
                  checked={templateDialog.template.is_active}
                  onCheckedChange={(checked) =>
                    setTemplateDialog((prev) => ({
                      ...prev,
                      template: prev.template
                        ? { ...prev.template, is_active: checked }
                        : null,
                    }))
                  }
                />
                <Label>Активен</Label>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTemplateDialog({ open: false, template: null })}
            >
              Отмена
            </Button>
            <Button
              variant="outline"
              onClick={() => templateDialog.template && handlePreview(templateDialog.template)}
            >
              <Eye className="w-4 h-4 mr-1" />
              Превью
            </Button>
            <Button
              onClick={() => templateDialog.template && saveTemplateMutation.mutate(templateDialog.template)}
              disabled={saveTemplateMutation.isPending}
            >
              {saveTemplateMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              )}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog
        open={previewDialog.open}
        onOpenChange={(open) => !open && setPreviewDialog({ open: false, html: "", subject: "" })}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Превью: {previewDialog.subject}</DialogTitle>
          </DialogHeader>
          <div
            className="border rounded-lg p-4 bg-background"
            dangerouslySetInnerHTML={{ __html: previewDialog.html }}
          />
        </DialogContent>
      </Dialog>
    </ScrollArea>
  );
}
