import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useStartTelegramLink } from "@/hooks/useTelegramLink";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle } from "lucide-react";

/** Reuse primary-bot linking after email verification, before saving the questionnaire. */
export function QuestionnaireTelegramStep({ pageId, onLinkedChange }: { pageId: string; onLinkedChange?: (linked: boolean) => void }) {
  const { user } = useAuth();
  const status = useQuery({
    queryKey: ["questionnaire-support-bot", user?.id, pageId], enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("site-form-submit", {
        body: { action: "questionnaire_telegram_status", page_id: pageId, fields: [] },
      });
      if (error || data?.success !== true) throw new Error("telegram_status_failed");
      return { linked: data.linked === true, botUsername: String(data.bot_username || "").replace(/^@/, "") };
    },
    refetchOnWindowFocus: true, staleTime: 0,
  });
  const botUsername = status.data?.botUsername || "";
  const linked = status.data?.linked === true && !status.isError;
  useEffect(() => { onLinkedChange?.(linked); }, [linked, onLinkedChange]);
  const start = useStartTelegramLink();
  const [link, setLink] = useState<{ url: string; expiresAt: number; botUsername: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const deadlines = [link?.expiresAt].filter((value): value is number => typeof value === "number");
    if (!deadlines.length) return;
    const timer = window.setTimeout(() => {
      setLink(current => current && current.expiresAt <= Date.now() ? null : current);
    }, Math.max(0, Math.min(...deadlines) - Date.now()) + 10);
    return () => window.clearTimeout(timer);
  }, [link]);
  async function prepare() {
    setError(""); setLink(null);
    try {
      const result = await start.mutateAsync();
      const url = new URL(result.deep_link || "");
      const expiresAt = Date.parse(result.expires_at || "");
      if (!result.success || !/^[a-z0-9_]{5,32}$/i.test(botUsername) || result.bot_username?.replace(/^@/, "").toLowerCase() !== botUsername.toLowerCase() ||
          url.protocol !== "https:" || url.hostname !== "t.me" || url.pathname.toLowerCase() !== `/${botUsername.toLowerCase()}` || url.username || url.password || url.port ||
          !url.searchParams.get("start") || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("invalid_link");
      setLink({ url: url.href, expiresAt, botUsername });
    } catch { setError("Не удалось подготовить привязку Telegram. Ответы сохранены в черновике — попробуйте ещё раз."); }
  }
  return <div className="space-y-3 rounded-lg border p-4">
    <h3 className="text-lg font-semibold">Подключите support-бота</h3>
    {linked ? <>
      <p role="status">Telegram уже привязан. Повторная привязка не нужна.</p>
      <Button type="button" variant="outline" onClick={() => { void status.refetch(); }}>Проверить привязку</Button>
    </> : <>
      <p>Привяжите Telegram через нашего support-бота{botUsername ? ` @${botUsername}` : ""}. Откройте бота и нажмите «Старт», затем вернитесь сюда.</p>
      {link && link.botUsername === botUsername && link.expiresAt > Date.now() ? <Button asChild className="w-full"><a href={link.url} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" />Открыть support-бота</a></Button>
        : <Button type="button" className="w-full" disabled={start.isPending || status.isLoading} onClick={() => { void prepare(); }}>{start.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Привязать Telegram</Button>}
      {link && <Button type="button" variant="outline" className="w-full" disabled={status.isFetching} onClick={() => { void status.refetch(); }}>Я нажал «Старт» — проверить привязку</Button>}
    </>}
    {status.isError && <div role="alert"><p>Не удалось проверить подключение бота.</p><Button type="button" variant="outline" disabled={status.isFetching} onClick={() => { void status.refetch(); }}>Повторить проверку</Button></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
