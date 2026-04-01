import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  DocVersion,
  DocMeta,
  AUTO_CURRENT_LABEL,
  getManualVersions,
  getAutoVersion,
  isAutoVersion,
  ViewMode,
} from "@/lib/systemDocsRegistry";

interface UseSystemDocsOptions {
  sectionKey: string;
  initialMode?: ViewMode;
  initialVersion?: string;
}

export function useSystemDocs({
  sectionKey,
  initialMode = "manual",
  initialVersion,
}: UseSystemDocsOptions) {
  const { user } = useAuth();
  const [allVersions, setAllVersions] = useState<DocVersion[]>([]);
  const [selectedManualVersion, setSelectedManualVersion] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [activating, setActivating] = useState(false);
  const [copied, setCopied] = useState(false);

  const manualVersions = useMemo(() => getManualVersions(allVersions), [allVersions]);
  const autoVersion = useMemo(() => getAutoVersion(allVersions), [allVersions]);

  const currentDoc = useMemo(() => {
    if (viewMode === "auto") return autoVersion || null;
    return manualVersions.find((v) => v.version_label === selectedManualVersion) || null;
  }, [viewMode, autoVersion, manualVersions, selectedManualVersion]);

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

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("admin_docs" as any)
      .select("*")
      .eq("section_key", sectionKey)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching docs:", error);
      toast.error("Ошибка загрузки документации");
    } else {
      const docs = (data as unknown as DocVersion[]) || [];
      setAllVersions(docs);

      // Auto-select version
      if (initialVersion) {
        const found = docs.find((d) => d.version_label === initialVersion);
        if (found) {
          if (isAutoVersion(found)) {
            setViewMode("auto");
          } else {
            setViewMode("manual");
            setSelectedManualVersion(found.version_label);
          }
        }
      } else {
        const manual = docs.filter((d) => !isAutoVersion(d));
        const active = manual.find((d) => d.status === "active");
        setSelectedManualVersion(active?.version_label || manual[0]?.version_label || "");
      }
    }
    setLoading(false);
  }, [sectionKey, initialVersion]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const logAudit = useCallback(
    async (action: string, meta?: Record<string, any>) => {
      try {
        await supabase.from("audit_logs" as any).insert({
          action,
          actor_type: "user",
          actor_user_id: user?.id || null,
          actor_label: "admin_system_docs",
          meta: { section_key: sectionKey, ...meta },
        } as any);
      } catch (e) {
        console.error("Audit log error:", e);
      }
    },
    [user?.id, sectionKey]
  );

  const handleCopyAll = useCallback(async () => {
    const text = currentDoc?.content_text || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Документация скопирована в буфер обмена");
      setTimeout(() => setCopied(false), 2000);
      await logAudit("system_docs.content_copied", {
        version_label: currentDoc?.version_label,
        mode: viewMode,
      });
    } catch {
      toast.error("Не удалось скопировать");
    }
  }, [currentDoc, viewMode, logAudit]);

  const handleDownload = useCallback(
    async (filename: string) => {
      const text = currentDoc?.content_text || "";
      if (!text) return;
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      await logAudit("system_docs.content_downloaded", {
        version_label: currentDoc?.version_label,
        filename,
        mode: viewMode,
      });
    },
    [currentDoc, viewMode, logAudit]
  );

  const handleCreateNewVersion = useCallback(async () => {
    if (!currentDoc || viewMode === "auto") return;
    const nextLabel = `POINT ${String.fromCharCode(65 + manualVersions.length)}`;
    setCreating(true);
    const { error } = await supabase.from("admin_docs" as any).insert({
      section_key: sectionKey,
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
      await logAudit("system_docs.version_created", { version_label: nextLabel });
      await fetchVersions();
      setSelectedManualVersion(nextLabel);
    }
    setCreating(false);
  }, [currentDoc, viewMode, manualVersions.length, sectionKey, user?.id, logAudit, fetchVersions]);

  const handleActivateVersion = useCallback(
    async (versionLabel: string) => {
      const target = manualVersions.find((v) => v.version_label === versionLabel);
      if (!target || target.status === "active") return;
      setActivating(true);

      // Step 1: Archive current active manual version (exclude AUTO-CURRENT)
      const currentActive = manualVersions.find((v) => v.status === "active");
      if (currentActive) {
        const { error: archiveError } = await supabase
          .from("admin_docs" as any)
          .update({ status: "archived", updated_by: user?.id } as any)
          .eq("id", currentActive.id);
        if (archiveError) {
          toast.error("Ошибка архивирования текущей версии");
          console.error(archiveError);
          setActivating(false);
          return;
        }
        await logAudit("system_docs.version_archived", {
          version_label: currentActive.version_label,
        });
      }

      // Step 2: Activate target
      const { error } = await supabase
        .from("admin_docs" as any)
        .update({ status: "active", updated_by: user?.id } as any)
        .eq("id", target.id);

      if (error) {
        toast.error("Ошибка активации версии");
        console.error(error);
      } else {
        toast.success(`Версия ${versionLabel} активирована`);
        await logAudit("system_docs.version_activated", { version_label: versionLabel });
        await fetchVersions();
        setSelectedManualVersion(versionLabel);
      }
      setActivating(false);
    },
    [manualVersions, user?.id, logAudit, fetchVersions]
  );

  return {
    allVersions,
    manualVersions,
    autoVersion,
    currentDoc,
    sections,
    selectedManualVersion,
    setSelectedManualVersion,
    viewMode,
    setViewMode,
    loading,
    creating,
    activating,
    copied,
    fetchVersions,
    handleCopyAll,
    handleDownload,
    handleCreateNewVersion,
    handleActivateVersion,
  };
}
