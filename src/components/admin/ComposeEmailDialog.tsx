import { useState } from "react";
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
import { toast } from "sonner";
import { Loader2, Send, Mail } from "lucide-react";

interface ComposeEmailDialogProps {
  recipientEmail: string | null;
  recipientName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function ComposeEmailDialog({ 
  recipientEmail, 
  recipientName,
  open, 
  onOpenChange,
  onSuccess,
}: ComposeEmailDialogProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  // Load email accounts
  const { data: emailAccounts } = useQuery({
    queryKey: ["email-accounts-for-compose"],
    queryFn: async () => {
      // Try integration_instances first
      const { data: integrations } = await supabase
        .from("integration_instances")
        .select("id, alias, config, is_default")
        .eq("category", "email")
        .eq("status", "connected");

      // Then email_accounts
      const { data: accounts } = await supabase
        .from("email_accounts")
        .select("id, display_name, email, is_default")
        .eq("is_active", true);

      const result: Array<{ id: string; name: string; email: string; isDefault: boolean }> = [];

      integrations?.forEach(i => {
        const config = i.config as Record<string, unknown>;
        result.push({
          id: i.id,
          name: i.alias || "Email",
          email: (config?.from_email as string) || (config?.email as string) || "",
          isDefault: i.is_default || false,
        });
      });

      accounts?.forEach(a => {
        result.push({
          id: a.id,
          name: a.display_name || a.email,
          email: a.email,
          isDefault: a.is_default || false,
        });
      });

      return result;
    },
    enabled: open,
  });

  // Set default account when loaded
  useState(() => {
    if (emailAccounts?.length && !selectedAccountId) {
      const defaultAcc = emailAccounts.find(a => a.isDefault) || emailAccounts[0];
      setSelectedAccountId(defaultAcc.id);
    }
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!recipientEmail) throw new Error("No recipient email");
      if (!subject.trim()) throw new Error("Subject is required");
      if (!body.trim()) throw new Error("Body is required");

      // Build HTML body
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          ${body.split('\n').map(line => `<p style="margin: 0 0 10px 0;">${line || '&nbsp;'}</p>`).join('')}
        </div>
      `;

      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          to: recipientEmail,
          subject: subject.trim(),
          html: htmlBody,
          text: body.trim(),
          account_id: selectedAccountId || undefined,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data;
    },
    onSuccess: () => {
      toast.success("Письмо отправлено");
      setSubject("");
      setBody("");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Написать письмо
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Кому</Label>
            <Input 
              value={recipientName ? `${recipientName} <${recipientEmail}>` : recipientEmail || ""} 
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
                      {acc.name} ({acc.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Тема</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Тема письма..."
            />
          </div>

          <div className="space-y-2">
            <Label>Сообщение</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Текст письма..."
              className="min-h-[200px] resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button 
            onClick={() => sendMutation.mutate()} 
            disabled={sendMutation.isPending || !subject.trim() || !body.trim()}
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
