/**
 * Toolbar для верхнего ряда вкладки форм: справа — кнопка управления колонками.
 * Архитектурно отделён от FormsHubFilters (фильтры остаются фильтрами).
 */
import { ColumnSettings } from "@/components/admin/ColumnSettings";
import { useFormsColumns } from "@/hooks/useFormsColumns";

export function FormsTableToolbar() {
  const { columns, setColumns } = useFormsColumns();
  return (
    <div className="flex items-center justify-end">
      <ColumnSettings columns={columns} onChange={setColumns} />
    </div>
  );
}
