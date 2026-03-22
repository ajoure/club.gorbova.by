/**
 * PersonsTableView — full-width table of persons with search and filter pills.
 */

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { GlassCard } from '@/components/ui/GlassCard';
import { Users, Plus, Search, Loader2 } from 'lucide-react';
import { getPersonDisplayName, getPersonDocumentSummary } from '@/lib/persons/personDisplayUtils';
import type { PersonRow } from '@/hooks/useAiPersons';

type FilterKey = 'all' | 'active' | 'inactive';

const FILTER_PILLS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'inactive', label: 'Неактивные' },
];

interface PersonsTableViewProps {
  allPersons: PersonRow[];
  isLoading: boolean;
  onCreateNew: () => void;
  onView: (person: PersonRow) => void;
}

function normalizeSearch(val: string): string {
  return val.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)\+]/g, '');
}

export function PersonsTableView({ allPersons, isLoading, onCreateNew, onView }: PersonsTableViewProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const filtered = useMemo(() => {
    let list = allPersons;

    if (filter === 'active') list = list.filter((p) => p.is_active);
    if (filter === 'inactive') list = list.filter((p) => !p.is_active);

    if (search.trim()) {
      const q = normalizeSearch(search);
      const qDigits = q.replace(/\D/g, '');
      list = list.filter((p) => {
        if (p.full_name && p.full_name.toLowerCase().includes(q)) return true;
        if (p.personal_number && p.personal_number.toLowerCase().includes(q)) return true;
        if (p.passport_number && p.passport_number.toLowerCase().includes(q)) return true;
        if (p.passport_series && `${p.passport_series} ${p.passport_number}`.toLowerCase().includes(q)) return true;
        if (p.email && p.email.toLowerCase().includes(q)) return true;
        if (p.phone && qDigits && normalizePhone(p.phone).includes(qDigits)) return true;
        return false;
      });
    }

    return [...list].sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return (a.full_name || '').localeCompare(b.full_name || '', 'ru');
    });
  }, [allPersons, filter, search]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">Физлица</h2>
        <Button onClick={onCreateNew} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Добавить
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по ФИО, документу, телефону, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTER_PILLS.map((pill) => (
            <Button
              key={pill.key}
              variant={filter === pill.key ? 'default' : 'outline'}
              size="sm"
              className="text-xs"
              onClick={() => setFilter(pill.key)}
            >
              {pill.label}
            </Button>
          ))}
        </div>
      </div>

      {allPersons.length === 0 && (
        <GlassCard className="text-center py-12">
          <div className="mx-auto mb-4 p-4 rounded-2xl bg-muted/40 w-fit">
            <Users className="h-8 w-8 text-teal-500" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Нет физлиц</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Добавьте физлицо для автозаполнения документов.
          </p>
          <Button onClick={onCreateNew}>
            <Plus className="h-4 w-4 mr-1" />
            Добавить физлицо
          </Button>
        </GlassCard>
      )}

      {allPersons.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ФИО</TableHead>
              <TableHead className="w-[160px]">Документ</TableHead>
              <TableHead className="w-[140px]">Телефон</TableHead>
              <TableHead className="w-[160px]">Email</TableHead>
              <TableHead className="w-[100px]">Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Ничего не найдено
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((person) => (
                <TableRow
                  key={person.id}
                  className="cursor-pointer"
                  onClick={() => onView(person)}
                >
                  <TableCell className="font-medium">{getPersonDisplayName(person)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm font-mono">
                    {getPersonDocumentSummary(person)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{person.phone || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-[160px]">{person.email || '—'}</TableCell>
                  <TableCell>
                    {person.is_active ? (
                      <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                        Активный
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">
                        Неактивный
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          Показано: {filtered.length} из {allPersons.length}
        </p>
      )}
    </div>
  );
}
