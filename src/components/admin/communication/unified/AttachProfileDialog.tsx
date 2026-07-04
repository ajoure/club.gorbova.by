import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Search } from "lucide-react";

/**
 * AttachProfileDialog (V2-HEADERS) — вынесен из IgContactHeader
 * для переиспользования в UnifiedChatHeader.
 * Поиск profiles + link_instagram_contact_to_profile.
 */
interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instagramContactId: string;
  igLabel: string;
}

export function AttachProfileDialog({ open, onOpenChange, instagramContactId, igLabel }: Props) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<{ profileId: string; label: string } | null>(
    null,
  );

  const search = useQuery({
    queryKey: ["attach-profile-search", q],
    enabled: open && q.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const like = `%${q.trim()}%`;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone, avatar_url")
        .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
        .limit(20);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const linkMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const { data, error } = await supabase.rpc("link_instagram_contact_to_profile", {
        p_instagram_contact_id: instagramContactId,
        p_profile_id: profileId,
        p_overwrite: false,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Instagram-контакт привязан к профилю");
      qc.invalidateQueries({ queryKey: ["unified-ig-contacts"] });
      qc.invalidateQueries({ queryKey: ["unified-ig-dialogs"] });
      qc.invalidateQueries({ queryKey: ["profile-channels"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error("Не удалось привязать: " + (e?.message || "ошибка")),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Привязать к профилю</DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground">
            Instagram-контакт: <b>{igLabel}</b>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Поиск по имени, email или телефону (мин. 2 символа)…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <div className="max-h-80 overflow-y-auto border rounded-md divide-y divide-border/30">
            {q.trim().length < 2 ? (
              <div className="p-3 text-xs text-muted-foreground">
                Введите минимум 2 символа для поиска
              </div>
            ) : search.isLoading ? (
              <div className="p-3 text-xs text-muted-foreground">Поиск…</div>
            ) : search.error ? (
              <div className="p-3 text-xs text-destructive">
                Ошибка поиска: {(search.error as any)?.message || "ошибка"}
              </div>
            ) : !search.data?.length ? (
              <div className="p-3 text-xs text-muted-foreground">Ничего не найдено</div>
            ) : (
              search.data.map((p: any) => {
                const label = p.full_name || p.email || p.id;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2 p-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{label}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {p.email || "—"}
                        {p.phone ? ` · ${p.phone}` : ""}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={linkMutation.isPending}
                      onClick={() => setConfirmTarget({ profileId: p.id, label })}
                    >
                      Привязать
                    </Button>
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmTarget} onOpenChange={(v) => !v && setConfirmTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Привязать Instagram к профилю?</AlertDialogTitle>
            <AlertDialogDescription>
              Instagram-контакт <b>{igLabel}</b> будет привязан к профилю{" "}
              <b>{confirmTarget?.label}</b>. Действие будет записано в журнал изменений; отвязать
              можно из карточки контакта.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmTarget) {
                  linkMutation.mutate(confirmTarget.profileId);
                  setConfirmTarget(null);
                }
              }}
            >
              Привязать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
