/**
 * CorporateStep3Params — Step 3: Participants, procedure params, agenda.
 *
 * Uses PersonPicker for participants/chair/secretary with quick-create.
 * Default address from entity, default dates by law, default agenda.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, Users, Calendar, MapPin, ListOrdered, AlertTriangle, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PersonPicker } from "@/components/ai-requisites/PersonPicker";
import { useAiPersons } from "@/hooks/useAiPersons";
import { useEntityPersonLinks } from "@/hooks/useEntityPersonLinks";
import { useAiEntities } from "@/hooks/useAiEntities";
import { formatStructuredAddressForView } from "@/lib/address/formatStructuredAddress";
import type { CanonicalAddressPayload } from "@/lib/address/types";
import type {
  CorporateDraftSession,
  CorporateParams,
  Participant,
  AgendaItem,
  CharterRules,
} from "@/lib/corporate/corporateTypes";
import {
  determineProcedureMode,
  getDefaultAgenda,
  getDefaultDates,
} from "@/lib/corporate/corporateRuleEngine";
import {
  LAW_ANNUAL_MEETING_DEADLINE_MONTH,
  LAW_ANNUAL_MEETING_DEADLINE_DAY,
} from "@/lib/corporate/corporateTypes";

interface Props {
  session: CorporateDraftSession;
  onAutoSave: (patch: Record<string, unknown>) => void;
  onUpdate: (patch: Record<string, unknown>) => Promise<unknown>;
}

const EMPTY_PARTICIPANT: Participant = {
  type: 'individual',
  name: '',
  share_percent: 0,
  vote_count: 0,
  attendance: 'present',
};

export function CorporateStep3Params({ session, onAutoSave }: Props) {
  const existingParams = (session.corporate_params || {}) as Partial<CorporateParams>;
  const charterRules = (session.confirmed_charter_rules || {}) as Partial<CharterRules>;
  const legalDetailsId = session.legal_details_id;

  // Data hooks
  const { allPersons, createPerson, isCreating: isCreatingPerson, profileId: personsProfileId } = useAiPersons();
  const { links, createLink } = useEntityPersonLinks(legalDetailsId, personsProfileId);
  const { allEntities } = useAiEntities();

  // Get entity address for autofill
  const entity = useMemo(() => {
    if (!legalDetailsId) return null;
    return allEntities.find(e => e.id === legalDetailsId) ?? null;
  }, [allEntities, legalDetailsId]);

  const entityAddress = useMemo(() => {
    if (!entity) return '';
    const isEnt = entity.client_type === 'entrepreneur';
    const structured = (isEnt ? entity.ent_address_structured : entity.leg_address_structured) as unknown as CanonicalAddressPayload | null;
    const fallback = isEnt ? entity.ent_address : entity.leg_address;
    const lines = formatStructuredAddressForView(structured, fallback);
    return lines.join(', ');
  }, [entity]);

  // Default dates
  const defaults = useMemo(
    () => getDefaultDates(session.report_year, charterRules),
    [session.report_year, charterRules]
  );

  // Initialize state from saved params or defaults
  const [participants, setParticipants] = useState<Participant[]>(
    existingParams.participants?.length ? existingParams.participants : [{ ...EMPTY_PARTICIPANT }]
  );

  const defaultAgenda = useMemo(() => {
    const mode = determineProcedureMode(participants.filter(p => p.name.trim()));
    return getDefaultAgenda(mode, charterRules);
  }, [charterRules]); // only recompute on charter rules change, not on every participant edit

  const [agenda, setAgenda] = useState<AgendaItem[]>(
    existingParams.agenda?.length ? existingParams.agenda : defaultAgenda
  );
  const [meetingDate, setMeetingDate] = useState(existingParams.meeting?.date || defaults.meetingDate);
  const [meetingTime, setMeetingTime] = useState(existingParams.meeting?.time || '');
  const [meetingLocation, setMeetingLocation] = useState(existingParams.meeting?.location || entityAddress);
  const [meetingFormat, setMeetingFormat] = useState<string>(existingParams.meeting?.format || 'in_person');
  const [votingForm, setVotingForm] = useState<string>(existingParams.meeting?.voting_form || 'open');
  const [chairPersonId, setChairPersonId] = useState<string | null>(existingParams.chair?.person_id || null);
  const [chairName, setChairName] = useState(existingParams.chair?.name || '');
  const [secretaryPersonId, setSecretaryPersonId] = useState<string | null>(existingParams.secretary?.person_id || null);
  const [secretaryName, setSecretaryName] = useState(existingParams.secretary?.name || '');
  const [noticeDate, setNoticeDate] = useState(existingParams.notice?.date || defaults.noticeDate);
  const [reviewDateFrom, setReviewDateFrom] = useState(existingParams.review?.date_from || defaults.reviewDateFrom);
  const [reviewLocation, setReviewLocation] = useState(existingParams.review?.location || entityAddress);

  // Track if user manually changed address
  const [addressAutoFilled, setAddressAutoFilled] = useState(!existingParams.meeting?.location);
  const [reviewLocationAutoFilled, setReviewLocationAutoFilled] = useState(!existingParams.review?.location);

  // Quick-create dialog
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateName, setQuickCreateName] = useState('');
  const [quickCreateTarget, setQuickCreateTarget] = useState<'participant' | 'chair' | 'secretary'>('participant');
  const [quickCreateIdx, setQuickCreateIdx] = useState<number>(0);

  // Detected mode
  const detectedMode = determineProcedureMode(participants.filter(p => p.name.trim()));

  // Date warnings
  const deadlineDate = new Date(session.report_year + 1, LAW_ANNUAL_MEETING_DEADLINE_MONTH - 1, LAW_ANNUAL_MEETING_DEADLINE_DAY);
  const meetingDateObj = meetingDate ? new Date(meetingDate) : null;
  const isAfterDeadline = meetingDateObj && meetingDateObj > deadlineDate;

  // Linked persons with share info
  const linkedPersonIds = useMemo(() => {
    const map = new Map<string, { share_percent?: number; role_type: string }>();
    for (const link of links) {
      if (!map.has(link.person_id)) {
        map.set(link.person_id, {
          share_percent: link.share_percent ?? undefined,
          role_type: link.role_type,
        });
      }
    }
    return map;
  }, [links]);

  // Auto-save on changes
  const buildParams = useCallback((): Partial<CorporateParams> => ({
    participants,
    agenda,
    meeting: { date: meetingDate, time: meetingTime, location: meetingLocation, format: meetingFormat as any, voting_form: votingForm as any },
    chair: { person_id: chairPersonId || undefined, name: chairName },
    secretary: { person_id: secretaryPersonId || undefined, name: secretaryName },
    governance: charterRules
      ? {
          has_board: (charterRules as any).has_board ?? false,
          has_auditor: (charterRules as any).has_auditor ?? false,
          has_audit_commission: (charterRules as any).has_audit_commission ?? false,
        }
      : { has_board: false, has_auditor: false, has_audit_commission: false },
    notice: { date: noticeDate, method: existingParams.notice?.method, days_before: existingParams.notice?.days_before },
    review: { location: reviewLocation, date_from: reviewDateFrom, date_to: existingParams.review?.date_to },
    candidates: existingParams.candidates || {},
  }), [participants, agenda, meetingDate, meetingTime, meetingLocation, meetingFormat, votingForm, chairPersonId, chairName, secretaryPersonId, secretaryName, charterRules, noticeDate, reviewDateFrom, reviewLocation, existingParams]);

  useEffect(() => {
    const params = buildParams();
    onAutoSave({
      corporate_params: params,
      procedure_mode: detectedMode,
    });
  }, [participants, agenda, meetingDate, meetingTime, meetingLocation, meetingFormat, votingForm, chairPersonId, chairName, secretaryPersonId, secretaryName, noticeDate, reviewDateFrom, reviewLocation]);

  // Person selection handler for participant
  const handleSelectPerson = (idx: number, personId: string | null) => {
    if (!personId) {
      updateParticipant(idx, { person_id: undefined, name: '' });
      return;
    }
    const person = allPersons.find(p => p.id === personId);
    if (!person) return;

    const linkInfo = linkedPersonIds.get(personId);
    const patch: Partial<Participant> = {
      person_id: personId,
      name: person.full_name || '',
      type: 'individual',
    };
    if (linkInfo?.share_percent != null) {
      patch.share_percent = linkInfo.share_percent;
    }
    updateParticipant(idx, patch);
  };

  // Chair/secretary selection
  const handleSelectChair = (personId: string | null) => {
    if (!personId) { setChairPersonId(null); setChairName(''); return; }
    const person = allPersons.find(p => p.id === personId);
    setChairPersonId(personId);
    setChairName(person?.full_name || '');
  };

  const handleSelectSecretary = (personId: string | null) => {
    if (!personId) { setSecretaryPersonId(null); setSecretaryName(''); return; }
    const person = allPersons.find(p => p.id === personId);
    setSecretaryPersonId(personId);
    setSecretaryName(person?.full_name || '');
  };

  // Quick-create person
  const handleQuickCreate = async () => {
    if (!quickCreateName.trim()) return;
    try {
      const newPerson = await createPerson({ full_name: quickCreateName.trim(), is_active: true });
      // Auto-link to entity if available
      if (legalDetailsId && linkProfileId) {
        try {
          // Find founder role from catalog — use first available role
          await createLink({
            person_id: newPerson.id,
            legal_details_id: legalDetailsId,
            role_catalog_id: links[0]?.role_catalog_id || '', // will be resolved
            role_type: 'founder',
            profile_id: linkProfileId,
          });
        } catch {
          // Link creation may fail if catalog not ready — that's OK
        }
      }

      if (quickCreateTarget === 'participant') {
        updateParticipant(quickCreateIdx, {
          person_id: newPerson.id,
          name: newPerson.full_name || quickCreateName.trim(),
          type: 'individual',
        });
      } else if (quickCreateTarget === 'chair') {
        setChairPersonId(newPerson.id);
        setChairName(newPerson.full_name || quickCreateName.trim());
      } else {
        setSecretaryPersonId(newPerson.id);
        setSecretaryName(newPerson.full_name || quickCreateName.trim());
      }

      setQuickCreateOpen(false);
      setQuickCreateName('');
      toast.success("Физлицо создано");
    } catch (err: any) {
      toast.error("Ошибка: " + err.message);
    }
  };

  const openQuickCreate = (target: 'participant' | 'chair' | 'secretary', idx = 0) => {
    setQuickCreateTarget(target);
    setQuickCreateIdx(idx);
    setQuickCreateName('');
    setQuickCreateOpen(true);
  };

  // Participant handlers
  const addParticipant = () => setParticipants([...participants, { ...EMPTY_PARTICIPANT }]);
  const removeParticipant = (idx: number) => setParticipants(participants.filter((_, i) => i !== idx));
  const updateParticipant = (idx: number, patch: Partial<Participant>) => {
    setParticipants(participants.map((p, i) => i === idx ? { ...p, ...patch } : p));
  };

  // Agenda handlers
  const addAgendaItem = () => setAgenda([...agenda, { number: agenda.length + 1, title: '' }]);
  const removeAgendaItem = (idx: number) => {
    const updated = agenda.filter((_, i) => i !== idx).map((a, i) => ({ ...a, number: i + 1 }));
    setAgenda(updated);
  };

  return (
    <div className="space-y-6">
      {/* Mode indicator */}
      <GlassCard className="p-3">
        <div className="flex items-center gap-2">
          <Badge variant={detectedMode === 'sole_participant_decision' ? 'secondary' : 'default'}>
            {detectedMode === 'sole_participant_decision'
              ? 'Решение единственного участника'
              : 'Годовое общее собрание участников'}
          </Badge>
          <span className="text-xs text-muted-foreground">(определено по составу участников)</span>
        </div>
      </GlassCard>

      {/* Participants */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" />
            Состав участников
          </h4>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => openQuickCreate('participant', participants.length)}>
              <UserPlus className="h-3.5 w-3.5 mr-1" />
              Создать
            </Button>
            <Button variant="outline" size="sm" onClick={addParticipant}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Добавить
            </Button>
          </div>
        </div>

        {participants.map((p, idx) => (
          <GlassCard key={idx} className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Участник {idx + 1}</span>
                {p.person_id && (
                  <Badge variant="outline" className="text-[10px]">из реквизитов</Badge>
                )}
                {!p.person_id && p.name && (
                  <Badge variant="secondary" className="text-[10px]">введено вручную</Badge>
                )}
              </div>
              {participants.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removeParticipant(idx)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">Физлицо</Label>
                <div className="mt-1 flex gap-2">
                  <div className="flex-1">
                    <PersonPicker
                      persons={allPersons}
                      value={p.person_id || null}
                      onChange={(pid) => handleSelectPerson(idx, pid)}
                    />
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => openQuickCreate('participant', idx)}>
                    <UserPlus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {!p.person_id && (
                  <div className="mt-2">
                    <Label className="text-xs text-muted-foreground">или ФИО вручную</Label>
                    <Input
                      className="mt-1"
                      value={p.name}
                      onChange={(e) => updateParticipant(idx, { name: e.target.value })}
                      placeholder="Иванов Иван Иванович"
                    />
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs">Тип</Label>
                <Select value={p.type} onValueChange={(v) => updateParticipant(idx, { type: v as any })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Физическое лицо</SelectItem>
                    <SelectItem value="legal_entity">Юридическое лицо</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Доля (%)</Label>
                <Input type="number" className="mt-1" value={p.share_percent} onChange={(e) => updateParticipant(idx, { share_percent: Number(e.target.value) })} min={0} max={100} />
              </div>
              <div>
                <Label className="text-xs">Количество голосов</Label>
                <Input type="number" className="mt-1" value={p.vote_count} onChange={(e) => updateParticipant(idx, { vote_count: Number(e.target.value) })} min={0} />
              </div>
              <div>
                <Label className="text-xs">Форма участия</Label>
                <Select value={p.attendance} onValueChange={(v) => updateParticipant(idx, { attendance: v as any })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="present">Присутствует</SelectItem>
                    <SelectItem value="absent">Отсутствует</SelectItem>
                    <SelectItem value="absentee_vote">Заочное голосование</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Representative block */}
            <div className="border-t pt-2 mt-2">
              <Label className="text-xs text-muted-foreground">Представитель (если есть)</Label>
              <div className="grid gap-2 sm:grid-cols-2 mt-1">
                <Input
                  placeholder="ФИО представителя"
                  value={p.representative?.name || ''}
                  onChange={(e) => updateParticipant(idx, {
                    representative: { name: e.target.value, basis: p.representative?.basis || '' }
                  })}
                />
                <Input
                  placeholder="Основание полномочий"
                  value={p.representative?.basis || ''}
                  onChange={(e) => updateParticipant(idx, {
                    representative: { name: p.representative?.name || '', basis: e.target.value }
                  })}
                />
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Meeting details (only for annual_meeting) */}
      {detectedMode === 'annual_meeting' && (
        <div className="space-y-4">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Параметры собрания
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Дата собрания</Label>
                {meetingDate === defaults.meetingDate && (
                  <Badge variant="outline" className="text-[10px]">по умолчанию</Badge>
                )}
              </div>
              <Input type="date" className="mt-1" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
              {isAfterDeadline && (
                <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  Дата после крайнего срока ({LAW_ANNUAL_MEETING_DEADLINE_DAY}.0{LAW_ANNUAL_MEETING_DEADLINE_MONTH}.{session.report_year + 1})
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Время</Label>
              <Input type="time" className="mt-1" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Место проведения</Label>
                {addressAutoFilled && meetingLocation === entityAddress && (
                  <Badge variant="outline" className="text-[10px]">из реквизитов юрлица</Badge>
                )}
              </div>
              <Input
                className="mt-1"
                value={meetingLocation}
                onChange={(e) => { setMeetingLocation(e.target.value); setAddressAutoFilled(false); }}
                placeholder="г. Минск, ул. Примерная, 1"
              />
            </div>
            <div>
              <Label className="text-xs">Форма проведения</Label>
              <Select value={meetingFormat} onValueChange={setMeetingFormat}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_person">Очная</SelectItem>
                  <SelectItem value="absentee">Заочная</SelectItem>
                  <SelectItem value="mixed">Смешанная</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Форма голосования</Label>
              <Select value={votingForm} onValueChange={setVotingForm}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Открытое</SelectItem>
                  <SelectItem value="secret">Тайное</SelectItem>
                  <SelectItem value="mixed">Смешанное</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Notice & Review dates */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Дата извещения</Label>
                {noticeDate === defaults.noticeDate && (
                  <Badge variant="outline" className="text-[10px]">по закону</Badge>
                )}
              </div>
              <Input type="date" className="mt-1" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Начало ознакомления с документами</Label>
                {reviewDateFrom === defaults.reviewDateFrom && (
                  <Badge variant="outline" className="text-[10px]">по закону</Badge>
                )}
              </div>
              <Input type="date" className="mt-1" value={reviewDateFrom} onChange={(e) => setReviewDateFrom(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Место ознакомления с документами</Label>
                {reviewLocationAutoFilled && reviewLocation === entityAddress && (
                  <Badge variant="outline" className="text-[10px]">из реквизитов юрлица</Badge>
                )}
              </div>
              <Input
                className="mt-1"
                value={reviewLocation}
                onChange={(e) => { setReviewLocation(e.target.value); setReviewLocationAutoFilled(false); }}
                placeholder="г. Минск, ул. Примерная, 1"
              />
            </div>
          </div>

          {/* Chair & Secretary with PersonPicker */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Председатель собрания</Label>
              <div className="mt-1 flex gap-2">
                <div className="flex-1">
                  <PersonPicker persons={allPersons} value={chairPersonId} onChange={handleSelectChair} />
                </div>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => openQuickCreate('chair')}>
                  <UserPlus className="h-3.5 w-3.5" />
                </Button>
              </div>
              {!chairPersonId && (
                <Input className="mt-1" value={chairName} onChange={(e) => setChairName(e.target.value)} placeholder="ФИО (вручную)" />
              )}
              {!chairPersonId && chairName && (
                <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  Лицо не создано в реквизитах
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Секретарь собрания</Label>
              <div className="mt-1 flex gap-2">
                <div className="flex-1">
                  <PersonPicker persons={allPersons} value={secretaryPersonId} onChange={handleSelectSecretary} />
                </div>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => openQuickCreate('secretary')}>
                  <UserPlus className="h-3.5 w-3.5" />
                </Button>
              </div>
              {!secretaryPersonId && (
                <Input className="mt-1" value={secretaryName} onChange={(e) => setSecretaryName(e.target.value)} placeholder="ФИО (вручную)" />
              )}
              {!secretaryPersonId && secretaryName && (
                <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  Лицо не создано в реквизитах
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Agenda */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <ListOrdered className="h-4 w-4" />
            Повестка дня
          </h4>
          <Button variant="outline" size="sm" onClick={addAgendaItem}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Добавить
          </Button>
        </div>

        {agenda.map((item, idx) => (
          <div key={idx} className="flex gap-2 items-start">
            <span className="text-sm font-medium text-muted-foreground mt-2.5 w-6 shrink-0 text-right">
              {item.number}.
            </span>
            <div className="flex-1 space-y-1">
              <Input
                value={item.title}
                onChange={(e) => {
                  const updated = [...agenda];
                  updated[idx] = { ...updated[idx], title: e.target.value };
                  setAgenda(updated);
                }}
                placeholder="Вопрос повестки дня"
              />
            </div>
            {agenda.length > 1 && (
              <Button variant="ghost" size="sm" className="mt-0.5" onClick={() => removeAgendaItem(idx)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Quick-create dialog */}
      <Dialog open={quickCreateOpen} onOpenChange={setQuickCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Создать физлицо</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>ФИО</Label>
              <Input
                className="mt-1"
                value={quickCreateName}
                onChange={(e) => setQuickCreateName(e.target.value)}
                placeholder="Иванов Иван Иванович"
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Будет создано физлицо с минимальными данными. Дополнительные реквизиты можно заполнить позже в карточке лица.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickCreateOpen(false)}>Отмена</Button>
            <Button onClick={handleQuickCreate} disabled={!quickCreateName.trim() || isCreatingPerson}>
              {isCreatingPerson ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
