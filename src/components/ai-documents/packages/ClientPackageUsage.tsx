import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAiEntities } from "@/hooks/useAiEntities";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";
import { useRequisitesV2, type LegalEntityRequisitesRow } from "@/hooks/useRequisitesV2";
import { normalizeLegacyData } from "@/lib/requisites-v2/fieldMap";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Copy, ExternalLink, FileDown, FileText, History, Loader2, Mail, Send, Building2 } from "lucide-react";
import { toast } from "sonner";

type ExternalForm = {
  id: string;
  title: string;
  description: string | null;
  delivery: { email?: boolean; telegram?: boolean };
};

type HistoryDocument = {
  id: string;
  title: string;
  file_name: string | null;
  url: string | null;
};

type HistoryRow = {
  id: string;
  status: string;
  submitted_at: string;
  generated_at: string | null;
  documents: HistoryDocument[];
};

type LegalEntityChoice = {
  id: string;
  title: string;
  unp: string;
  source: "requisites_v2" | "legacy";
};

function entityTitle(entity: ClientLegalDetails) {
  if (entity.client_type === "entrepreneur") {
    const name = entity.ent_name?.trim();
    if (!name) return "ИП без наименования";
    return /^ИП\b/i.test(name) ? name : `ИП ${name}`;
  }

  return entity.grp_short_name?.trim()
    || (entity.leg_org_form && entity.leg_name ? `${entity.leg_org_form} «${entity.leg_name}»` : null)
    || entity.leg_name?.trim()
    || "Юрлицо без наименования";
}

function entityUnp(entity: ClientLegalDetails) {
  return entity.client_type === "entrepreneur"
    ? (entity.ent_unp?.trim() || "")
    : (entity.leg_unp?.trim() || "");
}

function v2EntityChoice(row: LegalEntityRequisitesRow): LegalEntityChoice {
  const data = normalizeLegacyData(row.subject_type, row.data);
  const name = String(data.name ?? "").trim();
  const shortName = String(data.short_name ?? data.grp_short_name ?? "").trim();
  const form = String(data.org_form ?? "").trim();
  const title = row.subject_type === "entrepreneur"
    ? (name ? (/^ИП\b/iu.test(name) ? name : `ИП ${name}`) : "ИП без наименования")
    : (shortName || (form && name ? `${form} «${name}»` : name) || "Юрлицо без наименования");
  return { id: row.id, title, unp: String(data.unp ?? "").trim(), source: "requisites_v2" };
}

function legacyEntityChoice(entity: ClientLegalDetails): LegalEntityChoice {
  return { id: entity.id, title: entityTitle(entity), unp: entityUnp(entity), source: "legacy" };
}

function historyLabel(status: string) {
  if (status === "generated") return "Готов";
  if (status === "delivery_partial") return "Готов, доставка частично";
  if (status === "generating") return "Формируется";
  if (status === "failed") return "Не сформирован";
  return "Получен";
}

/**
 * Клиентская поверхность пакета. Здесь намеренно нет полей, ролей, шаблонов
 * и редактора анкеты: ими управляет только администратор в PackagesWorkspace.
 */
export function ClientPackageUsage({
  packageTemplateId,
  packageName,
  packageDescription,
}: {
  packageTemplateId: string;
  packageName: string;
  packageDescription: string | null;
}) {
  const queryClient = useQueryClient();
  const entities = useAiEntities();
  const requisitesV2 = useRequisitesV2({ scope: "user_requisites" });
  // В личном кабинете источник — актуальные реквизиты v2. Старая таблица
  // остаётся резервом только для записей, созданных до перехода.
  const legalEntities = useMemo<LegalEntityChoice[]>(() => {
    if (requisitesV2.legalEntities.length > 0) {
      return requisitesV2.legalEntities.map(v2EntityChoice);
    }
    return entities.allEntities
      .filter((entity) => entity.status !== "archived")
      .map(legacyEntityChoice);
  }, [entities.allEntities, requisitesV2.legalEntities]);
  const [legalEntityId, setLegalEntityId] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (legalEntityId || legalEntities.length === 0) return;
    setLegalEntityId(legalEntities[0].id);
  }, [legalEntityId, legalEntities]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setEmail((current) => current || data.user!.email!);
    });
  }, []);

  const formsQuery = useQuery({
    queryKey: ["client-package-external-forms", packageTemplateId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("external-document-form", {
        body: { action: "owner_forms", package_template_id: packageTemplateId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.forms ?? []) as ExternalForm[];
    },
  });

  const forms = formsQuery.data ?? [];
  const form = forms[0] ?? null;

  useEffect(() => {
    if (!form) return;
    setEmailEnabled(form.delivery?.email !== false);
    setTelegramEnabled(form.delivery?.telegram !== false);
  }, [form?.id]);

  const historyQuery = useQuery({
    queryKey: ["client-package-external-history", packageTemplateId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("external-document-form", {
        body: { action: "owner_history", package_template_id: packageTemplateId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.submissions ?? []) as HistoryRow[];
    },
  });

  const deliveryAvailable = useMemo(
    () => Boolean(form && (form.delivery?.email !== false || form.delivery?.telegram !== false)),
    [form],
  );

  const createLink = async () => {
    if (!form || !legalEntityId) return;
    if (!emailEnabled && !telegramEnabled) {
      toast.error("Выберите хотя бы один способ получения отчёта");
      return;
    }
    if (emailEnabled && !email.trim()) {
      toast.error("Укажите адрес электронной почты для получения отчёта");
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("external-document-form", {
        body: {
          action: "create_link",
          form_id: form.id,
          legal_entity_id: legalEntityId,
          legal_entity_source: legalEntities.find((entity) => entity.id === legalEntityId)?.source ?? "legacy",
          delivery: {
            email: emailEnabled,
            telegram: telegramEnabled,
            to_email: emailEnabled ? email.trim() : undefined,
          },
        },
      });
      if (error) throw error;
      if (!data?.token) throw new Error(data?.error || "Не удалось создать ссылку");
      const nextUrl = `${window.location.origin}/document-form/${data.token}`;
      setUrl(nextUrl);
      await navigator.clipboard?.writeText(nextUrl);
      toast.success("Ссылка создана и скопирована");
      await queryClient.invalidateQueries({ queryKey: ["client-package-external-history", packageTemplateId] });
    } catch (error: any) {
      toast.error(error?.message || "Не удалось создать ссылку");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <GlassCard className="p-4 sm:p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-orange-500/10 text-orange-600 flex items-center justify-center shrink-0">
            <FileText className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">{packageName}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {packageDescription || "Внешняя анкета для подтверждения расходов и приложений."}
            </p>
          </div>
        </div>

        {formsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Проверяем доступную анкету…</div>
        ) : !form ? (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
            Для этого пакета администратор ещё не включил внешнюю анкету.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label className="text-sm">ЮЛ / ИП, для которого составляется отчёт</Label>
              {entities.isLoading || requisitesV2.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : legalEntities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Сначала добавьте реквизиты ЮЛ / ИП во вкладке «Реквизиты».</p>
              ) : (
                <Select value={legalEntityId} onValueChange={setLegalEntityId}>
                  <SelectTrigger className="max-w-xl"><SelectValue placeholder="Выберите ЮЛ / ИП" /></SelectTrigger>
                  <SelectContent>
                    {legalEntities.map((entity) => {
                      return <SelectItem key={entity.id} value={entity.id}>{entity.title}{entity.unp ? ` · УНП ${entity.unp}` : ""}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>

            {deliveryAvailable ? <div className="rounded-xl border border-border/60 bg-background/35 p-3 sm:p-4 space-y-3">
              <div className="flex items-center gap-2"><Send className="h-4 w-4 text-primary" /><h3 className="text-sm font-medium">Куда отправить готовый отчёт</h3></div>
              {form.delivery?.email !== false ? <div className="space-y-2">
                <div className="flex items-center justify-between gap-3"><Label htmlFor="external-report-email" className="text-sm flex items-center gap-2"><Mail className="h-3.5 w-3.5" />На электронную почту</Label><Switch id="external-report-email" checked={emailEnabled} onCheckedChange={setEmailEnabled} /></div>
                {emailEnabled ? <Input id="external-report-email-address" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /> : null}
              </div> : null}
              {form.delivery?.telegram !== false ? <div className="flex items-center justify-between gap-3"><Label htmlFor="external-report-telegram" className="text-sm">В Telegram владельцу доступа</Label><Switch id="external-report-telegram" checked={telegramEnabled} onCheckedChange={setTelegramEnabled} /></div> : null}
              <p className="text-xs text-muted-foreground">PDF и DOCX направляются после заполнения анкеты сотрудником. Telegram используется только если он подключён к вашему кабинету.</p>
            </div> : null}

            <div className="flex flex-wrap gap-2 items-center">
              <Button onClick={createLink} disabled={!legalEntityId || creating}>
                {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Copy className="h-4 w-4 mr-2" />}
                Создать и скопировать ссылку
              </Button>
              <span className="text-xs text-muted-foreground">Ссылка действует, пока у вас есть доступ к этому пакету.</span>
            </div>
            {url ? <div className="rounded-xl bg-muted/60 px-3 py-2 text-xs break-all flex gap-2 items-start"><ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0" />{url}</div> : null}
          </>
        )}
      </GlassCard>

      <GlassCard className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /><h2 className="text-base font-semibold">Готовые отчёты</h2></div><Badge variant="outline">{historyQuery.data?.length ?? 0}</Badge></div>
        {historyQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : historyQuery.isError ? <p className="text-sm text-destructive">Не удалось загрузить историю. Обновите страницу.</p> : (historyQuery.data?.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Здесь появятся отчёты, которые заполнят сотрудники по вашим ссылкам.</p> : <div className="space-y-2">
          {historyQuery.data!.map((item) => <div key={item.id} className="rounded-xl border border-border/50 p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between"><div><p className="text-sm font-medium">{historyLabel(item.status)}</p><p className="text-xs text-muted-foreground">Получен {new Date(item.submitted_at).toLocaleString("ru-BY")}</p></div><div className="flex flex-wrap gap-2">{item.documents.map((document) => document.url ? <Button key={document.id} variant="outline" size="sm" asChild><a href={document.url} target="_blank" rel="noreferrer"><FileDown className="h-3.5 w-3.5 mr-1" />{document.file_name || document.title}</a></Button> : null)}</div></div>)}
        </div>}
      </GlassCard>
    </div>
  );
}
