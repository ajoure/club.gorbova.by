/**
 * LegalDetailsPickerDialog — Sprint 8
 *
 * Список реквизитов клиента (client_legal_details). Если задан profileId — фильтр по нему,
 * иначе показ последних реквизитов с поиском.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Building2, User } from "lucide-react";

export interface LegalDetailsPickResult {
  id: string;
  profile_id: string;
  client_type: string;
  is_default: boolean;
  display_name: string;
  display_unp: string | null;
  email: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  individual: "Физлицо",
  individual_entrepreneur: "ИП",
  legal_entity: "Юрлицо",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profileId?: string | null;
  onSelect: (item: LegalDetailsPickResult) => void;
}

export function LegalDetailsPickerDialog({ open, onOpenChange, profileId, onSelect }: Props) {
  const [q, setQ] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["legal-details-picker", q, profileId ?? null],
    enabled: open,
    queryFn: async () => {
      let query = supabase
        .from("client_legal_details")
        .select("id, profile_id, client_type, is_default, ind_full_name, ent_name, leg_name, ent_unp, leg_unp, email")
        .order("is_default", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(60);

      if (profileId) query = query.eq("profile_id", profileId);
      const term = q.trim();
      if (term) {
        query = query.or(
          `ind_full_name.ilike.%${term}%,ent_name.ilike.%${term}%,leg_name.ilike.%${term}%,ent_unp.ilike.%${term}%,leg_unp.ilike.%${term}%,email.ilike.%${term}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        profile_id: r.profile_id,
        client_type: r.client_type,
        is_default: r.is_default,
        display_name:
          r.client_type === "individual"
            ? r.ind_full_name || "Без ФИО"
            : r.leg_name || r.ent_name || "Без названия",
        display_unp: r.leg_unp || r.ent_unp || null,
        email: r.email,
      })) as LegalDetailsPickResult[];
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Выбрать реквизиты клиента</DialogTitle>
          <DialogDescription>
            {profileId
              ? "Реквизиты этого клиента. Если у клиента несколько комплектов — выберите нужный."
              : "Поиск по имени, названию организации, УНП или email."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ФИО, организация, УНП, email"
            className="pl-9"
          />
        </div>

        <div className="max-h-[400px] overflow-y-auto border rounded-md divide-y">
          {isLoading && (
            <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Загрузка…
            </div>
          )}
          {!isLoading && rows.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {profileId ? "У этого клиента ещё нет реквизитов" : "Реквизитов не найдено"}
            </div>
          )}
          {!isLoading && rows.map((r) => {
            const isOrg = r.client_type !== "individual";
            const Icon = isOrg ? Building2 : User;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => { onSelect(r); onOpenChange(false); }}
                className="w-full text-left p-3 hover:bg-muted/40 transition-colors flex items-start gap-3"
              >
                <Icon className={`h-4 w-4 mt-0.5 ${isOrg ? "text-indigo-500" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{r.display_name}</span>
                    {r.is_default && (
                      <Badge variant="outline" className="text-emerald-700 border-emerald-300">
                        По умолчанию
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-muted-foreground">
                      {TYPE_LABEL[r.client_type] ?? r.client_type}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                    {r.display_unp && <span>УНП: {r.display_unp}</span>}
                    {r.email && <span>· {r.email}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
