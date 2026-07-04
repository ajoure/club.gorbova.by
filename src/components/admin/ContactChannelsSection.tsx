import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Send, Instagram, LifeBuoy, Link2, Link2Off, Search } from "lucide-react";
import { useProfileChannels } from "@/hooks/useProfileChannels";

/**
 * ContactChannelsSection (PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-CHANNELS P2)
 *
 * Секция «Каналы связи» в ContactDetailSheet. Read-only safe:
 *   - падение любого запроса НЕ ломает открытие карточки;
 *   - Telegram / Support показываются как read-only (mgmt в других местах);
 *   - Instagram — единственный канал с ручным merge (link/unlink RPC).
 *
 * Использует канон instagram_contacts.profile_id — новых bridge-таблиц нет.
 */
interface Props {
  profileId: string;
  profileName?: string | null;
  profileEmail?: string | null;
}

export function ContactChannelsSection({ profileId, profileName, profileEmail }: Props) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useProfileChannels(profileId);
  const [attachOpen, setAttachOpen] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<{ contactId: string; label: string } | null>(
    null,
  );

  const unlinkMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const { data, error } = await supabase.rpc("unlink_instagram_contact_from_profile", {
        p_instagram_contact_id: contactId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Instagram-контакт отвязан");
      qc.invalidateQueries({ queryKey: ["profile-channels", profileId] });
      qc.invalidateQueries({ queryKey: ["unified-ig-contacts"] });
      qc.invalidateQueries({ queryKey: ["unified-ig-dialogs"] });
    },
    onError: (e: any) => toast.error("Не удалось отвязать: " + (e?.message || "ошибка")),
  });

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          Каналы связи
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Загрузка…</p>
        ) : error ? (
          <p className="text-xs text-destructive">Не удалось загрузить каналы</p>
        ) : (
          <>
            {/* Telegram — read-only */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <Send className="h-4 w-4 mt-0.5 text-sky-500 shrink-0" />
                <div>
                  <div className="font-medium">Telegram</div>
                  {data?.telegram.linked ? (
                    <div className="text-xs text-muted-foreground">
                      {data.telegram.telegramUsername
                        ? `@${data.telegram.telegramUsername}`
                        : `ID ${data.telegram.telegramUserId}`}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">Не привязан</div>
                  )}
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">read-only</Badge>
            </div>

            {/* Instagram — link/unlink */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <Instagram className="h-4 w-4 mt-0.5 text-pink-500 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium">Instagram</div>
                  {data?.instagram.length ? (
                    <ul className="space-y-1 mt-1">
                      {data.instagram.map((c) => (
                        <li key={c.contactId} className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground truncate">
                            {c.username ? `@${c.username}` : c.fullName || c.instagramUserId}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-[10px] text-destructive hover:text-destructive"
                            onClick={() =>
                              setUnlinkTarget({
                                contactId: c.contactId,
                                label: c.username ? `@${c.username}` : c.fullName || c.instagramUserId,
                              })
                            }
                          >
                            <Link2Off className="h-3 w-3 mr-1" />
                            Отвязать
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-muted-foreground">Не привязан</div>
                  )}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setAttachOpen(true)}
              >
                <Link2 className="h-3 w-3 mr-1" />
                Привязать IG
              </Button>
            </div>

            {/* Support — read-only */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <LifeBuoy className="h-4 w-4 mt-0.5 text-orange-500 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium">Техподдержка</div>
                  {data?.support.length ? (
                    <ul className="text-xs text-muted-foreground space-y-0.5 mt-1">
                      {data.support.slice(0, 5).map((t) => (
                        <li key={t.ticketId} className="truncate">
                          #{t.ticketNumber || t.ticketId.slice(0, 6)} · {t.subject || "без темы"}{" "}
                          <span className="opacity-60">({t.status})</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-muted-foreground">Нет открытых обращений</div>
                  )}
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">read-only</Badge>
            </div>
          </>
        )}
      </CardContent>

      <AttachInstagramDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        profileId={profileId}
        profileName={profileName}
        profileEmail={profileEmail}
        alreadyLinkedIds={new Set(data?.instagram.map((c) => c.contactId) || [])}
      />

      <AlertDialog
        open={!!unlinkTarget}
        onOpenChange={(v) => !v && setUnlinkTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отвязать Instagram-контакт?</AlertDialogTitle>
            <AlertDialogDescription>
              {unlinkTarget?.label} будет отвязан от профиля{" "}
              <b>{profileName || profileEmail || profileId}</b>. Историю сообщений это не удалит,
              но клик по имени в ленте больше не откроет карточку профиля.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (unlinkTarget) {
                  unlinkMutation.mutate(unlinkTarget.contactId);
                  setUnlinkTarget(null);
                }
              }}
            >
              Отвязать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ============================================================
// Attach IG dialog: поиск IG-контактов по username/full_name.
// Показывает статус (свободен / привязан к другому профилю),
// требует confirm при overwrite.
// ============================================================
function AttachInstagramDialog({
  open,
  onOpenChange,
  profileId,
  profileName,
  profileEmail,
  alreadyLinkedIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profileId: string;
  profileName?: string | null;
  profileEmail?: string | null;
  alreadyLinkedIds: Set<string>;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<{
    contactId: string;
    label: string;
    previousProfileId: string | null;
  } | null>(null);

  const search = useQuery({
    queryKey: ["attach-ig-search", q],
    enabled: open,
    staleTime: 30_000,
    queryFn: async () => {
      let query = supabase
        .from("instagram_contacts")
        .select("id, instagram_username, full_name, instagram_user_id, profile_id, instagram_account_id")
        .order("updated_at", { ascending: false })
        .limit(20);
      if (q.trim()) {
        const like = `%${q.trim()}%`;
        query = query.or(`instagram_username.ilike.${like},full_name.ilike.${like},instagram_user_id.ilike.${like}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const linkMutation = useMutation({
    mutationFn: async (payload: { contactId: string; overwrite: boolean }) => {
      const { data, error } = await supabase.rpc("link_instagram_contact_to_profile", {
        p_instagram_contact_id: payload.contactId,
        p_profile_id: profileId,
        p_overwrite: payload.overwrite,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Instagram-контакт привязан");
      qc.invalidateQueries({ queryKey: ["profile-channels", profileId] });
      qc.invalidateQueries({ queryKey: ["attach-ig-search"] });
      qc.invalidateQueries({ queryKey: ["unified-ig-contacts"] });
      qc.invalidateQueries({ queryKey: ["unified-ig-dialogs"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error("Не удалось привязать: " + (e?.message || "ошибка")),
  });

  const targetProfileLabel = profileName || profileEmail || profileId;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Привязать Instagram-контакт</DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground">
            Профиль: <b>{targetProfileLabel}</b>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Поиск по @username, имени или IG ID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <div className="max-h-80 overflow-y-auto border rounded-md divide-y divide-border/30">
            {search.isLoading ? (
              <div className="p-3 text-xs text-muted-foreground">Загрузка…</div>
            ) : search.error ? (
              <div className="p-3 text-xs text-destructive">
                Ошибка поиска: {(search.error as any)?.message || "ошибка"}
              </div>
            ) : !search.data?.length ? (
              <div className="p-3 text-xs text-muted-foreground">Ничего не найдено</div>
            ) : (
              search.data.map((c: any) => {
                const alreadyThis = alreadyLinkedIds.has(c.id);
                const linkedOther = c.profile_id && c.profile_id !== profileId;
                const label = c.instagram_username
                  ? `@${c.instagram_username}`
                  : c.full_name || c.instagram_user_id;
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 p-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{label}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        IG ID: {c.instagram_user_id}
                        {alreadyThis && " · уже привязан к этому профилю"}
                        {linkedOther && " · привязан к другому профилю"}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={linkedOther ? "destructive" : "default"}
                      className="h-7 text-[11px]"
                      disabled={alreadyThis || linkMutation.isPending}
                      onClick={() => {
                        if (linkedOther) {
                          setConfirmTarget({
                            contactId: c.id,
                            label,
                            previousProfileId: c.profile_id,
                          });
                        } else {
                          linkMutation.mutate({ contactId: c.id, overwrite: false });
                        }
                      }}
                    >
                      {alreadyThis ? "Уже привязан" : linkedOther ? "Перепривязать" : "Привязать"}
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

      <AlertDialog
        open={!!confirmTarget}
        onOpenChange={(v) => !v && setConfirmTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Перепривязать Instagram-контакт?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget?.label} уже привязан к другому профилю. Перезаписать привязку на{" "}
              <b>{targetProfileLabel}</b>? Действие будет записано в журнал изменений.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmTarget) {
                  linkMutation.mutate({ contactId: confirmTarget.contactId, overwrite: true });
                  setConfirmTarget(null);
                }
              }}
            >
              Перезаписать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
