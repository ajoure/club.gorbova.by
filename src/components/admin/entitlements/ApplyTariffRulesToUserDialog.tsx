/**
 * Админ-инструмент ручного обновления entitlements пользователя по тарифу и продуктам.
 *
 * Сценарий: «у клиента BUSINESS Club, но бонусные продукты не выданы / истекли».
 * Админ выбирает пользователя (inline-поиск), тариф, опционально продукты-таргеты
 * и опционально срок доступа в днях (override).
 *
 * Под капотом — каноническая Edge-функция `rules-retroapply` (никаких новых RPC/edge).
 */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Play, Eye, AlertTriangle, User as UserIcon, Search, X, Mail, Phone, Check,
} from "lucide-react";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Если задан — пользователь зафиксирован, селектор скрыт. */
  fixedUserId?: string;
  fixedUserLabel?: string;
  onApplied?: () => void;
}

interface PreviewAction {
  action_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  target_product_id: string;
  target_product_code: string;
  target_product_name: string;
  category: string;
  current_expires_at: string | null;
  planned_expires_at: string | null;
  skip_reason: string | null;
}

interface PreviewResult {
  summary: {
    total: number;
    missing_access: number;
    aligned_update_needed: number;
    reducible_by_rule: number;
    already_satisfied: number;
    condition_not_met: number;
    expired_source_window?: number;
    conflict_existing: number;
    requires_manual_review: number;
  };
  actions: PreviewAction[];
  executed?: {
    targeted: number; created: number; updated: number; reactivated: number;
    skipped_idempotent: number; skipped_conflict: number; skipped_error: number;
    errors?: Array<{ action_id: string; error: string }>;
  };
}

interface ProfileHit {
  id: string;
  user_id?: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  missing_access: "Будет выдан доступ",
  aligned_update_needed: "Будет обновлён срок",
  reducible_by_rule: "Будет сокращён срок",
  already_satisfied: "Уже соответствует",
  condition_not_met: "Условие не выполнено",
  expired_source_window: "Срок уже в прошлом",
  conflict_existing: "Конфликт",
  requires_manual_review: "Требует решения",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function ApplyTariffRulesToUserDialog({
  open, onOpenChange, fixedUserId, fixedUserLabel, onApplied,
}: Props) {
  const [userId, setUserId] = useState<string>(fixedUserId || "");
  const [userLabel, setUserLabel] = useState<string>(fixedUserLabel || "");
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<ProfileHit[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tariffId, setTariffId] = useState<string>("");
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [recalculate, setRecalculate] = useState(true);
  const [durationDays, setDurationDays] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  // Inline user search (debounced) — only when no fixed user
  useEffect(() => {
    if (fixedUserId) return;
    const term = userQuery.trim();
    if (term.length < 2) {
      setUserResults([]);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setUserSearchLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("admin-search-profiles", {
          body: { query: term, limit: 20 },
        });
        if (error) throw error;
        if (data?.success) {
          setUserResults(data.results || []);
          setShowResults(true);
        }
      } catch (e: any) {
        toast.error("Ошибка поиска: " + (e?.message || String(e)));
      } finally {
        setUserSearchLoading(false);
      }
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [userQuery, fixedUserId]);

  // Load tariffs
  const { data: tariffs = [] } = useQuery({
    queryKey: ["apply-rules-tariffs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tariffs")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  // Load access_rules for selected tariff to extract candidate target products
  const { data: rulesForTariff = [] } = useQuery({
    queryKey: ["apply-rules-for-tariff", tariffId],
    queryFn: async () => {
      if (!tariffId) return [];
      const { data, error } = await supabase
        .from("access_rules")
        .select("id, conditions, is_active, target_ref, grant_target_type")
        .eq("is_active", true)
        .eq("tariff_id", tariffId);
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!tariffId,
  });

  const candidateProductIds = useMemo(() => {
    const set = new Set<string>();
    rulesForTariff.forEach((r: any) => {
      const c = r.conditions || {};
      if (Array.isArray(c.target_product_ids)) c.target_product_ids.forEach((id: string) => set.add(id));
      if (typeof c.target_product_id === "string") set.add(c.target_product_id);
      if (r.grant_target_type === "product_access" && r.target_ref) set.add(r.target_ref);
    });
    return [...set];
  }, [rulesForTariff]);

  const { data: candidateProducts = [] } = useQuery({
    queryKey: ["apply-rules-candidate-products", candidateProductIds],
    queryFn: async () => {
      if (candidateProductIds.length === 0) return [];
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name, code")
        .in("id", candidateProductIds)
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: candidateProductIds.length > 0,
  });

  const reset = useCallback(() => {
    setPreview(null);
    setSelectedProducts(new Set());
    setDurationDays("");
    if (!fixedUserId) {
      setUserQuery("");
      setUserResults([]);
    }
  }, [fixedUserId]);

  const pickUser = (hit: ProfileHit) => {
    if (!hit.user_id) {
      toast.error("У контакта нет связанного user_id (профиль не привязан к auth-пользователю).");
      return;
    }
    setUserId(hit.user_id);
    setUserLabel(hit.full_name || hit.email || hit.user_id);
    setUserQuery("");
    setUserResults([]);
    setShowResults(false);
    setPreview(null);
  };

  const clearUser = () => {
    setUserId("");
    setUserLabel("");
    setPreview(null);
  };

  const runRetroApply = useCallback(async (mode: "preview" | "execute") => {
    if (!userId) {
      toast.error("Выберите пользователя");
      return;
    }
    if (!tariffId) {
      toast.error("Выберите тариф");
      return;
    }
    const overrideDays = durationDays.trim() ? Number(durationDays) : 0;
    if (durationDays.trim() && (!Number.isFinite(overrideDays) || overrideDays <= 0 || overrideDays > 3650)) {
      toast.error("Срок доступа: введите число от 1 до 3650 дней");
      return;
    }
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        mode,
        source_tariff_id: tariffId,
        user_ids: [userId],
        recalculate_existing: recalculate,
      };
      if (selectedProducts.size > 0) {
        body.target_product_ids = [...selectedProducts];
      }
      if (overrideDays > 0) {
        body.duration_days_override = overrideDays;
      }
      if (mode === "execute") {
        body.apply_categories = ["missing_access", "aligned_update_needed"];
      }
      const { data, error } = await supabase.functions.invoke("rules-retroapply", { body });
      if (error) throw error;
      const result = data as PreviewResult;
      setPreview(result);
      if (mode === "execute") {
        const ex = result.executed;
        const total = (ex?.created || 0) + (ex?.updated || 0) + (ex?.reactivated || 0);
        if (total > 0) {
          toast.success(`Применено: создано ${ex?.created || 0}, обновлено ${ex?.updated || 0}, реактивировано ${ex?.reactivated || 0}`);
          onApplied?.();
        } else {
          toast.info("Изменений не потребовалось");
        }
      } else {
        const changes =
          result.summary.missing_access +
          result.summary.aligned_update_needed;
        toast.success(`Предпросмотр готов. К применению: ${changes}`);
      }
    } catch (err: any) {
      const msg = normalizeEdgeFunctionError(err?.message || String(err));
      toast.error("Ошибка: " + msg);
    } finally {
      setLoading(false);
    }
  }, [userId, tariffId, recalculate, selectedProducts, durationDays, onApplied]);

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const applicableActions = preview?.actions.filter(
    (a) => a.category === "missing_access" || a.category === "aligned_update_needed",
  ) || [];

  const allSelected = candidateProducts.length > 0 && selectedProducts.size === candidateProducts.length;
  const toggleAllProducts = () => {
    if (allSelected) setSelectedProducts(new Set());
    else setSelectedProducts(new Set(candidateProducts.map((p: any) => p.id)));
    setPreview(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Применить правила тарифа к пользователю</DialogTitle>
          <DialogDescription>
            Запускает канонические правила доступа (access_rules) точечно для одного пользователя.
            Можно ограничить продуктами и/или задать срок доступа вручную (перебивает rule.duration_days).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* User — inline search */}
          <div>
            <Label className="mb-2 block">Пользователь</Label>
            {fixedUserId ? (
              <div className="px-3 py-2 rounded-md border bg-muted/30 text-sm">
                {fixedUserLabel || fixedUserId}
              </div>
            ) : userId ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30 text-sm">
                <UserIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate flex-1">{userLabel || userId}</span>
                <Button type="button" variant="ghost" size="sm" onClick={clearUser}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="relative">
                <div className="flex items-center gap-2 px-3 rounded-md border focus-within:ring-2 focus-within:ring-ring">
                  <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    onFocus={() => userResults.length > 0 && setShowResults(true)}
                    placeholder="ФИО, email или телефон (мин. 2 символа)…"
                    className="border-0 focus-visible:ring-0 px-0 shadow-none"
                  />
                  {userSearchLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                {showResults && userResults.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 border rounded-md bg-popover shadow-md max-h-64 overflow-y-auto">
                    {userResults.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        onClick={() => pickUser(hit)}
                        className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex items-start gap-2 border-b last:border-0"
                      >
                        <UserIcon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{hit.full_name || "Без имени"}</div>
                          <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                            {hit.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{hit.email}</span>}
                            {hit.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{hit.phone}</span>}
                          </div>
                          {!hit.user_id && (
                            <div className="text-xs text-amber-600 mt-0.5">⚠ не привязан к auth-пользователю</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {showResults && userQuery.trim().length >= 2 && !userSearchLoading && userResults.length === 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 border rounded-md bg-popover shadow-md px-3 py-2 text-sm text-muted-foreground">
                    Ничего не найдено
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tariff */}
          <div>
            <Label className="mb-2 block">Тариф</Label>
            <Select value={tariffId} onValueChange={(v) => { setTariffId(v); setSelectedProducts(new Set()); setPreview(null); }}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите тариф" />
              </SelectTrigger>
              <SelectContent>
                {tariffs.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Target products (optional) */}
          {tariffId && candidateProducts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Продукты ({selectedProducts.size > 0 ? `выбрано ${selectedProducts.size}` : "все из правил"})</Label>
                <Button type="button" variant="ghost" size="sm" onClick={toggleAllProducts}>
                  <Check className="h-3 w-3 mr-1" />
                  {allSelected ? "Снять все" : "Выбрать все"}
                </Button>
              </div>
              <div className="max-h-44 overflow-y-auto rounded-md border p-2 space-y-1">
                {candidateProducts.map((p: any) => {
                  const checked = selectedProducts.has(p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/40 cursor-pointer text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setSelectedProducts((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(p.id); else next.delete(p.id);
                            return next;
                          });
                          setPreview(null);
                        }}
                      />
                      <span className="flex-1">{p.name}</span>
                      {p.code && <span className="text-muted-foreground text-xs">({p.code})</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {tariffId && candidateProducts.length === 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Активных правил доступа на этом тарифе не найдено. Применять нечего.</span>
            </div>
          )}

          {/* Duration override */}
          <div>
            <Label className="mb-2 block">Срок доступа в днях (необязательно)</Label>
            <Input
              type="number"
              min={1}
              max={3650}
              value={durationDays}
              onChange={(e) => { setDurationDays(e.target.value); setPreview(null); }}
              placeholder="По умолчанию — из правила/подписки"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Если задано — planned_expires = сейчас + N дней, перебивает rule.duration_days и окно подписки.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={recalculate} onCheckedChange={(v) => setRecalculate(!!v)} />
            <span>Пересчитывать сроки уже выданных доступов (выравнивать по правилу)</span>
          </label>

          {/* Preview result */}
          {preview && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="outline">Всего: {preview.summary.total}</Badge>
                <Badge className="bg-green-100 text-green-800 border-green-300">
                  Выдать: {preview.summary.missing_access}
                </Badge>
                <Badge className="bg-amber-100 text-amber-900 border-amber-300">
                  Обновить срок: {preview.summary.aligned_update_needed}
                </Badge>
                {preview.summary.already_satisfied > 0 && (
                  <Badge variant="secondary">Уже выдано: {preview.summary.already_satisfied}</Badge>
                )}
                {preview.summary.condition_not_met > 0 && (
                  <Badge variant="secondary">Условие не выполнено: {preview.summary.condition_not_met}</Badge>
                )}
                {(preview.summary.expired_source_window || 0) > 0 && (
                  <Badge variant="destructive">Срок в прошлом: {preview.summary.expired_source_window}</Badge>
                )}
                {preview.summary.conflict_existing > 0 && (
                  <Badge variant="destructive">Конфликт: {preview.summary.conflict_existing}</Badge>
                )}
              </div>

              {applicableActions.length > 0 && (
                <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
                  {applicableActions.map((a) => (
                    <div key={a.action_id} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{a.target_product_name}</span>
                        <Badge variant="outline" className="shrink-0">
                          {CATEGORY_LABEL[a.category] || a.category}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {a.current_expires_at && <>текущий до {formatDate(a.current_expires_at)} → </>}
                        <>планируется до {formatDate(a.planned_expires_at)}</>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {preview.executed && (
                <div className="text-sm rounded-md bg-muted/40 p-3">
                  Выполнено: создано {preview.executed.created}, обновлено {preview.executed.updated},
                  реактивировано {preview.executed.reactivated}
                  {(preview.executed.skipped_conflict + preview.executed.skipped_error) > 0 && (
                    <> · пропущено {preview.executed.skipped_conflict + preview.executed.skipped_error}</>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={loading}>
            Закрыть
          </Button>
          <Button
            variant="secondary"
            onClick={() => runRetroApply("preview")}
            disabled={loading || !userId || !tariffId}
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
            Предпросмотр
          </Button>
          <Button
            onClick={() => runRetroApply("execute")}
            disabled={loading || !preview || (preview.summary.missing_access + preview.summary.aligned_update_needed) === 0}
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Применить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
