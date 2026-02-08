import { useState, useEffect } from 'react';

/**
 * P0-guard: Debounce any value to reduce UI updates during rapid input
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds (default: 150ms)
 * @returns Debounced value
 */
export function useDebouncedValue<T>(value: T, delay: number = 150): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
