import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ButtonActionType } from "@/services/sitePages/types";
import type { AnchorsRegistry } from "@/hooks/useSitePageAnchors";
import { HelpIcon } from "@/components/help/HelpComponents";

interface ButtonBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
  /** Реестр anchors/blocks страницы. Если не передан — доступен только тип 'link' (backward-compat). */
  registry?: AnchorsRegistry;
  /** id текущего блока для запрета self-target */
  currentBlockId?: string;
}

const ACTION_LABELS: Record<ButtonActionType, string> = {
  link: "Ссылка (URL)",
  scroll_to_anchor: "Прокрутить к якорю",
  show_block: "Показать блок",
  toggle_block: "Переключить видимость блока",
  open_form: "Открыть форму",
};

export function ButtonBlockEditor({ content, onChange, registry, currentBlockId }: ButtonBlockEditorProps) {
  const action = (content.action as { type?: ButtonActionType; target?: string } | undefined) || { type: "link", target: "" };
  const actionType: ButtonActionType = action.type || "link";
  const target = action.target || "";

  const updateAction = (patch: Partial<{ type: ButtonActionType; target: string }>) => {
    const next = { type: actionType, target, ...patch };
    // Сменили тип → сбросить target (несовместимые цели)
    if (patch.type && patch.type !== actionType) next.target = "";
    onChange({ ...content, action: next });
  };

  // Список целей по типу действия (только stable id / anchorId — никаких title/index)
  const targetOptions = (() => {
    if (!registry) return [];
    if (actionType === "scroll_to_anchor") {
      return registry.anchors
        .filter((a) => a.blockId !== currentBlockId)
        .map((a) => ({ value: a.anchorId, label: `#${a.anchorId}` }));
    }
    if (actionType === "show_block" || actionType === "toggle_block") {
      return registry.blocks
        .filter((b) => b.blockId !== currentBlockId)
        .map((b) => ({
          value: b.blockId,
          label: `${b.label} (${b.type}${b.anchorId ? ` · #${b.anchorId}` : ""})`,
        }));
    }
    if (actionType === "open_form") {
      return registry.blocks
        .filter((b) => b.type === "form" && b.blockId !== currentBlockId)
        .map((b) => ({ value: b.blockId, label: `${b.label} (форма)` }));
    }
    return [];
  })();

  const targetMissing = actionType !== "link" && target && registry && !targetOptions.some((o) => o.value === target);

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Текст кнопки</Label>
        <RichTextarea inline value={(content.text as string) || ""} onChange={(v) => onChange({ ...content, text: v })} />
      </div>

      {/* ─── Action selector ─── */}
      <div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs">Действие при клике</Label>
          <HelpIcon helpKey="site_builder.actions.type" />
        </div>
        <Select value={actionType} onValueChange={(v) => updateAction({ type: v as ButtonActionType })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(ACTION_LABELS) as ButtonActionType[]).map((t) => (
              <SelectItem key={t} value={t}>{ACTION_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {actionType === "link" && (
        <div>
          <Label className="text-xs">URL</Label>
          <Input
            value={(content.link as string) || ""}
            onChange={(e) => onChange({ ...content, link: e.target.value })}
            placeholder="https://..."
          />
        </div>
      )}

      {actionType !== "link" && (
        <div>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs">Цель действия</Label>
            <HelpIcon helpKey="site_builder.actions.target" />
          </div>
          {targetOptions.length === 0 ? (
            <p className="text-[11px] text-muted-foreground border rounded-md p-2">
              {actionType === "scroll_to_anchor"
                ? "Нет якорей на странице. Задайте Anchor ID в настройках блока."
                : actionType === "open_form"
                  ? "На странице нет блоков типа «Форма»."
                  : "Нет других блоков на странице."}
            </p>
          ) : (
            <Select value={target} onValueChange={(v) => updateAction({ target: v })}>
              <SelectTrigger><SelectValue placeholder="Выберите цель…" /></SelectTrigger>
              <SelectContent>
                {targetOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {targetMissing && (
            <p className="text-[11px] text-destructive mt-1">
              Текущая цель не найдена на странице — выберите новую.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-xs">Стиль</Label>
          <Select value={(content.variant as string) || "primary"} onValueChange={(v) => onChange({ ...content, variant: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="primary">Основная</SelectItem>
              <SelectItem value="secondary">Дополнительная</SelectItem>
              <SelectItem value="outline">Контурная</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Размер</Label>
          <Select value={(content.size as string) || "md"} onValueChange={(v) => onChange({ ...content, size: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sm">Маленький</SelectItem>
              <SelectItem value="md">Средний</SelectItem>
              <SelectItem value="lg">Большой</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Выравнивание</Label>
          <Select value={(content.alignment as string) || "center"} onValueChange={(v) => onChange({ ...content, alignment: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Лево</SelectItem>
              <SelectItem value="center">Центр</SelectItem>
              <SelectItem value="right">Право</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
