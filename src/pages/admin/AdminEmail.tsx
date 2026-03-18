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
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { HelpIcon } from "@/components/help/HelpComponents";
import { 
  ALLOWED_TEMPLATE_VARIABLES, 
  validateTemplateVariables, 
  renderTemplatePreview 
} from "@/lib/email-template-validation";
import { resolveTokens } from "@/lib/token-resolver";
import { ProductEmailMappings } from "@/components/admin/ProductEmailMappings";
import { TokenizedRichInput } from "@/components/admin/TokenizedRichInput";
import { SafeHtml } from "@/components/ui/SafeHtml";

// Interfaces and helper functions

interface EmailAccount {
  id: string;
  email: string;
  display_name: string | null;
  provider: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_encryption: string | null;
  smtp_username: string | null;
  has_password: boolean;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  is_default: boolean;
  is_active: boolean;
  use_for: string[];
  created_at: string;
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

const getSmtpSettings = (email: string) => {
  const domain = email.split("@")[1]?.toLowerCase();
  const smtpConfigs: Record<string, { host: string; port: number; encryption: string }> = {
    "yandex.ru": { host: "smtp.yandex.ru", port: 465, encryption: "SSL" },
    "yandex.com": { host: "smtp.yandex.ru", port: 465, encryption: "SSL" },
    "ya.ru": { host: "smtp.yandex.ru", port: 465, encryption: "SSL" },
    "gmail.com": { host: "smtp.gmail.com", port: 465, encryption: "SSL" },
    "googlemail.com": { host: "smtp.gmail.com", port: 465, encryption: "SSL" },
    "mail.ru": { host: "smtp.mail.ru", port: 465, encryption: "SSL" },
    "inbox.ru": { host: "smtp.mail.ru", port: 465, encryption: "SSL" },
    "list.ru": { host: "smtp.mail.ru", port: 465, encryption: "SSL" },
    "bk.ru": { host: "smtp.mail.ru", port: 465, encryption: "SSL" },
    "outlook.com": { host: "smtp.office365.com", port: 587, encryption: "TLS" },
    "hotmail.com": { host: "smtp.office365.com", port: 587, encryption: "TLS" },
    "live.com": { host: "smtp.office365.com", port: 587, encryption: "TLS" },
    "icloud.com": { host: "smtp.mail.me.com", port: 587, encryption: "TLS" },
    "me.com": { host: "smtp.mail.me.com", port: 587, encryption: "TLS" },
    "tut.by": { host: "smtp.yandex.ru", port: 465, encryption: "SSL" },
  };
  return smtpConfigs[domain] || null;
};

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
  const [testingImap, setTestingImap] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showImapSettings, setShowImapSettings] = useState(false);
  const [templateValidationError, setTemplateValidationError] = useState<string | null>(null);
  const [fetchingEmail, setFetchingEmail] = useState<string | null>(null);
  const [previewProductId, setPreviewProductId] = useState<string>("");

  // Fetch products for preview context
  const { data: productsForPreview = [] } = useQuery({
    queryKey: ["products-for-email-preview"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

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
    onSuccess: () => { toast.success("Тестовое письмо отправлено"); },
    onError: (error: Error) => { toast.error(`Ошибка отправки: ${error.message}`); },
    onSettled: () => { setTestingSend(null); },
  });

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
      if (total > 0) { toast.success(`Получено ${total} новых писем`); }
      else { toast.info("Новых писем нет"); }
      queryClient.invalidateQueries({ queryKey: ["email-accounts"] });
    },
    onError: (error: Error) => { toast.error(`Ошибка: ${error.message}`); },
    onSettled: () => { setFetchingEmail(null); },
  });

  const handleFetchInbox = (accountId: string) => {
    setFetchingEmail(accountId);
    fetchInboxMutation.mutate(accountId);
  };

  const handleTestSend = (accountId: string) => {
    setTestingSend(accountId);
    testSendMutation.mutate(accountId);
  };

  const testImapMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await supabase.functions.invoke("email-test-connection", {
        body: { account_id: accountId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data.success) { toast.success(data.message || "IMAP подключение успешно!"); }
      else { toast.error(data.error || "Ошибка подключения IMAP"); }
    },
    onError: (error: Error) => { toast.error(`Ошибка: ${error.message}`); },
    onSettled: () => { setTestingImap(null); },
  });

  const handleTestImap = (accountId: string) => {
    setTestingImap(accountId);
    testImapMutation.mutate(accountId);
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

  const handlePreview = async (template: EmailTemplate) => {
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
    const ctx = previewProductId && previewProductId !== "__none__" ? { productId: previewProductId } : {};
    html = await resolveTokens(html, ctx);
    subject = await resolveTokens(subject, ctx);
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
            <p>Нет настроенных почтовых ящиков</p>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{account.email}</span>
                      {account.is_default && (
                        <Badge variant="outline" className="text-xs">
                          По умолчанию
                        </Badge>
                      )}
                      {getStatusBadge(account.is_active)}
                      {account.imap_enabled ? (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Wifi className="w-3 h-3" /> IMAP
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs gap-1 opacity-50">
                          <WifiOff className="w-3 h-3" /> IMAP
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {account.provider} • {account.display_name || "Без имени"}
                      {account.last_fetched_at && (
                        <> • Последняя проверка: {new Date(account.last_fetched_at).toLocaleString("ru")}</>
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {account.imap_enabled && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleFetchInbox(account.id)}
                        disabled={fetchingEmail === account.id}
                      >
                        {fetchingEmail === account.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestImap(account.id)}
                        disabled={testingImap === account.id}
                      >
                        {testingImap === account.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Inbox className="w-4 h-4" />
                        )}
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTestSend(account.id)}
                    disabled={testingSend === account.id}
                  >
                    {testingSend === account.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setAccountDialog({ open: true, account: { ...account } })
                    }
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm("Удалить этот почтовый ящик?")) {
                        deleteAccountMutation.mutate(account.id);
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Email Templates Section */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <Settings2 className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Шаблоны писем</h2>
          <HelpIcon helpKey="email.templates" alwaysShow />
        </div>

        {loadingTemplates ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>Нет шаблонов</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Код</TableHead>
                <TableHead>Тема</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {template.code}
                    </code>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {template.subject}
                  </TableCell>
                  <TableCell>{getStatusBadge(template.is_active)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePreview(template)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setTemplateDialog({
                            open: true,
                            template: { ...template },
                          })
                        }
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </GlassCard>

      {/* Product Email Mappings */}
      <ProductEmailMappings accounts={accounts} />

      {/* Account Edit Dialog */}
      <Dialog
        open={accountDialog.open}
        onOpenChange={(open) =>
          !open && setAccountDialog({ open: false, account: null })
        }
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {accountDialog.account?.id
                ? "Редактировать почтовый ящик"
                : "Добавить почтовый ящик"}
            </DialogTitle>
          </DialogHeader>

          {accountDialog.account && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (accountDialog.account) {
                  saveAccountMutation.mutate(accountDialog.account);
                }
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={accountDialog.account.email || ""}
                  onChange={(e) => {
                    const email = e.target.value;
                    const smtpSettings = getSmtpSettings(email);
                    const imapSettings = getImapSettings(email);
                    setAccountDialog((prev) => ({
                      ...prev,
                      account: {
                        ...prev.account,
                        email,
                        smtp_username: prev.account?.smtp_username || email,
                        from_email: prev.account?.from_email || email,
                        ...(smtpSettings && !prev.account?.smtp_host
                          ? {
                              smtp_host: smtpSettings.host,
                              smtp_port: smtpSettings.port,
                              smtp_encryption: smtpSettings.encryption,
                            }
                          : {}),
                        ...(imapSettings && !prev.account?.imap_host
                          ? {
                              imap_host: imapSettings.host,
                              imap_port: imapSettings.port,
                            }
                          : {}),
                      },
                    }));
                  }}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Имя отправителя</Label>
                  <Input
                    value={accountDialog.account.display_name || ""}
                    onChange={(e) =>
                      setAccountDialog((prev) => ({
                        ...prev,
                        account: { ...prev.account, display_name: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>From Email</Label>
                  <Input
                    value={accountDialog.account.from_email || ""}
                    onChange={(e) =>
                      setAccountDialog((prev) => ({
                        ...prev,
                        account: { ...prev.account, from_email: e.target.value },
                      }))
                    }
                  />
                </div>
              </div>

              <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" type="button" className="gap-1">
                    <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                    SMTP настройки
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 mt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>SMTP Host</Label>
                      <Input
                        value={accountDialog.account.smtp_host || ""}
                        onChange={(e) =>
                          setAccountDialog((prev) => ({
                            ...prev,
                            account: { ...prev.account, smtp_host: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>SMTP Port</Label>
                      <Input
                        type="number"
                        value={accountDialog.account.smtp_port || 465}
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
                      <Label>SMTP Username</Label>
                      <Input
                        value={accountDialog.account.smtp_username || ""}
                        onChange={(e) =>
                          setAccountDialog((prev) => ({
                            ...prev,
                            account: { ...prev.account, smtp_username: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>SMTP Password</Label>
                      <Input
                        type="password"
                        value={accountDialog.account.smtp_password || ""}
                        onChange={(e) =>
                          setAccountDialog((prev) => ({
                            ...prev,
                            account: { ...prev.account, smtp_password: e.target.value },
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Шифрование</Label>
                    <Select
                      value={accountDialog.account.smtp_encryption || "SSL"}
                      onValueChange={(v) =>
                        setAccountDialog((prev) => ({
                          ...prev,
                          account: { ...prev.account, smtp_encryption: v },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SSL">SSL</SelectItem>
                        <SelectItem value="TLS">TLS</SelectItem>
                        <SelectItem value="NONE">Без шифрования</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={showImapSettings} onOpenChange={setShowImapSettings}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" type="button" className="gap-1">
                    <ChevronDown className={`w-4 h-4 transition-transform ${showImapSettings ? "rotate-180" : ""}`} />
                    IMAP настройки (входящие)
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 mt-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={accountDialog.account.imap_enabled ?? false}
                      onCheckedChange={(checked) =>
                        setAccountDialog((prev) => ({
                          ...prev,
                          account: { ...prev.account, imap_enabled: checked },
                        }))
                      }
                    />
                    <Label>Включить IMAP</Label>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>IMAP Host</Label>
                      <Input
                        value={accountDialog.account.imap_host || ""}
                        onChange={(e) =>
                          setAccountDialog((prev) => ({
                            ...prev,
                            account: { ...prev.account, imap_host: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>IMAP Port</Label>
                      <Input
                        type="number"
                        value={accountDialog.account.imap_port || 993}
                        onChange={(e) =>
                          setAccountDialog((prev) => ({
                            ...prev,
                            account: { ...prev.account, imap_port: parseInt(e.target.value) || 993 },
                          }))
                        }
                      />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={accountDialog.account.is_active ?? true}
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
                    checked={accountDialog.account.is_default ?? false}
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
          )}
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
                  const fullText = templateDialog.template.subject + templateDialog.template.body_html;
                  const validation = validateTemplateVariables(fullText);
                  if (!validation.valid) {
                    const errors = [
                      ...validation.invalidVariables,
                      ...validation.invalidCfTokens,
                    ];
                    setTemplateValidationError(`Недопустимые переменные: ${errors.join(', ')}`);
                    toast.error(`Недопустимые переменные: ${errors.join(', ')}`);
                    return;
                  }
                  setTemplateValidationError(null);
                  saveTemplateMutation.mutate(templateDialog.template);
                }
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Тема письма</Label>
                <TokenizedRichInput
                  singleLine
                  value={templateDialog.template.subject}
                  onChange={(val) => {
                    setTemplateValidationError(null);
                    setTemplateDialog((prev) => ({
                      ...prev,
                      template: prev.template ? { ...prev.template, subject: val } : null,
                    }));
                  }}
                  placeholder="Тема письма..."
                />
              </div>

              <div className="space-y-2">
                <Label>Тело письма (HTML)</Label>
                <TokenizedRichInput
                  value={templateDialog.template.body_html}
                  onChange={(val) => {
                    setTemplateValidationError(null);
                    setTemplateDialog((prev) => ({
                      ...prev,
                      template: prev.template ? { ...prev.template, body_html: val } : null,
                    }));
                  }}
                  placeholder="HTML-тело письма..."
                  rows={12}
                />
                {templateValidationError && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {templateValidationError}
                  </p>
                )}
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
            <div className="flex items-center gap-2">
              <Label className="text-muted-foreground whitespace-nowrap text-xs">Контекст продукта:</Label>
              <Select value={previewProductId} onValueChange={setPreviewProductId}>
                <SelectTrigger className="h-8 text-xs w-[240px]">
                  <SelectValue placeholder="Без продукта (cf → пусто)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Без продукта</SelectItem>
                  {productsForPreview.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-muted-foreground">Тема:</Label>
              <p className="font-medium">{previewDialog.subject}</p>
            </div>
            <div className="border rounded-lg p-4 bg-background text-foreground max-h-[400px] overflow-y-auto">
              <div dangerouslySetInnerHTML={{ __html: previewDialog.html }} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
