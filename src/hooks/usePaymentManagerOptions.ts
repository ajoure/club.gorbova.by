import { useEffect, useMemo, useRef } from "react";
import {
  usePaymentManagerDirectoryOptions,
  type PaymentManagerDirectoryOption,
} from "@/hooks/usePaymentManagerDirectoryOptions";
import type { UnifiedPayment } from "@/hooks/useUnifiedPayments";

type PaymentManager = Pick<UnifiedPayment, "responsible_user_id" | "responsible_name">;
export type PaymentManagerOption = { value: string; label: string };
const EMPTY_STAFF: PaymentManagerDirectoryOption[] = [];
const isManager = (value: string | null): value is string =>
  Boolean(value && value !== "all" && value !== "__unassigned__");

/** Directory choices must not depend on whether this period contains payments. */
export function buildPaymentManagerOptions(
  staff: PaymentManagerDirectoryOption[],
  payments: PaymentManager[],
): PaymentManagerOption[] {
  const names = new Map<string, string>();
  for (const payment of payments) {
    if (!isManager(payment.responsible_user_id)) continue;
    const name = payment.responsible_name?.trim();
    if (name || !names.has(payment.responsible_user_id)) {
      names.set(payment.responsible_user_id, name || "Менеджер (имя недоступно)");
    }
  }
  // Prefer current directory labels; retain former staff from payment snapshots.
  for (const person of staff) {
    if (!isManager(person.user_id)) continue;
    const name = person.label.trim();
    if (name || !names.has(person.user_id)) {
      names.set(person.user_id, name || "Менеджер (имя недоступно)");
    }
  }
  return Array.from(names, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru") || a.value.localeCompare(b.value));
}

export function usePaymentManagerOptions(payments: PaymentManager[], selectedValue: string) {
  const directory = usePaymentManagerDirectoryOptions();
  const staff = directory.data ?? EMPTY_STAFF;
  const options = useMemo(() => buildPaymentManagerOptions(staff, payments), [staff, payments]);
  const selectedOption = options.find(option => option.value === selectedValue);
  const lastSelected = useRef<PaymentManagerOption>();

  useEffect(() => {
    if (selectedOption) lastSelected.current = selectedOption;
    else if (!isManager(selectedValue)) lastSelected.current = undefined;
  }, [selectedOption, selectedValue]);

  // A former employee can disappear from the current period. Keep only the
  // selected label in memory, without resetting the filter or persisting PII.
  const retainedOption = isManager(selectedValue) && !selectedOption
    ? lastSelected.current?.value === selectedValue
      ? lastSelected.current
      : { value: selectedValue, label: "Выбранный менеджер (имя недоступно)" }
    : undefined;

  return {
    options: retainedOption ? [...options, retainedOption] : options,
    isLoading: directory.isLoading,
    isFetching: directory.isFetching,
    isError: directory.isError,
    refetch: directory.refetch,
  };
}
