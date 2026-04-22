import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, Loader2, GripVertical } from "lucide-react";
import { toast } from "sonner";

interface RoomBlock {
  id: string;
  public_id: string;
  live_event_id: string;
  block_type: string;
  display_scope: string;
  position: string;
  sort_order: number;
  is_active: boolean;
  config: Record<string, any>;
  created_at: string;
}

const blockTypeLabels: Record<string, string> = {
  button: "Кнопка",
  banner: "Баннер",
  text: "Текст",
  product_choice: "Выбор продукта",
};

const displayScopeLabels: Record<string, string> = {
  always: "Всегда",
  live_only: "Только в эфире",
  replay_only: "Только в записи",
};

const positionLabels: Record<string, string> = {
  under_video: "Под видео",
  sidebar: "Сайдбар",
  sticky: "Закреплённый",
};

export function LiveEventRoomBlocksEditor({ liveEventId }: { liveEventId: string }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newBlock, setNewBlock] = useState({
    block_type: "button" as string,
    display_scope: "always" as string,
    position: "under_video" as string,
    config: {} as Record<string, any>,
  });

  const { data: blocks, isLoading } = useQuery({
    queryKey: ["admin-room-blocks", liveEventId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("live_event_room_blocks") as any)
        .select("*")
        .eq("live_event_id", liveEventId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as RoomBlock[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.from("live_event_room_blocks") as any).insert({
        live_event_id: liveEventId,
        block_type: newBlock.block_type,
        display_scope: newBlock.display_scope,
        position: newBlock.position,
        sort_order: (blocks?.length || 0) + 1,
        is_active: true,
        config: newBlock.config,
        created_by: (await supabase.auth.getUser()).data.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-room-blocks", liveEventId] });
      setAdding(false);
      setNewBlock({ block_type: "button", display_scope: "always", position: "under_video", config: {} });
      toast.success("Блок добавлен");
    },
    onError: (e: any) => toast.error("Ошибка: " + e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase.from("live_event_room_blocks") as any)
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-room-blocks", liveEventId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("live_event_room_blocks") as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-room-blocks", liveEventId] });
      toast.success("Блок удалён");
    },
    onError: (e: any) => toast.error("Ошибка: " + e.message),
  });

  if (isLoading) {
    return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Продающие блоки ({blocks?.length || 0})</span>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Добавить
        </Button>
      </div>

      {blocks?.map((block) => (
        <Card key={block.id} className="relative">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <Badge variant="outline" className="text-[10px]">{blockTypeLabels[block.block_type] || block.block_type}</Badge>
                <Badge variant="secondary" className="text-[10px]">{displayScopeLabels[block.display_scope]}</Badge>
                <Badge variant="secondary" className="text-[10px]">{positionLabels[block.position]}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={block.is_active}
                  onCheckedChange={(v) => toggleMutation.mutate({ id: block.id, is_active: v })}
                />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteMutation.mutate(block.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {block.block_type === "button" && (
                <span>Текст: {block.config.text || "—"} → {block.config.target_url || "—"}</span>
              )}
              {block.block_type === "banner" && (
                <span>Заголовок: {block.config.title || "—"}</span>
              )}
              {block.block_type === "text" && (
                <span>Markdown: {(block.config.body || "").slice(0, 60) || "—"}</span>
              )}
              {block.block_type === "product_choice" && (
                <span>
                  Заголовок: {block.config.title || "—"} · Tariff ID: <code className="text-[10px]">{block.config.tariff_id || "—"}</code>
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {!blocks?.length && !adding && (
        <p className="text-sm text-muted-foreground text-center py-4">Нет блоков. Добавьте кнопку или баннер.</p>
      )}

      {adding && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Новый блок</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Тип</Label>
                <Select value={newBlock.block_type} onValueChange={(v) => setNewBlock((p) => ({ ...p, block_type: v, config: {} }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="button">Кнопка</SelectItem>
                    <SelectItem value="banner">Баннер</SelectItem>
                    <SelectItem value="text">Текст / Markdown</SelectItem>
                    <SelectItem value="product_choice">Выбор продукта</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Видимость</Label>
                <Select value={newBlock.display_scope} onValueChange={(v) => setNewBlock((p) => ({ ...p, display_scope: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">Всегда</SelectItem>
                    <SelectItem value="live_only">Только эфир</SelectItem>
                    <SelectItem value="replay_only">Только запись</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Позиция</Label>
                <Select value={newBlock.position} onValueChange={(v) => setNewBlock((p) => ({ ...p, position: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="under_video">Под видео</SelectItem>
                    <SelectItem value="sidebar">Сайдбар</SelectItem>
                    <SelectItem value="sticky">Закреплённый</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {newBlock.block_type === "button" && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Текст кнопки</Label>
                  <Input className="h-8 text-xs" placeholder="Записаться" value={newBlock.config.text || ""}
                    onChange={(e) => setNewBlock((p) => ({ ...p, config: { ...p.config, text: e.target.value } }))} />
                </div>
                <div>
                  <Label className="text-xs">URL</Label>
                  <Input className="h-8 text-xs" placeholder="https://..." value={newBlock.config.target_url || ""}
                    onChange={(e) => setNewBlock((p) => ({ ...p, config: { ...p.config, target_url: e.target.value } }))} />
                </div>
              </div>
            )}

            {newBlock.block_type === "banner" && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Заголовок</Label>
                  <Input className="h-8 text-xs" value={newBlock.config.title || ""}
                    onChange={(e) => setNewBlock((p) => ({ ...p, config: { ...p.config, title: e.target.value } }))} />
                </div>
                <div>
                  <Label className="text-xs">Текст</Label>
                  <Input className="h-8 text-xs" value={newBlock.config.body || ""}
                    onChange={(e) => setNewBlock((p) => ({ ...p, config: { ...p.config, body: e.target.value } }))} />
                </div>
                <div>
                  <Label className="text-xs">CTA текст</Label>
                  <Input className="h-8 text-xs" value={newBlock.config.cta_text || ""}
                    onChange={(e) => setNewBlock((p) => ({ ...p, config: { ...p.config, cta_text: e.target.value } }))} />
                </div>
                <div>
                  <Label className="text-xs">CTA URL</Label>
                  <Input className="h-8 text-xs" value={newBlock.config.cta_url || ""}
                    onChange={(e) => setNewBlock((p) => ({ ...p, config: { ...p.config, cta_url: e.target.value } }))} />
                </div>
              </div>
            )}

            {newBlock.block_type === "text" && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Текст / Markdown</Label>
                  <textarea
                    className="w-full min-h-[80px] text-xs rounded-md border border-input bg-background px-3 py-2"
                    value={newBlock.config.body || ""}
                    onChange={(e) => setNewBlock((p) => ({ ...p, config: { ...p.config, body: e.target.value } }))}
                    placeholder="**Жирный** текст, _курсив_, [ссылки](https://...)"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Поддержка: **жирный**, _курсив_, [ссылка](https://...). Только http/https.
                  </p>
                </div>
              </div>
            )}

            {newBlock.block_type === "product_choice" && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Заголовок</Label>
                  <Input className="h-8 text-xs" value={newBlock.config.title || ""}
                    onChange={(e) => setNewBlock((p) => ({ ...p, config: { ...p.config, title: e.target.value } }))}
                    placeholder="Выберите тариф" />
                </div>
                <div>
                  <Label className="text-xs">Tariff ID (UUID, ID-first)</Label>
                  <Input className="h-8 text-xs font-mono" value={newBlock.config.tariff_id || ""}
                    onChange={(e) => setNewBlock((p) => ({ ...p, config: { ...p.config, tariff_id: e.target.value } }))}
                    placeholder="00000000-0000-0000-0000-000000000000" />
                </div>
                <div>
                  <Label className="text-xs">CTA текст</Label>
                  <Input className="h-8 text-xs" value={newBlock.config.cta_text || ""}
                    onChange={(e) => setNewBlock((p) => ({ ...p, config: { ...p.config, cta_text: e.target.value } }))}
                    placeholder="Купить" />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Каноническая оплата через bepaid-create-token (isOneTime: true → createPaymentCheckout). ID-first.
                </p>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Отмена</Button>
              <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                {addMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Сохранить
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
