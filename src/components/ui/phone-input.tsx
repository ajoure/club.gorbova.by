import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronDown, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
export { isValidPhoneNumber } from "../../../supabase/functions/site-form-submit/phone-validation";

// Country data with codes
const countries = [
  { code: "BY", name: "Беларусь", dial: "+375", flag: "🇧🇾" },
  { code: "RU", name: "Россия", dial: "+7", flag: "🇷🇺" },
  { code: "UA", name: "Украина", dial: "+380", flag: "🇺🇦" },
  { code: "KZ", name: "Казахстан", dial: "+7", flag: "🇰🇿" },
  { code: "PL", name: "Польша", dial: "+48", flag: "🇵🇱" },
  { code: "LT", name: "Литва", dial: "+370", flag: "🇱🇹" },
  { code: "LV", name: "Латвия", dial: "+371", flag: "🇱🇻" },
  { code: "EE", name: "Эстония", dial: "+372", flag: "🇪🇪" },
  { code: "DE", name: "Германия", dial: "+49", flag: "🇩🇪" },
  { code: "FR", name: "Франция", dial: "+33", flag: "🇫🇷" },
  { code: "GB", name: "Великобритания", dial: "+44", flag: "🇬🇧" },
  { code: "US", name: "США", dial: "+1", flag: "🇺🇸" },
  { code: "CA", name: "Канада", dial: "+1", flag: "🇨🇦" },
  { code: "AU", name: "Австралия", dial: "+61", flag: "🇦🇺" },
  { code: "CN", name: "Китай", dial: "+86", flag: "🇨🇳" },
  { code: "JP", name: "Япония", dial: "+81", flag: "🇯🇵" },
  { code: "KR", name: "Южная Корея", dial: "+82", flag: "🇰🇷" },
  { code: "IN", name: "Индия", dial: "+91", flag: "🇮🇳" },
  { code: "TR", name: "Турция", dial: "+90", flag: "🇹🇷" },
  { code: "GE", name: "Грузия", dial: "+995", flag: "🇬🇪" },
  { code: "AM", name: "Армения", dial: "+374", flag: "🇦🇲" },
  { code: "AZ", name: "Азербайджан", dial: "+994", flag: "🇦🇿" },
  { code: "UZ", name: "Узбекистан", dial: "+998", flag: "🇺🇿" },
  { code: "TJ", name: "Таджикистан", dial: "+992", flag: "🇹🇯" },
  { code: "KG", name: "Кыргызстан", dial: "+996", flag: "🇰🇬" },
  { code: "TM", name: "Туркменистан", dial: "+993", flag: "🇹🇲" },
  { code: "MD", name: "Молдова", dial: "+373", flag: "🇲🇩" },
  { code: "IL", name: "Израиль", dial: "+972", flag: "🇮🇱" },
  { code: "AE", name: "ОАЭ", dial: "+971", flag: "🇦🇪" },
  { code: "TH", name: "Таиланд", dial: "+66", flag: "🇹🇭" },
  { code: "VN", name: "Вьетнам", dial: "+84", flag: "🇻🇳" },
  { code: "ID", name: "Индонезия", dial: "+62", flag: "🇮🇩" },
  { code: "MY", name: "Малайзия", dial: "+60", flag: "🇲🇾" },
  { code: "SG", name: "Сингапур", dial: "+65", flag: "🇸🇬" },
  { code: "IT", name: "Италия", dial: "+39", flag: "🇮🇹" },
  { code: "ES", name: "Испания", dial: "+34", flag: "🇪🇸" },
  { code: "PT", name: "Португалия", dial: "+351", flag: "🇵🇹" },
  { code: "NL", name: "Нидерланды", dial: "+31", flag: "🇳🇱" },
  { code: "BE", name: "Бельгия", dial: "+32", flag: "🇧🇪" },
  { code: "AT", name: "Австрия", dial: "+43", flag: "🇦🇹" },
  { code: "CH", name: "Швейцария", dial: "+41", flag: "🇨🇭" },
  { code: "SE", name: "Швеция", dial: "+46", flag: "🇸🇪" },
  { code: "NO", name: "Норвегия", dial: "+47", flag: "🇳🇴" },
  { code: "DK", name: "Дания", dial: "+45", flag: "🇩🇰" },
  { code: "FI", name: "Финляндия", dial: "+358", flag: "🇫🇮" },
  { code: "CZ", name: "Чехия", dial: "+420", flag: "🇨🇿" },
  { code: "SK", name: "Словакия", dial: "+421", flag: "🇸🇰" },
  { code: "HU", name: "Венгрия", dial: "+36", flag: "🇭🇺" },
  { code: "RO", name: "Румыния", dial: "+40", flag: "🇷🇴" },
  { code: "BG", name: "Болгария", dial: "+359", flag: "🇧🇬" },
  { code: "GR", name: "Греция", dial: "+30", flag: "🇬🇷" },
  { code: "HR", name: "Хорватия", dial: "+385", flag: "🇭🇷" },
  { code: "RS", name: "Сербия", dial: "+381", flag: "🇷🇸" },
  { code: "ME", name: "Черногория", dial: "+382", flag: "🇲🇪" },
  { code: "MK", name: "Северная Македония", dial: "+389", flag: "🇲🇰" },
  { code: "SI", name: "Словения", dial: "+386", flag: "🇸🇮" },
  { code: "BA", name: "Босния и Герцеговина", dial: "+387", flag: "🇧🇦" },
  { code: "AL", name: "Албания", dial: "+355", flag: "🇦🇱" },
  { code: "IE", name: "Ирландия", dial: "+353", flag: "🇮🇪" },
  { code: "IS", name: "Исландия", dial: "+354", flag: "🇮🇸" },
  { code: "CY", name: "Кипр", dial: "+357", flag: "🇨🇾" },
  { code: "MT", name: "Мальта", dial: "+356", flag: "🇲🇹" },
  { code: "LU", name: "Люксембург", dial: "+352", flag: "🇱🇺" },
  { code: "MX", name: "Мексика", dial: "+52", flag: "🇲🇽" },
  { code: "BR", name: "Бразилия", dial: "+55", flag: "🇧🇷" },
  { code: "AR", name: "Аргентина", dial: "+54", flag: "🇦🇷" },
  { code: "CL", name: "Чили", dial: "+56", flag: "🇨🇱" },
  { code: "CO", name: "Колумбия", dial: "+57", flag: "🇨🇴" },
  { code: "PE", name: "Перу", dial: "+51", flag: "🇵🇪" },
  { code: "VE", name: "Венесуэла", dial: "+58", flag: "🇻🇪" },
  { code: "EC", name: "Эквадор", dial: "+593", flag: "🇪🇨" },
  { code: "UY", name: "Уругвай", dial: "+598", flag: "🇺🇾" },
  { code: "PY", name: "Парагвай", dial: "+595", flag: "🇵🇾" },
  { code: "BO", name: "Боливия", dial: "+591", flag: "🇧🇴" },
  { code: "ZA", name: "ЮАР", dial: "+27", flag: "🇿🇦" },
  { code: "EG", name: "Египет", dial: "+20", flag: "🇪🇬" },
  { code: "NG", name: "Нигерия", dial: "+234", flag: "🇳🇬" },
  { code: "KE", name: "Кения", dial: "+254", flag: "🇰🇪" },
  { code: "MA", name: "Марокко", dial: "+212", flag: "🇲🇦" },
  { code: "TN", name: "Тунис", dial: "+216", flag: "🇹🇳" },
  { code: "SA", name: "Саудовская Аравия", dial: "+966", flag: "🇸🇦" },
  { code: "QA", name: "Катар", dial: "+974", flag: "🇶🇦" },
  { code: "KW", name: "Кувейт", dial: "+965", flag: "🇰🇼" },
  { code: "BH", name: "Бахрейн", dial: "+973", flag: "🇧🇭" },
  { code: "OM", name: "Оман", dial: "+968", flag: "🇴🇲" },
  { code: "JO", name: "Иордания", dial: "+962", flag: "🇯🇴" },
  { code: "LB", name: "Ливан", dial: "+961", flag: "🇱🇧" },
  { code: "SY", name: "Сирия", dial: "+963", flag: "🇸🇾" },
  { code: "IQ", name: "Ирак", dial: "+964", flag: "🇮🇶" },
  { code: "IR", name: "Иран", dial: "+98", flag: "🇮🇷" },
  { code: "PK", name: "Пакистан", dial: "+92", flag: "🇵🇰" },
  { code: "BD", name: "Бангладеш", dial: "+880", flag: "🇧🇩" },
  { code: "NP", name: "Непал", dial: "+977", flag: "🇳🇵" },
  { code: "LK", name: "Шри-Ланка", dial: "+94", flag: "🇱🇰" },
  { code: "MM", name: "Мьянма", dial: "+95", flag: "🇲🇲" },
  { code: "KH", name: "Камбоджа", dial: "+855", flag: "🇰🇭" },
  { code: "LA", name: "Лаос", dial: "+856", flag: "🇱🇦" },
  { code: "MN", name: "Монголия", dial: "+976", flag: "🇲🇳" },
  { code: "PH", name: "Филиппины", dial: "+63", flag: "🇵🇭" },
  { code: "NZ", name: "Новая Зеландия", dial: "+64", flag: "🇳🇿" },
  { code: "HK", name: "Гонконг", dial: "+852", flag: "🇭🇰" },
  { code: "TW", name: "Тайвань", dial: "+886", flag: "🇹🇼" },
];

// Get default country (Belarus)
const defaultCountry = countries.find(c => c.code === "BY") || countries[0];

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  error?: boolean;
  id?: string;
  required?: boolean;
}

export function PhoneInput({
  value,
  onChange,
  onBlur,
  placeholder = "Номер телефона",
  className,
  error,
  id,
  required,
}: PhoneInputProps) {
  const [open, setOpen] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState(defaultCountry);
  const [localNumber, setLocalNumber] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Parse initial value to detect country and number
  useEffect(() => {
    if (value) {
      // Find matching country by dial code (longest match first)
      const sortedCountries = [...countries].sort((a, b) => b.dial.length - a.dial.length);
      for (const country of sortedCountries) {
        if (value.startsWith(country.dial)) {
          setSelectedCountry(country);
          setLocalNumber(value.slice(country.dial.length).replace(/\D/g, ''));
          return;
        }
      }
      // If no country found, use default and extract digits
      setLocalNumber(value.replace(/\D/g, ''));
    }
  }, []);

  const handleCountrySelect = (country: typeof defaultCountry) => {
    setSelectedCountry(country);
    setOpen(false);
    // Update full value
    const newValue = country.dial + localNumber;
    onChange(newValue);
    // Focus input after selection
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // Smart paste/input handler: detect full phone numbers with country codes
  const processPhoneInput = (input: string): { country: typeof defaultCountry; number: string } | null => {
    // Normalize: remove spaces, dashes, parentheses
    let normalized = input.replace(/[\s\-\(\)]/g, '');
    
    // Convert 00 prefix to +
    if (normalized.startsWith('00')) {
      normalized = '+' + normalized.slice(2);
    }
    
    // If starts with +, try to detect country code
    if (normalized.startsWith('+')) {
      // Sort by dial code length (longest first) to match correctly
      const sortedCountries = [...countries].sort((a, b) => b.dial.length - a.dial.length);
      for (const country of sortedCountries) {
        if (normalized.startsWith(country.dial)) {
          const numberPart = normalized.slice(country.dial.length).replace(/\D/g, '');
          return { country, number: numberPart };
        }
      }
    }
    
    // Check if input contains the currently selected country dial code
    const cleanInput = input.replace(/[\s\-\(\)]/g, '');
    if (cleanInput.startsWith(selectedCountry.dial)) {
      const numberPart = cleanInput.slice(selectedCountry.dial.length).replace(/\D/g, '');
      return { country: selectedCountry, number: numberPart };
    }
    
    return null;
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    
    // Try smart detection first
    const detected = processPhoneInput(input);
    if (detected) {
      setSelectedCountry(detected.country);
      setLocalNumber(detected.number);
      onChange(detected.country.dial + detected.number);
      return;
    }
    
    // Standard logic: only digits
    const digits = input.replace(/\D/g, '');
    setLocalNumber(digits);
    onChange(selectedCountry.dial + digits);
  };

  // Handle paste event for smart country detection
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    
    // Try smart detection
    const detected = processPhoneInput(pasted);
    if (detected) {
      setSelectedCountry(detected.country);
      setLocalNumber(detected.number);
      onChange(detected.country.dial + detected.number);
      return;
    }
    
    // Fallback: just extract digits
    const digits = pasted.replace(/\D/g, '');
    setLocalNumber(digits);
    onChange(selectedCountry.dial + digits);
  };

  return (
    <div className={cn("flex gap-0", className)}>
      {/* Country selector */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "h-12 px-3 rounded-l-xl rounded-r-none border-r-0 bg-background/50 border-border/50 hover:bg-muted/50 min-w-[90px] justify-between",
              error && "border-destructive"
            )}
          >
            <span className="flex items-center gap-1.5">
              <span className="text-lg">{selectedCountry.flag}</span>
              <span className="text-sm font-medium">{selectedCountry.dial}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0 z-50 bg-popover" align="start">
          <Command>
            <CommandInput placeholder="Поиск страны..." className="h-10" />
            <CommandList>
              <CommandEmpty>Страна не найдена</CommandEmpty>
              <CommandGroup className="max-h-[300px] overflow-y-auto">
                {countries.map((country) => (
                  <CommandItem
                    key={country.code}
                    value={`${country.name} ${country.dial}`}
                    onSelect={() => handleCountrySelect(country)}
                    className="cursor-pointer"
                  >
                    <span className="text-lg mr-2">{country.flag}</span>
                    <span className="flex-1">{country.name}</span>
                    <span className="text-muted-foreground">{country.dial}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Phone number input */}
      <div className="relative flex-1">
        <Input
          ref={inputRef}
          id={id}
          type="tel"
          inputMode="numeric"
          value={localNumber}
          onChange={handleNumberChange}
          onPaste={handlePaste}
          onBlur={onBlur}
          className={cn(
            "h-12 rounded-l-none rounded-r-xl bg-background/50 border-border/50 focus:border-primary",
            error && "border-destructive"
          )}
          placeholder={placeholder}
          required={required}
        />
      </div>
    </div>
  );
}

// Helper to get full phone number with country code
export function getFullPhoneNumber(countryDial: string, number: string): string {
  return countryDial + number.replace(/\D/g, '');
}

// Validate phone number (basic validation)
