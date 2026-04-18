import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSitePage } from "@/hooks/useSitePages";
import { SitePageService } from "@/services/sitePages/SitePageService";
import { SitePublicationService } from "@/services/sitePages/SitePublicationService";
import { SiteBlockEditor } from "@/components/admin/site-builder/SiteBlockEditor";
import { SiteSettingsPanel } from "@/components/admin/site-builder/SiteSettingsPanel";
import { SitePreview } from "@/components/admin/site-builder/SitePreview";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Save, Globe, GlobeIcon, Loader2, Eye, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { SiteBlock, UpdateSitePageData } from "@/services/sitePages/types";

export default function AdminSiteEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: page, isLoading } = useSitePage(id || "");

  const [blocks, setBlocks] = useState<SiteBlock[]>([]);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [seoSettings, setSeoSettings] = useState<Record<string, unknown>>({});
  const [themeSettings, setThemeSettings] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [activeTab, setActiveTab] = useState("editor");

  useEffect(() => {
    if (page) {
      setBlocks((page.blocks as unknown as SiteBlock[]) || []);
      setTitle(page.title);
      setSlug(page.slug);
      setSeoSettings(page.seo_settings || {});
      setThemeSettings(page.theme_settings || {});
    }
  }, [page]);

  const handleSave = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      const data: UpdateSitePageData = {
        title,
        slug,
        blocks,
        seo_settings: seoSettings,
        theme_settings: themeSettings,
      };
      await SitePageService.updatePage(id, data);
      queryClient.invalidateQueries({ queryKey: ["site-pages", id] });
      toast.success("Сохранено");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }, [id, title, slug, blocks, seoSettings, themeSettings, queryClient]);

  const handlePublish = useCallback(async () => {
    if (!id || !page) return;
    setPublishing(true);
    try {
      if (page.status === "published") {
        await SitePublicationService.unpublish(id);
      } else {
        await SitePageService.updatePage(id, { title, slug, blocks, seo_settings: seoSettings, theme_settings: themeSettings });
        await SitePublicationService.publish(id);
      }
      queryClient.invalidateQueries({ queryKey: ["site-pages", id] });
      queryClient.invalidateQueries({ queryKey: ["site-pages"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPublishing(false);
    }
  }, [id, page, title, slug, blocks, seoSettings, themeSettings, queryClient]);

  if (isLoading || !page) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout fullHeight>
      <div className="flex flex-col h-full">
        {/* Header — responsive: title may wrap up to 2 lines, action buttons stay on the right and never overlap */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 sm:px-4 py-2 sm:py-3 bg-background">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate("/admin/sites")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="text-base sm:text-lg font-semibold leading-tight line-clamp-2 break-words">
                {title}
              </h1>
              <span className="block truncate text-xs text-muted-foreground">/{slug}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0 ml-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open("/docs#site-builder", "_blank", "noopener,noreferrer")}
              title="Открыть полное руководство по Конструктору сайтов"
              aria-label="Справка"
            >
              <BookOpen className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Справка</span>
            </Button>
            <Button variant="outline" size="sm" onClick={handleSave} disabled={saving} aria-label="Сохранить">
              {saving ? <Loader2 className="h-4 w-4 animate-spin sm:mr-2" /> : <Save className="h-4 w-4 sm:mr-2" />}
              <span className="hidden sm:inline">Сохранить</span>
            </Button>
            <Button
              variant={page.status === "published" ? "secondary" : "default"}
              size="sm"
              onClick={handlePublish}
              disabled={publishing}
              aria-label={page.status === "published" ? "Снять с публикации" : "Опубликовать"}
            >
              {publishing ? (
                <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
              ) : page.status === "published" ? (
                <GlobeIcon className="h-4 w-4 sm:mr-2" />
              ) : (
                <Globe className="h-4 w-4 sm:mr-2" />
              )}
              <span className="hidden sm:inline">
                {page.status === "published" ? "Снять с публикации" : "Опубликовать"}
              </span>
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="border-b px-4">
              <TabsList className="h-10">
                <TabsTrigger value="editor">Редактор</TabsTrigger>
                <TabsTrigger value="preview">
                  <Eye className="h-4 w-4 mr-1" />
                  Предпросмотр
                </TabsTrigger>
                <TabsTrigger value="settings">Настройки</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="editor" className="flex-1 overflow-auto m-0 p-4">
              <SiteBlockEditor blocks={blocks} onChange={setBlocks} />
            </TabsContent>
            <TabsContent value="preview" className="flex-1 overflow-auto m-0">
              <SitePreview blocks={blocks} themeSettings={themeSettings} pageId={id} />
            </TabsContent>
            <TabsContent value="settings" className="flex-1 overflow-auto m-0 p-4">
              <SiteSettingsPanel
                pageId={id || ""}
                title={title}
                slug={slug}
                seoSettings={seoSettings}
                themeSettings={themeSettings}
                onTitleChange={setTitle}
                onSlugChange={setSlug}
                onSeoChange={setSeoSettings}
                onThemeChange={setThemeSettings}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AdminLayout>
  );
}
