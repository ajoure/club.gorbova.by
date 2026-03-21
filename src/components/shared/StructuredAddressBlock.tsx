/// <reference types="google.maps" />
/**
 * StructuredAddressBlock — unified structured address input for the entire platform.
 *
 * Uses usePlaceAutocomplete + GooglePlacesAdapter (anti-corruption layer).
 * ALL address forms MUST use this component.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CopyableIdChip } from '@/components/ui/CopyableIdChip';
import type { LegalDetailsFieldEntry } from '@/hooks/useLegalDetailsFields';
import { usePlaceAutocomplete } from '@/hooks/usePlaceAutocomplete';
import { GooglePlacesAdapter } from '@/lib/address/adapters/GooglePlacesAdapter';
import type { StructuredAddress } from '@/lib/address/types';
import { AUTOCOMPLETE_FIELDS } from '@/lib/address/types';
import { buildAutocompleteQuery, emptyAddress } from '@/lib/address/utils';
import { cn } from '@/lib/utils';

export interface StructuredAddressBlockProps {
  value: StructuredAddress;
  onChange: (value: StructuredAddress) => void;
  disabled?: boolean;
  compact?: boolean;
  countries?: string[];
  /** Optional map: address field key (street, house, etc.) → registry entry for CopyableIdChip */
  fieldIds?: Map<string, LegalDetailsFieldEntry>;
}

interface FieldConfig {
  key: keyof StructuredAddress;
  label: string;
  placeholder: string;
  colSpan?: string;
}

const FULL_LAYOUT: FieldConfig[] = [
  { key: 'street', label: 'Улица', placeholder: 'ул. Ленина', colSpan: 'col-span-2' },
  { key: 'house', label: 'Дом', placeholder: '19' },
  { key: 'building', label: 'Корпус', placeholder: '' },
  { key: 'apartment', label: 'Кв./Офис', placeholder: '' },
  { key: 'postal_code', label: 'Индекс', placeholder: '220000' },
  { key: 'city', label: 'Город', placeholder: 'Минск', colSpan: 'col-span-2' },
  { key: 'settlement', label: 'Населённый пункт', placeholder: '' },
  { key: 'district', label: 'Район', placeholder: '' },
  { key: 'region', label: 'Область / Регион', placeholder: '', colSpan: 'col-span-2' },
  { key: 'address_line_2', label: 'Доп. строка', placeholder: 'Этаж, подъезд…' },
  { key: 'country_name', label: 'Страна', placeholder: '' },
];

const COMPACT_LAYOUT: FieldConfig[] = [
  { key: 'street', label: 'Улица', placeholder: 'ул. Ленина', colSpan: 'col-span-2' },
  { key: 'house', label: 'Дом', placeholder: '19' },
  { key: 'building', label: 'Корпус', placeholder: '' },
  { key: 'apartment', label: 'Кв./Офис', placeholder: '' },
  { key: 'city', label: 'Город', placeholder: 'Минск' },
  { key: 'region', label: 'Область', placeholder: '' },
  { key: 'postal_code', label: 'Индекс', placeholder: '' },
  { key: 'country_name', label: 'Страна', placeholder: '' },
];

const DROPDOWN_Z_INDEX = 9999;

export function StructuredAddressBlock({
  value,
  onChange,
  disabled,
  compact,
  countries,
  fieldIds,
}: StructuredAddressBlockProps) {
  const layout = compact ? COMPACT_LAYOUT : FULL_LAYOUT;

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
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isSelectingRef = useRef(false);

  useEffect(() => cleanup, [cleanup]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [setIsOpen]);

  const updateDropdownPosition = useCallback(() => {
    if (!activeField) { setDropdownPos(null); return; }
    const el = fieldRefs.current.get(activeField);
    if (!el) { setDropdownPos(null); return; }
    const rect = el.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
  }, [activeField]);

  useEffect(() => { updateDropdownPosition(); }, [activeField, predictions, updateDropdownPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const close = () => { if (!isSelectingRef.current) clearPredictions(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [isOpen, clearPredictions]);

  const handleFieldChange = useCallback(
    (field: keyof StructuredAddress, val: string) => {
      let updated = { ...value, [field]: val };

      // Hard reset stale dependent data when editing primary address fields
      if (field === 'street') {
        updated = {
          ...updated,
          house: '',
          building: '',
          apartment: '',
          postal_code: '',
          google_place_id: null,
          lat: null,
          lng: null,
        };
      } else if (field === 'city') {
        updated = {
          ...updated,
          house: '',
          building: '',
          apartment: '',
          postal_code: '',
          street: '',
          settlement: '',
          google_place_id: null,
          lat: null,
          lng: null,
        };
      } else if (field === 'settlement') {
        updated = {
          ...updated,
          google_place_id: null,
          lat: null,
          lng: null,
        };
      }

      onChange(updated);

      if (AUTOCOMPLETE_FIELDS.includes(field) && isReady) {
        setActiveField(field);
        const query = buildAutocompleteQuery(updated, field, val);
        fetchPredictions(query);
        setHighlightIndex(-1);
      }
    },
    [value, onChange, isReady, fetchPredictions]
  );

  const handleSelect = useCallback(
    async (prediction: (typeof predictions)[0]) => {
      isSelectingRef.current = true;
      const details = await fetchPlaceDetails(prediction);

      if (details) {
        const parsed = GooglePlacesAdapter.parseComponents(details.addressComponents as any[]);
        const merged: StructuredAddress = {
          ...emptyAddress(),
          building: value.building,
          apartment: value.apartment,
          address_line_2: value.address_line_2,
          ...parsed,
          google_place_id: details.placeId,
          lat: details.lat,
          lng: details.lng,
        };
        onChange(merged);
      }

      clearPredictions();
      isSelectingRef.current = false;
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

  const handleBlur = useCallback(() => {
    setTimeout(() => { if (!isSelectingRef.current) setIsOpen(false); }, 200);
  }, [setIsOpen]);

  const showDropdown = isOpen && predictions.length > 0 && dropdownPos !== null;

  const dropdownElement = showDropdown
    ? createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: DROPDOWN_Z_INDEX,
          }}
          className="rounded-md border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden"
        >
          <ul className="py-1 max-h-60 overflow-y-auto">
            {predictions.map((p, index) => (
              <li
                key={p.placeId}
                role="option"
                aria-selected={index === highlightIndex}
                className={cn(
                  'px-3 py-2 cursor-pointer text-sm transition-colors',
                  index === highlightIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(p)}
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
        document.body
      )
    : null;

  return (
    <div ref={containerRef} className="w-full">
      <div className={cn('grid gap-3', 'grid-cols-4')}>
        {layout.map((field) => (
          <div
            key={field.key}
            ref={(el) => {
              if (el) fieldRefs.current.set(field.key, el);
              else fieldRefs.current.delete(field.key);
            }}
            className={cn(field.colSpan || 'col-span-1')}
          >
            <Label htmlFor={`addr-${field.key}`} className="text-xs text-muted-foreground mb-1 block">
              {field.label}
            </Label>
            <Input
              id={`addr-${field.key}`}
              value={(value[field.key] as string) ?? ''}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              onFocus={() => setActiveField(field.key)}
              disabled={disabled}
              placeholder={field.placeholder}
              autoComplete="off"
              className="h-9 text-sm"
            />
          </div>
        ))}
      </div>
      {dropdownElement}
    </div>
  );
}
