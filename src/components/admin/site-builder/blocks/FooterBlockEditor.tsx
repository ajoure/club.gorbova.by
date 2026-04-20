import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Trash2, ArrowUp, ArrowDown, ChevronDown } from "lucide-react";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/services/sitePages/types";
import { buildFooterDefaultContent, type FooterBlockContent, type FooterNavItem, type FooterSocialItem } from "@/components/layout/footerDefaults";

interface FooterBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  telegram: "Telegram",
  instagram: "Instagram",
  vk: "ВКонтакте",
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  x: "X (Twitter)",
};

function normalizeContent(content: Record<string, unknown>): FooterBlockContent {
  const defaults = buildFooterDefaultContent();
  return {
    brand: { ...defaults.brand, ...((content.brand as object) ?? {}) } as FooterBlockContent["brand"],
    company: { ...defaults.company, ...((content.company as object) ?? {}) } as FooterBlockContent["company"],
    navigation: { ...defaults.navigation, ...((content.navigation as object) ?? {}) } as FooterBlockContent["navigation"],
    legal: { ...defaults.legal, ...((content.legal as object) ?? {}) } as FooterBlockContent["legal"],
    social: { ...defaults.social, ...((content.social as object) ?? {}) } as FooterBlockContent["social"],
    payments: { ...defaults.payments, ...((content.payments as object) ?? {}) } as FooterBlockContent["payments"],
    copyright: { ...defaults.copyright, ...((content.copyright as object) ?? {}) } as FooterBlockContent["copyright"],
  };
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-lg">
      <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50">
        <span className="text-sm font-medium">{title}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 pt-1 space-y-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function FooterBlockEditor({ content, onChange }: FooterBlockEditorProps) {
  const data = normalizeContent(content);

  const update = <K extends keyof FooterBlockContent>(key: K, patch: Partial<FooterBlockContent[K]>) => {
    onChange({ ...content, [key]: { ...data[key], ...patch } });
  };

  const updateNavItems = (key: "navigation" | "legal", items: FooterNavItem[]) => {
    onChange({ ...content, [key]: { ...data[key], items } });
  };

  const updateSocialItems = (items: FooterSocialItem[]) => {
    onChange({ ...content, social: { ...data.social, items } });
  };

  const moveItem = <T,>(arr: T[], from: number, to: number): T[] => {
    if (to < 0 || to >= arr.length) return arr;
    const next = [...arr];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };

  const renderNavList = (key: "navigation" | "legal") => {
    const items = data[key].items;
    return (
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="border rounded-md p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Ссылка {i + 1}</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateNavItems(key, moveItem(items, i, i - 1))} disabled={i === 0}>
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateNavItems(key, moveItem(items, i, i + 1))} disabled={i === items.length - 1}>
                  <ArrowDown className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => updateNavItems(key, items.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <Input
              value={item.label}
              onChange={(e) => updateNavItems(key, items.map((it, j) => (j === i ? { ...it, label: e.target.value } : it)))}
              placeholder="Название"
            />
            <Input
              value={item.href}
              onChange={(e) => updateNavItems(key, items.map((it, j) => (j === i ? { ...it, href: e.target.value } : it)))}
              placeholder="/path или https://..."
            />
            <div className="flex items-center justify-between">
              <Label className="text-xs">Открывать в новой вкладке</Label>
              <Switch
                checked={!!item.openInNewTab}
                onCheckedChange={(v) => updateNavItems(key, items.map((it, j) => (j === i ? { ...it, openInNewTab: v } : it)))}
              />
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" className="w-full" onClick={() => updateNavItems(key, [...items, { label: "", href: "", openInNewTab: false }])}>
          <Plus className="h-3 w-3 mr-1" /> Добавить ссылку
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Изменения в этом блоке применяются только к этой странице. Глобальный подвал других страниц не меняется.
      </p>

      <Section title="Бренд" defaultOpen>
        <ToggleRow label="Показывать блок бренда" checked={data.brand.showBrand} onChange={(v) => update("brand", { showBrand: v })} />
        <div>
          <Label className="text-xs">URL логотипа</Label>
          <Input value={data.brand.logoUrl} onChange={(e) => update("brand", { logoUrl: e.target.value })} placeholder="/logo.png" />
        </div>
        <div>
          <Label className="text-xs">Название</Label>
          <Input value={data.brand.name} onChange={(e) => update("brand", { name: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Подпись</Label>
          <Input value={data.brand.subtitle} onChange={(e) => update("brand", { subtitle: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Описание (необязательно)</Label>
          <Textarea value={data.brand.description} onChange={(e) => update("brand", { description: e.target.value })} rows={2} />
        </div>
      </Section>

      <Section title="Компания и контакты">
        <ToggleRow label="Показывать блок компании" checked={data.company.showCompany} onChange={(v) => update("company", { showCompany: v })} />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Название</Label>
            <Input value={data.company.name} onChange={(e) => update("company", { name: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">УНП</Label>
            <Input value={data.company.unp} onChange={(e) => update("company", { unp: e.target.value })} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Юридический адрес</Label>
          <Input value={data.company.legalAddress} onChange={(e) => update("company", { legalAddress: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Почтовый адрес</Label>
          <Input value={data.company.mailingAddress} onChange={(e) => update("company", { mailingAddress: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Телефон (отображаемый)</Label>
            <Input value={data.company.phone} onChange={(e) => update("company", { phone: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">tel: ссылка</Label>
            <Input value={data.company.phoneHref} onChange={(e) => update("company", { phoneHref: e.target.value })} placeholder="tel:+375..." />
          </div>
        </div>
        <div>
          <Label className="text-xs">Email</Label>
          <Input value={data.company.email} onChange={(e) => update("company", { email: e.target.value })} placeholder="mail@example.com" />
        </div>
        <div>
          <Label className="text-xs">Режим работы</Label>
          <Input value={data.company.workHours} onChange={(e) => update("company", { workHours: e.target.value })} />
        </div>
      </Section>

      <Section title="Навигация">
        <ToggleRow label="Показывать блок навигации" checked={data.navigation.showNavigation} onChange={(v) => update("navigation", { showNavigation: v })} />
        <div>
          <Label className="text-xs">Заголовок</Label>
          <Input value={data.navigation.title} onChange={(e) => update("navigation", { title: e.target.value })} />
        </div>
        {renderNavList("navigation")}
      </Section>

      <Section title="Документы">
        <ToggleRow label="Показывать блок документов" checked={data.legal.showLegal} onChange={(v) => update("legal", { showLegal: v })} />
        <div>
          <Label className="text-xs">Заголовок</Label>
          <Input value={data.legal.title} onChange={(e) => update("legal", { title: e.target.value })} />
        </div>
        {renderNavList("legal")}
      </Section>

      <Section title="Соцсети">
        <ToggleRow label="Показывать блок соцсетей" checked={data.social.showSocial} onChange={(v) => update("social", { showSocial: v })} />
        <div>
          <Label className="text-xs">Заголовок</Label>
          <Input value={data.social.title} onChange={(e) => update("social", { title: e.target.value })} />
        </div>
        <div className="space-y-2">
          {data.social.items.map((item, i) => (
            <div key={i} className="border rounded-md p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Соцсеть {i + 1}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => updateSocialItems(data.social.items.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <Select value={item.platform} onValueChange={(v) => updateSocialItems(data.social.items.map((it, j) => (j === i ? { ...it, platform: v } : it)))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOCIAL_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>{PLATFORM_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={item.url} onChange={(e) => updateSocialItems(data.social.items.map((it, j) => (j === i ? { ...it, url: e.target.value } : it)))} placeholder="https://..." />
              <Input value={item.label} onChange={(e) => updateSocialItems(data.social.items.map((it, j) => (j === i ? { ...it, label: e.target.value } : it)))} placeholder="Подпись (необязательно)" />
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-full" onClick={() => updateSocialItems([...data.social.items, { platform: "telegram", url: "", label: "" }])}>
            <Plus className="h-3 w-3 mr-1" /> Добавить соцсеть
          </Button>
        </div>
      </Section>

      <Section title="Прочее">
        <ToggleRow label="Показывать платёжные системы" checked={data.payments.showPayments} onChange={(v) => update("payments", { showPayments: v })} />
        <ToggleRow label="Показывать copyright" checked={data.copyright.showCopyright} onChange={(v) => update("copyright", { showCopyright: v })} />
        <div>
          <Label className="text-xs">Текст copyright (пусто → авто «© {"{год}"} {data.company.name}»)</Label>
          <Input value={data.copyright.text} onChange={(e) => update("copyright", { text: e.target.value })} placeholder="© 2025 Моя компания. Все права защищены." />
        </div>
      </Section>
    </div>
  );
}
