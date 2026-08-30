import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Handshake, Loader2, User, Package, Coins, ChevronRight, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ContactPickerDialog, type PickedContact } from "@/components/admin/shared/pickers/ContactPickerDialog";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useStaffOptions } from "@/hooks/useStaffOptions";

interface CreateDealDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (orderId: string) => void;
}

interface Pipeline { id: string; name: string }
interface Stage { id: string; name: string; pipeline_id: string; order_index: number | null; is_default: boolean | null }
interface Product { id: string; name: string }
interface Tariff { id: string; name: string; product_id: string }

const CURRENCIES = ["BYN", "USD", "EUR", "RUB"];

export function CreateDealDialog({ open, onOpenChange, onCreated }: CreateDealDialogProps) {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const { data: staff = [] } = useStaffOptions();
  const canReassign = hasPermission("deals.reassign");
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState("BYN");
  const [pipelineId, setPipelineId] = useState<string>("");
  const [stageId, setStageId] = useState<string>("");
  const [productId, setProductId] = useState<string>("__none__");
  const [tariffId, setTariffId] = useState<string>("__none__");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [responsibleId, setResponsibleId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (user?.id) setResponsibleId(user.id);
    (async () => {
      const [pipesRes, stagesRes, prodRes, tariffRes] = await Promise.all([
        supabase.from("crm_pipelines").select("id,name").order("name"),
        supabase.from("crm_pipeline_stages").select("id,name,pipeline_id,order_index,is_default").order("order_index"),
        supabase.from("products_v2").select("id,name").eq("is_active", true).order("name"),
        supabase.from("tariffs").select("id,name,product_id").eq("is_active", true).order("name"),
      ]);
      setPipelines(pipesRes.data ?? []);
      setStages((stagesRes.data ?? []) as Stage[]);
      setProducts(prodRes.data ?? []);
      setTariffs((tariffRes.data ?? []) as any);
      const preferred =
        pipesRes.data?.find((p: Pipeline) => p.name === "Основная") ?? pipesRes.data?.[0];
      if (preferred) setPipelineId(preferred.id);
    })();
  }, [open, user?.id]);

  useEffect(() => {
    if (!pipelineId) return;
    const forPipe = stages.filter((s) => s.pipeline_id === pipelineId);
    const def = forPipe.find((s) => s.is_default) ?? forPipe[0];
    setStageId(def?.id ?? "");
  }, [pipelineId, stages]);

  const pipelineStages = useMemo(
    () => stages.filter((s) => s.pipeline_id === pipelineId),
    [stages, pipelineId],
  );
  const productTariffs = useMemo(
    () => tariffs.filter((t) => t.product_id === productId),
    [tariffs, productId],
  );

  useEffect(() => {
    setTariffId("__none__");
  }, [productId]);

  const reset = () => {
    setContact(null);
    setTitle("");
    setNotes("");
    setAmount("");
    setCurrency("BYN");
    setProductId("__none__");
    setTariffId("__none__");
    setResponsibleId(user?.id || "");
  };

  const submit = async () => {
    if (!contact) {
      toast.error("Выберите контакт");
      return;
    }
    const numericAmount = amount ? Number(amount.replace(",", ".")) : 0;
    if (Number.isNaN(numericAmount) || numericAmount < 0) {
      toast.error("Некорректная сумма");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("admin_create_deal_v2", {
        p_profile_id: contact.id,
        p_title: title || null,
        p_product_id: productId === "__none__" ? null : productId,
        p_tariff_id: tariffId === "__none__" ? null : tariffId,
        p_pipeline_id: pipelineId || null,
        p_pipeline_stage_id: stageId || null,
        p_amount: numericAmount,
        p_currency: currency,
        p_notes: notes || null,
        p_responsible_user_id: responsibleId || null,
      });
      if (error) {
        const msg = error.message || "";
        if (msg === "forbidden") toast.error("Нет прав на создание сделок");
        else if (msg === "profile_not_found") toast.error("Контакт не найден");
        else toast.error("Ошибка: " + msg);
        return;
      }
      toast.success("Сделка создана");
      reset();
      onOpenChange(false);
      if (data) onCreated?.(data as string);
    } catch (e: any) {
      toast.error("Ошибка: " + (e?.message ?? "unknown"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!saving) {
            onOpenChange(v);
            if (!v) reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden border-white/20 bg-background/80 backdrop-blur-2xl shadow-2xl">
          <div className="relative">
            <div className="absolute inset-x-0 -top-16 h-40 bg-gradient-to-br from-emerald-500/30 via-primary/10 to-transparent blur-2xl pointer-events-none" />
            <div className="relative p-6">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                    <Handshake className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <DialogTitle className="text-lg">Новая сделка</DialogTitle>
                    <DialogDescription className="text-xs">
                      Заведите сделку вручную. Обязательный минимум — контакт и стадия воронки.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="mt-5 space-y-4">
                {/* Contact */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" /> Контакт
                  </Label>
                  {contact ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-muted/40 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {contact.full_name || contact.email || contact.phone || contact.id.slice(0, 8)}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {[contact.email, contact.phone].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
                          Заменить
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setContact(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full justify-between" onClick={() => setPickerOpen(true)}>
                      <span className="text-muted-foreground">Выбрать существующий контакт</span>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Менеджер продажи</Label>
                  <Select value={responsibleId} onValueChange={setResponsibleId} disabled={!canReassign}>
                    <SelectTrigger><SelectValue placeholder="Выберите сотрудника" /></SelectTrigger>
                    <SelectContent>
                      {staff.map((item) => (
                        <SelectItem key={item.user_id} value={item.user_id}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!canReassign && <p className="text-[11px] text-muted-foreground">Новая сделка назначается на вас.</p>}
                </div>

                {/* Title */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Название сделки</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Например: Продление BUSINESS на 12 мес"
                  />
                </div>

                {/* Pipeline & Stage */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Воронка</Label>
                    <Select value={pipelineId} onValueChange={setPipelineId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите воронку" />
                      </SelectTrigger>
                      <SelectContent>
                        {pipelines.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Стадия</Label>
                    <Select value={stageId} onValueChange={setStageId} disabled={!pipelineStages.length}>
                      <SelectTrigger>
                        <SelectValue placeholder="Стадия" />
                      </SelectTrigger>
                      <SelectContent>
                        {pipelineStages.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Product & Tariff */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Package className="h-3.5 w-3.5" /> Продукт
                    </Label>
                    <Select value={productId} onValueChange={setProductId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Не выбран" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— без продукта —</SelectItem>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Тариф</Label>
                    <Select value={tariffId} onValueChange={setTariffId} disabled={productId === "__none__"}>
                      <SelectTrigger>
                        <SelectValue placeholder="Не выбран" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— без тарифа —</SelectItem>
                        {productTariffs.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Amount */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Coins className="h-3.5 w-3.5" /> Сумма
                    </Label>
                    <Input
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Валюта</Label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Примечание</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Договорённости, источник, контекст…"
                    className="resize-none"
                  />
                </div>
              </div>

              <DialogFooter className="mt-6 gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                  Отмена
                </Button>
                <Button onClick={submit} disabled={saving || !contact} className="min-w-[160px]">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Handshake className="h-4 w-4 mr-2" />}
                  Создать сделку
                </Button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ContactPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(c) => {
          setContact(c);
          setPickerOpen(false);
        }}
        options={{ title: "Выбор контакта для сделки", helperText: "Ищите по имени, email, телефону или Telegram" }}
      />
    </>
  );
}
