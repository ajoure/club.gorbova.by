import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Edit2, Loader2, Video, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface LiveEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kinescope_video_id: string;
  product_id: string;
  access_rule: { mode: string; product_id: string | null; tariff_id: string | null };
  status: string;
  is_published: boolean;
  scheduled_at: string | null;
  replay_enabled: boolean;
  created_at: string;
}

interface LiveEventForm {
  slug: string;
  title: string;
  description: string;
  kinescope_video_id: string;
  product_id: string;
  access_mode: "all" | "product" | "tariff";
  access_product_id: string;
  access_tariff_id: string;
  status: string;
  is_published: boolean;
  scheduled_at: string;
  replay_enabled: boolean;
}

const defaultForm: LiveEventForm = {
  slug: "",
  title: "",
  description: "",
  kinescope_video_id: "",
  product_id: "",
  access_mode: "product",
  access_product_id: "",
  access_tariff_id: "",
  status: "draft",
  is_published: false,
  scheduled_at: "",
  replay_enabled: false,
};

const statusLabels: Record<string, string> = {
  draft: "Черновик",
  scheduled: "Запланирован",
  live: "В эфире",
  ended: "Завершён",
};

export default function AdminLiveEvents() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LiveEventForm>(defaultForm);

  const { data: events, isLoading } = useQuery({
    queryKey: ["admin-live-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_events")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as LiveEvent[];
    },
  });

  const { data: products } = useQuery({
    queryKey: ["admin-live-products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  const { data: tariffs } = useQuery({
    queryKey: ["admin-live-tariffs", form.access_product_id],
    queryFn: async () => {
      if (!form.access_product_id) return [];
      const { data } = await supabase
        .from("tariffs")
        .select("id, name")
        .eq("product_id", form.access_product_id)
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: !!form.access_product_id,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: LiveEventForm) => {
      const accessRule = {
        mode: data.access_mode,
        product_id: data.access_mode !== "all" ? data.access_product_id || data.product_id : null,
        tariff_id: data.access_mode === "tariff" ? data.access_tariff_id : null,
      };

      const payload = {
        slug: data.slug,
        title: data.title,
        description: data.description || null,
        kinescope_video_id: data.kinescope_video_id,
        product_id: data.product_id,
        access_rule: accessRule,
        status: data.status,
        is_published: data.is_published,
        scheduled_at: data.scheduled_at || null,
        replay_enabled: data.replay_enabled,
      };

      if (editingId) {
        const { error } = await supabase.from("live_events").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("live_events").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Эфир обновлён" : "Эфир создан");
      setDialogOpen(false);
      setEditingId(null);
      setForm(defaultForm);
      queryClient.invalidateQueries({ queryKey: ["admin-live-events"] });
    },
    onError: (err) => toast.error("Ошибка: " + (err as Error).message),
  });

  const handleEdit = (event: LiveEvent) => {
    setEditingId(event.id);
    const ar = event.access_rule || { mode: "product", product_id: null, tariff_id: null };
    setForm({
      slug: event.slug,
      title: event.title,
      description: event.description || "",
      kinescope_video_id: event.kinescope_video_id,
      product_id: event.product_id,
      access_mode: (ar.mode as "all" | "product" | "tariff") || "product",
      access_product_id: ar.product_id || event.product_id || "",
      access_tariff_id: ar.tariff_id || "",
      status: event.status,
      is_published: event.is_published,
      scheduled_at: event.scheduled_at || "",
      replay_enabled: event.replay_enabled,
    });
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingId(null);
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const isValid = form.slug.trim() && form.title.trim() && form.kinescope_video_id.trim() && form.product_id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Video className="h-5 w-5" />
            Эфиры / Live Events
          </h2>
          <p className="text-sm text-muted-foreground">Управление видеоэфирами Kinescope</p>
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Создать эфир
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !events?.length ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Нет эфиров. Создайте первый.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Опубликован</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-medium">{event.title}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">/live/{event.slug}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{statusLabels[event.status] || event.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {event.is_published ? (
                        <Badge className="bg-green-100 text-green-700">Да</Badge>
                      ) : (
                        <Badge variant="outline">Нет</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {event.scheduled_at
                        ? format(new Date(event.scheduled_at), "dd.MM.yyyy HH:mm", { locale: ru })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(event)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(`/live/${event.slug}`, "_blank")}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Редактировать эфир" : "Создать эфир"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Название *</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Slug *</Label>
                <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="my-live-event" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Описание</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>

            <div className="space-y-2">
              <Label>Kinescope Video ID *</Label>
              <Input value={form.kinescope_video_id} onChange={(e) => setForm({ ...form, kinescope_video_id: e.target.value })} placeholder="video-id-from-kinescope" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Продукт *</Label>
                <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v, access_product_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Выберите продукт" /></SelectTrigger>
                  <SelectContent>
                    {products?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Статус</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Черновик</SelectItem>
                    <SelectItem value="scheduled">Запланирован</SelectItem>
                    <SelectItem value="live">В эфире</SelectItem>
                    <SelectItem value="ended">Завершён</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Дата и время эфира</Label>
              <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
            </div>

            {/* Access Rule */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Правило доступа</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={form.access_mode} onValueChange={(v) => setForm({ ...form, access_mode: v as "all" | "product" | "tariff" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Всем авторизованным</SelectItem>
                    <SelectItem value="product">По продукту</SelectItem>
                    <SelectItem value="tariff">По тарифу продукта</SelectItem>
                  </SelectContent>
                </Select>

                {form.access_mode === "tariff" && (
                  <div className="space-y-2">
                    <Label>Тариф</Label>
                    <Select value={form.access_tariff_id} onValueChange={(v) => setForm({ ...form, access_tariff_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Выберите тариф" /></SelectTrigger>
                      <SelectContent>
                        {tariffs?.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  {form.access_mode === "all" && "Ссылка откроется всем авторизованным пользователям"}
                  {form.access_mode === "product" && "Ссылка откроется только пользователям с доступом к выбранному продукту"}
                  {form.access_mode === "tariff" && "Ссылка откроется только пользователям с выбранным тарифом продукта"}
                </p>
              </CardContent>
            </Card>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={form.is_published} onCheckedChange={(v) => setForm({ ...form, is_published: v })} />
                <Label>Опубликован</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.replay_enabled} onCheckedChange={(v) => setForm({ ...form, replay_enabled: v })} />
                <Label>Запись доступна</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={() => saveMutation.mutate(form)} disabled={!isValid || saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingId ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
