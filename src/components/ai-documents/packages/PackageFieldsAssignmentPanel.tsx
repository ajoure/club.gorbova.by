/**
 * PackageFieldsAssignmentPanel — PATCH-PACKAGE-CUSTOM-FIELDS-V1 (B1).
 *
 * Назначение полей пакета конкретному шаблону документа (по
 * `package_template_item_id`). НЕ дублирует свойства каталога
 * (public_id / data_type / choices / default_kind / global label):
 * управляет только настройками использования поля в данном документе.
 *
 * Доступно из аккордеона «Анкеты документов». Каталог — read-only,
 * правится во вкладке «Роли и поля пакета» (PackageFieldsManager).
 */
import { useMemo } from "react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plug, ListChecks, Loader2, Info, Copy } from "lucide-react";
import { HelpTooltip } from "@/components/help/HelpComponents";
import {
  usePackageFieldCatalog,
  type PackageFieldRow,
} from "@/hooks/usePackageFieldCatalog";
import {
  useItemFieldAssignments,
  usePackageFieldAssignments,
  type PackageItemFieldAssignmentRow,
  type AssignmentVisibilityMode,
} from "@/hooks/useDocumentItemFieldAssignments";

interface Props {
  packageTemplateId: string;
  packageTemplateItemId: string;
}

const VIS_LABEL: Record<AssignmentVisibilityMode, string> = {
  ask_client: "Спросить у клиента",
  admin_only: "Только админ",
  hidden_with_default: "Скрыто (default)",
};

function copyToken(publicId: string) {
  const token = `{{${publicId}}}`;
  navigator.clipboard?.writeText(token).catch(() => {});
}

export function PackageFieldsAssignmentPanel({ packageTemplateId, packageTemplateItemId }: Props) {
  const { fields, isLoading: catalogLoading } = usePackageFieldCatalog(packageTemplateId);
  const { assignments, isLoading: assignLoading, upsert, upserting, remove } =
    useItemFieldAssignments(packageTemplateItemId);
  const { assignToAll, assigningToAll } = usePackageFieldAssignments(packageTemplateId);

  const byCatalogId = useMemo(() => {
    const m = new Map<string, PackageItemFieldAssignmentRow>();
    assignments.forEach((a) => m.set(a.field_catalog_id, a));
    return m;
  }, [assignments]);

  const activeFields = useMemo(
    () => fields.filter((f) => f.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [fields],
  );

  if (catalogLoading || assignLoading) {
    return (
      <div className="border-t pt-3 mt-2">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (activeFields.length === 0) {
    return (
      <div className="border-t pt-3 mt-2 text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-0.5 shrink-0" />
        В пакете пока нет активных полей. Создайте поле в подвкладке
        «Роли и поля пакета».
      </div>
    );
  }

  return (
    <div className="border-t pt-3 mt-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Plug className="h-3.5 w-3.5 text-indigo-500" />
        <h4 className="text-[12px] font-semibold">Поля пакета в этом документе</h4>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5">
          {assignments.filter((a) => a.is_active).length} / {activeFields.length}
        </Badge>
      </div>

      <div className="space-y-1.5">
        {activeFields.map((field) => {
          const a = byCatalogId.get(field.id) ?? null;
          const enabled = !!a?.is_active;
          return (
            <AssignmentRow
              key={field.id}
              field={field}
              assignment={a}
              enabled={enabled}
              packageTemplateItemId={packageTemplateItemId}
              onUpsert={upsert}
              upserting={upserting}
              onRemove={remove}
              onAssignToAll={assignToAll}
              assigningToAll={assigningToAll}
            />
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground flex items-start gap-1">
        <Info className="h-2.5 w-2.5 mt-0.5 shrink-0" />
        Параметры поля (тип, варианты, обязательность по умолчанию)
        задаются в каталоге. Здесь — только как поле используется
        в этом документе.
      </p>
    </div>
  );
}

interface RowProps {
  field: PackageFieldRow;
  assignment: PackageItemFieldAssignmentRow | null;
  enabled: boolean;
  packageTemplateItemId: string;
  onUpsert: (input: Parameters<ReturnType<typeof useItemFieldAssignments>["upsert"]>[0]) => void;
  upserting: boolean;
  onRemove: (id: string) => void;
  onAssignToAll: (fieldCatalogId: string) => void;
  assigningToAll: boolean;
}

function AssignmentRow({
  field, assignment, enabled, packageTemplateItemId,
  onUpsert, upserting, onRemove, onAssignToAll, assigningToAll,
}: RowProps) {
  const requiredOverride = assignment?.is_required_override;

  const handleToggle = (checked: boolean) => {
    if (!checked && assignment) {
      onRemove(assignment.id);
      return;
    }
    onUpsert({
      id: assignment?.id,
      package_template_item_id: packageTemplateItemId,
      field_catalog_id: field.id,
      visibility_mode: assignment?.visibility_mode ?? "ask_client",
      is_active: true,
      sort_order: assignment?.sort_order ?? field.sort_order,
    });
  };

  const handleVisibility = (v: AssignmentVisibilityMode) => {
    if (!assignment) return;
    onUpsert({
      id: assignment.id,
      package_template_item_id: packageTemplateItemId,
      field_catalog_id: field.id,
      visibility_mode: v,
      is_required_override: assignment.is_required_override,
      label_override: assignment.label_override,
      help_override: assignment.help_override,
      section_key: assignment.section_key,
      sort_order: assignment.sort_order,
      is_active: assignment.is_active,
    });
  };

  const handleRequiredOverride = (v: "inherit" | "required" | "optional") => {
    if (!assignment) return;
    const map = { inherit: null, required: true, optional: false } as const;
    onUpsert({
      id: assignment.id,
      package_template_item_id: packageTemplateItemId,
      field_catalog_id: field.id,
      visibility_mode: assignment.visibility_mode,
      is_required_override: map[v],
      label_override: assignment.label_override,
      help_override: assignment.help_override,
      section_key: assignment.section_key,
      sort_order: assignment.sort_order,
      is_active: assignment.is_active,
    });
  };

  const handleLabel = (label: string) => {
    if (!assignment) return;
    onUpsert({
      id: assignment.id,
      package_template_item_id: packageTemplateItemId,
      field_catalog_id: field.id,
      visibility_mode: assignment.visibility_mode,
      is_required_override: assignment.is_required_override,
      label_override: label.trim() || null,
      help_override: assignment.help_override,
      section_key: assignment.section_key,
      sort_order: assignment.sort_order,
      is_active: assignment.is_active,
    });
  };

  const reqValue: "inherit" | "required" | "optional" =
    requiredOverride === null || requiredOverride === undefined
      ? "inherit"
      : requiredOverride
        ? "required"
        : "optional";

  return (
    <div className="border rounded p-2 space-y-1.5 bg-card">
      <div className="flex items-center gap-2 flex-wrap">
        <Switch checked={enabled} onCheckedChange={handleToggle} disabled={upserting} />
        <span className="text-[12px] font-medium flex-1 min-w-0 truncate">{field.label}</span>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono">
          {field.public_id}
        </Badge>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5">
          {field.data_type}
        </Badge>
        {field.required && (
          <Badge className="text-[10px] h-4 px-1.5 bg-rose-100 text-rose-700 border-rose-200">
            обязат. (каталог)
          </Badge>
        )}
        <HelpTooltip helpKey="" customShort="Скопировать токен {{pf-XXXXXX}} для вставки в DOCX." alwaysShow>
          <Button
            size="icon" variant="ghost" className="h-6 w-6"
            onClick={() => copyToken(field.public_id)}
          >
            <Copy className="h-3 w-3" />
          </Button>
        </HelpTooltip>
        <HelpTooltip
          helpKey=""
          customShort="Назначить это поле всем шаблонам пакета (идемпотентно)."
          alwaysShow
        >
          <Button
            size="sm" variant="outline" className="h-6 px-2 text-[10px]"
            onClick={() => onAssignToAll(field.id)}
            disabled={assigningToAll}
          >
            <ListChecks className="h-3 w-3 mr-1" />
            Во все
          </Button>
        </HelpTooltip>
      </div>

      {enabled && assignment && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5 pl-9">
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Видимость</label>
            <Select
              value={assignment.visibility_mode}
              onValueChange={(v) => handleVisibility(v as AssignmentVisibilityMode)}
            >
              <SelectTrigger className="h-7 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["ask_client", "admin_only", "hidden_with_default"] as const).map((m) => (
                  <SelectItem key={m} value={m} className="text-[11px]">
                    {VIS_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Обязательность в этом документе</label>
            <Select value={reqValue} onValueChange={(v) => handleRequiredOverride(v as "inherit" | "required" | "optional")}>
              <SelectTrigger className="h-7 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit" className="text-[11px]">Как в каталоге</SelectItem>
                <SelectItem value="required" className="text-[11px]">Обязательно</SelectItem>
                <SelectItem value="optional" className="text-[11px]">Необязательно</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Локальная подпись (опц.)</label>
            <Input
              className="h-7 text-[11px]"
              defaultValue={assignment.label_override ?? ""}
              placeholder={field.label}
              onBlur={(e) => {
                const v = e.target.value;
                if ((assignment.label_override ?? "") !== v) handleLabel(v);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
