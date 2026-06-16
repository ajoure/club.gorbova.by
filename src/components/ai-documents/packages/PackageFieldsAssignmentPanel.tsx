/**
 * PackageFieldsAssignmentPanel — read-only token-driven view (V2).
 *
 * Раньше панель управляла записями в `document_package_item_field_assignments`:
 * админ вручную включал каждое pf-поле для каждого документа, выбирал
 * видимость (ask_client / admin_only / hidden_with_default) и override
 * обязательности. Это путало пользователя и приводило к ошибке
 * `dpifa_invalid_references` при включении.
 *
 * Новая модель: набор pf-полей документа определяется **токенами в DOCX**.
 * Что встречается в `{{pf-XXXXXX}}` активной версии шаблона — то и
 * показывается клиенту в анкете. Никаких ручных тумблеров.
 *
 * Эта панель — просто диагностика: какие pf-поля каталога реально
 * подхватываются этим документом. Кнопка «копировать токен» сохранена.
 */
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plug, Info, Copy, AlertTriangle, Loader2 } from "lucide-react";
import { HelpTooltip } from "@/components/help/HelpComponents";
import {
  usePackageFieldCatalog,
  type PackageFieldRow,
} from "@/hooks/usePackageFieldCatalog";
import { usePackageDetectedFields } from "@/hooks/usePackageDetectedFields";

interface Props {
  packageTemplateId: string;
  packageTemplateItemId: string;
}

function copyToken(publicId: string) {
  const token = `{{${publicId}}}`;
  navigator.clipboard?.writeText(token).catch(() => {});
}

export function PackageFieldsAssignmentPanel({
  packageTemplateId,
  packageTemplateItemId,
}: Props) {
  const { fields, isLoading: catalogLoading } = usePackageFieldCatalog(packageTemplateId);
  const { byItemId, isLoading: detectLoading } = usePackageDetectedFields(packageTemplateId);

  const detectedPublicIds = byItemId[packageTemplateItemId] ?? [];

  const { matched, unknownTokens } = useMemo(() => {
    const byPublic = new Map<string, PackageFieldRow>();
    for (const f of fields) if (f.public_id) byPublic.set(f.public_id, f);
    const matched: PackageFieldRow[] = [];
    const unknownTokens: string[] = [];
    for (const pid of detectedPublicIds) {
      const f = byPublic.get(pid);
      if (f && f.is_active) matched.push(f);
      else unknownTokens.push(pid);
    }
    return { matched, unknownTokens };
  }, [fields, detectedPublicIds]);

  if (catalogLoading || detectLoading) {
    return (
      <div className="border-t pt-3 mt-2">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (detectedPublicIds.length === 0) {
    return (
      <div className="border-t pt-3 mt-2 text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-0.5 shrink-0" />
        В DOCX этого шаблона не найдено токенов <code className="font-mono">{`{{pf-XXXXXX}}`}</code>.
        Добавьте поля пакета в текст документа — они появятся здесь автоматически
        и будут спрошены у клиента в анкете один раз на весь пакет.
      </div>
    );
  }

  return (
    <div className="border-t pt-3 mt-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Plug className="h-3.5 w-3.5 text-indigo-500" />
        <h4 className="text-[12px] font-semibold">Поля пакета в этом документе</h4>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5">
          {matched.length} найдено
        </Badge>
      </div>

      <div className="space-y-1.5">
        {matched.map((field) => (
          <div
            key={field.id}
            className="border rounded p-2 flex items-center gap-2 flex-wrap bg-card"
          >
            <span className="text-[12px] font-medium flex-1 min-w-0 truncate">
              {field.label}
            </span>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono">
              {field.public_id}
            </Badge>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
              {field.data_type}
            </Badge>
            {field.required && (
              <Badge className="text-[10px] h-4 px-1.5 bg-rose-100 text-rose-700 border-rose-200">
                обязат.
              </Badge>
            )}
            <HelpTooltip
              helpKey=""
              customShort={`Скопировать токен {{${field.public_id}}} для вставки в DOCX.`}
              alwaysShow
            >
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => copyToken(field.public_id)}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </HelpTooltip>
          </div>
        ))}

        {unknownTokens.length > 0 && (
          <div className="border border-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded p-2 text-[11px] text-amber-700 dark:text-amber-300 space-y-1">
            <div className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3 w-3" />
              Незнакомые pf-токены в шаблоне
            </div>
            <div className="flex flex-wrap gap-1">
              {unknownTokens.map((t) => (
                <code
                  key={t}
                  className="font-mono text-[10px] bg-background border px-1 py-0.5 rounded"
                >
                  {t}
                </code>
              ))}
            </div>
            <p className="text-[10px] opacity-80">
              Эти токены есть в DOCX, но не найдены в каталоге активных полей пакета.
              Создайте их во вкладке «Роли и поля пакета» или удалите из шаблона.
            </p>
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground flex items-start gap-1">
        <Info className="h-2.5 w-2.5 mt-0.5 shrink-0" />
        Поле создаётся один раз в каталоге пакета и автоматически появляется
        в любом документе, где встречается его токен. Клиент заполняет его
        один раз на всю сессию.
      </p>
    </div>
  );
}
