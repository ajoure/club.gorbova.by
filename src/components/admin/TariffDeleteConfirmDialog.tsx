import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldCheck, Archive, Loader2, Info } from "lucide-react";
import {
  useTariffDeleteSafetyCheck,
  useArchiveTariff,
  useDeleteTariff,
} from "@/hooks/useProductsV2";
import {
  useOfferDeleteSafetyCheck,
  useArchiveTariffOffer,
  useDeleteTariffOffer,
} from "@/hooks/useTariffOffers";

type EntityType = "tariff" | "offer";

interface Props {
  open: boolean;
  entityType: EntityType;
  entityId: string | null;
  onClose: () => void;
}

interface SafetyResult {
  blockers: Record<string, number>;
  soft_links: Record<string, number>;
  cascade_will_remove: Record<string, number>;
  can_hard_delete: boolean;
  recommended_action: "soft_archive" | "hard_delete";
}

const BLOCKER_LABELS: Record<string, { label: string; hint: string }> = {
  orders_v2: {
    label: "Оплаченные заказы",
    hint: "Финансовая история. Удалять нельзя — используйте архив.",
  },
  subscriptions_v2_active: {
    label: "Активные подписки",
    hint: "Отмените их в разделе «Платежи → Подписки» или дождитесь окончания.",
  },
  subscriptions_v2_total: {
    label: "Подписки (всего, включая закрытые)",
    hint: "История подписок защищена. Архив скроет тариф, история сохранится.",
  },
  payment_links_active: {
    label: "Активные платёжные ссылки",
    hint: "Откройте «Платежи → Журнал ссылок», деактивируйте или перепривяжите на другой тариф.",
  },
  payment_reconcile_queue: {
    label: "Записи в очереди сверки",
    hint: "Дождитесь обработки очереди сверки платежей.",
  },
};

const SOFT_LABELS: Record<string, { label: string; hint: string }> = {
  live_event_access_rules: {
    label: "Правил доступа на эфирах",
    hint: "Откройте Эфиры → правила доступа и переназначьте на другой тариф.",
  },
  live_event_product_cta_bindings: {
    label: "CTA-кнопок на эфирах",
    hint: "Откройте Эфиры → CTA и переназначьте на другой тариф.",
  },
  broadcast_templates: {
    label: "Шаблонов рассылок с таргетингом",
    hint: "Откройте «Коммуникации → Шаблоны» и смените таргетинг.",
  },
};

const CASCADE_LABELS: Record<string, string> = {
  tariff_offers: "кнопок оплаты",
  tariff_features: "характеристик тарифа",
  tariff_prices: "цен",
  payment_plans: "планов оплаты",
  access_rules: "правил доступа",
  module_access: "правил доступа к модулям",
  lesson_price_rules: "ценовых правил уроков",
  document_generation_rules: "правил генерации документов",
  bepaid_product_mappings_unlinked: "связей с BePaid (отвяжутся)",
};

export function TariffDeleteConfirmDialog({ open, entityType, entityId, onClose }: Props) {
  const [safety, setSafety] = useState<SafetyResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const tariffSafety = useTariffDeleteSafetyCheck();
  const offerSafety = useOfferDeleteSafetyCheck();
  const archiveTariff = useArchiveTariff();
  const archiveOffer = useArchiveTariffOffer();
  const deleteTariff = useDeleteTariff();
  const deleteOffer = useDeleteTariffOffer();

  const isTariff = entityType === "tariff";
  const checkMutation = isTariff ? tariffSafety : offerSafety;
  const archiveMutation = isTariff ? archiveTariff : archiveOffer;
  const deleteMutation = isTariff ? deleteTariff : deleteOffer;
  const entityWord = isTariff ? "тариф" : "кнопку оплаты";

  useEffect(() => {
    if (open && entityId) {
      setSafety(null);
      setCheckError(null);
      checkMutation.mutateAsync(entityId).then(
        (res) => setSafety(res as SafetyResult),
        (error) => {
          setSafety(null);
          setCheckError(error?.message || "Не удалось проверить зависимости");
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entityId, entityType]);

  const isLoading = checkMutation.isPending || (!safety && !checkError && open);
  const blockers = safety
    ? Object.entries(safety.blockers).filter(([, v]) => Number(v) > 0)
    : [];
  const softLinks = safety
    ? Object.entries(safety.soft_links).filter(([, v]) => Number(v) > 0)
    : [];
  const cascade = safety
    ? Object.entries(safety.cascade_will_remove).filter(([, v]) => Number(v) > 0)
    : [];

  const scenario: "green" | "yellow" | "red" = !safety
    ? "green"
    : blockers.length > 0
    ? "red"
    : softLinks.length > 0
    ? "yellow"
    : "green";

  const handleArchive = async () => {
    if (!entityId) return;
    await archiveMutation.mutateAsync(entityId);
    onClose();
  };

  const handleHardDelete = async () => {
    if (!entityId) return;
    try {
      await deleteMutation.mutateAsync(entityId);
      onClose();
    } catch {
      // ошибка уже показана в toast хука; перезагружаем safety на случай новых блокеров
      if (entityId) {
        const res = await checkMutation.mutateAsync(entityId).catch(() => null);
        if (res) setSafety(res as SafetyResult);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Удалить {entityWord}?</DialogTitle>
          <DialogDescription>
            Перед удалением мы проверим, на что ссылается {entityWord}.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Проверяем зависимости…
          </div>
        )}

        {!isLoading && checkError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Не удалось проверить зависимости</AlertTitle>
            <AlertDescription>
              Обновите страницу и повторите. Если ошибка повторится, используйте «В архив» только после проверки связей в платежах и эфирах.
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && safety && (
          <div className="space-y-3">
            {scenario === "green" && (
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Можно удалить безопасно</AlertTitle>
                <AlertDescription>
                  Никаких заказов, подписок и активных ссылок не найдено.
                </AlertDescription>
              </Alert>
            )}

            {scenario === "yellow" && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Удаление возможно, но осиротеют связки</AlertTitle>
                <AlertDescription>
                  После удаления потребуется переназначить связанные сущности на другой тариф.
                  Рекомендуем сначала перевести в архив.
                </AlertDescription>
              </Alert>
            )}

            {scenario === "red" && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Удалить навсегда нельзя</AlertTitle>
                <AlertDescription>
                  На {entityWord} ссылаются финансовые записи. Используйте «Архив» — {entityWord}{" "}
                  пропадёт из публичных страниц и админских селектов, но история сохранится.
                </AlertDescription>
              </Alert>
            )}

            {blockers.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">Что мешает удалению:</div>
                <ul className="space-y-2">
                  {blockers.map(([key, count]) => {
                    const meta = BLOCKER_LABELS[key] ?? { label: key, hint: "" };
                    return (
                      <li key={key} className="rounded-md border p-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span>{meta.label}</span>
                          <Badge variant="destructive">{count}</Badge>
                        </div>
                        {meta.hint && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Как починить: {meta.hint}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {softLinks.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">Осиротеют после удаления:</div>
                <ul className="space-y-2">
                  {softLinks.map(([key, count]) => {
                    const meta = SOFT_LABELS[key] ?? { label: key, hint: "" };
                    return (
                      <li key={key} className="rounded-md border p-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span>{meta.label}</span>
                          <Badge variant="secondary">{count}</Badge>
                        </div>
                        {meta.hint && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Как починить: {meta.hint}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {cascade.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-medium">Будет удалено вместе с {entityWord}:</div>
                <div className="text-xs text-muted-foreground">
                  {cascade
                    .map(([k, v]) => `${v} ${CASCADE_LABELS[k] ?? k}`)
                    .join(", ")}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          {((safety && scenario !== "green") || checkError) && (
            <Button
              variant="secondary"
              onClick={handleArchive}
              disabled={archiveMutation.isPending || !entityId}
            >
              {archiveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Archive className="h-4 w-4 mr-1" />
              )}
              В архив
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={handleHardDelete}
            disabled={
              !safety ||
              !safety.can_hard_delete ||
              deleteMutation.isPending
            }
            title={
              safety && !safety.can_hard_delete
                ? "Удаление навсегда заблокировано — используйте Архив"
                : undefined
            }
          >
            {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Удалить навсегда
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
