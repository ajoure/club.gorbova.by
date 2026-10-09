import { useEffect, useState } from "react";
import { useStartTelegramLink, useTelegramLinkStatus } from "@/hooks/useTelegramLink";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/** Existing primary-bot linking, shown only after a persisted questionnaire. */
export function QuestionnaireTelegramStep({ pageId, blockId }: { pageId: string; blockId: string }) {
  const status = useTelegramLinkStatus();
  const start = useStartTelegramLink();
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<{ url: string } | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  useEffect(() => {
    const deadlines = [link?.expiresAt].filter((value): value is number => typeof value === "number");
    if (!deadlines.length) return;
    const timer = window.setTimeout(() => {
      setLink(current => current && current.expiresAt <= Date.now() ? null : current);
    }, Math.max(0, Math.min(...deadlines) - Date.now()) + 10);
    return () => window.clearTimeout(timer);
  }, [link]);
  async function prepareInvite() {
    setError(""); setInvite(null); setInviteBusy(true);
    try {
      const { data, error: requestError } = await supabase.functions.invoke("site-form-submit", {
        body: { action: "bonus_channel_invite", page_id: pageId, block_id: blockId, fields: [] },
      });
      if (requestError || data?.success !== true || typeof data.invite_link !== "string"
        || !/^https:\/\/t\.me\/(\+|joinchat\/)[A-Za-z0-9_-]+$/.test(data.invite_link)) throw new Error("invalid_invite");
      setInvite({ url: data.invite_link });
    } catch { setError("Не удалось подготовить приглашение. Анкета сохранена — попробуйте ещё раз через пару минут."); }
    finally { setInviteBusy(false); }
  }
  async function prepare() {
    setError(""); setLink(null);
    try {
      const result = await start.mutateAsync();
      const url = new URL(result.deep_link || "");
      const expiresAt = Date.parse(result.expires_at || "");
      if (!result.success || result.bot_username?.replace(/^@/, "").toLowerCase() !== "gorbovabybot" ||
          url.protocol !== "https:" || url.hostname !== "t.me" || url.pathname.toLowerCase() !== "/gorbovabybot" ||
          !url.searchParams.get("start") || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("invalid_link");
      setLink({ url: url.href, expiresAt });
    } catch { setError("Не удалось подготовить привязку Telegram. Анкета сохранена — попробуйте ещё раз."); }
  }
  const linked = status.data?.status === "active";
  return <div className="space-y-3 rounded-lg border p-4">
    <h3 className="text-lg font-semibold">Telegram и бонусы</h3>
    {linked ? <>
      <p role="status">Telegram уже привязан. Повторная привязка не нужна.</p>
      <Button type="button" variant="outline" onClick={() => { void status.refetch(); }}>Проверить привязку</Button>
      <p>Ваш бонус — бесплатный канал «X-files для бухгалтеров». После анкеты доступ сохраняется навсегда, подписка клуба не нужна.</p>
      <p>Приглашение бессрочное и привязано к вашему Telegram. По пересланной ссылке другой человек вступить не сможет.</p>
      {invite
        ? <Button asChild className="w-full"><a href={invite.url} target="_blank" rel="noopener noreferrer">Вступить в бесплатный канал</a></Button>
        : <Button type="button" className="w-full" disabled={inviteBusy} onClick={() => { void prepareInvite(); }}>{inviteBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Получить приглашение в канал</Button>}
    </> : <>
      <p>Привяжите Telegram через нашего бота @gorbovabybot. Откройте бота и нажмите «Старт», затем вернитесь сюда.</p>
      {link && link.expiresAt > Date.now() ? <Button asChild className="w-full"><a href={link.url} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" />Открыть support-бота</a></Button>
        : <Button type="button" className="w-full" disabled={start.isPending || status.isLoading} onClick={() => { void prepare(); }}>{start.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Привязать Telegram</Button>}
      {link && <Button type="button" variant="outline" className="w-full" disabled={status.isFetching} onClick={() => { void status.refetch(); }}>Я нажал «Старт» — проверить привязку</Button>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
