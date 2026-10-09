import { useState } from "react";
import { useStartTelegramLink, useTelegramLinkStatus } from "@/hooks/useTelegramLink";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle } from "lucide-react";

/** Existing primary-bot linking, shown only after a persisted questionnaire. */
export function QuestionnaireTelegramStep() {
  const status = useTelegramLinkStatus();
  const start = useStartTelegramLink();
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [error, setError] = useState("");
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
    </> : <>
      <p>Привяжите Telegram через нашего бота @gorbovabybot. Откройте бота и нажмите «Старт», затем вернитесь сюда.</p>
      {link && link.expiresAt > Date.now() ? <Button asChild className="w-full"><a href={link.url} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" />Открыть support-бота</a></Button>
        : <Button type="button" className="w-full" disabled={start.isPending || status.isLoading} onClick={() => { void prepare(); }}>{start.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Привязать Telegram</Button>}
      {link && <Button type="button" variant="outline" className="w-full" disabled={status.isFetching} onClick={() => { void status.refetch(); }}>Я нажал «Старт» — проверить привязку</Button>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
