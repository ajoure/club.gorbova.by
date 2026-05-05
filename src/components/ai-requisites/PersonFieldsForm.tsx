/**
 * PersonFieldsForm — standalone form for person (individual) fields.
 * No billing, no leg_/ent_ fields, no useLegalDetails dependency.
 */

import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, User, FileText, MapPin, Phone, Info } from 'lucide-react';
import { StructuredAddressBlock } from '@/components/shared/StructuredAddressBlock';
import { DatePicker } from '@/components/ui/date-picker';
import { CopyablePlainLabel } from '@/components/ui/CopyablePlainLabel';
import { useLegalDetailsFields } from '@/hooks/useLegalDetailsFields';
import { normalizePassport, containsCyrillic } from '@/lib/persons/passportNormalizer';
import type { StructuredAddress } from '@/lib/address/types';
import { emptyAddress } from '@/lib/address/utils';
import type { CanonicalAddressPayload } from '@/lib/address/types';
import type { PersonRow } from '@/hooks/useAiPersons';

interface PersonFieldsFormProps {
  initialData: PersonRow | null;
  onSubmit: (data: Record<string, any>) => Promise<void>;
  isSubmitting: boolean;
}

function parseAddress(structured: unknown): StructuredAddress {
  if (!structured) return emptyAddress();
  const s = structured as CanonicalAddressPayload;
  return {
    country_code: (s as any).country_code || 'BY',
    street: s.street || '',
    house: s.house || '',
    building: s.building || '',
    apartment: s.apartment || '',
    city: s.city || '',
    city_district: s.city_district || '',
    region: s.region || '',
    district: s.district || '',
    settlement: s.settlement || '',
    postal_code: s.postal_code || '',
    country_name: s.country || '',
    address_line_2: '',
    google_place_id: s.google_place_id || null,
    lat: s.lat || null,
    lng: s.lng || null,
  };
}

function addressToStructured(addr: StructuredAddress): CanonicalAddressPayload {
  return {
    country: addr.country_name || 'Беларусь',
    country_code: 'BY',
    postal_code: addr.postal_code || null,
    region: addr.region || null,
    district: addr.district || null,
    city: addr.city || null,
    city_district: addr.city_district || null,
    settlement: addr.settlement || null,
    street: addr.street || null,
    house: addr.house || null,
    building: addr.building || null,
    apartment: addr.apartment || null,
    google_place_id: addr.google_place_id || null,
    lat: addr.lat || null,
    lng: addr.lng || null,
    source: 'manual',
    last_verified_at: null,
    raw_input: null,
    formatted_address: null,
  };
}

/** Map registry column names → fieldsMap keys for person fields */
const PERSON_FIELD_KEYS: Record<string, string> = {
  full_name: 'ind_full_name',
  birth_date: 'ind_birth_date',
  personal_number: 'ind_personal_number',
  passport_number_full: 'ind_passport_number',
  passport_issued_by: 'ind_passport_issued_by',
  passport_issued_date: 'ind_passport_issued_date',
  passport_valid_until: 'ind_passport_valid_until',
  phone: 'phone',
  email: 'email',
};

export function PersonFieldsForm({ initialData, onSubmit, isSubmitting }: PersonFieldsFormProps) {
  const { fieldsMap } = useLegalDetailsFields();

  const [fullName, setFullName] = useState(initialData?.full_name || '');
  const [birthDate, setBirthDate] = useState(initialData?.birth_date || '');
  const [personalNumber, setPersonalNumber] = useState(initialData?.personal_number || '');
  
  // Unified passport field — prefer passport_number_full, fallback to composed series+number
  const initialPassport = (() => {
    const d = initialData as any;
    if (d?.passport_number_full) return d.passport_number_full;
    const series = d?.passport_series || '';
    const number = d?.passport_number || '';
    if (series || number) return `${series}${number}`.trim();
    return '';
  })();
  const [passportFull, setPassportFull] = useState(initialPassport);
  const [passportHint, setPassportHint] = useState('');
  const [passportError, setPassportError] = useState('');

  const [passportIssuedBy, setPassportIssuedBy] = useState(initialData?.passport_issued_by || '');
  const [passportIssuedDate, setPassportIssuedDate] = useState(initialData?.passport_issued_date || '');
  const [passportValidUntil, setPassportValidUntil] = useState(initialData?.passport_valid_until || '');
  const [phone, setPhone] = useState(initialData?.phone || '');
  const [email, setEmail] = useState(initialData?.email || '');
  const [notes, setNotes] = useState(initialData?.notes || '');
  const [isActive, setIsActive] = useState(initialData?.is_active ?? true);
  const [address, setAddress] = useState<StructuredAddress>(() => parseAddress(initialData?.address_structured));

  /** Get publicId for a person field from registry */
  const pid = (formField: string) => fieldsMap.get(PERSON_FIELD_KEYS[formField])?.publicId;

  const handlePassportBlur = useCallback(() => {
    if (!passportFull.trim()) {
      setPassportHint('');
      setPassportError('');
      return;
    }
    const result = normalizePassport(passportFull);
    if (result.success && result.normalized) {
      setPassportFull(result.normalized);
      if (result.normalized !== result.original) {
        setPassportHint(`Сохранено как: ${result.normalized}`);
      } else {
        setPassportHint('');
      }
      setPassportError('');
    } else {
      setPassportError('Используйте латиницу. Серия и номер паспорта вводятся только английскими буквами и цифрами, без пробелов.');
      setPassportHint('');
    }
  }, [passportFull]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;

    // Validate passport before submit
    if (passportFull.trim()) {
      const result = normalizePassport(passportFull);
      if (!result.success) {
        setPassportError('Используйте латиницу. Серия и номер паспорта вводятся только английскими буквами и цифрами, без пробелов.');
        return;
      }
    }

    const normalizedPassport = passportFull.trim() ? normalizePassport(passportFull).normalized : null;

    const data: Record<string, any> = {
      full_name: fullName.trim(),
      birth_date: birthDate || null,
      personal_number: personalNumber || null,
      passport_number_full: normalizedPassport,
      // Keep legacy fields in sync for backward compatibility during transition
      passport_series: null,
      passport_number: null,
      passport_issued_by: passportIssuedBy || null,
      passport_issued_date: passportIssuedDate || null,
      passport_valid_until: passportValidUntil || null,
      phone: phone || null,
      email: email || null,
      notes: notes || null,
      is_active: isActive,
      address_structured: addressToStructured(address),
    };

    await onSubmit(data);
  }, [fullName, birthDate, personalNumber, passportFull, passportIssuedBy, passportIssuedDate, passportValidUntil, phone, email, notes, isActive, address, onSubmit]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Basic info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <User className="w-4 h-4" />
            Основная информация
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <CopyablePlainLabel htmlFor="pf-full-name" label="ФИО *" publicId={pid('full_name')} />
            <Input id="pf-full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Иванов Иван Иванович" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <CopyablePlainLabel htmlFor="pf-birth-date" label="Дата рождения" publicId={pid('birth_date')} />
              <DatePicker
                id="pf-birth-date"
                value={birthDate}
                onChange={setBirthDate}
                fromYear={1920}
                toYear={new Date().getFullYear()}
                maxDate={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div>
              <CopyablePlainLabel htmlFor="pf-personal-number" label="Личный номер" publicId={pid('personal_number')} />
              <Input id="pf-personal-number" value={personalNumber} onChange={(e) => setPersonalNumber(e.target.value)} placeholder="3010178A001PB2" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Passport */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Паспортные данные
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <CopyablePlainLabel htmlFor="pf-passport-full" label="Серия и номер паспорта" publicId={pid('passport_number_full')} />
            <Input
              id="pf-passport-full"
              value={passportFull}
              onChange={(e) => {
                const v = e.target.value;
                setPassportFull(v);
                setPassportHint('');
                if (containsCyrillic(v)) {
                  setPassportError('Используйте латиницу. Серия и номер паспорта вводятся только английскими буквами и цифрами, без пробелов.');
                } else {
                  setPassportError('');
                }
              }}
              onBlur={handlePassportBlur}
              placeholder="MP4187696"
              className={passportError ? 'border-destructive' : ''}
            />
            {passportHint && (
              <p className="text-xs text-primary mt-1">{passportHint}</p>
            )}
            {passportError && (
              <p className="text-xs text-destructive mt-1">{passportError}</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">
              Только английские буквы и цифры, без пробелов. Например: MP4187696
            </p>
          </div>
          <div>
            <CopyablePlainLabel htmlFor="pf-passport-issued-by" label="Кем выдан" publicId={pid('passport_issued_by')} />
            <Input id="pf-passport-issued-by" value={passportIssuedBy} onChange={(e) => setPassportIssuedBy(e.target.value)} placeholder="Фрунзенский РУВД г. Минска" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <CopyablePlainLabel htmlFor="pf-passport-issued-date" label="Дата выдачи" publicId={pid('passport_issued_date')} />
              <Input id="pf-passport-issued-date" type="date" value={passportIssuedDate} onChange={(e) => setPassportIssuedDate(e.target.value)} />
            </div>
            <div>
              <CopyablePlainLabel htmlFor="pf-passport-valid-until" label="Срок действия" publicId={pid('passport_valid_until')} />
              <Input id="pf-passport-valid-until" type="date" value={passportValidUntil} onChange={(e) => setPassportValidUntil(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Address — no clickable labels per approved plan */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            Адрес
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StructuredAddressBlock
            value={address}
            onChange={setAddress}
            apartmentLabel="Квартира"
          />
        </CardContent>
      </Card>

      {/* Contacts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <Phone className="w-4 h-4" />
            Контакты
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <CopyablePlainLabel htmlFor="pf-phone" label="Телефон" publicId={pid('phone')} />
              <Input id="pf-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+375 29 123 45 67" />
            </div>
            <div>
              <CopyablePlainLabel htmlFor="pf-email" label="Email" publicId={pid('email')} />
              <Input id="pf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ivan@example.com" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Service info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <Info className="w-4 h-4" />
            Служебная информация
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="pf-notes" className="text-xs text-muted-foreground">Заметки</Label>
            <Textarea id="pf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Дополнительная информация…" rows={3} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="pf-is-active" className="text-sm">Активная запись</Label>
            <Switch id="pf-is-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </CardContent>
      </Card>

      <div className="pt-2">
        <Button type="submit" className="w-full" disabled={isSubmitting || !fullName.trim() || !!passportError}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Сохранить
        </Button>
      </div>
    </form>
  );
}
