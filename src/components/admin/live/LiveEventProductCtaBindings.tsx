import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminRole } from "@/lib/liveRoomRoles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Loader2, ShoppingCart, ExternalLink, FileText, Eye, Layers } from "lucide-react";
import { toast } from "sonner";
import { DomainEventService } from "@/lib/domain-events";

const CTA_TYPE_LABELS: Record<string, string> = {
  buy_now: "Купить",
  open_product: "Открыть продукт",
  open_tariff: "Выбрать тариф",
  lead_form: "Заявка",
  preorder: "Предзапись",
  external_link: "Внешняя ссылка",
};

const DISPLAY_MODE_LABELS: Record<string, string> = {
  manual: "Вручную",
  after_minutes: "Через N минут",
  at_datetime: "По дате/времени",
  always: "Всегда",
};

const POSITION_LABELS: Record<string, string> = {
  under_video: "Под видео",
  sidebar: "Боковая панель",
  sticky: "Прикреплённый",
};

interface BindingForm {
  product_id: string;
  tariff_id: string;
  offer_id: string;
  cta_type: string;
  display_mode: string;
  position: string;
  show_after_minutes: string;
  show_at: Date | undefined;
  title_override: string;
  description_override: string;
  button_text_override: string;
  image_override: string;
  is_active: boolean;
  external_url: string;
}

const EMPTY_FORM: BindingForm = {
  product_id: "", tariff_id: "", offer_id: "",
  cta_type: "buy_now", display_mode: "manual", position: "under_video",
  show_after_minutes: "", show_at: undefined,
  title_override: "", description_override: "", button_text_override: "",
  image_override: "", is_active: true, external_url: "",
};

export function LiveEventProductCtaBindings({ liveEventId }: { liveEventId: string }) {
  const { session, role } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<BindingForm>(EMPTY_FORM);
  const canManageCta = isAdminRole(role);

  const { data: bindings, isLoading } = useQuery({
    queryKey: ["cta-bindings-admin", liveEventId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("live_event_product_cta_bindings") as any)
        .select("*")
        .eq("live_event_id", liveEventId)
        .order("sort_order");
      if (error) throw error;
      return data || [];
    },
  });

  // Products for select
  const { data: products } = useQuery({
    queryKey: ["products-for-cta"],
    queryFn: async () => {
      const { data } = await supabase.from("products_v2").select("id, name, slug").eq("is_active", true).order("name");
      return data || [];
    },
  });

  // Tariffs for selected product
  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-for-cta", form.product_id],
    enabled: !!form.product_id,
    queryFn: async () => {
      const { data } = await supabase.from("tariffs").select("id, name, public_id").eq("product_id", form.product_id).order("sort_order");
      return data || [];
    },
  });

  // Offers for selected tariff
  const { data: offers } = useQuery({
    queryKey: ["offers-for-cta", form.tariff_id],
    enabled: !!form.tariff_id,
    queryFn: async () => {
      const { data } = await supabase.from("tariff_offers").select("id, amount, button_label, offer_type").eq("tariff_id", form.tariff_id).eq("is_active", true);
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.product_id) throw new Error("Выберите продукт");

      const payload: Record<string, any> = {
        live_event_id: liveEventId,
        product_id: form.product_id,
        tariff_id: form.tariff_id || null,
        offer_id: form.offer_id || null,
        cta_type: form.cta_type,
        display_mode: form.display_mode,
        position: form.position,
        show_after_minutes: form.display_mode === "after_minutes" && form.show_after_minutes ? parseInt(form.show_after_minutes) : null,
        show_at: form.display_mode === "at_datetime" && form.show_at ? form.show_at.toISOString() : null,
        title_override: form.title_override || null,
        description_override: form.description_override || null,
        button_text_override: form.button_text_override || null,
        image_override: form.image_override || null,
        is_active: form.is_active,
        created_by: session?.user?.id,
        metadata: form.cta_type === "external_link" && form.external_url
          ? { external_url: form.external_url }
          : {},
      };

      const { error } = await (supabase.from("live_event_product_cta_bindings") as any).insert(payload);
      if (error) throw error;

      await DomainEventService.emitEvent("live_product_cta_created", "webinar", liveEventId, {
        product_id: form.product_id,
        cta_type: form.cta_type,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cta-bindings-admin", liveEventId] });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      toast.success("CTA привязан");
    },
    onError: (e: any) => toast.error(e.message || "Ошибка"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (bindingId: string) => {
      const { error } = await (supabase.from("live_event_product_cta_bindings") as any)
        .delete().eq("id", bindingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cta-bindings-admin", liveEventId] });
      toast.success("CTA удалён");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase.from("live_event_product_cta_bindings") as any)
        .update({ is_active, updated_by: session?.user?.id, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cta-bindings-admin", liveEventId] });
    },
  });

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Product CTA привязки</span>
        {canManageCta && (
          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setForm(EMPTY_FORM); setDialogOpen(true); }}>
            <Plus className="h-3 w-3" /> Добавить CTA
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : !bindings?.length ? (
        <p className="text-sm text-muted-foreground text-center py-4">Нет привязанных CTA</p>
      ) : (
        <div className="space-y-2">
          {bindings.map((b: any) => (
            <Card key={b.id} className={`${b.is_active ? "" : "opacity-50"}`}>
              <CardContent className="p-3 flex items-center gap-3">
                <Layers className="h-4 w-4 text-indigo-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{b.title_override || b.product_id?.slice(0, 8)}</p>
                  <div className="flex gap-1 mt-0.5 flex-wrap">
                    <Badge variant="outline" className="text-[9px] px-1">{CTA_TYPE_LABELS[b.cta_type] || b.cta_type}</Badge>
                    <Badge variant="outline" className="text-[9px] px-1">{DISPLAY_MODE_LABELS[b.display_mode] || b.display_mode}</Badge>
                    <Badge variant="outline" className="text-[9px] px-1">{POSITION_LABELS[b.position] || b.position}</Badge>
                  </div>
                </div>
                {canManageCta && (
                  <>
                    <Switch checked={b.is_active} onCheckedChange={(v) => toggleMutation.mutate({ id: b.id, is_active: v })} />
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteMutation.mutate(b.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Привязать CTA к эфиру</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Product */}
            <div>
              <Label className="text-xs">Продукт *</Label>
              <Select value={form.product_id} onValueChange={(v) => setForm((p) => ({ ...p, product_id: v, tariff_id: "", offer_id: "" }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Выберите продукт" /></SelectTrigger>
                <SelectContent>
                  {products?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Tariff */}
            {form.product_id && tariffs?.length ? (
              <div>
                <Label className="text-xs">Тариф (опционально)</Label>
                <Select value={form.tariff_id} onValueChange={(v) => setForm((p) => ({ ...p, tariff_id: v, offer_id: "" }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Без тарифа" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Без тарифа</SelectItem>
                    {tariffs.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {/* Offer */}
            {form.tariff_id && offers?.length ? (
              <div>
                <Label className="text-xs">Оффер (опционально)</Label>
                <Select value={form.offer_id} onValueChange={(v) => setForm((p) => ({ ...p, offer_id: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Без оффера" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Без оффера</SelectItem>
                    {offers.map((o) => <SelectItem key={o.id} value={o.id}>{o.button_label || o.offer_type} — {o.amount} BYN</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {/* CTA Type */}
            <div>
              <Label className="text-xs">Тип CTA</Label>
              <Select value={form.cta_type} onValueChange={(v) => setForm((p) => ({ ...p, cta_type: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CTA_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* External URL for external_link */}
            {form.cta_type === "external_link" && (
              <div>
                <Label className="text-xs">URL внешней ссылки</Label>
                <Input className="h-8 text-xs" value={form.external_url} onChange={(e) => setForm((p) => ({ ...p, external_url: e.target.value }))} placeholder="https://..." />
              </div>
            )}

            {/* Display Mode */}
            <div>
              <Label className="text-xs">Режим показа</Label>
              <Select value={form.display_mode} onValueChange={(v) => setForm((p) => ({ ...p, display_mode: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DISPLAY_MODE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {form.display_mode === "after_minutes" && (
              <div>
                <Label className="text-xs">Показать через (минут)</Label>
                <Input className="h-8 text-xs" type="number" value={form.show_after_minutes} onChange={(e) => setForm((p) => ({ ...p, show_after_minutes: e.target.value }))} />
              </div>
            )}

            {form.display_mode === "at_datetime" && (
              <div>
                <Label className="text-xs">Показать в</Label>
                <Input className="h-8 text-xs" type="datetime-local"
                  value={form.show_at ? new Date(form.show_at.getTime() - form.show_at.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""}
                  onChange={(e) => setForm((p) => ({ ...p, show_at: e.target.value ? new Date(e.target.value) : undefined }))}
                />
              </div>
            )}

            {/* Position */}
            <div>
              <Label className="text-xs">Позиция</Label>
              <Select value={form.position} onValueChange={(v) => setForm((p) => ({ ...p, position: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(POSITION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Overrides */}
            <div>
              <Label className="text-xs">Заголовок (override)</Label>
              <Input className="h-8 text-xs" value={form.title_override} onChange={(e) => setForm((p) => ({ ...p, title_override: e.target.value }))} placeholder="Из продукта" />
            </div>
            <div>
              <Label className="text-xs">Описание (override)</Label>
              <Input className="h-8 text-xs" value={form.description_override} onChange={(e) => setForm((p) => ({ ...p, description_override: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Текст кнопки (override)</Label>
              <Input className="h-8 text-xs" value={form.button_text_override} onChange={(e) => setForm((p) => ({ ...p, button_text_override: e.target.value }))} placeholder="Из оффера" />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm((p) => ({ ...p, is_active: v }))} />
              <Label className="text-xs">Активен</Label>
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
