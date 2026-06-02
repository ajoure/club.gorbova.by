import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, ShieldAlert, Globe, Lock, Eye, EyeOff } from "lucide-react";

type FilterMode = "all" | "public" | "gated" | "with_rules" | "no_rules";

interface SectionRow {
  id: string;
  code: string;
  label: string;
  route: string;
  is_public: boolean;
  is_active: boolean;
  sort_order: number;
  rules_count: number;
}

export default function AdminSections() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    section: SectionRow | null;
    field: "is_public" | "is_active";
    newValue: boolean;
    rulesCount: number;
  }>({ open: false, section: null, field: "is_public", newValue: false, rulesCount: 0 });

  // Fetch sections + rules count
  const { data: sections, isLoading } = useQuery({
    queryKey: ["admin-sections"],
    queryFn: async () => {
      const { data: secs, error } = await supabase
        .from("app_sections")
        .select("id, code, label, route, is_public, is_active, sort_order")
        .order("sort_order");
      if (error) throw error;

      // Count active section_access rules per section (target_ref = section UUID)
      const { data: rules, error: rulesErr } = await supabase
        .from("access_rules")
        .select("target_ref")
        .eq("grant_target_type", "section_access")
        .eq("is_active", true);
      if (rulesErr) throw rulesErr;

      const countMap = new Map<string, number>();
      (rules || []).forEach((r: any) => {
        countMap.set(r.target_ref, (countMap.get(r.target_ref) || 0) + 1);
      });

      // Bridge: domain rule grant_target_type='document_generation' (sentinel target_ref)
      // counts toward app_sections.code='document_generation'.
      const { data: docGenRules, error: docGenErr } = await supabase
        .from("access_rules")
        .select("id")
        .eq("grant_target_type", "document_generation")
        .eq("target_ref", "document_generation")
        .eq("is_active", true);
      if (docGenErr) throw docGenErr;
      const docGenSection = (secs || []).find((s: any) => s.code === "document_generation");
      if (docGenSection && (docGenRules?.length ?? 0) > 0) {
        countMap.set(
          docGenSection.id,
          (countMap.get(docGenSection.id) || 0) + (docGenRules?.length ?? 0),
        );
      }

      return (secs || []).map((s: any) => ({
        ...s,
        rules_count: countMap.get(s.id) || 0,
      })) as SectionRow[];
    },
  });

  // Filtered sections
  const filtered = useMemo(() => {
    if (!sections) return [];
    switch (filter) {
      case "public":
        return sections.filter((s) => s.is_public);
      case "gated":
        return sections.filter((s) => !s.is_public);
      case "with_rules":
        return sections.filter((s) => s.rules_count > 0);
      case "no_rules":
        return sections.filter((s) => s.rules_count === 0);
      default:
        return sections;
    }
  }, [sections, filter]);

  // Mutation: update section field (only is_public or is_active)
  const updateSection = useMutation({
    mutationFn: async ({
      id,
      field,
      value,
    }: {
      id: string;
      field: "is_public" | "is_active";
      value: boolean;
    }) => {
      const { error } = await supabase
        .from("app_sections")
        .update({ [field]: value, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sections"] });
      queryClient.invalidateQueries({ queryKey: ["section-access"] });
      queryClient.invalidateQueries({ queryKey: ["access-rule-sections"] });
      toast.success("Секция обновлена");
    },
    onError: (err: any) => {
      toast.error("Ошибка обновления: " + (err.message || ""));
    },
  });

  // Handle toggle with confirmation
  const handleToggle = (section: SectionRow, field: "is_public" | "is_active", newValue: boolean) => {
    // Closing a section (is_public true→false)
    if (field === "is_public" && !newValue) {
      setConfirmDialog({
        open: true,
        section,
        field,
        newValue,
        rulesCount: section.rules_count,
      });
      return;
    }

    // Deactivating a section with active rules
    if (field === "is_active" && !newValue && section.rules_count > 0) {
      setConfirmDialog({
        open: true,
        section,
        field,
        newValue,
        rulesCount: section.rules_count,
      });
      return;
    }

    // No confirmation needed
    updateSection.mutate({ id: section.id, field, value: newValue });
  };

  const confirmAction = () => {
    if (confirmDialog.section) {
      updateSection.mutate({
        id: confirmDialog.section.id,
        field: confirmDialog.field,
        value: confirmDialog.newValue,
      });
    }
    setConfirmDialog((d) => ({ ...d, open: false }));
  };

  const getConfirmDialogContent = () => {
    const { field, rulesCount, section } = confirmDialog;
    if (field === "is_public") {
      if (rulesCount === 0) {
        return {
          title: "Закрыть раздел?",
          description: `Раздел «${section?.label}» станет недоступен всем пользователям, кроме админов. На данный момент нет ни одного правила доступа (section_access) для этой секции. Все обычные пользователи потеряют доступ.`,
        };
      }
      return {
        title: "Закрыть раздел?",
        description: `Раздел «${section?.label}» станет доступен только пользователям с соответствующим правилом доступа (${rulesCount} активных правил). Продолжить?`,
      };
    }
    return {
      title: "Деактивировать секцию?",
      description: `На секцию «${section?.label}» ссылаются ${rulesCount} активных правил. Деактивация сделает эти правила неэффективными. Продолжить?`,
    };
  };

  const filters: { key: FilterMode; label: string }[] = [
    { key: "all", label: "Все" },
    { key: "public", label: "Публичные" },
    { key: "gated", label: "Закрытые" },
    { key: "with_rules", label: "С правилами" },
    { key: "no_rules", label: "Без правил" },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const dialogContent = getConfirmDialogContent();

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Разделы платформы</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Управление видимостью и доступом к разделам приложения
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
              filter === f.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Код</TableHead>
            <TableHead>Название</TableHead>
            <TableHead>Маршрут</TableHead>
            <TableHead className="text-center">Статус</TableHead>
            <TableHead className="text-center">Публичный</TableHead>
            <TableHead className="text-center">Активный</TableHead>
            <TableHead className="text-center">Правил</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered?.map((section) => (
            <TableRow key={section.id} className={!section.is_active ? "opacity-50" : ""}>
              <TableCell className="font-mono text-xs">{section.code}</TableCell>
              <TableCell className="font-medium text-sm">{section.label}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {section.route}
              </TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-1">
                  {section.is_public ? (
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Globe className="h-3 w-3" />
                      публичный
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px] gap-1">
                      <Lock className="h-3 w-3" />
                      закрытый
                    </Badge>
                  )}
                  {!section.is_active && (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <EyeOff className="h-3 w-3" />
                      неактивный
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-center">
                <Switch
                  checked={section.is_public}
                  onCheckedChange={(v) => handleToggle(section, "is_public", v)}
                  disabled={updateSection.isPending}
                />
              </TableCell>
              <TableCell className="text-center">
                <Switch
                  checked={section.is_active}
                  onCheckedChange={(v) => handleToggle(section, "is_active", v)}
                  disabled={updateSection.isPending}
                />
              </TableCell>
              <TableCell className="text-center">
                {section.rules_count > 0 ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {section.rules_count}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {filtered?.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                Нет секций по выбранному фильтру
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Warning */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <strong>Код</strong> и <strong>маршрут</strong> секции нельзя изменить после создания.
          Удаление секций запрещено — используйте деактивацию. Секции <strong>money</strong> и <strong>live</strong> не рекомендуется
          закрывать без отдельного proof, так как у них есть собственная внутренняя логика доступа.
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((d) => ({ ...d, open }))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogContent.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialogContent.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAction}>Подтвердить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
