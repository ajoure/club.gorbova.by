import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";

interface RoomBlock {
  id: string;
  block_type: string;
  display_scope: string;
  position: string;
  sort_order: number;
  is_active: boolean;
  config: Record<string, any>;
}

interface LiveEventRoomBlocksProps {
  liveEventId: string;
  displayContext: "live" | "replay";
  position: "under_video" | "sidebar" | "sticky";
}

export function LiveEventRoomBlocks({ liveEventId, displayContext, position }: LiveEventRoomBlocksProps) {
  const queryClient = useQueryClient();
  const queryKey = ["room-blocks", liveEventId, position];

  const { data: blocks } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("live_event_room_blocks") as any)
        .select("*")
        .eq("live_event_id", liveEventId)
        .eq("is_active", true)
        .eq("position", position)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as RoomBlock[];
    },
  });

  // Realtime show/hide: подписка на INSERT/UPDATE/DELETE для этого эфира.
  // Любое изменение → invalidate, фильтрация active+position происходит в queryFn.
  useEffect(() => {
    if (!liveEventId) return;
    const channel = supabase
      .channel(`room-blocks:${liveEventId}:${position}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_event_room_blocks",
          filter: `live_event_id=eq.${liveEventId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [liveEventId, position, queryClient]);

  if (!blocks?.length) return null;

  const visible = blocks.filter((b) => {
    if (b.display_scope === "always") return true;
    if (b.display_scope === "live_only" && displayContext === "live") return true;
    if (b.display_scope === "replay_only" && displayContext === "replay") return true;
    return false;
  });

  if (!visible.length) return null;

  return (
    <div className="space-y-2">
      {visible.map((block) => {
        if (block.block_type === "button") return <ButtonBlock key={block.id} config={block.config} />;
        if (block.block_type === "banner") return <BannerBlock key={block.id} config={block.config} />;
        if (block.block_type === "text") return <TextBlock key={block.id} config={block.config} />;
        if (block.block_type === "product_choice")
          return <ProductChoiceBlock key={block.id} config={block.config} />;
        return null;
      })}
    </div>
  );
}

function ButtonBlock({ config }: { config: Record<string, any> }) {
  const { text = "Подробнее", target_url, style = "default" } = config;
  if (!target_url) return null;

  return (
    <Button
      className="w-full"
      variant={style === "destructive" ? "destructive" : style === "outline" ? "outline" : "default"}
      onClick={() => window.open(target_url, "_blank")}
    >
      {text}
      <ExternalLink className="h-3.5 w-3.5 ml-2" />
    </Button>
  );
}

function BannerBlock({ config }: { config: Record<string, any> }) {
  const { title, body, cta_text, cta_url, image_url } = config;

  return (
    <div className="room-cta-card rounded-lg border bg-card p-3 space-y-2">
      {image_url && (
        <img src={image_url} alt="" className="w-full rounded-md object-cover max-h-32" />
      )}
      {title && <h4 className="font-semibold text-sm text-card-foreground">{title}</h4>}
      {body && <p className="text-xs text-muted-foreground">{body}</p>}
      {cta_text && cta_url && (
        <Button size="sm" className="w-full" onClick={() => window.open(cta_url, "_blank")}>
          {cta_text}
          <ExternalLink className="h-3 w-3 ml-1.5" />
        </Button>
      )}
    </div>
  );
}

/**
 * TextBlock — безопасный рендер мини-разметки.
 * Поддержка: **bold**, _italic_, [text](url), переносы строк.
 * Внешние ссылки только http/https; всё остальное игнорируется (XSS-safe).
 */
function TextBlock({ config }: { config: Record<string, any> }) {
  const body: string = config.body || "";
  if (!body.trim()) return null;
  return (
    <div className="room-cta-card rounded-lg border bg-card p-3 text-sm text-card-foreground leading-relaxed w-full max-w-full min-w-0 overflow-hidden break-words [overflow-wrap:anywhere] [word-break:break-word] whitespace-pre-wrap">
      {renderInlineMarkdown(body)}
    </div>
  );
}

function renderInlineMarkdown(text: string): JSX.Element[] {
  // Безопасный парсер: разбиваем по строкам, потом по токенам [..](..), **..**, _.._.
  const lines = text.split(/\r?\n/);
  return lines.map((line, lineIdx) => (
    <span key={lineIdx} className="block">
      {tokenize(line)}
    </span>
  ));
}

function tokenize(line: string): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = [];
  let rest = line;
  let key = 0;
  // Порядок: ссылки → bold → italic.
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
  const boldRe = /\*\*([^*]+)\*\*/;
  const italicRe = /_([^_]+)_/;

  while (rest.length > 0) {
    const linkM = rest.match(linkRe);
    const boldM = rest.match(boldRe);
    const italicM = rest.match(italicRe);
    const candidates = [linkM, boldM, italicM].filter(Boolean) as RegExpMatchArray[];
    if (candidates.length === 0) {
      out.push(rest);
      break;
    }
    candidates.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const m = candidates[0];
    const idx = m.index ?? 0;
    if (idx > 0) out.push(rest.slice(0, idx));
    if (m === linkM && linkM) {
      out.push(
        <a
          key={`l-${key++}`}
          href={linkM[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:no-underline"
        >
          {linkM[1]}
        </a>
      );
      rest = rest.slice(idx + linkM[0].length);
    } else if (m === boldM && boldM) {
      out.push(<strong key={`b-${key++}`}>{boldM[1]}</strong>);
      rest = rest.slice(idx + boldM[0].length);
    } else if (m === italicM && italicM) {
      out.push(<em key={`i-${key++}`}>{italicM[1]}</em>);
      rest = rest.slice(idx + italicM[0].length);
    }
  }
  return out;
}

/**
 * ProductChoiceBlock — каноническая оплата через bepaid-create-token (isOneTime: true → createPaymentCheckout).
 * ID-first контракт: tariff_id (UUID) обязателен. Без авторизации → запрос логина.
 */
function ProductChoiceBlock({ config }: { config: Record<string, any> }) {
  const { title, tariff_id, cta_text = "Купить" } = config;
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);

  if (!tariff_id) return null;

  const handleBuy = async () => {
    if (!session?.user?.email) {
      toast.error("Войдите, чтобы оформить покупку");
      return;
    }
    setLoading(true);
    try {
      // ID-first: резолвим product_id + code по tariff_id (UUID).
      const { data: tariff, error: tariffError } = await supabase
        .from("tariffs")
        .select("id, code, product_id")
        .eq("id", tariff_id)
        .maybeSingle();

      if (tariffError || !tariff?.product_id) {
        throw new Error("Тариф не найден или не привязан к продукту");
      }

      // Канонический контракт bepaid-create-token (isOneTime: true → createPaymentCheckout).
      const { data, error } = await supabase.functions.invoke("bepaid-create-token", {
        body: {
          productId: tariff.product_id,
          customerEmail: session.user.email,
          tariffCode: tariff.code,
          isOneTime: true,
          description: title || undefined,
        },
      });
      if (error) throw error;
      const url =
        (data as any)?.redirectUrl ||
        (data as any)?.redirect_url ||
        (data as any)?.checkout?.redirect_url;
      if (url) {
        window.location.href = url;
      } else if ((data as any)?.error) {
        throw new Error((data as any).error);
      } else {
        toast.error("Не удалось получить ссылку на оплату");
      }
    } catch (e: any) {
      toast.error(normalizeEdgeFunctionError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="room-cta-card rounded-lg border bg-card p-3 space-y-2">
      {title && <h4 className="font-semibold text-sm text-card-foreground">{title}</h4>}
      <Button size="sm" className="w-full" onClick={handleBuy} disabled={loading}>
        {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
        {cta_text}
      </Button>
    </div>
  );
}
