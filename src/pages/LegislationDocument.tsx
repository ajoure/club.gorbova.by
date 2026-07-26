import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  ListTree,
  Landmark,
  Lock,
  Scale,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  useLegalDocument,
  useLegalDocumentPreview,
} from "@/hooks/useLegislation";
import type { LegalStructureNode } from "@/types/legislation";

function makeFallbackStructure(content: string): LegalStructureNode[] {
  return content
    .split(/\n{2,}|\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => {
      const article = text.match(/^Статья\s+([\dА-Яа-я./-]+)/i);
      const chapter = text.match(/^ГЛАВА\s+([\dА-Яа-я./-]+)/i);
      const section = text.match(/^РАЗДЕЛ\s+([\dА-Яа-я./-]+)/i);
      const id = article
        ? `art-${article[1].replace(/[./]/g, "-")}`
        : chapter
          ? `chapter-${chapter[1].replace(/[./]/g, "-")}`
          : section
            ? `section-${section[1].replace(/[./]/g, "-")}`
            : `par-${index + 1}`;
      const kind = article
        ? "article"
        : chapter
          ? "chapter"
          : section
            ? "section"
            : "paragraph";

      return { id, kind, text, level: kind === "paragraph" ? 3 : 1 };
    });
}

function GuestGate({
  title,
  redirectTo,
}: {
  title: string;
  redirectTo: string;
}) {
  const encoded = encodeURIComponent(redirectTo);
  return (
    <main className="min-h-screen bg-gradient-to-br from-background via-muted/50 to-background px-4 py-16">
      <div className="mx-auto max-w-2xl">
        <GlassCard className="space-y-6 py-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <div className="space-y-2">
            <Badge variant="outline">Законодательство Республики Беларусь</Badge>
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-muted-foreground">
              Зарегистрируйтесь или войдите, чтобы прочитать актуальную редакцию
              и перейти непосредственно к указанной норме.
            </p>
          </div>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild>
              <Link to={`/auth?mode=signup&redirectTo=${encoded}`}>
                Зарегистрироваться и прочитать
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/auth?redirectTo=${encoded}`}>У меня уже есть аккаунт</Link>
            </Button>
          </div>
        </GlassCard>
      </div>
    </main>
  );
}

export default function LegislationDocument() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { data: preview, isLoading: previewLoading } =
    useLegalDocumentPreview(slug);
  const {
    data: document,
    isLoading: documentLoading,
    isError,
  } = useLegalDocument(slug, Boolean(user));
  const [copiedAnchor, setCopiedAnchor] = useState<string | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);

  const nodes = useMemo(() => {
    if (document?.structure?.length) return document.structure;
    return makeFallbackStructure(document?.content_text ?? "");
  }, [document]);
  const contents = useMemo(
    () =>
      nodes.filter(
        (node) =>
          node.kind === "section" ||
          node.kind === "chapter" ||
          node.kind === "article",
      ),
    [nodes],
  );

  useEffect(() => {
    if (!document || !location.hash) return;
    const anchor = decodeURIComponent(location.hash.slice(1));
    const reveal = (targetAnchor: string) => {
      const element = window.document.getElementById(targetAnchor);
      if (!element) return false;
      requestAnimationFrame(() => {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("ring-2", "ring-primary/40", "bg-primary/5");
      });
      return true;
    };

    if (reveal(anchor)) return;

    void (async () => {
      const { data } = await supabase
        .from("legal_anchor_aliases")
        .select("current_anchor,status")
        .eq("document_id", document.id)
        .eq("old_anchor", anchor)
        .maybeSingle();
      if (data?.status !== "redirect" || !data.current_anchor) return;
      window.history.replaceState(
        null,
        "",
        `${location.pathname}${location.search}#${data.current_anchor}`,
      );
      reveal(data.current_anchor);
    })();
  }, [document, location.hash, location.pathname, location.search]);

  const copyAnchor = async (anchor: string) => {
    const url = `${window.location.origin}${location.pathname}${location.search}#${anchor}`;
    await navigator.clipboard.writeText(url);
    setCopiedAnchor(anchor);
    window.setTimeout(() => setCopiedAnchor(null), 1800);
  };

  const goToAnchor = (anchor: string) => {
    const element = window.document.getElementById(anchor);
    if (!element) return;
    window.history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}#${encodeURIComponent(anchor)}`,
    );
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    element.classList.add("ring-2", "ring-primary/40", "bg-primary/5");
    setContentsOpen(false);
  };

  if (authLoading || previewLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-12">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <GuestGate
        title={preview?.title ?? "Нормативный правовой акт"}
        redirectTo={`${location.pathname}${location.search}${location.hash}`}
      />
    );
  }

  if (documentLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-4">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-96 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  if (isError || !document) {
    return (
      <DashboardLayout>
        <GlassCard className="py-14 text-center">
          <Scale className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Документ не найден</h1>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/knowledge">Вернуться в базу знаний</Link>
          </Button>
        </GlassCard>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="relative mx-auto max-w-5xl space-y-6 pb-8">
        <div className="pointer-events-none absolute -left-24 -top-16 -z-10 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <nav
          aria-label="Навигация по нормативному акту"
          className="fixed right-3 top-16 z-40 flex items-center justify-between gap-1 rounded-2xl border border-border/70 bg-background/90 p-1.5 shadow-xl shadow-background/40 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 sm:right-6 sm:gap-2 sm:p-2"
        >
          <Button asChild variant="ghost" size="sm" className="min-w-0">
            <Link to="/knowledge">
              <ArrowLeft className="mr-2 h-4 w-4 shrink-0" />
              <span className="truncate">Законодательство</span>
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            <ArrowUp className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">К началу документа</span>
            <span className="sm:hidden">Наверх</span>
          </Button>
        </nav>

        <GlassCard className="relative overflow-hidden border-primary/15 bg-gradient-to-br from-primary/[0.12] via-background to-violet-500/[0.06] p-4 sm:p-5">
          <Landmark className="pointer-events-none absolute -bottom-12 -right-5 h-36 w-36 text-primary/[0.04]" />
          <div className="relative flex items-start gap-3">
            <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="flex flex-wrap gap-2">
                <Badge>
                  {document.status === "active" ? "Действует" : document.status}
                </Badge>
                <Badge variant="outline" className="bg-background/60">
                  {document.source === "etalon"
                    ? "ЭТАЛОН-ONLINE"
                    : "Загружено вручную"}
                </Badge>
              </div>
              <h1 className="text-xl font-semibold leading-snug sm:text-2xl">
                {document.title}
              </h1>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                {document.doc_date && (
                  <span>Дата: {document.doc_date}</span>
                )}
                {document.doc_number && <span>№ {document.doc_number}</span>}
                {document.revision_label && (
                  <span>{document.revision_label}</span>
                )}
              </div>
            </div>
          </div>
        </GlassCard>

        {contents.length > 0 && (
          <Collapsible open={contentsOpen} onOpenChange={setContentsOpen}>
            <div className="overflow-hidden rounded-2xl border bg-card/90 shadow-sm backdrop-blur">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 sm:px-5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ListTree className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">Содержание документа</span>
                    <span className="block text-xs text-muted-foreground">
                      Быстрый переход к разделу, главе или статье
                    </span>
                  </span>
                  <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
                    {contents.length}
                  </Badge>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                      contentsOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="max-h-[min(55vh,32rem)] overflow-y-auto border-t p-2 sm:p-3">
                  {contents.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => goToAnchor(node.id)}
                      className={`flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-primary/[0.07] hover:text-primary ${
                        node.kind === "article" ? "pl-7" : ""
                      }`}
                    >
                      <span className="mt-0.5 w-14 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {node.kind === "section"
                          ? "Раздел"
                          : node.kind === "chapter"
                            ? "Глава"
                            : "Статья"}
                      </span>
                      <span className="line-clamp-2 leading-snug">{node.text}</span>
                    </button>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}

        <article className="space-y-3 rounded-2xl border bg-card/80 px-3 py-4 shadow-sm backdrop-blur sm:px-5 sm:py-6">
          {nodes.map((node) => (
            <div
              id={node.id}
              key={node.id}
              className={`group scroll-mt-24 rounded-xl px-4 py-3 transition-all ${
                node.kind === "article" ||
                node.kind === "chapter" ||
                node.kind === "section"
                  ? "mt-7 border border-border/50 bg-muted/45 font-semibold"
                  : "leading-relaxed"
              }`}
            >
              <div className="flex items-start gap-3">
                <p className="min-w-0 flex-1 whitespace-pre-wrap">{node.text}</p>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 opacity-60 group-hover:opacity-100"
                  aria-label="Скопировать ссылку на этот фрагмент"
                  onClick={() => copyAnchor(node.id)}
                >
                  {copiedAnchor === node.id ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </article>
      </div>
    </DashboardLayout>
  );
}
