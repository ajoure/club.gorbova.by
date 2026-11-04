import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { normalizeCompanyName, inferCompanyLegalForm } from "@/lib/companies/normalizeCompanyName";
import { normalizeCompanyPhone } from "@/lib/companies/normalizeCompanyPhone";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface EditableCompany {
  id: string; full_name: string; short_name: string | null; legal_form: string | null;
  email: string | null; phone: string | null; country: string; company_kind: string;
}
const COMPANY_LEGAL_FORMS = ["ООО", "ОДО", "ЗАО", "ОАО", "ПАО", "АО", "СООО", "ИООО", "СЗАО", "УП", "ЧУП", "КУП", "РУП", "ТУП", "ПК", "ТДО", "ТОО", "МУП", "ФГУП", "ГП"];

export function EditCompanyDialog({ company, open, onOpenChange, onSaved }: {
  company: EditableCompany | null;
  open?: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const access = useAdminAccess();
  const isAdmin = !access.isLoading && (access.isAdmin || access.isSuperAdmin);
  const isOpen = open ?? !!company;
  const [addressState, setAddressState] = useState<{ companyId: string; original: string | null; value: string } | null>(null);
  const [addressError, setAddressError] = useState(false);
  const submissionGuard = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    setAddressState(null); setAddressError(false); setSubmitted(false); submissionGuard.current=false;
    if (!isOpen || !company || !isAdmin) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.from("companies").select("legal_address").eq("id", company.id).single();
      if (cancelled) return;
      if (error || !data) setAddressError(true);
      else setAddressState({ companyId: company.id, original: data.legal_address, value: data.legal_address ?? "" });
    })();
    return () => { cancelled = true; };
  }, [company?.id, isOpen, isAdmin]);
  const [fullName, setFullName] = useState("");
  const [shortName, setShortName] = useState("");
  const [legalForm, setLegalForm] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (!company) return;
    setFullName(normalizeCompanyName(company.full_name));
    setShortName(normalizeCompanyName(company.short_name ?? ""));
    setLegalForm(company.legal_form || inferCompanyLegalForm(company.full_name) || "");
    setEmail(company.email ?? "");
    setPhone(normalizeCompanyPhone(company.phone, company.country) ?? "");
  }, [company, isOpen]);

  const updateCompany = useMutation({
    mutationFn: async () => {
      if (!company) return;
      if (submissionGuard.current) throw new Error("Сначала проверьте сохранённые изменения в карточке компании");
      if (isAdmin && (!addressState || addressState.companyId !== company.id)) throw new Error("Адрес ещё не прочитан");
      const args = {
        _id: company.id,
        _full_name: normalizeCompanyName(fullName),
        _short_name: normalizeCompanyName(shortName) || null,
        _email: email,
        _phone: normalizeCompanyPhone(phone, company.country),
        _legal_form: legalForm || null,
      };
      const addressChanged = isAdmin && addressState && addressState.value !== (addressState.original ?? "");
      if (addressChanged && (!addressState.value.trim() || addressState.value.trim().length > 2000)) throw new Error("Укажите юридический адрес (до 2000 символов)");
      submissionGuard.current=true; setSubmitted(true);
      // Both overloads execute with the real authenticated session. Never set an initiator or claims.
      const { data, error } = addressChanged
        ? await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{data: unknown; error: {message: string} | null}>)("crm_company_update", {
            ...args, _legal_address: addressState.value, _expected_legal_address: addressState.original,
          })
        : await supabase.rpc("crm_company_update", args);
      if (error) throw error;
      if (data !== company.id) throw new Error("Сохранение не подтверждено. Перечитайте карточку перед повторением");
    },
    onSuccess: () => { toast.success("Компания обновлена"); onSaved(); },
    onError: (error: Error) => toast.error(error.message || "Не удалось обновить компанию"),
  });

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(event) => { event.preventDefault(); if (!fullName.trim()) return toast.error("Укажите название"); if (!submitted) updateCompany.mutate(); }}>
          <DialogHeader><DialogTitle>Редактировать компанию</DialogTitle><DialogDescription>Изменения сохраняются в канонической записи компании.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-5">
            <label className="grid gap-2 text-sm font-medium">Полное название<Input value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label className="grid gap-2 text-sm font-medium">Короткое название<Input value={shortName} onChange={(event) => setShortName(event.target.value)} /></label>
            {company?.company_kind !== "entrepreneur" && <label className="grid gap-2 text-sm font-medium">Организационная форма<Select value={legalForm || "none"} onValueChange={(value) => setLegalForm(value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Выберите ОПФ" /></SelectTrigger><SelectContent><SelectItem value="none">Не указана</SelectItem>{Array.from(new Set([...COMPANY_LEGAL_FORMS, ...(legalForm ? [legalForm] : [])])).map((form) => <SelectItem key={form} value={form}>{form}</SelectItem>)}</SelectContent></Select></label>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">Email<Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" /></label>
              <label className="grid gap-2 text-sm font-medium">Телефон<Input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            </div>
            <p className="text-xs text-muted-foreground">Статус меняется отдельными действиями «Архивировать» и «Объединить», чтобы не обходить CRM-инварианты.</p>
          </div>
          {isAdmin && <div className="mb-4 grid gap-2"><label className="grid gap-2 text-sm font-medium">Юридический адрес<Textarea value={addressState?.value ?? ""} disabled={!addressState || submitted} maxLength={2000} onChange={event => setAddressState(prev => prev ? { ...prev, value: event.target.value } : prev)} /></label>{addressError ? <p role="alert" className="text-sm text-destructive">Не удалось прочитать текущий адрес. Закройте форму и перечитайте карточку.</p> : !addressState ? <p className="text-sm text-muted-foreground">Читаем текущий адрес…</p> : null}</div>}
          {submitted && updateCompany.isError && <p role="alert" className="mb-4 text-sm text-destructive">Повторная отправка заблокирована. Закройте форму и проверьте карточку компании.</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button><Button type="submit" disabled={updateCompany.isPending || submitted || access.isLoading || (isAdmin && !addressState)}>{updateCompany.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Сохранить</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
