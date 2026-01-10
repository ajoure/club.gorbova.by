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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import {
  Plus,
  Mail,
  Edit2,
  Trash2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Send,
  Eye,
  Loader2,
  Server,
  ChevronDown,
  Settings2,
  Download,
  Inbox,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { HelpIcon, HelpLabel } from "@/components/help/HelpComponents";

interface EmailAccount {
  id: string;
  email: string;
  display_name: string | null;
  provider: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_encryption: string | null;
  smtp_username: string | null;
  smtp_password: string | null;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  is_default: boolean;
  is_active: boolean;
  use_for: string[];
  created_at: string;
  // IMAP fields
  imap_host: string | null;
  imap_port: number | null;
  imap_encryption: string | null;
  imap_enabled: boolean;
  last_fetched_at: string | null;
}

interface EmailTemplate {
  id: string;
  code: string;
  name: string;
  subject: string;
  body_html: string;
  variables: string[];
  is_active: boolean;
  created_at: string;
}

const USE_FOR_OPTIONS = [
  { value: "system", label: "Системные уведомления" },
  { value: "password", label: "Пароли" },
  { value: "receipts", label: "Чеки" },
  { value: "support", label: "Поддержка" },
];

// Auto-detect SMTP settings based on email domain
const getSmtpSettings = (email: string) => {
  const domain = email.split("@")[1]?.toLowerCase();
  
  const smtpConfigs: Record<string, { host: string; port: number; encryption: string }> = {
    // Yandex
    "yandex.ru": { host: "smtp.yandex.ru", port: 465, encryption: "SSL" },
    "yandex.com": { host: "smtp.yandex.ru", port: 465, encryption: "SSL" },
    "ya.ru": { host: "smtp.yandex.ru", port: 465, encryption: "SSL" },
    // Gmail
    "gmail.com": { host: "smtp.gmail.com", port: 465, encryption: "SSL" },
    "googlemail.com": { host: "smtp.gmail.com", port: 465, encryption: "SSL" },
    // Mail.ru
    "mail.ru": { host: "smtp.mail.ru", port: 465, encryption: "SSL" },
    "inbox.ru": { host: "smtp.mail.ru", port: 465, encryption: "SSL" },
    "list.ru": { host: "smtp.mail.ru", port: 465, encryption: "SSL" },
    "bk.ru": { host: "smtp.mail.ru", port: 465, encryption: "SSL" },
    // Outlook/Hotmail
    "outlook.com": { host: "smtp.office365.com", port: 587, encryption: "TLS" },
    "hotmail.com": { host: "smtp.office365.com", port: 587, encryption: "TLS" },
    "live.com": { host: "smtp.office365.com", port: 587, encryption: "TLS" },
    // iCloud
    "icloud.com": { host: "smtp.mail.me.com", port: 587, encryption: "TLS" },
    "me.com": { host: "smtp.mail.me.com", port: 587, encryption: "TLS" },
    // Tut.by / Yandex Belarus
    "tut.by": { host: "smtp.yandex.ru", port: 465, encryption: "SSL" },
  };

  return smtpConfigs[domain] || null;
};

// Auto-detect IMAP settings based on email domain  
const getImapSettings = (email: string) => {
  const domain = email.split("@")[1]?.toLowerCase();
  
  const imapConfigs: Record<string, { host: string; port: number }> = {
    "gmail.com": { host: "imap.gmail.com", port: 993 },
    "googlemail.com": { host: "imap.gmail.com", port: 993 },
    "yandex.ru": { host: "imap.yandex.ru", port: 993 },
    "yandex.com": { host: "imap.yandex.com", port: 993 },
    "ya.ru": { host: "imap.yandex.ru", port: 993 },
    "mail.ru": { host: "imap.mail.ru", port: 993 },
    "inbox.ru": { host: "imap.mail.ru", port: 993 },
    "list.ru": { host: "imap.mail.ru", port: 993 },
    "bk.ru": { host: "imap.mail.ru", port: 993 },
    "outlook.com": { host: "outlook.office365.com", port: 993 },
    "hotmail.com": { host: "outlook.office365.com", port: 993 },
    "live.com": { host: "outlook.office365.com", port: 993 },
  };

  return imapConfigs[domain] || null;
};

const getProviderName = (email: string): string => {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "smtp";
  
  if (["yandex.ru", "yandex.com", "ya.ru", "tut.by"].includes(domain)) return "Yandex";
  if (["gmail.com", "googlemail.com"].includes(domain)) return "Gmail";
  if (["mail.ru", "inbox.ru", "list.ru", "bk.ru"].includes(domain)) return "Mail.ru";
  if (["outlook.com", "hotmail.com", "live.com"].includes(domain)) return "Outlook";
  if (["icloud.com", "me.com"].includes(domain)) return "iCloud";
  
  return "SMTP";
};

export default function AdminEmail() {
  const queryClient = useQueryClient();
  const [accountDialog, setAccountDialog] = useState<{
    open: boolean;
    account: Partial<EmailAccount> | null;
  }>({ open: false, account: null });
  
  const [templateDialog, setTemplateDialog] = useState<{
    open: boolean;
    template: EmailTemplate | null;
  }>({ open: false, template: null });
  
  const [previewDialog, setPreviewDialog] = useState<{
    open: boolean;
    html: string;
    subject: string;
  }>({ open: false, html: "", subject: "" });
  
  const [testingSend, setTestingSend] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showImapSettings, setShowImapSettings] = useState(false);
  const [fetchingEmail, setFetchingEmail] = useState<string | null>(null);

  // Fetch email accounts
  const { data: accounts = [], isLoading: loadingAccounts } = useQuery({
    queryKey: ["email-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_accounts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as EmailAccount[];
    },
  });

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

  // Save account mutation
  const saveAccountMutation = useMutation({
    mutationFn: async (account: Partial<EmailAccount>) => {
      if (account.id) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, created_at, ...updateData } = account;
        const { error } = await supabase
          .from("email_accounts")
          .update(updateData as Record<string, unknown>)
          .eq("id", account.id);
        if (error) throw error;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, created_at: _createdAt, ...insertData } = account;
        if (!insertData.email) throw new Error("Email обязателен");
        
        // Auto-detect SMTP settings
        const smtpSettings = getSmtpSettings(insertData.email);
        const provider = getProviderName(insertData.email);
        
        const insertPayload = {
          email: insertData.email,
          display_name: insertData.display_name || null,
          provider: provider,
          smtp_host: insertData.smtp_host || smtpSettings?.host || null,
          smtp_port: insertData.smtp_port || smtpSettings?.port || 465,
          smtp_encryption: insertData.smtp_encryption || smtpSettings?.encryption || "SSL",
          smtp_username: insertData.smtp_username || insertData.email,
          smtp_password: insertData.smtp_password || null,
          from_name: insertData.from_name || null,
          from_email: insertData.from_email || insertData.email,
          reply_to: insertData.reply_to || null,
          is_default: insertData.is_default ?? false,
          is_active: insertData.is_active ?? true,
        };
        const { error } = await supabase.from("email_accounts").insert([insertPayload]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-accounts"] });
      setAccountDialog({ open: false, account: null });
      toast.success("Почтовый ящик сохранен");
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  // Delete account mutation
  const deleteAccountMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("email_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-accounts"] });
      toast.success("Почтовый ящик удален");
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

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

  // Test send mutation
  const testSendMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) throw new Error("Аккаунт не найден");
      
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user?.email) throw new Error("Email пользователя не найден");

      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          to: userData.user.email,
          subject: "Тестовое письмо",
          html: `<h1>Тестовое письмо</h1><p>Это тестовое письмо от ${account.from_name || account.email}</p>`,
          account_id: accountId,
        },
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Тестовое письмо отправлено");
    },
    onError: (error: Error) => {
      toast.error(`Ошибка отправки: ${error.message}`);
    },
    onSettled: () => {
      setTestingSend(null);
    },
  });

  // Fetch inbox mutation  
  const fetchInboxMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await supabase.functions.invoke("email-fetch-inbox", {
        body: { account_id: accountId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const total = data.results?.reduce((sum: number, r: { fetched?: number }) => sum + (r.fetched || 0), 0) || 0;
      if (total > 0) {
        toast.success(`Получено ${total} новых писем`);
      } else {
        toast.info("Новых писем нет");
      }
      queryClient.invalidateQueries({ queryKey: ["email-accounts"] });
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
    onSettled: () => {
      setFetchingEmail(null);
    },
  });

  const handleFetchInbox = (accountId: string) => {
    setFetchingEmail(accountId);
    fetchInboxMutation.mutate(accountId);
  };

  const handleTestSend = (accountId: string) => {
    setTestingSend(accountId);
    testSendMutation.mutate(accountId);
  };

  const getStatusBadge = (isActive: boolean) => {
    if (isActive) {
      return (
        <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/30">
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

  const handlePreview = (template: EmailTemplate) => {
    // Replace variables with example values
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

  return (
    <div className="space-y-6">
      {/* Email Accounts Section */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Почтовые ящики</h2>
            <HelpIcon helpKey="email.smtp" alwaysShow />
          </div>
          <Button
            onClick={() =>
              setAccountDialog({
                open: true,
                account: {
                  provider: "smtp",
                  smtp_port: 465,
                  smtp_encryption: "SSL",
                  is_active: true,
                  is_default: false,
                  use_for: [],
                },
              })
            }
          >
            <Plus className="w-4 h-4 mr-2" />
            Добавить ящик
          </Button>
        </div>

        {loadingAccounts ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Mail className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>Нет подключенных почтовых ящиков</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Провайдер</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Используется для</TableHead>
                <TableHead>По умолчанию</TableHead>
                <TableHead className="w-[120px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{account.email}</div>
                      {account.from_name && (
                        <div className="text-sm text-muted-foreground">
                          {account.from_name}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {account.provider === "smtp" ? "SMTP" : account.provider}
                    </Badge>
                  </TableCell>
                  <TableCell>{getStatusBadge(account.is_active)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {account.use_for?.map((u) => (
                        <Badge key={u} variant="secondary" className="text-xs">
                          {USE_FOR_OPTIONS.find((o) => o.value === u)?.label || u}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {account.is_default && (
                      <Badge className="bg-primary/20 text-primary border-primary/30">
                        По умолчанию
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {account.imap_enabled && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleFetchInbox(account.id)}
                          disabled={fetchingEmail === account.id}
                          title="Загрузить входящие"
                        >
                          {fetchingEmail === account.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleTestSend(account.id)}
                        disabled={testingSend === account.id}
                        title="Отправить тестовое письмо"
                      >
                        {testingSend === account.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setAccountDialog({ open: true, account })}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteAccountMutation.mutate(account.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </GlassCard>

      {/* Email Templates Section */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Шаблоны писем</h2>
        </div>

        {loadingTemplates ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>Нет шаблонов писем</p>
          </div>
        ) : (
          <Accordion type="single" collapsible className="w-full">
            {templates.map((template) => (
              <AccordionItem key={template.id} value={template.id}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3 text-left">
                    <div className="flex-1">
                      <div className="font-medium">{template.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {template.code}
                      </div>
                    </div>
                    {getStatusBadge(template.is_active)}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4 pt-2">
                    <div>
                      <Label className="text-muted-foreground">Тема письма</Label>
                      <p className="mt-1">{template.subject}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Переменные</Label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {template.variables.map((v) => (
                          <code key={v} className="px-2 py-0.5 bg-muted rounded text-xs">
                            {`{{${v}}}`}
                          </code>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePreview(template)}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        Превью
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setTemplateDialog({ open: true, template })
                        }
                      >
                        <Edit2 className="w-4 h-4 mr-2" />
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

      {/* Account Dialog */}
      <Dialog
        open={accountDialog.open}
        onOpenChange={(open) =>
          !open && setAccountDialog({ open: false, account: null })
        }
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {accountDialog.account?.id
                ? "Редактировать почтовый ящик"
                : "Добавить почтовый ящик"}
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (accountDialog.account) {
                saveAccountMutation.mutate(accountDialog.account);
              }
            }}
            className="space-y-4"
          >
            {/* Simple form - just email and password */}
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                required
                type="email"
                placeholder="your@email.com"
                value={accountDialog.account?.email || ""}
                onChange={(e) => {
                  const email = e.target.value;
                  const smtpSettings = getSmtpSettings(email);
                  const provider = getProviderName(email);
                  setAccountDialog((prev) => ({
                    ...prev,
                    account: { 
                      ...prev.account, 
                      email,
                      // Auto-fill SMTP settings when email changes
                      ...(smtpSettings && !prev.account?.id ? {
                        smtp_host: smtpSettings.host,
                        smtp_port: smtpSettings.port,
                        smtp_encryption: smtpSettings.encryption,
                        provider: provider,
                        smtp_username: email,
                        from_email: email,
                      } : {}),
                    },
                  }));
                }}
              />
              {accountDialog.account?.email && getSmtpSettings(accountDialog.account.email) && (
                <p className="text-xs text-muted-foreground">
                  Настройки SMTP для {getProviderName(accountDialog.account.email)} будут применены автоматически
                </p>
              )}
              {accountDialog.account?.email && !getSmtpSettings(accountDialog.account.email) && accountDialog.account.email.includes("@") && (
                <p className="text-xs text-amber-500">
                  Неизвестный провайдер — настройте SMTP вручную в дополнительных настройках
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Пароль приложения</Label>
              <Input
                required={!accountDialog.account?.id}
                name="smtp_app_password"
                type="text"
                placeholder="Пароль или App Password"
                value={accountDialog.account?.smtp_password || ""}
                onChange={(e) =>
                  setAccountDialog((prev) => ({
                    ...prev,
                    account: { ...prev.account, smtp_password: e.target.value },
                  }))
                }
                className="[&:not(:placeholder-shown)]:[-webkit-text-security:disc]"
              />
              <p className="text-xs text-muted-foreground">
                Для Gmail, Yandex и других рекомендуется использовать пароль приложения
              </p>
            </div>

            <div className="space-y-2">
              <Label>Имя отправителя</Label>
              <Input
                placeholder="Gorbova Club"
                value={accountDialog.account?.from_name || ""}
                onChange={(e) =>
                  setAccountDialog((prev) => ({
                    ...prev,
                    account: { ...prev.account, from_name: e.target.value },
                  }))
                }
              />
            </div>

            {/* Advanced settings - collapsible */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span className="flex items-center gap-2">
                    <Settings2 className="w-4 h-4" />
                    Дополнительные настройки
                  </span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label>SMTP Host</Label>
                    <Input
                      value={accountDialog.account?.smtp_host || ""}
                      onChange={(e) =>
                        setAccountDialog((prev) => ({
                          ...prev,
                          account: { ...prev.account, smtp_host: e.target.value },
                        }))
                      }
                      placeholder="smtp.yandex.ru"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input
                      type="number"
                      value={accountDialog.account?.smtp_port || 465}
                      onChange={(e) =>
                        setAccountDialog((prev) => ({
                          ...prev,
                          account: {
                            ...prev.account,
                            smtp_port: parseInt(e.target.value) || 465,
                          },
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Encryption</Label>
                    <Select
                      value={accountDialog.account?.smtp_encryption || "SSL"}
                      onValueChange={(value) =>
                        setAccountDialog((prev) => ({
                          ...prev,
                          account: { ...prev.account, smtp_encryption: value },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SSL">SSL</SelectItem>
                        <SelectItem value="TLS">TLS</SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>SMTP Username</Label>
                    <Input
                      value={accountDialog.account?.smtp_username || ""}
                      onChange={(e) =>
                        setAccountDialog((prev) => ({
                          ...prev,
                          account: { ...prev.account, smtp_username: e.target.value },
                        }))
                      }
                      placeholder={accountDialog.account?.email || ""}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Reply-To (опционально)</Label>
                  <Input
                    type="email"
                    value={accountDialog.account?.reply_to || ""}
                    onChange={(e) =>
                      setAccountDialog((prev) => ({
                        ...prev,
                        account: { ...prev.account, reply_to: e.target.value },
                      }))
                    }
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* IMAP Settings */}
            <Collapsible open={showImapSettings} onOpenChange={setShowImapSettings}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span className="flex items-center gap-2">
                    <Inbox className="w-4 h-4" />
                    Входящая почта (IMAP)
                  </span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showImapSettings ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={accountDialog.account?.imap_enabled ?? false}
                    onCheckedChange={(checked) => {
                      const imapSettings = accountDialog.account?.email ? getImapSettings(accountDialog.account.email) : null;
                      setAccountDialog((prev) => ({
                        ...prev,
                        account: { 
                          ...prev.account, 
                          imap_enabled: checked,
                          ...(checked && imapSettings && !prev.account?.imap_host ? {
                            imap_host: imapSettings.host,
                            imap_port: imapSettings.port,
                          } : {}),
                        },
                      }));
                    }}
                  />
                  <Label>Получать входящие письма</Label>
                </div>

                {accountDialog.account?.imap_enabled && (
                  <>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2 col-span-2">
                        <Label>IMAP Host</Label>
                        <Input
                          value={accountDialog.account?.imap_host || ""}
                          onChange={(e) =>
                            setAccountDialog((prev) => ({
                              ...prev,
                              account: { ...prev.account, imap_host: e.target.value },
                            }))
                          }
                          placeholder="imap.yandex.ru"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Port</Label>
                        <Input
                          type="number"
                          value={accountDialog.account?.imap_port || 993}
                          onChange={(e) =>
                            setAccountDialog((prev) => ({
                              ...prev,
                              account: { ...prev.account, imap_port: parseInt(e.target.value) || 993 },
                            }))
                          }
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Используется тот же пароль, что и для SMTP
                    </p>
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={accountDialog.account?.is_active ?? true}
                  onCheckedChange={(checked) =>
                    setAccountDialog((prev) => ({
                      ...prev,
                      account: { ...prev.account, is_active: checked },
                    }))
                  }
                />
                <Label>Активен</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={accountDialog.account?.is_default ?? false}
                  onCheckedChange={(checked) =>
                    setAccountDialog((prev) => ({
                      ...prev,
                      account: { ...prev.account, is_default: checked },
                    }))
                  }
                />
                <Label>По умолчанию</Label>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAccountDialog({ open: false, account: null })}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={saveAccountMutation.isPending}>
                {saveAccountMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Template Edit Dialog */}
      <Dialog
        open={templateDialog.open}
        onOpenChange={(open) =>
          !open && setTemplateDialog({ open: false, template: null })
        }
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Редактировать шаблон: {templateDialog.template?.name}</DialogTitle>
          </DialogHeader>

          {templateDialog.template && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (templateDialog.template) {
                  saveTemplateMutation.mutate(templateDialog.template);
                }
              }}
              className="space-y-4"
            >
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
                <Label>Доступные переменные</Label>
                <div className="flex flex-wrap gap-1">
                  {templateDialog.template.variables.map((v) => (
                    <code
                      key={v}
                      className="px-2 py-0.5 bg-muted rounded text-xs cursor-pointer hover:bg-muted/80"
                      onClick={() => {
                        // Copy to clipboard
                        navigator.clipboard.writeText(`{{${v}}}`);
                        toast.success(`Скопировано: {{${v}}}`);
                      }}
                    >
                      {`{{${v}}}`}
                    </code>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Тело письма (HTML)</Label>
                <Textarea
                  rows={12}
                  className="font-mono text-sm"
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

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handlePreview(templateDialog.template!)}
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Превью
                </Button>
                <Button type="submit" disabled={saveTemplateMutation.isPending}>
                  {saveTemplateMutation.isPending && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  Сохранить
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog
        open={previewDialog.open}
        onOpenChange={(open) =>
          !open && setPreviewDialog({ open: false, html: "", subject: "" })
        }
      >
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Превью письма</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Тема:</Label>
              <p className="font-medium">{previewDialog.subject}</p>
            </div>
            <div className="border rounded-lg p-4 bg-white text-black max-h-[400px] overflow-y-auto">
              <div dangerouslySetInnerHTML={{ __html: previewDialog.html }} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
