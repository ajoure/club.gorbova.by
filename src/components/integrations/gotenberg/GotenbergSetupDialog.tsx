import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  status: {
    configured: boolean; enabled: boolean; url: string | null;
    basic_user_last4: string | null; basic_pass_last4: string | null;
  } | null;
}

export function GotenbergSetupDialog({ open, onOpenChange, status }: Props) {
  const [url, setUrl] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (open) {
      setUrl(status?.url ?? "https://pdf.gorbova.by");
      setUser("");
      setPass("");
      setEnabled(status?.enabled ?? true);
    }
  }, [open, status]);

  const save = async () => {
    if (!url) { toast.error("URL обязателен"); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("hosterby-api", {
        body: {
          action: "gotenberg_save_config",
          payload: {
            gotenberg_url: url,
            gotenberg_basic_user: user || undefined,
            gotenberg_basic_pass: pass || undefined,
            gotenberg_enabled: enabled,
          },
        },
      });
      if (error) throw error;
      const ok = (data as { success?: boolean })?.success;
      if (!ok) throw new Error((data as { error?: string })?.error ?? "Ошибка сохранения");
      toast.success("Настройки Gotenberg сохранены");
      qc.invalidateQueries({ queryKey: ["gotenberg-status"] });
      onOpenChange(false);
    } catch (e) {
      toast.error(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Настройка Gotenberg</DialogTitle>
          <DialogDescription>
            Подключение к DOCX→PDF конвертеру на VPS hoster.by. После сохранения запустите Health-check и Test DOCX→PDF.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>URL (HTTPS)</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://pdf.gorbova.by" />
          </div>
          <div>
            <Label>Basic Auth — пользователь</Label>
            <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder={status?.basic_user_last4 ? `сейчас: …${status.basic_user_last4}` : "опционально"} />
          </div>
          <div>
            <Label>Basic Auth — пароль</Label>
            <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={status?.basic_pass_last4 ? `сейчас: …${status.basic_pass_last4} (оставьте пустым чтобы не менять)` : "опционально"} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label className="text-sm">Включён</Label>
              <p className="text-xs text-muted-foreground">Без этого флага конвертация не запускается из canonical generator</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
