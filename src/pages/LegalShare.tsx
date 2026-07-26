import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { BookOpen, Check, Copy, ExternalLink, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/GlassCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useLegalDocumentSharePreview } from "@/hooks/useLegislation";
import {
  getLegalAnchorLabel,
  getLegalDocumentPath,
  getLegalOgImageUrl,
  getLegalSharePath,
} from "@/lib/legalShare";

const upsertMeta = (selector: string, attributes: Record<string, string>) => {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => element?.setAttribute(key, value));
};

export default function LegalShare() {
  const { ref, anchor } = useParams<{ ref: string; anchor?: string }>();
  const { user, loading: authLoading } = useAuth();
  const { data: preview, isLoading, isError } = useLegalDocumentSharePreview(ref);
  const [copied, setCopied] = useState(false);
  const decodedAnchor = anchor ? decodeURIComponent(anchor) : null;
  const canonicalPath = preview
    ? getLegalDocumentPath(preview.slug, decodedAnchor)
    : "/knowledge?tab=knowledge-laws";
  const sharePath = ref ? getLegalSharePath(ref, decodedAnchor) : "/knowledge";
  const shareUrl = useMemo(
    () => (typeof window === "undefined" ? `https://gorbova.by${sharePath}` : `${window.location.origin}${sharePath}`),
    [sharePath],
  );

  useEffect(() => {
    if (!preview || !ref) return;
    const anchorLabel = getLegalAnchorLabel(decodedAnchor);
    const title = `${anchorLabel ? `${anchorLabel} — ` : ""}${preview.title}`;
    const description = [
      "Актуальная редакция нормативного правового акта Республики Беларусь.",
      preview.doc_date,
      preview.doc_number ? `№ ${preview.doc_number}` : null,
    ].filter(Boolean).join(" ");
    const image = getLegalOgImageUrl(ref, decodedAnchor);

    document.title = `${title} | Буква закона`;
    upsertMeta('meta[name="description"]', { name: "description", content: description });
    upsertMeta('meta[property="og:type"]', { property: "og:type", content: "article" });
    upsertMeta('meta[property="og:title"]', { property: "og:title", content: title });
    upsertMeta('meta[property="og:description"]', { property: "og:description", content: description });
    upsertMeta('meta[property="og:url"]', { property: "og:url", content: shareUrl });
    upsertMeta('meta[property="og:image"]', { property: "og:image", content: image });
    upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: title });
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
    upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: image });
  }, [decodedAnchor, preview, ref, shareUrl]);

  if (authLoading || isLoading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-background via-primary/[0.04] to-violet-500/[0.08] px-4 py-14">
        <div className="mx-auto max-w-2xl space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-72 w-full rounded-3xl" />
        </div>
      </main>
    );
  }

  if (user && preview) return <Navigate to={canonicalPath} replace />;

  if (isError || !preview) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <GlassCard className="max-w-lg py-12 text-center">
          <Scale className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Документ не найден</h1>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/knowledge?tab=knowledge-laws">Открыть законодательство</Link>
          </Button>
        </GlassCard>
      </main>
    );
  }

  const anchorLabel = getLegalAnchorLabel(decodedAnchor);
  const redirectTo = encodeURIComponent(canonicalPath);
  const copyShare = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-background via-primary/[0.04] to-violet-500/[0.08] px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <GlassCard className="relative overflow-hidden border-primary/15 p-6 sm:p-9">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative space-y-7">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <BookOpen className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold">Буква закона</p>
                <p className="text-sm text-muted-foreground">Законодательство Республики Беларусь</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge>{preview.status === "active" ? "Действует" : preview.status}</Badge>
                {anchorLabel && <Badge variant="secondary">{anchorLabel}</Badge>}
              </div>
              <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">{preview.title}</h1>
              <p className="text-sm text-muted-foreground">
                {[preview.doc_date, preview.doc_number ? `№ ${preview.doc_number}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>

            <p className="leading-relaxed text-muted-foreground">
              Войдите или зарегистрируйтесь, чтобы открыть актуальную редакцию
              {anchorLabel ? ` и сразу перейти к норме «${anchorLabel}»` : ""}.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button asChild size="lg">
                <Link to={`/auth?mode=signup&redirectTo=${redirectTo}`}>
                  Зарегистрироваться
                  <ExternalLink className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to={`/auth?redirectTo=${redirectTo}`}>Войти и прочитать</Link>
              </Button>
            </div>

            <Button type="button" variant="ghost" className="w-full" onClick={copyShare}>
              {copied ? <Check className="mr-2 h-4 w-4 text-green-600" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? "Ссылка скопирована" : "Скопировать красивую ссылку"}
            </Button>
          </div>
        </GlassCard>
      </div>
    </main>
  );
}
