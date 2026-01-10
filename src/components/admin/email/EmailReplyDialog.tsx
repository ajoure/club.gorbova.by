import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Loader2, Send, Reply, ChevronDown, FileText } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface EmailItem {
  id: string;
  from_email: string;
  from_name: string | null;
  to_email: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
}

interface EmailReplyDialogProps {
  email: EmailItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function EmailReplyDialog({ 
  email, 
  open, 
  onOpenChange,
  onSuccess,
}: EmailReplyDialogProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [showQuote, setShowQuote] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // Reset form when email changes
  useEffect(() => {
    if (email) {
      const reSubject = email.subject?.startsWith("Re:") 
        ? email.subject 
        : `Re: ${email.subject || "(Без темы)"}`;
      setSubject(reSubject);
      setBody("");
      setSelectedTemplateId("");
    }
  }, [email]);

  // Load email accounts
  const { data: emailAccounts } = useQuery({
    queryKey: ["email-accounts-for-reply"],
    queryFn: async () => {
      const { data: accounts } = await supabase
        .from("email_accounts")
        .select("id, display_name, email, is_default")
        .eq("is_active", true);

      return accounts?.map(a => ({
        id: a.id,
        name: a.display_name || a.email,
        email: a.email,
        isDefault: a.is_default || false,
      })) || [];
    },
    enabled: open,
  });

  // Load quick templates
  const { data: templates } = useQuery({
    queryKey: ["email-templates-for-reply"],
    queryFn: async () => {
      const { data } = await supabase
        .from("email_templates")
        .select("id, code, name, subject, body_html")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: open,
  });

  // Set default account when loaded
  useEffect(() => {
    if (emailAccounts?.length && !selectedAccountId) {
      // Try to find account matching the recipient
      const matchingAccount = emailAccounts.find(a => a.email === email?.to_email);
      const defaultAcc = matchingAccount || emailAccounts.find(a => a.isDefault) || emailAccounts[0];
      if (defaultAcc) {
        setSelectedAccountId(defaultAcc.id);
      }
    }
  }, [emailAccounts, email?.to_email, selectedAccountId]);

  // Apply template
  const handleApplyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates?.find(t => t.id === templateId);
    if (template) {
      // Extract text from HTML for textarea
      const parser = new DOMParser();
      const doc = parser.parseFromString(template.body_html, 'text/html');
      const textContent = doc.body.textContent || template.body_html;
      
      // Replace variables with placeholders
      let text = textContent
        .replace(/\{\{name\}\}/g, email?.from_name || "")
        .replace(/\{\{email\}\}/g, email?.from_email || "");
      
      setBody(text);
    }
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!email) throw new Error("No email to reply to");
      if (!body.trim()) throw new Error("Message is required");

      // Build quote
      const quotedText = email.body_text 
        ? `\n\n---\n${format(new Date(email.received_at || new Date()), "dd.MM.yyyy HH:mm", { locale: ru })}, ${email.from_name || email.from_email}:\n${email.body_text}`
        : "";

      const fullBody = showQuote ? body.trim() + quotedText : body.trim();

      // Build HTML body
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          ${body.split('\n').map(line => `<p style="margin: 0 0 10px 0;">${line || '&nbsp;'}</p>`).join('')}
          ${showQuote && email.body_text ? `
            <div style="margin-top: 20px; padding-top: 10px; border-top: 1px solid #ccc; color: #666;">
              <p style="font-size: 12px; margin-bottom: 10px;">
                ${format(new Date(email.received_at || new Date()), "dd.MM.yyyy HH:mm", { locale: ru })}, 
                ${email.from_name || email.from_email}:
              </p>
              <blockquote style="margin: 0; padding-left: 10px; border-left: 2px solid #ccc; color: #666;">
                ${email.body_text.split('\n').map(line => `<p style="margin: 0 0 5px 0;">${line || '&nbsp;'}</p>`).join('')}
              </blockquote>
            </div>
          ` : ''}
        </div>
      `;

      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          to: email.from_email,
          subject: subject.trim(),
          html: htmlBody,
          text: fullBody,
          account_id: selectedAccountId || undefined,
          in_reply_to: email.id,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data;
    },
    onSuccess: () => {
      toast.success("Ответ отправлен");
      setBody("");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  if (!email) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Reply className="w-5 h-5" />
            Ответить на письмо
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Кому</Label>
              <Input 
                value={email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email} 
                disabled 
              />
            </div>

            {emailAccounts && emailAccounts.length > 1 && (
              <div className="space-y-2">
                <Label>От кого</Label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите аккаунт" />
                  </SelectTrigger>
                  <SelectContent>
                    {emailAccounts.map(acc => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Тема</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {templates && templates.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Шаблон ответа
              </Label>
              <Select value={selectedTemplateId} onValueChange={handleApplyTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите шаблон..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Сообщение</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Введите ответ..."
              className="min-h-[180px] resize-none"
            />
          </div>

          <Collapsible open={showQuote} onOpenChange={setShowQuote}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                <ChevronDown className={`h-4 w-4 transition-transform ${showQuote ? "rotate-180" : ""}`} />
                {showQuote ? "Скрыть цитату" : "Показать цитату"}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 p-3 rounded-lg bg-muted/50 border text-sm text-muted-foreground">
                <p className="text-xs mb-2">
                  {format(new Date(email.received_at || new Date()), "dd.MM.yyyy HH:mm", { locale: ru })}, 
                  {" "}{email.from_name || email.from_email}:
                </p>
                <p className="whitespace-pre-wrap text-xs pl-2 border-l-2 border-muted-foreground/30">
                  {email.body_text?.slice(0, 500)}
                  {(email.body_text?.length || 0) > 500 && "..."}
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button 
            onClick={() => sendMutation.mutate()} 
            disabled={sendMutation.isPending || !body.trim()}
          >
            {sendMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Отправить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
