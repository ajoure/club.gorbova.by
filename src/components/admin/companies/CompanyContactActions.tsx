import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContactPickerDialog, type PickedContact } from "@/components/admin/shared/pickers/ContactPickerDialog";
import { isUnlinkableBillingContact, linkRegisteredCompanyContact, readBillingUnlink, readRegisteredCompanyLink, unlinkBillingContact,
  type CompanyContactEdge, type RegisteredCompanyRole } from "./companyContactOperations";

const errorMessage = (error: unknown) => error && typeof error === "object" && "message" in error ? String(error.message) : "Не удалось проверить результат";

export function BillingContactUnlink({companyId,contact,canManage,onChanged}: {
  companyId: string; contact: CompanyContactEdge; canManage: boolean; onChanged: () => Promise<void>;
}) {
  const [open,setOpen] = useState(false);
  const [reason,setReason] = useState("");
  const [busy,setBusy] = useState(false);
  const [dispatched,setDispatched] = useState(false);
  const dispatchGuard = useRef(false);
  const [message,setMessage] = useState("");
  if (!canManage || !isUnlinkableBillingContact(contact)) return null;
  const verify = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!await readBillingUnlink(companyId,contact)) throw new Error("Отвязка не подтверждена. Повторная отправка заблокирована; проверьте историю операции");
      await onChanged(); setOpen(false); toast.success("Связь плательщика отвязана");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (busy || dispatchGuard.current) return;
    setBusy(true); setMessage("");
    try {
      await unlinkBillingContact(companyId,contact,reason,() => { dispatchGuard.current=true; setDispatched(true); });
      await onChanged(); setOpen(false); toast.success("Связь плательщика отвязана");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <><Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => setOpen(true)}>Отвязать плательщика</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>Отвязать профиль плательщика</DialogTitle><DialogDescription>Будет удалена только связь с этой компанией. Реквизиты и их владелец, документы, покупки, платежи и права сохраняются. Повторная автоматическая привязка будет заблокирована.</DialogDescription></DialogHeader>
      <label className="grid gap-2 text-sm">Причина отвязки<Textarea value={reason} maxLength={500} disabled={busy || dispatched} onChange={event => setReason(event.target.value)} /></label>
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Закрыть</Button>{dispatched ? <Button type="button" disabled={busy} onClick={verify}>Перечитать состояние</Button> : <Button type="button" disabled={busy || !reason.trim()} onClick={submit}>Отвязать профиль</Button>}</DialogFooter>
    </DialogContent></Dialog></>;
}

export function RegisteredCompanyContactForm({companyId,contacts,onChanged}: {
  companyId: string; contacts: CompanyContactEdge[]; onChanged: () => Promise<void>;
}) {
  const [pickerOpen,setPickerOpen] = useState(false);
  const [selected,setSelected] = useState<PickedContact | null>(null);
  const [role,setRole] = useState<RegisteredCompanyRole>("director");
  const [busy,setBusy] = useState(false);
  const [dispatched,setDispatched] = useState(false);
  const dispatchGuard = useRef(false);
  const [message,setMessage] = useState("");
  const complete = async () => { await onChanged(); setSelected(null); dispatchGuard.current=false; setDispatched(false); toast.success("Зарегистрированный профиль связан"); };
  const submit = async () => {
    if (busy || dispatchGuard.current || !selected || contacts.some(c => c.profile_id === selected.id)) return;
    setBusy(true); setMessage("");
    try { await linkRegisteredCompanyContact(companyId,selected.id,role,() => { dispatchGuard.current=true; setDispatched(true); }); await complete(); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    if (busy || !selected) return;
    setBusy(true);
    try {
      if (!await readRegisteredCompanyLink(companyId,selected.id,role)) throw new Error("Связь не подтверждена. Повторная отправка заблокирована; проверьте историю операции");
      await complete();
    } catch(error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3 rounded-lg border bg-muted/30 p-3"><div className="text-sm font-medium">Связать зарегистрированный профиль</div>
    <Button type="button" variant="outline" disabled={busy || dispatched} onClick={() => setPickerOpen(true)}>Выбрать существующий профиль</Button>
    {selected && <><p className="text-sm" data-profile-id={selected.id}>{selected.full_name || "Выбранный профиль"}</p><Select value={role} disabled={busy || dispatched} onValueChange={value => setRole(value as RegisteredCompanyRole)}><SelectTrigger aria-label="Роль зарегистрированного профиля"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="director">Директор</SelectItem><SelectItem value="employee">Сотрудник</SelectItem></SelectContent></Select>
    {contacts.some(c => c.profile_id === selected.id) && <p role="alert" className="text-sm">Этот профиль уже связан с компанией.</p>}
    {dispatched ? <Button type="button" disabled={busy} onClick={verify}>Перечитать состояние связи</Button> : <Button type="button" disabled={busy || contacts.some(c => c.profile_id === selected.id)} onClick={submit}>Связать профиль</Button>}</>}
    {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
    <ContactPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={profile => { if (!dispatchGuard.current) {setSelected(profile);setMessage("");} setPickerOpen(false); }} options={{title:"Выбрать зарегистрированный профиль",helperText:"Выберите существующий профиль. Новые контакты здесь не создаются.",searchMode:"name_only"}} />
  </div>;
}
