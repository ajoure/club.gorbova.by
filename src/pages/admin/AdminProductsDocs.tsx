import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Copy, Check, FileText, Plus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "sonner";

interface DocVersion {
  id: string;
  section_key: string;
  version_label: string;
  status: string;
  content_text: string;
  created_at: string;
  updated_at: string;
}

export default function AdminProductsDocs() {
  const navigate = useNavigate();
  const { isSuperAdmin, loading: permLoading } = usePermissions();
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (permLoading) return;
    if (!isSuperAdmin()) {
      navigate("/admin/products-v2");
      return;
    }
    fetchVersions();
  }, [permLoading]);

  const fetchVersions = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("admin_docs" as any)
      .select("*")
      .eq("section_key", "products_sales")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching docs:", error);
      toast.error("Ошибка загрузки документации");
    } else {
      const docs = (data as unknown as DocVersion[]) || [];
      setVersions(docs);
      const active = docs.find((d) => d.status === "active");
      setSelectedVersion(active?.version_label || docs[0]?.version_label || "");
    }
    setLoading(false);
  };

  const currentDoc = useMemo(
    () => versions.find((v) => v.version_label === selectedVersion),
    [versions, selectedVersion]
  );

  const handleCopyAll = async () => {
    const text = currentDoc?.content_text || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Документация скопирована в буфер обмена");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const handleCreateNewVersion = async () => {
    if (!currentDoc) return;
    const nextLabel = `POINT ${String.fromCharCode(65 + versions.length)}`;

    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("admin_docs" as any).insert({
      section_key: "products_sales",
      version_label: nextLabel,
      status: "draft",
      content_text: currentDoc.content_text,
      created_by: user?.id || null,
      updated_by: user?.id || null,
    } as any);

    if (error) {
      if (error.code === "23505") {
        toast.error(`Версия ${nextLabel} уже существует`);
      } else {
        toast.error("Ошибка создания версии");
        console.error(error);
      }
    } else {
      toast.success(`Версия ${nextLabel} (draft) создана`);
      await fetchVersions();
      setSelectedVersion(nextLabel);
    }
    setCreating(false);
  };

  // Parse content into sections by === separators
  const sections = useMemo(() => {
    const text = currentDoc?.content_text || "";
    if (!text) return [];

    const parts: { title: string; body: string }[] = [];
    const lines = text.split("\n");
    let currentTitle = "";
    let currentBody: string[] = [];

    for (const line of lines) {
      if (line.match(/^={3,}$/)) {
        if (currentTitle || currentBody.length > 0) {
          if (currentBody.length > 0 && !currentTitle) {
            currentTitle = currentBody[0] || "Документация";
            currentBody = currentBody.slice(1);
          }
          parts.push({ title: currentTitle.trim(), body: currentBody.join("\n").trim() });
          currentTitle = "";
          currentBody = [];
        }
        continue;
      }

      if (!currentTitle && line.trim() && currentBody.length === 0) {
        currentTitle = line;
      } else {
        currentBody.push(line);
      }
    }
    if (currentTitle || currentBody.length > 0) {
      if (!currentTitle && currentBody.length > 0) {
        currentTitle = currentBody[0];
        currentBody = currentBody.slice(1);
      }
      parts.push({ title: currentTitle.trim(), body: currentBody.join("\n").trim() });
    }

    return parts;
  }, [currentDoc?.content_text]);

  if (permLoading || loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-4 pb-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/admin/products-v2")}
              className="h-8"
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Продукты
            </Button>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h1 className="text-sm font-semibold text-foreground">
                Документация: Products & Sales
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {versions.length > 0 && (
              <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                <SelectTrigger className="h-8 w-[160px] text-xs">
                  <SelectValue placeholder="Версия" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.version_label} value={v.version_label}>
                      <span className="flex items-center gap-2">
                        {v.version_label}
                        {v.status === "active" && (
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                            active
                          </span>
                        )}
                        {v.status === "draft" && (
                          <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                            draft
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={handleCreateNewVersion}
              disabled={creating || versions.length === 0}
            >
              <Plus className="h-3 w-3 mr-1" />
              Новая версия
            </Button>

            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs"
              onClick={handleCopyAll}
              disabled={!currentDoc}
            >
              {copied ? (
                <Check className="h-3 w-3 mr-1" />
              ) : (
                <Copy className="h-3 w-3 mr-1" />
              )}
              {copied ? "Скопировано" : "Копировать всё"}
            </Button>
          </div>
        </div>

        {/* No docs yet */}
        {versions.length === 0 && (
          <GlassCard className="text-center py-12">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              Документация ещё не создана. Добавьте первую версию (POINT A).
            </p>
          </GlassCard>
        )}

        {/* Doc sections */}
        {currentDoc && sections.map((section, idx) => (
          <GlassCard key={idx} className="p-5">
            {section.title && (
              <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                {section.title}
              </h2>
            )}
            {section.body && (
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
                {section.body}
              </pre>
            )}
          </GlassCard>
        ))}

        {/* Version meta */}
        {currentDoc && (
          <div className="text-[10px] text-muted-foreground/60 px-1">
            Версия: {currentDoc.version_label} · Статус: {currentDoc.status} ·
            Обновлено: {new Date(currentDoc.updated_at).toLocaleString("ru-RU")}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
