import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

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
  const { data: blocks } = useQuery({
    queryKey: ["room-blocks", liveEventId, position],
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

  if (!blocks?.length) return null;

  // Filter by display_scope
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
    <div className="rounded-lg border bg-card p-3 space-y-2">
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
