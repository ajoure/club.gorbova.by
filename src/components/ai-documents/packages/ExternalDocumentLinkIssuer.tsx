import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

type ExternalForm = {
  id: string;
  title: string;
  package_template_item_id: string;
};

/**
 * Owner-facing part of the generic external-form workflow. It receives an
 * already selected legal entity from the ordinary package questionnaire and
 * requests an opaque link from the server; no entitlement data is trusted in
 * the browser.
 */
export function ExternalDocumentLinkIssuer({
  packageTemplateId,
  profileId,
  legalEntityId,
}: {
  packageTemplateId: string;
  profileId: string;
  legalEntityId: string;
}) {
  const [formId, setFormId] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const formsQuery = useQuery({
    queryKey: ["client-external-document-forms", packageTemplateId, profileId],
    queryFn: async () => {
      const { data: items, error: itemError } = await supabase
        .from("document_package_template_items")
        .select("id")
        .eq("package_template_id", packageTemplateId);
      if (itemError) throw itemError;
      const ids = (items ?? []).map((item: any) => item.id);
      if (!ids.length) return [] as ExternalForm[];
      const { data, error } = await supabase
        .from("document_package_external_forms" as never)
        .select("id, title, package_template_item_id")
        .in("package_template_item_id", ids)
        .eq("is_active", true);
      if (error) throw error;
      return (data ?? []) as unknown as ExternalForm[];
    },
  });
  const forms = formsQuery.data ?? [];
  const currentTitle = useMemo(() => forms.find((form) => form.id === formId)?.title, [formId, forms]);
  if (!formsQuery.isLoading && forms.length === 0) return null;

  const create = async () => {
    if (!formId) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("external-document-form", {
        body: { action: "create_link", form_id: formId, legal_entity_id: legalEntityId },
      });
      if (error) throw error;
      if (!data?.token) throw new Error(data?.error || "Не удалось создать ссылку");
      const nextUrl = `${window.location.origin}/document-form/${data.token}`;
      setUrl(nextUrl);
      await navigator.clipboard?.writeText(nextUrl);
      toast.success("Ссылка скопирована в буфер обмена");
    } catch (error: any) {
      toast.error(error?.message || "Не удалось создать ссылку");
    } finally {
      setCreating(false);
    }
  };

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-start gap-2">
        <ExternalLink className="h-4 w-4 text-primary mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">Ссылка для заполнения документа</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Выберите включённую администратором внешнюю анкету и отправьте ссылку сотруднику.
            Она остаётся рабочей только пока действует ваш доступ к генерации документов.
          </p>
        </div>
      </div>
      {formsQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={formId} onValueChange={(value) => { setFormId(value); setUrl(null); }}>
            <SelectTrigger className="text-xs flex-1"><SelectValue placeholder="Выберите документ…" /></SelectTrigger>
            <SelectContent>{forms.map((form) => <SelectItem key={form.id} value={form.id} className="text-xs">{form.title}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" onClick={create} disabled={!formId || creating}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Copy className="h-3.5 w-3.5 mr-1" /> Создать и скопировать</>}
          </Button>
        </div>
      )}
      {url ? <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs break-all"><span className="font-medium">{currentTitle}: </span>{url}</div> : null}
    </GlassCard>
  );
}
