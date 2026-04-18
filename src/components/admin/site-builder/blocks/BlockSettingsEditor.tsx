import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BlockSettings } from "@/services/sitePages/types";
import { isValidAnchorSlug } from "@/hooks/useSitePageAnchors";
import { HelpIcon } from "@/components/help/HelpComponents";
import { blockHasAnyAdvancedCapability, blockHasCapability } from "@/lib/sitePages/blockCapabilities";

interface BlockSettingsEditorProps {
  settings: BlockSettings;
  onChange: (settings: BlockSettings) => void;
  /** anchorIds других блоков (без текущего) — для проверки дубликата inline */
  otherAnchorIds?: string[];
  /** Тип блока — для capability whitelist расширенных настроек */
  blockType?: string;
}

export function BlockSettingsEditor({ settings, onChange, otherAnchorIds = [], blockType = "" }: BlockSettingsEditorProps) {
  const update = (patch: Partial<BlockSettings>) => onChange({ ...settings, ...patch });
  const showAdvanced = blockHasAnyAdvancedCapability(blockType);
  const canCard = blockHasCapability(blockType, "cardStyle");
  const canAlign = blockHasCapability(blockType, "alignment");
  const canMobilePadding = blockHasCapability(blockType, "mobilePadding");

  const anchor = settings.anchorId || "";
  const anchorInvalid = anchor !== "" && !isValidAnchorSlug(anchor);
  const anchorDuplicate = anchor !== "" && otherAnchorIds.includes(anchor);

  return (
    <div className="space-y-4 border-t pt-4 mt-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Настройки блока</p>

      {/* ─── Anchor ─── */}
      <div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs">Якорь (anchor ID)</Label>
          <HelpIcon helpKey="site_builder.block.settings.anchor" />
        </div>
        <Input
          value={anchor}
          onChange={(e) => update({ anchorId: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
          placeholder="например: tariffs, faq, about"
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Латиница, цифры, дефис. Уникален в пределах страницы. Используется для прокрутки и в URL #anchor.
        </p>
        {anchorInvalid && (
          <p className="text-[11px] text-destructive mt-1">Допустимы только a-z, 0-9, '-'. 1–48 символов.</p>
        )}
        {anchorDuplicate && (
          <p className="text-[11px] text-destructive mt-1">Этот якорь уже используется в другом блоке.</p>
        )}
      </div>

      {/* ─── Initial visibility ─── */}
      <div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs">Начальная видимость</Label>
          <HelpIcon helpKey="site_builder.block.settings.visibility" />
        </div>
        <Select
          value={settings.initialVisibility || "visible"}
          onValueChange={(v) => update({ initialVisibility: v as BlockSettings["initialVisibility"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="visible">Виден изначально</SelectItem>
            <SelectItem value="hidden">Скрыт (показать через действие кнопки)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Отступ сверху (px)</Label>
          <Input
            type="number"
            min={0}
            value={settings.paddingTop}
            onChange={(e) => update({ paddingTop: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label className="text-xs">Отступ снизу (px)</Label>
          <Input
            type="number"
            min={0}
            value={settings.paddingBottom}
            onChange={(e) => update({ paddingBottom: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div>
        <Label className="text-xs">Цвет фона</Label>
        <Input
          value={settings.backgroundColor}
          onChange={(e) => update({ backgroundColor: e.target.value })}
          placeholder="#ffffff или hsl(...)"
        />
      </div>

      <div>
        <Label className="text-xs">Фоновое изображение (URL)</Label>
        <Input
          value={settings.backgroundImage}
          onChange={(e) => update({ backgroundImage: e.target.value })}
          placeholder="https://..."
        />
      </div>

      <div>
        <Label className="text-xs">Цвет текста</Label>
        <Input
          value={settings.textColor}
          onChange={(e) => update({ textColor: e.target.value })}
          placeholder="#000000"
        />
      </div>

      <div>
        <Label className="text-xs">Максимальная ширина</Label>
        <Select value={settings.maxWidth} onValueChange={(v) => update({ maxWidth: v as BlockSettings["maxWidth"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sm">Узкая (sm)</SelectItem>
            <SelectItem value="md">Средняя (md)</SelectItem>
            <SelectItem value="lg">Широкая (lg)</SelectItem>
            <SelectItem value="xl">Очень широкая (xl)</SelectItem>
            <SelectItem value="full">На всю ширину</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs">На всю ширину</Label>
        <Switch checked={settings.fullWidth} onCheckedChange={(v) => update({ fullWidth: v })} />
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs">Скрыть на мобильных</Label>
        <Switch checked={settings.hideOnMobile} onCheckedChange={(v) => update({ hideOnMobile: v })} />
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs">Скрыть на десктопе</Label>
        <Switch checked={settings.hideOnDesktop} onCheckedChange={(v) => update({ hideOnDesktop: v })} />
      </div>

      {/* ─── Sprint v3: reusable styling controls (capability-gated) ─── */}
      {showAdvanced && (
        <div className="border-t pt-3 mt-2 space-y-3">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Расширенное оформление
          </p>

          {canMobilePadding && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Отступ сверху на мобильном (px)</Label>
                <Input
                  type="number"
                  min={0}
                  value={settings.mobilePaddingTop ?? ""}
                  onChange={(e) => update({ mobilePaddingTop: e.target.value === "" ? undefined : Number(e.target.value) })}
                  placeholder="как на десктопе"
                />
              </div>
              <div>
                <Label className="text-xs">Отступ снизу на мобильном (px)</Label>
                <Input
                  type="number"
                  min={0}
                  value={settings.mobilePaddingBottom ?? ""}
                  onChange={(e) => update({ mobilePaddingBottom: e.target.value === "" ? undefined : Number(e.target.value) })}
                  placeholder="как на десктопе"
                />
              </div>
            </div>
          )}

          {canCard && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Стиль карточки</Label>
                  <Select
                    value={settings.cardStyle ?? "default"}
                    onValueChange={(v) => update({ cardStyle: v === "default" ? undefined : (v as BlockSettings["cardStyle"]) })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">По умолчанию</SelectItem>
                      <SelectItem value="plain">Без рамки</SelectItem>
                      <SelectItem value="bordered">С рамкой</SelectItem>
                      <SelectItem value="glass">Стекло</SelectItem>
                      <SelectItem value="filled">Залитая</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Скругление углов</Label>
                  <Select
                    value={settings.cardRadius ?? "default"}
                    onValueChange={(v) => update({ cardRadius: v === "default" ? undefined : (v as BlockSettings["cardRadius"]) })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">По умолчанию</SelectItem>
                      <SelectItem value="none">Без скругления</SelectItem>
                      <SelectItem value="sm">Небольшое</SelectItem>
                      <SelectItem value="md">Среднее</SelectItem>
                      <SelectItem value="lg">Большое</SelectItem>
                      <SelectItem value="xl">Очень большое</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Тень</Label>
                  <Select
                    value={settings.cardShadow ?? "default"}
                    onValueChange={(v) => update({ cardShadow: v === "default" ? undefined : (v as BlockSettings["cardShadow"]) })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">По умолчанию</SelectItem>
                      <SelectItem value="none">Без тени</SelectItem>
                      <SelectItem value="sm">Небольшая</SelectItem>
                      <SelectItem value="md">Средняя</SelectItem>
                      <SelectItem value="lg">Большая</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Прозрачность рамки (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={10}
                    value={settings.borderOpacity ?? ""}
                    onChange={(e) => update({ borderOpacity: e.target.value === "" ? undefined : Number(e.target.value) })}
                    placeholder="100"
                  />
                </div>
              </div>
            </>
          )}

          {canAlign && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Выравнивание заголовка</Label>
                <Select
                  value={settings.titleAlignment ?? "default"}
                  onValueChange={(v) => update({ titleAlignment: v === "default" ? undefined : (v as BlockSettings["titleAlignment"]) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">По умолчанию</SelectItem>
                    <SelectItem value="left">По левому краю</SelectItem>
                    <SelectItem value="center">По центру</SelectItem>
                    <SelectItem value="right">По правому краю</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Выравнивание элементов</Label>
                <Select
                  value={settings.itemAlignment ?? "default"}
                  onValueChange={(v) => update({ itemAlignment: v === "default" ? undefined : (v as BlockSettings["itemAlignment"]) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">По умолчанию</SelectItem>
                    <SelectItem value="left">По левому краю</SelectItem>
                    <SelectItem value="center">По центру</SelectItem>
                    <SelectItem value="right">По правому краю</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
