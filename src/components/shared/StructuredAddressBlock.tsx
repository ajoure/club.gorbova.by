/// <reference types="google.maps" />
/**
 * StructuredAddressBlock — unified structured address input for the entire platform.
 *
 * Uses usePlaceAutocomplete + GooglePlacesAdapter (anti-corruption layer).
 * ALL address forms MUST use this component.
 *
 * Field mapping:
 *   city (backend) → "Населённый пункт" (UI)
 *   city_district  → "Район города"
 *   district       → "Район" (административный район области)
 *   settlement / address_line_2 — kept in types for backend compat, removed from UI
 *
 * Mini-PATCH: Address UX Polish
 *   - Reordered layouts: street/house first, administrative context below
 *   - Apartment parser fallback after Google select (not in GRP/enrichment path)
 *   - Soft city normalization on blur (BY only, known cities)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePlaceAutocomplete } from '@/hooks/usePlaceAutocomplete';
import type { LegalDetailsFieldEntry } from '@/hooks/useLegalDetailsFields';
import { GooglePlacesAdapter } from '@/lib/address/adapters/GooglePlacesAdapter';
import type { StructuredAddress } from '@/lib/address/types';
import { AUTOCOMPLETE_FIELDS } from '@/lib/address/types';
import { buildAutocompleteQuery, emptyAddress } from '@/lib/address/utils';
import { parseHousePremiseInput, parseStreetInput, stripApartmentPrefix } from '@/lib/address/parseStreetInput';
import { geocodePostalCodeByAddress, reverseGeocodePostalCode } from '@/lib/address/googlePlaceDetails';
import { cn } from '@/lib/utils';

export interface StructuredAddressBlockProps {
  value: StructuredAddress;
  onChange: (value: StructuredAddress) => void;
  disabled?: boolean;
  compact?: boolean;
  countries?: string[];
  fieldIds?: Map<string, LegalDetailsFieldEntry>;
  /** Override apartment field label (default: "Помещение"). For persons use "Квартира". */
  apartmentLabel?: string;
}

interface FieldConfig {
  key: keyof StructuredAddress;
  label: string;
  placeholder: string;
  colSpan?: string;
}

/**
 * Full layout — reordered per mini-PATCH spec:
 * Street/house/building/apartment first (most frequently edited),
 * administrative context below.
 */
const FULL_LAYOUT: FieldConfig[] = [
  { key: 'street', label: 'Улица', placeholder: 'ул. Ленина', colSpan: 'col-span-2' },
  { key: 'house', label: 'Дом', placeholder: '19' },
  { key: 'building', label: 'Корпус', placeholder: '' },
  { key: 'apartment', label: 'Помещение', placeholder: '' },
  { key: 'country_name', label: 'Страна', placeholder: '' },
  { key: 'region', label: 'Область / Регион', placeholder: '', colSpan: 'col-span-2' },
  { key: 'district', label: 'Район', placeholder: '' },
  { key: 'city', label: 'Населённый пункт', placeholder: 'г. Минск', colSpan: 'col-span-2' },
  { key: 'city_district', label: 'Район города', placeholder: 'Фрунзенский' },
  { key: 'postal_code', label: 'Индекс', placeholder: '220000' },
];

const COMPACT_LAYOUT: FieldConfig[] = [
  { key: 'street', label: 'Улица', placeholder: 'ул. Ленина', colSpan: 'col-span-2' },
  { key: 'house', label: 'Дом', placeholder: '19' },
  { key: 'building', label: 'Корпус', placeholder: '' },
  { key: 'apartment', label: 'Помещение', placeholder: '' },
  { key: 'city', label: 'Населённый пункт', placeholder: 'г. Минск' },
  { key: 'district', label: 'Район', placeholder: '' },
  { key: 'city_district', label: 'Район города', placeholder: 'Фрунзенский' },
  { key: 'region', label: 'Область', placeholder: '' },
  { key: 'postal_code', label: 'Индекс', placeholder: '' },
  { key: 'country_name', label: 'Страна', placeholder: '' },
];

const DROPDOWN_Z_INDEX = 9999;

/** Known BY cities for soft normalization on blur */
const KNOWN_BY_CITIES: Record<string, string> = {
  'минск': 'г. Минск',
  'брест': 'г. Брест',
  'гомель': 'г. Гомель',
  'гродно': 'г. Гродно',
  'витебск': 'г. Витебск',
  'могилёв': 'г. Могилёв',
  'могилев': 'г. Могилёв',
};

/** Check if address is Belarusian */
function isByAddress(addr: StructuredAddress): boolean {
  if (addr.country_code?.toUpperCase() === 'BY') return true;
  if (addr.country_name && /беларус/i.test(addr.country_name)) return true;
  return false;
}

/** Check if city value already has a type prefix */
function hasCityPrefix(val: string): boolean {
  return /^(г\.|аг\.|д\.|п\.|г\.п\.|город|гор\.|пос\.)\s/i.test(val);
}

export function StructuredAddressBlock({
  value,
  onChange,
  disabled,
  compact,
  countries,
  fieldIds,
  apartmentLabel,
}: StructuredAddressBlockProps) {
  const baseLayout = compact ? COMPACT_LAYOUT : FULL_LAYOUT;
  const layout = apartmentLabel
    ? baseLayout.map(f => f.key === 'apartment' ? { ...f, label: apartmentLabel } : f)
    : baseLayout;

  const {
    predictions,
    isOpen,
    setIsOpen,
    fetchPredictions,
    fetchPlaceDetails,
    clearPredictions,
    cleanup,
    isReady,
  } = usePlaceAutocomplete({ countries });

  const [activeField, setActiveField] = useState<keyof StructuredAddress | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; maxHeight: number; placement: 'below' | 'above' } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isSelectingRef = useRef(false);
  const isHoveringDropdownRef = useRef(false);

  useEffect(() => cleanup, [cleanup]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (isSelectingRef.current || isHoveringDropdownRef.current) return;
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [setIsOpen]);

  const updateDropdownPosition = useCallback(() => {
    if (!activeField) {
      setDropdownPos(null);
      return;
    }
    const el = fieldRefs.current.get(activeField);
    if (!el) {
      setDropdownPos(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    // Use visualViewport when available (excludes mobile on-screen keyboard area)
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    const viewportTop = vv ? vv.offsetTop : 0;
    const viewportHeight = vv ? vv.height : window.innerHeight;
    const viewportBottom = viewportTop + viewportHeight;
    const GAP = 4;
    const MIN_HEIGHT = 120;
    const MAX_HEIGHT = 240;
    const spaceBelow = viewportBottom - rect.bottom - GAP;
    const spaceAbove = rect.top - viewportTop - GAP;
    let placement: 'below' | 'above' = 'below';
    let maxHeight = Math.min(MAX_HEIGHT, Math.max(0, spaceBelow));
    if (spaceBelow < MIN_HEIGHT && spaceAbove > spaceBelow) {
      placement = 'above';
      maxHeight = Math.min(MAX_HEIGHT, Math.max(0, spaceAbove));
    }
    const top = placement === 'below' ? rect.bottom + GAP : Math.max(viewportTop, rect.top - GAP - maxHeight);
    setDropdownPos({ top, left: rect.left, width: rect.width, maxHeight, placement });
  }, [activeField]);

  useEffect(() => {
    updateDropdownPosition();
  }, [activeField, predictions, updateDropdownPosition]);

  // Reposition dropdown on viewport changes (mobile keyboard open/close, scroll, resize)
  // Do NOT close — closing on resize made the dropdown disappear when iOS keyboard opened.
  useEffect(() => {
    if (!isOpen) return;
    const reposition = () => updateDropdownPosition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    vv?.addEventListener('resize', reposition);
    vv?.addEventListener('scroll', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      vv?.removeEventListener('resize', reposition);
      vv?.removeEventListener('scroll', reposition);
    };
  }, [isOpen, updateDropdownPosition]);

  const handleFieldChange = useCallback(
    (field: keyof StructuredAddress, val: string) => {
      let updated = { ...value, [field]: val };
      const parsedStreetInput = field === 'street' ? parseStreetInput(val) : null;
      const parsedHouseInput = field === 'house' ? parseHousePremiseInput(val) : null;

      // Hierarchical clearing — when editing city (= населённый пункт), clear child fields
      if (field === 'city') {
        updated = {
          ...updated,
          house: '',
          building: '',
          apartment: '',
          postal_code: '',
          street: '',
          google_place_id: null,
          lat: null,
          lng: null,
        };
      } else if (field === 'street') {
        updated = {
          ...updated,
          street: parsedStreetInput?.street || val,
          house: parsedStreetInput?.house || '',
          building: '',
          apartment: parsedStreetInput?.apartment || '',
          postal_code: '',
          google_place_id: null,
          lat: null,
          lng: null,
        };
      } else if (field === 'house' && parsedHouseInput) {
        updated = {
          ...updated,
          house: parsedHouseInput.house,
          apartment: parsedHouseInput.apartment || value.apartment,
          postal_code: '',
          google_place_id: null,
          lat: null,
          lng: null,
        };
      }

      onChange(updated);

      if (AUTOCOMPLETE_FIELDS.includes(field) && isReady) {
        setActiveField(field);
        const queryValue = field === 'street'
          ? [parsedStreetInput?.street || val, parsedStreetInput?.house, parsedStreetInput?.apartment && `пом ${parsedStreetInput.apartment}`]
              .filter(Boolean)
              .join(' ')
          : field === 'house'
            ? parsedHouseInput?.house || val
            : val;
        const query = buildAutocompleteQuery(updated, field, queryValue);
        fetchPredictions(query);
        setHighlightIndex(-1);
      }
    },
    [value, onChange, isReady, fetchPredictions]
  );

  /**
   * Soft city normalization on blur — BY only, known cities only.
   * "Минск" → "г. Минск" on blur. Never during typing.
   */
  const handleCityBlur = useCallback(() => {
    const city = value.city?.trim();
    if (!city) return;
    if (!isByAddress(value)) return;
    if (hasCityPrefix(city)) return;
    // Only single-word bare city names
    if (city.includes(' ')) return;

    const normalized = KNOWN_BY_CITIES[city.toLowerCase()];
    if (normalized && normalized !== city) {
      onChange({ ...value, city: normalized });
    }
  }, [value, onChange]);

  const handleSelect = useCallback(
    async (prediction: (typeof predictions)[0]) => {
      isSelectingRef.current = true;
      try {
        const details = await fetchPlaceDetails(prediction);

        if (details) {
          const parsed = GooglePlacesAdapter.parseComponents(details.addressComponents as any[]);
          const merged: StructuredAddress = {
            ...emptyAddress(),
            building: value.building,
            apartment: value.apartment,
            ...parsed,
            google_place_id: details.placeId,
            lat: details.lat,
            lng: details.lng,
          };

          // Apartment parser fallback: only if Google didn't provide apartment
          // and the description or street contains apartment-like patterns.
          // NOT used in GRP/UNP enrichment path (that sets address directly).
          if (!merged.apartment && prediction.description) {
            const streetForParse = merged.street
              ? `${merged.street} ${merged.house || ''}`.trim()
              : prediction.description;
            const parsed2 = parseStreetInput(streetForParse);
            if (parsed2.apartment) {
              merged.apartment = parsed2.apartment;
              if (parsed2.house && !merged.house) {
                merged.house = parsed2.house;
              }
              if (parsed2.street && !merged.street) {
                merged.street = parsed2.street;
              }
            }
          }

          // Final guard: strip apartment prefix from any source
          if (merged.apartment) {
            merged.apartment = stripApartmentPrefix(merged.apartment);
          }

          // Postal-code fallback: Google often omits postal_code for street-level
          // (route) selections. Reverse-geocode by lat/lng to fill the gap.
          if (!merged.postal_code && merged.lat != null && merged.lng != null) {
            const pc = await reverseGeocodePostalCode(merged.lat, merged.lng);
            if (pc) merged.postal_code = pc;
          }

          onChange(merged);
        }
      } catch (err) {
        console.error('[StructuredAddressBlock] handleSelect error:', err);
      } finally {
        isHoveringDropdownRef.current = false;
        clearPredictions();
        isSelectingRef.current = false;
      }
    },
    [fetchPlaceDetails, clearPredictions, onChange, value]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || predictions.length === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightIndex((p) => (p < predictions.length - 1 ? p + 1 : 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightIndex((p) => (p > 0 ? p - 1 : predictions.length - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < predictions.length) handleSelect(predictions[highlightIndex]);
          break;
        case 'Escape':
          e.preventDefault();
          clearPredictions();
          break;
      }
    },
    [isOpen, predictions, highlightIndex, handleSelect, clearPredictions]
  );

  const handleBlur = useCallback(
    (field: keyof StructuredAddress) => {
      if (field === 'city') {
        handleCityBlur();
      }
      // Strip apartment prefix on blur — final guard against "кв. 4" in storage
      if (field === 'apartment') {
        const raw = value.apartment?.trim();
        if (raw) {
          const clean = stripApartmentPrefix(raw);
          if (clean !== raw) {
            onChange({ ...value, apartment: clean });
          }
        }
      }
    },
    [handleCityBlur, value, onChange]
  );

  const handleLabelCopy = useCallback((fieldKey: keyof StructuredAddress) => {
    const fieldEntry = fieldIds?.get(fieldKey);
    if (!fieldEntry?.publicId) return;
    navigator.clipboard.writeText(fieldEntry.publicId);
    toast.success('ID скопирован');
  }, [fieldIds]);

  const portalTarget =
    (containerRef.current?.closest('[data-address-shell="true"]')?.querySelector('[data-address-portal-root]') as HTMLElement | null) ?? document.body;

  const showDropdown = isOpen && predictions.length > 0 && dropdownPos !== null;

  const dropdownElement = showDropdown
    ? createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          data-address-dropdown="true"
          onMouseEnter={() => {
            isHoveringDropdownRef.current = true;
          }}
          onMouseLeave={() => {
            isHoveringDropdownRef.current = false;
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            isSelectingRef.current = true;
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            isSelectingRef.current = true;
          }}
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: DROPDOWN_Z_INDEX,
          }}
          className="pointer-events-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden"
        >
          <ul className="py-1 overflow-y-auto" style={{ maxHeight: dropdownPos.maxHeight }}>
            {predictions.map((p, index) => (
              <li
                key={p.placeId}
                role="option"
                aria-selected={index === highlightIndex}
                className={cn(
                  'px-3 py-2 cursor-pointer text-sm transition-colors',
                  index === highlightIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                )}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  isSelectingRef.current = true;
                  handleSelect(p);
                }}
                onMouseEnter={() => setHighlightIndex(index)}
              >
                <span className="font-medium">{p.mainText}</span>
                {p.secondaryText && (
                  <span className="text-muted-foreground ml-1 text-xs">{p.secondaryText}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border bg-muted/30 text-right">
            Powered by Google
          </div>
        </div>,
        portalTarget
      )
    : null;

  return (
    <div ref={containerRef} className="w-full">
      <div className={cn('grid gap-3', 'grid-cols-4')}>
        {layout.map((field) => {
          const fieldEntry = fieldIds?.get(field.key);
          const canCopyFieldId = !!fieldEntry?.publicId;

          return (
            <div
              key={field.key}
              ref={(el) => {
                if (el) fieldRefs.current.set(field.key, el);
                else fieldRefs.current.delete(field.key);
              }}
              className={cn(field.colSpan || 'col-span-1')}
            >
              <Label
                htmlFor={`addr-${field.key}`}
                className={cn(
                  'text-xs text-muted-foreground mb-1',
                  canCopyFieldId && 'cursor-pointer hover:text-primary transition-colors'
                )}
                onClick={canCopyFieldId ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleLabelCopy(field.key);
                } : undefined}
                title={fieldEntry?.publicId ? `${fieldEntry.publicId} — клик для копирования` : undefined}
              >
                {field.label}
              </Label>
              <Input
                id={`addr-${field.key}`}
                value={(value[field.key] as string) ?? ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => handleBlur(field.key)}
                onFocus={() => setActiveField(field.key)}
                disabled={disabled}
                placeholder={field.placeholder}
                autoComplete="off"
                className="h-9 text-sm"
              />
            </div>
          );
        })}
      </div>
      {dropdownElement}
    </div>
  );
}
