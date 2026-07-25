import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Loader2, Plus, RefreshCw, Scale } from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { LegalCategory, LegalDocument } from "@/types/legislation";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[ъь]/g, "")
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

async function checksum(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default function AdminLegislation() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState<LegalCategory>("acts");
  const [docNumber, setDocNumber] = useState("");
  const [docDate, setDocDate] = useState("");
  const [content, setContent] = useState("");

  const documentsQuery = useQuery({
    queryKey: ["admin", "legislation"],
    queryFn: async (): Promise<LegalDocument[]> => {
      const { data, error } = await supabase
        .from("legal_documents")
        .select("*")
        .order("category")
        .order("title");
      if (error) throw error;
      return (data ?? []) as unknown as LegalDocument[];
    },
  });

  const documents = useMemo(
    () => documentsQuery.data ?? [],
    [documentsQuery.data],
  );
  const codeCount = useMemo(
    () => documents.filter((document) => document.category === "codes").length,
    [documents],
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "legislation"] });

  const syncCodes = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("legislation-sync", {
        body: { action: "sync_codes" },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Синхронизация не выполнена");
      return data;
    },
    onSuccess: (data) => {
      refresh();
      toast({
        title: "Кодексы синхронизированы",
        description: `Обработано: ${data.processed ?? 0}, обновлено: ${data.updated ?? 0}`,
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Ошибка синхронизации",
        description: error.message,
        variant: "destructive",
      }),
  });

  const createManual = useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Необходима авторизация");
      if (!title.trim() || !content.trim()) {
        throw new Error("Укажите название и полный текст документа");
      }

      const normalizedSlug = slugify(slug || title);
      const normalizedContent = content.trim();
      const contentChecksum = await checksum(normalizedContent);
      const { data: saved, error } = await supabase.from("legal_documents").insert({
        external_id: `manual:${crypto.randomUUID()}`,
        slug: normalizedSlug,
        source: "manual",
        title: title.trim(),
        category,
        doc_type: category === "codes" ? "code" : "legal_act",
        doc_number: docNumber.trim() || null,
        doc_date: docDate || null,
        content_text: normalizedContent,
        structure: [],
        checksum: contentChecksum,
        status: "active",
        is_published: false,
        created_by: user.id,
      }).select("id").single();
      if (error) throw error;

      const { error: versionError } = await supabase
        .from("legal_document_versions")
        .insert({
          document_id: saved.id,
          revision_key: contentChecksum.slice(0, 24),
          revision_label: "Первичная ручная загрузка",
          effective_at: docDate || null,
          content_text: normalizedContent,
          structure: [],
          checksum: contentChecksum,
          is_current: true,
        });
      if (versionError) throw versionError;
    },
    onSuccess: () => {
      setTitle("");
      setSlug("");
      setDocNumber("");
      setDocDate("");
      setContent("");
      setShowForm(false);
      refresh();
      toast({
        title: "Документ загружен",
        description: "Он сохранён как черновик. Проверьте текст перед публикацией.",
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Не удалось сохранить документ",
        description: error.message,
        variant: "destructive",
      }),
  });

  const togglePublished = useMutation({
    mutationFn: async ({
      id,
      isPublished,
    }: {
      id: string;
      isPublished: boolean;
    }) => {
      const { error } = await supabase
        .from("legal_documents")
        .update({ is_published: isPublished })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (error: Error) =>
      toast({
        title: "Не удалось изменить публикацию",
        description: error.message,
        variant: "destructive",
      }),
  });

  return (
    <AdminLayout>
      <div className="container mx-auto space-y-6 py-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Scale className="h-6 w-6" />
              Законодательство
            </h1>
            <p className="text-muted-foreground">
              Кодексы из ЭТАЛОН-ONLINE и документы, загруженные вручную
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowForm((value) => !value)}>
              <Plus className="mr-2 h-4 w-4" />
              Загрузить вручную
            </Button>
            <Button
              onClick={() => syncCodes.mutate()}
              disabled={syncCodes.isPending}
            >
              {syncCodes.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Синхронизировать кодексы
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Всего документов</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{documents.length}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Кодексы РБ</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{codeCount}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Опубликовано</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">
              {documents.filter((document) => document.is_published).length}
            </CardContent>
          </Card>
        </div>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>Ручная загрузка нормативного акта</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="legal-title">Название</Label>
                  <Input
                    id="legal-title"
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      if (!slug) setSlug(slugify(event.target.value));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="legal-slug">Адрес документа</Label>
                  <Input
                    id="legal-slug"
                    value={slug}
                    onChange={(event) => setSlug(slugify(event.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Категория</Label>
                  <Select
                    value={category}
                    onValueChange={(value) => setCategory(value as LegalCategory)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="codes">Кодексы Республики Беларусь</SelectItem>
                      <SelectItem value="acts">Нормативные правовые акты</SelectItem>
                      <SelectItem value="other">Другие правовые документы</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="legal-number">Номер</Label>
                    <Input
                      id="legal-number"
                      value={docNumber}
                      onChange={(event) => setDocNumber(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="legal-date">Дата</Label>
                    <Input
                      id="legal-date"
                      type="date"
                      value={docDate}
                      onChange={(event) => setDocDate(event.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="legal-content">Полный текст</Label>
                <Textarea
                  id="legal-content"
                  className="min-h-64 font-mono text-sm"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="Вставьте полный текст нормативного правового акта"
                />
              </div>
              <div>
                <Button
                  onClick={() => createManual.mutate()}
                  disabled={createManual.isPending}
                >
                  {createManual.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Сохранить как черновик
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Документы</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {documentsQuery.isLoading && (
              <p className="text-muted-foreground">Загрузка…</p>
            )}
            {!documentsQuery.isLoading && documents.length === 0 && (
              <div className="py-10 text-center text-muted-foreground">
                <BookOpen className="mx-auto mb-3 h-10 w-10 opacity-50" />
                Документы ещё не загружены
              </div>
            )}
            {documents.map((document) => (
              <div
                key={document.id}
                className="flex flex-col justify-between gap-4 rounded-xl border p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{document.title}</p>
                    <Badge variant="outline">
                      {document.source === "etalon" ? "ЭТАЛОН" : "Вручную"}
                    </Badge>
                    <Badge variant="secondary">
                      {document.category === "codes" ? "Кодекс" : "НПА"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    /knowledge/laws/{document.slug}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Label htmlFor={`publish-${document.id}`} className="text-sm">
                    Опубликован
                  </Label>
                  <Switch
                    id={`publish-${document.id}`}
                    checked={document.is_published}
                    onCheckedChange={(checked) =>
                      togglePublished.mutate({
                        id: document.id,
                        isPublished: checked,
                      })
                    }
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
