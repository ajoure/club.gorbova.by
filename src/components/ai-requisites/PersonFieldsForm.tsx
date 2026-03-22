/**
 * PersonFieldsForm — standalone form for person (individual) fields.
 * No billing, no leg_/ent_ fields, no useLegalDetails dependency.
 */

import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, User, FileText, MapPin, Phone, Info } from 'lucide-react';
import { StructuredAddressBlock } from '@/components/shared/StructuredAddressBlock';
import type { StructuredAddress } from '@/lib/address/types';
import { emptyAddress } from '@/lib/address/utils';
import type { CanonicalAddressPayload } from '@/lib/address/types';
import type { PersonRow } from '@/hooks/useAiPersons';

interface PersonFieldsFormProps {
  initialData: PersonRow | null;
  onSubmit: (data: Record<string, any>) => Promise<void>;
  isSubmitting: boolean;
}

function parseAddress(structured: any): StructuredAddress {
  if (!structured) return emptyAddress();
  const s = structured as CanonicalAddressPayload;
  return {
    street: s.street || '',
    house: s.house || '',
    building: s.building || '',
    apartment: s.apartment || '',
    city: s.city || '',
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

export function PersonFieldsForm({ initialData, onSubmit, isSubmitting }: PersonFieldsFormProps) {
  const [fullName, setFullName] = useState(initialData?.full_name || '');
  const [birthDate, setBirthDate] = useState(initialData?.birth_date || '');
  const [personalNumber, setPersonalNumber] = useState(initialData?.personal_number || '');
  const [passportSeries, setPassportSeries] = useState(initialData?.passport_series || '');
  const [passportNumber, setPassportNumber] = useState(initialData?.passport_number || '');
  const [passportIssuedBy, setPassportIssuedBy] = useState(initialData?.passport_issued_by || '');
  const [passportIssuedDate, setPassportIssuedDate] = useState(initialData?.passport_issued_date || '');
  const [passportValidUntil, setPassportValidUntil] = useState(initialData?.passport_valid_until || '');
  const [phone, setPhone] = useState(initialData?.phone || '');
  const [email, setEmail] = useState(initialData?.email || '');
  const [notes, setNotes] = useState(initialData?.notes || '');
  const [isActive, setIsActive] = useState(initialData?.is_active ?? true);
  const [address, setAddress] = useState<StructuredAddress>(() => parseAddress(initialData?.address_structured));

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;

    const data: Record<string, any> = {
      full_name: fullName.trim(),
      birth_date: birthDate || null,
      personal_number: personalNumber || null,
      passport_series: passportSeries || null,
      passport_number: passportNumber || null,
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
  }, [fullName, birthDate, personalNumber, passportSeries, passportNumber, passportIssuedBy, passportIssuedDate, passportValidUntil, phone, email, notes, isActive, address, onSubmit]);

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
            <Label htmlFor="pf-full-name" className="text-xs text-muted-foreground">ФИО *</Label>
            <Input id="pf-full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Иванов Иван Иванович" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pf-birth-date" className="text-xs text-muted-foreground">Дата рождения</Label>
              <Input id="pf-birth-date" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pf-personal-number" className="text-xs text-muted-foreground">Личный номер</Label>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pf-passport-series" className="text-xs text-muted-foreground">Серия</Label>
              <Input id="pf-passport-series" value={passportSeries} onChange={(e) => setPassportSeries(e.target.value)} placeholder="AB" />
            </div>
            <div>
              <Label htmlFor="pf-passport-number" className="text-xs text-muted-foreground">Номер</Label>
              <Input id="pf-passport-number" value={passportNumber} onChange={(e) => setPassportNumber(e.target.value)} placeholder="1234567" />
            </div>
          </div>
          <div>
            <Label htmlFor="pf-passport-issued-by" className="text-xs text-muted-foreground">Кем выдан</Label>
            <Input id="pf-passport-issued-by" value={passportIssuedBy} onChange={(e) => setPassportIssuedBy(e.target.value)} placeholder="Фрунзенский РУВД г. Минска" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pf-passport-issued-date" className="text-xs text-muted-foreground">Дата выдачи</Label>
              <Input id="pf-passport-issued-date" type="date" value={passportIssuedDate} onChange={(e) => setPassportIssuedDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pf-passport-valid-until" className="text-xs text-muted-foreground">Срок действия</Label>
              <Input id="pf-passport-valid-until" type="date" value={passportValidUntil} onChange={(e) => setPassportValidUntil(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Address */}
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
              <Label htmlFor="pf-phone" className="text-xs text-muted-foreground">Телефон</Label>
              <Input id="pf-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+375 29 123 45 67" />
            </div>
            <div>
              <Label htmlFor="pf-email" className="text-xs text-muted-foreground">Email</Label>
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
        <Button type="submit" className="w-full" disabled={isSubmitting || !fullName.trim()}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Сохранить
        </Button>
      </div>
    </form>
  );
}
