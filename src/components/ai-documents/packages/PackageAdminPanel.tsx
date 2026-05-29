/**
 * PackageAdminPanel — Sprint 3F Phase 2b.
 *
 * Admin-only композитная панель для пакетов документов:
 *  1) выбор пакета;
 *  2) per-package CRUD ролей (PackageRolesManager);
 *  3) привязка шаблонов через RPC (TemplateBindingControl);
 *  4) read-only контролируемая валидация DOCX (PackageTemplateValidationPanel).
 *
 * Никаких прямых INSERT/UPDATE/DELETE в `document_package_template_items`,
 * `document_templates.template_scope`, `document_package_role_catalog.public_id`.
 * Все мутации идут через canonical RPC или БД-триггеры (см. Phase 2 миграцию).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FileStack, Shield } from "lucide-react";
import { PackageRolesManager } from "./PackageRolesManager";
import { TemplateBindingControl } from "./TemplateBindingControl";
import { PackageTemplateValidationPanel } from "./PackageTemplateValidationPanel";

interface PackageRow {
  id: string;
  name: string;
  is_active: boolean;
}

export function PackageAdminPanel() {
  const [packageId, setPackageId] = useState<string | null>(null);

  const packagesQuery = useQuery({
    queryKey: ["pkg-admin-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_package_templates")
        .select("id, name, is_active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PackageRow[];
    },
  });

  // Auto-select first package
  useEffect(() => {
    if (!packageId && packagesQuery.data && packagesQuery.data.length > 0) {
      setPackageId(packagesQuery.data[0].id);
    }
  }, [packageId, packagesQuery.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
          <FileStack className="h-5 w-5 text-emerald-500" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Пакеты документов — администрирование
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
              <Shield className="h-3 w-3 mr-1" /> admin only
            </Badge>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Per-package роли (ln-XXXXXX), привязка шаблонов через RPC и read-only валидация.
            Никаких изменений в billing-резолвере, Gotenberg или
            <code className="mx-1">canonical-document-generate-strict</code>.
          </p>
        </div>
      </div>

      <Card className="p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">Пакет:</span>
          <Select value={packageId ?? ""} onValueChange={(v) => setPackageId(v || null)}>
            <SelectTrigger className="flex-1 max-w-md">
              <SelectValue placeholder="Выберите пакет…" />
            </SelectTrigger>
            <SelectContent>
              {(packagesQuery.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {!p.is_active && (
                    <span className="ml-2 text-[10px] text-muted-foreground">(архив)</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <PackageRolesManager packageTemplateId={packageId} />
      <TemplateBindingControl packageTemplateId={packageId} />
      <PackageTemplateValidationPanel packageTemplateId={packageId} />
    </div>
  );
}
