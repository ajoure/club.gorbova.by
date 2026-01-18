import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Loader2, Newspaper, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { usePermissions } from "@/hooks/usePermissions";

interface NewsItem {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  source: string;
  source_url: string | null;
  country: string;
  category: string;
  is_published: boolean;
  created_at: string;
}

export default function AdminNews() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [country, setCountry] = useState<string>("by");
  const [category, setCategory] = useState<string>("digest");
  
  const queryClient = useQueryClient();
  const { hasPermission, canWrite } = usePermissions();
  
  const canEdit = canWrite("news");

  // Fetch news
  const { data: news, isLoading } = useQuery({
    queryKey: ["admin-news"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news_content")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as NewsItem[];
    },
  });

  // Add news mutation
  const addNews = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from("news_content")
        .insert({
          title,
          summary: summary || null,
          content: content || null,
          source,
          source_url: sourceUrl || null,
          country,
          category,
          created_by: user?.id,
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Новость добавлена");
      queryClient.invalidateQueries({ queryKey: ["admin-news"] });
      queryClient.invalidateQueries({ queryKey: ["news-content"] });
      resetForm();
      setIsDialogOpen(false);
    },
    onError: (e: any) => {
      toast.error("Ошибка: " + e.message);
    },
  });

  // Delete news mutation
  const deleteNews = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("news_content")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Новость удалена");
      queryClient.invalidateQueries({ queryKey: ["admin-news"] });
      queryClient.invalidateQueries({ queryKey: ["news-content"] });
    },
    onError: (e: any) => {
      toast.error("Ошибка: " + e.message);
    },
  });

  // Toggle published mutation
  const togglePublished = useMutation({
    mutationFn: async ({ id, is_published }: { id: string; is_published: boolean }) => {
      const { error } = await supabase
        .from("news_content")
        .update({ is_published })
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-news"] });
      queryClient.invalidateQueries({ queryKey: ["news-content"] });
    },
  });

  const resetForm = () => {
    setTitle("");
    setSummary("");
    setContent("");
    setSource("");
    setSourceUrl("");
    setCountry("by");
    setCategory("digest");
  };

  const getCategoryLabel = (cat: string) => {
    const labels: Record<string, string> = {
      digest: "Дайджест",
      comments: "Комментарии",
      urgent: "Срочно",
    };
    return labels[cat] || cat;
  };

  const getCountryLabel = (c: string) => {
    return c === "by" ? "Беларусь" : "Россия";
  };

  const getCategoryVariant = (cat: string): "default" | "secondary" | "destructive" => {
    if (cat === "urgent") return "destructive";
    if (cat === "comments") return "secondary";
    return "default";
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Newspaper className="h-6 w-6" />
              Управление новостями
            </h1>
            <p className="text-muted-foreground">
              Добавляйте и редактируйте новости для экрана «Пульс»
            </p>
          </div>
          
          {canEdit && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить новость
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Новая новость</DialogTitle>
                  <DialogDescription>
                    Заполните данные для публикации в разделе «Пульс»
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Заголовок *</Label>
                    <Input
                      id="title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Изменения в Налоговый кодекс..."
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="source">Источник *</Label>
                    <Input
                      id="source"
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      placeholder="pravo.by"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="sourceUrl">Ссылка на источник</Label>
                    <Input
                      id="sourceUrl"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://pravo.by/..."
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="summary">Краткое описание (анонс)</Label>
                    <Textarea
                      id="summary"
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      placeholder="Внесены уточнения в порядок..."
                      rows={2}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="content">Полный текст новости</Label>
                    <Textarea
                      id="content"
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="Подробное содержимое новости..."
                      rows={6}
                      className="resize-y"
                    />
                    <p className="text-xs text-muted-foreground">
                      Если заполнено — будет показано при клике на новость
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Страна *</Label>
                      <Select value={country} onValueChange={setCountry}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="by">Беларусь</SelectItem>
                          <SelectItem value="ru">Россия</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label>Категория *</Label>
                      <Select value={category} onValueChange={setCategory}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="digest">Дайджест</SelectItem>
                          <SelectItem value="comments">Комментарии госорганов</SelectItem>
                          <SelectItem value="urgent">Срочно</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Отмена
                  </Button>
                  <Button
                    onClick={() => addNews.mutate()}
                    disabled={!title || !source || addNews.isPending}
                  >
                    {addNews.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Добавить
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Все новости</CardTitle>
            <CardDescription>
              {news?.length || 0} записей
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : !news?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                <Newspaper className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Новостей пока нет</p>
                {canEdit && <p className="text-sm">Нажмите «Добавить новость» для создания первой записи</p>}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Категория</TableHead>
                    <TableHead>Страна</TableHead>
                    <TableHead className="max-w-md">Заголовок</TableHead>
                    <TableHead>Опубликовано</TableHead>
                    {canEdit && <TableHead className="text-right">Действия</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {news.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-muted-foreground">
                        {item.created_at && !isNaN(new Date(item.created_at).getTime())
                          ? format(new Date(item.created_at), "dd.MM.yyyy", { locale: ru })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getCategoryVariant(item.category)}>
                          {getCategoryLabel(item.category)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{getCountryLabel(item.country)}</Badge>
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{item.title}</span>
                          {item.source_url && (
                            <a
                              href={item.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={item.is_published}
                          onCheckedChange={(checked) =>
                            togglePublished.mutate({ id: item.id, is_published: checked })
                          }
                          disabled={!canEdit}
                        />
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Удалить новость?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Это действие нельзя отменить. Новость будет удалена навсегда.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Отмена</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteNews.mutate(item.id)}
                                  className="bg-destructive hover:bg-destructive/90"
                                >
                                  Удалить
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
