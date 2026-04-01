import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSiteDomainBindings } from "@/hooks/useSiteDomainBindings";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Globe, Home } from "lucide-react";
import { useState } from "react";
import { normalizeDomain } from "@/services/sitePages/domainUtils";
import { Badge } from "@/components/ui/badge";

interface SiteSettingsPanelProps {
  pageId: string;
  title: string;
  slug: string;
  seoSettings: Record<string, unknown>;
  themeSettings: Record<string, unknown>;
  onTitleChange: (v: string) => void;
  onSlugChange: (v: string) => void;
  onSeoChange: (v: Record<string, unknown>) => void;
  onThemeChange: (v: Record<string, unknown>) => void;
}

export function SiteSettingsPanel({
  pageId, title, slug, seoSettings, themeSettings,
  onTitleChange, onSlugChange, onSeoChange, onThemeChange,
}: SiteSettingsPanelProps) {
  const { bindings, bindDomain, unbindDomain, setHome, isBinding, isSettingHome } = useSiteDomainBindings(pageId);
  const [newDomain, setNewDomain] = useState("");

  const handleAddDomain = () => {
    if (!newDomain.trim()) return;
    try {
      const normalized = normalizeDomain(newDomain);
      bindDomain(normalized);
      setNewDomain("");
    } catch {
      // normalizeDomain throws if empty after cleanup
    }
  };

  const handleDomainInput = (value: string) => {
    // Strip protocol/path on paste
    let cleaned = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    setNewDomain(cleaned);
  };

  const handleUnbind = (binding: typeof bindings[0]) => {
    if (binding.is_home) {
      if (!confirm("Это главная страница домена. После удаления корневой адрес (/) будет отдавать 404. Продолжить?")) {
        return;
      }
    }
    unbindDomain(binding.id);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* General */}
      <Card>
        <CardHeader><CardTitle className="text-base">Основные</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Название</Label>
            <Input value={title} onChange={(e) => onTitleChange(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Адрес страницы</Label>
            <Input
              value={slug}
              onChange={(e) => onSlugChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            />
            {bindings.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                URL: {bindings[0].domain}/<strong>{slug || "..."}</strong>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Привяжите домен, чтобы увидеть URL страницы
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* SEO */}
      <Card>
        <CardHeader><CardTitle className="text-base">SEO</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Meta Title</Label>
            <Input
              value={(seoSettings.title as string) || ""}
              onChange={(e) => onSeoChange({ ...seoSettings, title: e.target.value })}
              placeholder="Заголовок страницы для поисковиков"
            />
          </div>
          <div className="space-y-2">
            <Label>Meta Description</Label>
            <Textarea
              value={(seoSettings.description as string) || ""}
              onChange={(e) => onSeoChange({ ...seoSettings, description: e.target.value })}
              placeholder="Описание страницы"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>OG Image URL</Label>
            <Input
              value={(seoSettings.og_image as string) || ""}
              onChange={(e) => onSeoChange({ ...seoSettings, og_image: e.target.value })}
              placeholder="https://..."
            />
          </div>
        </CardContent>
      </Card>

      {/* Theme */}
      <Card>
        <CardHeader><CardTitle className="text-base">Тема</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Основной цвет</Label>
            <Input
              value={(themeSettings.primary_color as string) || ""}
              onChange={(e) => onThemeChange({ ...themeSettings, primary_color: e.target.value })}
              placeholder="#4F46E5"
            />
          </div>
          <div className="space-y-2">
            <Label>Шрифт</Label>
            <Input
              value={(themeSettings.font_family as string) || ""}
              onChange={(e) => onThemeChange({ ...themeSettings, font_family: e.target.value })}
              placeholder="Inter, sans-serif"
            />
          </div>
        </CardContent>
      </Card>

      {/* Domain Bindings */}
      <Card>
        <CardHeader><CardTitle className="text-base">Привязка доменов</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {bindings.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 p-2 border rounded">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{b.domain}</span>
                {b.is_home && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Home className="h-3 w-3" />
                    Главная
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!b.is_home && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={isSettingHome}
                    onClick={() => setHome({ domain: b.domain, targetPageId: pageId })}
                  >
                    <Home className="h-3 w-3 mr-1" />
                    Сделать главной
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleUnbind(b)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              value={newDomain}
              onChange={(e) => handleDomainInput(e.target.value)}
              placeholder="example.gorbova.by"
              className="flex-1"
            />
            <Button onClick={handleAddDomain} disabled={isBinding || !newDomain.trim()} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Привязать
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
