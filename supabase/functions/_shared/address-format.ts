// ============================================================================
// address-format.ts — Sprint D
// ----------------------------------------------------------------------------
// Канонический форматтер белорусского адреса для customer.address /
// executor.address.
//
// Порядок:
//   улица → дом → корпус → помещение/квартира → нас.пункт → индекс
//   → [район/обл. только для сельских] → страна
//
// Пример:
//   ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь
//
// Префиксы apartment по subject_type:
//   individual          → "кв."
//   legal_entity / executor / entrepreneur → "пом."
//
// Не дублирует уже готовые сокращения ("ул. ул.", "г. г.", "д. д.").
// Для Минска и облцентров скрывает административный хвост (район/обл.).
// Не добавляет country, если его нет в structured/raw.
// ============================================================================

// deno-lint-ignore-file no-explicit-any

export type AddressSubjectType =
  | 'individual'
  | 'legal_entity'
  | 'entrepreneur'
  | 'executor';

const KNOWN_CITY_DISTRICT_RE =
  /(центральн|ленинск|октябрьск|фрунзенск|московск|первомайск|советск|заводск|партизанск|железнодорожн)/i;

const OBLAST_CENTERS = [
  'минск', 'брест', 'витебск', 'гомель', 'гродно', 'могил',
];

function s(v: any): string {
  return v == null ? '' : String(v).trim();
}

function isEmpty(struct: any): boolean {
  if (!struct || typeof struct !== 'object') return true;
  const keys = ['street', 'house', 'city', 'settlement', 'locality', 'postal_code', 'country', 'apartment'];
  return !keys.some(k => s(struct[k]));
}

/** Add prefix unless value already begins with one of the prefix variants. */
function prefixed(prefix: string, value: string, alreadyRe: RegExp): string {
  if (!value) return '';
  if (alreadyRe.test(value)) return value;
  return `${prefix} ${value}`;
}

function isMinsk(city: string): boolean {
  return /^(г\.\s*)?минск$/i.test(city.trim());
}

function isOblastCenter(city: string): boolean {
  const c = city.replace(/^(г\.|город|гор\.)\s*/i, '').trim().toLowerCase();
  return OBLAST_CENTERS.some(o => c.startsWith(o));
}

/**
 * settlement_type indicates rural locality (д., аг., п., г.п.).
 * Also: if settlement field has rural prefix.
 */
function isRural(struct: any, cityRaw: string, settlementType: string): boolean {
  const st = settlementType.toLowerCase();
  if (/^(д\.?|дер\.?|деревня|аг\.?|агрогородок|п\.?|пос\.?|посёлок|поселок|г\.п\.?)$/i.test(st)) return true;
  if (/^(д\.|дер\.|деревня|аг\.|агрогородок|п\.|пос\.|посёлок|поселок|г\.п\.)\s/i.test(cityRaw)) return true;
  return false;
}

function looksLikeCityDistrict(value: string): boolean {
  if (!value) return false;
  if (!/район/i.test(value)) return false;
  return KNOWN_CITY_DISTRICT_RE.test(value);
}

/**
 * Pick city/locality. Skip settlement field if it actually contains a
 * city-internal district name (common GRP/Google Places artifact).
 */
function pickCity(struct: any): { city: string; settlementType: string } {
  const settlementType = s(struct.settlement_type) || s(struct.street_type ? '' : ''); // not standard; keep empty
  // Prefer locality > city > settlement
  const candidates = [
    s(struct.locality),
    s(struct.city),
    s(struct.settlement),
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (looksLikeCityDistrict(c)) continue;
    return { city: c, settlementType: s(struct.settlement_type) };
  }
  return { city: '', settlementType: '' };
}

function formatCity(city: string, settlementType: string): string {
  if (!city) return '';
  // If settlement_type explicit, prefix it (avoid double).
  if (settlementType) {
    const re = new RegExp('^' + settlementType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s', 'i');
    if (re.test(city)) return city;
    return `${settlementType} ${city}`;
  }
  // Already has any locality prefix → keep
  if (/^(г\.|г\s|город\s|гор\.|аг\.|д\.|дер\.|п\.|пос\.|посёлок|поселок|г\.п\.)\s*/i.test(city)) return city;
  return `г. ${city}`;
}

function formatStreet(street: string, streetType: string): string {
  if (!street) return '';
  if (streetType) {
    const re = new RegExp('^' + streetType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s', 'i');
    if (re.test(street)) return street;
    return `${streetType} ${street}`;
  }
  // Already prefixed → keep
  if (/^(ул\.|улица|пр\.|пр-т|проспект|пер\.|переулок|б-р|бульвар|наб\.|набережная|ш\.|шоссе|пл\.|площадь|тракт|пр\-кт)\s*/i.test(street)) {
    return street;
  }
  // Bare name → assume улица
  return `ул. ${street}`;
}

function formatRegion(region: string): string {
  if (!region) return '';
  if (/обл\.?$/i.test(region) || /область$/i.test(region)) {
    return region.replace(/область$/i, 'обл.');
  }
  return `${region} обл.`;
}

function formatDistrict(district: string): string {
  if (!district) return '';
  if (/р-н\.?$/i.test(district) || /район$/i.test(district)) {
    return district.replace(/район$/i, 'р-н');
  }
  return `${district} р-н`;
}

export interface FormatAddressResult {
  rendered: string;
  source: 'structured' | 'raw' | 'missing';
}

/**
 * Format a structured address payload (CanonicalAddressPayload-like JSONB).
 * Falls back to `fallback` raw string if structured is empty.
 */
export function formatStructuredAddress(
  struct: any,
  fallback: string | null | undefined,
  subjectType: AddressSubjectType,
): FormatAddressResult {
  const fb = s(fallback);
  if (isEmpty(struct)) {
    return { rendered: fb, source: fb ? 'raw' : 'missing' };
  }

  const street = s(struct.street);
  const streetType = s(struct.street_type);
  const house = s(struct.house);
  const building = s(struct.building);
  const apartment = s(struct.apartment) || s(struct.office) || s(struct.premise);
  const apartmentExplicitType = s(struct.apartment_type) || (struct.office ? 'оф.' : (struct.premise ? 'пом.' : ''));
  const postal = s(struct.postal_code);
  const country = s(struct.country);
  const region = s(struct.region);
  const district = s(struct.district);

  const { city, settlementType } = pickCity(struct);
  const rural = isRural(struct, city, settlementType);

  const parts: string[] = [];

  const streetLabel = formatStreet(street, streetType);
  if (streetLabel) parts.push(streetLabel);

  if (house) parts.push(prefixed('д.', house, /^(д\.?\s|дом\s)/i));
  if (building) parts.push(prefixed('корп.', building, /^(корп?\.?\s|корпус\s|стр\.?\s|строение\s)/i));

  if (apartment) {
    const aptPrefix = apartmentExplicitType
      || (subjectType === 'individual' ? 'кв.' : 'пом.');
    parts.push(prefixed(aptPrefix, apartment, /^(кв\.?\s|квартира\s|пом\.?\s|помещение\s|оф\.?\s|офис\s)/i));
  }

  const cityLabel = formatCity(city, settlementType);
  if (cityLabel) parts.push(cityLabel);

  if (postal) parts.push(postal);

  // Административный хвост — только для сельских адресов и НЕ для облцентров/Минска.
  const showAdminTail = rural && city && !isMinsk(city) && !isOblastCenter(city);
  if (showAdminTail) {
    if (district) parts.push(formatDistrict(district));
    if (region) parts.push(formatRegion(region));
  }

  if (country) parts.push(country);

  const rendered = parts.filter(Boolean).join(', ');
  if (!rendered) {
    return { rendered: fb, source: fb ? 'raw' : 'missing' };
  }
  return { rendered, source: 'structured' };
}
