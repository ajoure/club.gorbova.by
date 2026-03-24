/**
 * CorporateStep3Params — Step 3: Participants, procedure params, agenda.
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Users, Calendar, MapPin, ListOrdered } from "lucide-react";
import type {
  CorporateDraftSession,
  CorporateParams,
  Participant,
  AgendaItem,
} from "@/lib/corporate/corporateTypes";
import { determineProcedureMode } from "@/lib/corporate/corporateRuleEngine";

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

  const [participants, setParticipants] = useState<Participant[]>(
    existingParams.participants?.length ? existingParams.participants : [{ ...EMPTY_PARTICIPANT }]
  );
  const [agenda, setAgenda] = useState<AgendaItem[]>(
    existingParams.agenda?.length ? existingParams.agenda : [{ number: 1, title: '' }]
  );
  const [meetingDate, setMeetingDate] = useState(existingParams.meeting?.date || '');
  const [meetingTime, setMeetingTime] = useState(existingParams.meeting?.time || '');
  const [meetingLocation, setMeetingLocation] = useState(existingParams.meeting?.location || '');
  const [meetingFormat, setMeetingFormat] = useState(existingParams.meeting?.format || 'in_person');
  const [votingForm, setVotingForm] = useState(existingParams.meeting?.voting_form || 'open');
  const [chairName, setChairName] = useState(existingParams.chair?.name || '');
  const [secretaryName, setSecretaryName] = useState(existingParams.secretary?.name || '');

  // Detected mode
  const detectedMode = determineProcedureMode(participants.filter(p => p.name.trim()));

  // Auto-save on changes
  const buildParams = useCallback((): Partial<CorporateParams> => ({
    participants,
    agenda,
    meeting: { date: meetingDate, time: meetingTime, location: meetingLocation, format: meetingFormat as any, voting_form: votingForm as any },
    chair: { name: chairName },
    secretary: { name: secretaryName },
    governance: (session.confirmed_charter_rules as any)?.has_board !== undefined
      ? {
          has_board: (session.confirmed_charter_rules as any).has_board ?? false,
          has_auditor: (session.confirmed_charter_rules as any).has_auditor ?? false,
          has_audit_commission: (session.confirmed_charter_rules as any).has_audit_commission ?? false,
        }
      : { has_board: false, has_auditor: false, has_audit_commission: false },
    notice: existingParams.notice || {},
    review: existingParams.review || {},
    candidates: existingParams.candidates || {},
  }), [participants, agenda, meetingDate, meetingTime, meetingLocation, meetingFormat, votingForm, chairName, secretaryName, session, existingParams]);

  useEffect(() => {
    const params = buildParams();
    onAutoSave({
      corporate_params: params,
      procedure_mode: detectedMode,
    });
  }, [participants, agenda, meetingDate, meetingTime, meetingLocation, meetingFormat, votingForm, chairName, secretaryName]);

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
          <span className="text-xs text-muted-foreground">
            (определено по составу участников)
          </span>
        </div>
      </GlassCard>

      {/* Participants */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" />
            Состав участников
          </h4>
          <Button variant="outline" size="sm" onClick={addParticipant}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Добавить
          </Button>
        </div>

        {participants.map((p, idx) => (
          <GlassCard key={idx} className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Участник {idx + 1}
              </span>
              {participants.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removeParticipant(idx)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">ФИО / Наименование</Label>
                <Input
                  className="mt-1"
                  value={p.name}
                  onChange={(e) => updateParticipant(idx, { name: e.target.value })}
                  placeholder="Иванов Иван Иванович"
                />
              </div>
              <div>
                <Label className="text-xs">Тип</Label>
                <Select
                  value={p.type}
                  onValueChange={(v) => updateParticipant(idx, { type: v as any })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Физическое лицо</SelectItem>
                    <SelectItem value="legal_entity">Юридическое лицо</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Доля (%)</Label>
                <Input
                  type="number"
                  className="mt-1"
                  value={p.share_percent}
                  onChange={(e) => updateParticipant(idx, { share_percent: Number(e.target.value) })}
                  min={0}
                  max={100}
                />
              </div>
              <div>
                <Label className="text-xs">Количество голосов</Label>
                <Input
                  type="number"
                  className="mt-1"
                  value={p.vote_count}
                  onChange={(e) => updateParticipant(idx, { vote_count: Number(e.target.value) })}
                  min={0}
                />
              </div>
              <div>
                <Label className="text-xs">Форма участия</Label>
                <Select
                  value={p.attendance}
                  onValueChange={(v) => updateParticipant(idx, { attendance: v as any })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
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
              <Label className="text-xs">Дата собрания</Label>
              <Input type="date" className="mt-1" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Время</Label>
              <Input type="time" className="mt-1" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Место проведения</Label>
              <Input className="mt-1" value={meetingLocation} onChange={(e) => setMeetingLocation(e.target.value)} placeholder="г. Минск, ул. Примерная, 1" />
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

          {/* Chair & Secretary */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Председатель собрания</Label>
              <Input className="mt-1" value={chairName} onChange={(e) => setChairName(e.target.value)} placeholder="ФИО" />
            </div>
            <div>
              <Label className="text-xs">Секретарь собрания</Label>
              <Input className="mt-1" value={secretaryName} onChange={(e) => setSecretaryName(e.target.value)} placeholder="ФИО" />
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
    </div>
  );
}
