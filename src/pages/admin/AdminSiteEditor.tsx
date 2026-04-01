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
import { ArrowLeft, Save, Globe, GlobeIcon, Loader2, Eye } from "lucide-react";
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
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3 bg-background">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin/sites")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold">{title}</h1>
              <span className="text-xs text-muted-foreground">/{slug}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Сохранить
            </Button>
            <Button
              variant={page.status === "published" ? "secondary" : "default"}
              onClick={handlePublish}
              disabled={publishing}
            >
              {publishing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : page.status === "published" ? (
                <GlobeIcon className="h-4 w-4 mr-2" />
              ) : (
                <Globe className="h-4 w-4 mr-2" />
              )}
              {page.status === "published" ? "Снять с публикации" : "Опубликовать"}
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
