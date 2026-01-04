import { Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { getHelpText, HelpText } from '@/constants/helpTexts';
import { useHelpMode } from '@/contexts/HelpModeContext';
import { cn } from '@/lib/utils';

interface HelpIconProps {
  /** Ключ из словаря helpTexts */
  helpKey: string;
  /** Кастомный текст (если не хотите использовать словарь) */
  customText?: HelpText;
  /** Размер иконки */
  size?: 'sm' | 'md';
  /** Дополнительные классы */
  className?: string;
  /** Показывать всегда (игнорировать helpMode) */
  alwaysShow?: boolean;
}

/**
 * Компонент иконки подсказки ⓘ
 * Показывает popover с полным описанием при клике
 * Учитывает режим подсказок (helpMode)
 */
export function HelpIcon({ 
  helpKey, 
  customText, 
  size = 'sm',
  className,
  alwaysShow = false 
}: HelpIconProps) {
  const { helpMode } = useHelpMode();
  
  const helpText = customText || getHelpText(helpKey);
  
  if (!helpText) return null;
  if (!alwaysShow && !helpMode) return null;

  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button 
          type="button"
          className={cn(
            "inline-flex items-center justify-center text-muted-foreground/60 hover:text-muted-foreground transition-colors",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
            className
          )}
          aria-label="Показать подсказку"
        >
          <Info className={iconSize} />
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-72 p-3 text-sm bg-popover/95 backdrop-blur-sm border-border/50"
        side="top"
        align="start"
      >
        <div className="space-y-2">
          <p className="font-medium text-foreground">{helpText.short}</p>
          {helpText.full && (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {helpText.full}
            </p>
          )}
          {helpText.link && (
            <Link 
              to={helpText.link}
              className="inline-block text-xs text-primary hover:underline"
            >
              Подробнее →
            </Link>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface HelpTooltipProps {
  /** Ключ из словаря helpTexts */
  helpKey: string;
  /** Кастомный текст (если не хотите использовать словарь) */
  customShort?: string;
  /** Элемент, к которому привязан tooltip */
  children: React.ReactNode;
  /** Показывать всегда (игнорировать helpMode) */
  alwaysShow?: boolean;
  /** Сторона показа */
  side?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * Компонент tooltip-обёртки
 * Показывает короткую подсказку при наведении
 */
export function HelpTooltip({ 
  helpKey, 
  customShort,
  children,
  alwaysShow = false,
  side = 'top'
}: HelpTooltipProps) {
  const { helpMode } = useHelpMode();
  
  const helpText = getHelpText(helpKey);
  const shortText = customShort || helpText?.short;
  
  // Если подсказок нет или режим выключен — просто рендерим children
  if (!shortText || (!alwaysShow && !helpMode)) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          {children}
        </TooltipTrigger>
        <TooltipContent 
          side={side}
          className="bg-popover/95 backdrop-blur-sm border-border/50 text-xs"
        >
          {shortText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface HelpLabelProps {
  /** Текст label */
  children: React.ReactNode;
  /** Ключ подсказки */
  helpKey: string;
  /** Кастомный текст */
  customText?: HelpText;
  /** Дополнительные классы для label */
  className?: string;
  /** htmlFor для label */
  htmlFor?: string;
}

/**
 * Label с иконкой подсказки
 * Удобно для форм
 */
export function HelpLabel({ 
  children, 
  helpKey, 
  customText,
  className,
  htmlFor 
}: HelpLabelProps) {
  return (
    <label 
      htmlFor={htmlFor}
      className={cn("flex items-center gap-1.5 text-sm font-medium", className)}
    >
      {children}
      <HelpIcon helpKey={helpKey} customText={customText} />
    </label>
  );
}
