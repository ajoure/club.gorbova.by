import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BlockSettings } from "@/services/sitePages/types";
import { isValidAnchorSlug } from "@/hooks/useSitePageAnchors";
import { HelpIcon } from "@/components/help/HelpComponents";

interface BlockSettingsEditorProps {
  settings: BlockSettings;
  onChange: (settings: BlockSettings) => void;
  /** anchorIds других блоков (без текущего) — для проверки дубликата inline */
  otherAnchorIds?: string[];
}

export function BlockSettingsEditor({ settings, onChange, otherAnchorIds = [] }: BlockSettingsEditorProps) {
  const update = (patch: Partial<BlockSettings>) => onChange({ ...settings, ...patch });

  const anchor = settings.anchorId || "";
  const anchorInvalid = anchor !== "" && !isValidAnchorSlug(anchor);
  const anchorDuplicate = anchor !== "" && otherAnchorIds.includes(anchor);

  return (
    <div className="space-y-4 border-t pt-4 mt-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Настройки блока</p>

      {/* ─── Anchor (Site Builder Sprint v2) ─── */}
      <div>
        <Label className="text-xs">Якорь (anchor ID)</Label>
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
        <Label className="text-xs">Начальная видимость</Label>
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
    </div>
  );
}
