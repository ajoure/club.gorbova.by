/**
 * OrgFormCombobox — searchable combobox for legal entity forms.
 *
 * Uses OrgFormDictionary as data source.
 * Supports "Другое" with manual full + short input.
 * Canonical value = fullName (stored in DB).
 */

import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  searchOrgForms,
  findOrgFormByFull,
  getShortOrgForm,
  type OrgFormEntry,
} from '@/lib/legal-entities/OrgFormDictionary';

const OTHER_VALUE = '__OTHER__';

interface OrgFormComboboxProps {
  value: string; // canonical fullName or '__OTHER__'
  onChange: (fullName: string) => void;
  /** Custom full form (for "Другое") */
  customFullForm?: string;
  customShortForm?: string;
  onCustomFullFormChange?: (val: string) => void;
  onCustomShortFormChange?: (val: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function OrgFormCombobox({
  value,
  onChange,
  customFullForm = '',
  customShortForm = '',
  onCustomFullFormChange,
  onCustomShortFormChange,
  disabled,
  placeholder = 'Выберите форму',
}: OrgFormComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const isOther = value === OTHER_VALUE;

  const filteredEntries = useMemo(() => {
    return searchOrgForms(search, 'BY');
  }, [search]);

  const displayValue = useMemo(() => {
    if (!value) return '';
    if (isOther) return 'Другое';
    const short = getShortOrgForm(value);
    return short !== value ? short : value;
  }, [value, isOther]);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              'w-full justify-between font-normal h-9 text-sm',
              !value && 'text-muted-foreground'
            )}
          >
            {displayValue || placeholder}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Поиск формы..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>Форма не найдена</CommandEmpty>
              <CommandGroup>
                {filteredEntries.map((entry) => (
                  <CommandItem
                    key={entry.fullName}
                    value={entry.fullName}
                    onSelect={() => {
                      onChange(entry.fullName);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === entry.fullName ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="font-medium mr-2">{entry.shortName}</span>
                    <span className="text-muted-foreground text-xs truncate">
                      {entry.fullName}
                    </span>
                  </CommandItem>
                ))}
                {/* Другое */}
                <CommandItem
                  value={OTHER_VALUE}
                  onSelect={() => {
                    onChange(OTHER_VALUE);
                    setOpen(false);
                    setSearch('');
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      isOther ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="text-muted-foreground italic">Другое...</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Custom fields for "Другое" */}
      {isOther && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-muted-foreground">Полная форма *</Label>
            <Input
              value={customFullForm}
              onChange={(e) => onCustomFullFormChange?.(e.target.value)}
              placeholder="Полное наименование формы"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Краткая форма *</Label>
            <Input
              value={customShortForm}
              onChange={(e) => onCustomShortFormChange?.(e.target.value)}
              placeholder="Сокращение"
              className="h-8 text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
