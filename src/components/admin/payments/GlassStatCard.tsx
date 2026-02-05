 import { ReactNode } from "react";
 import { cn } from "@/lib/utils";
 
 export type GlassStatVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';
 
 interface GlassStatCardProps {
   title: string;
   value: string;
   subtitle?: string;
   icon: ReactNode;
   variant?: GlassStatVariant;
   isActive?: boolean;
   isClickable?: boolean;
   onClick?: () => void;
 }
 
 const variantColors: Record<GlassStatVariant, { text: string; iconBg: string }> = {
   default: { text: 'text-foreground', iconBg: 'bg-muted/50' },
   success: { text: 'text-[hsl(142,76%,36%)]', iconBg: 'bg-[hsl(142,76%,36%)]/10' },
   warning: { text: 'text-[hsl(38,92%,50%)]', iconBg: 'bg-[hsl(38,92%,50%)]/10' },
   danger: { text: 'text-destructive', iconBg: 'bg-destructive/10' },
   info: { text: 'text-[hsl(199,89%,48%)]', iconBg: 'bg-[hsl(199,89%,48%)]/10' },
 };
 
 export function GlassStatCard({
   title,
   value,
   subtitle,
   icon,
   variant = 'default',
   isActive = false,
   isClickable = true,
   onClick,
 }: GlassStatCardProps) {
   const colors = variantColors[variant];
 
   return (
     <div
       onClick={onClick}
       className={cn(
         // Base glass effect
         "relative overflow-hidden rounded-2xl p-4",
         "backdrop-blur-2xl",
         "border border-white/[0.12] dark:border-white/[0.08]",
         "shadow-[0_8px_32px_rgba(0,0,0,0.08)]",
         "transition-all duration-300",
         // Hover & active states
         isClickable && "cursor-pointer hover:border-white/[0.2] hover:scale-[1.02]",
         isActive && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background"
       )}
       style={{
         background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)',
       }}
     >
       {/* Inner shine overlay */}
       <div 
         className="absolute inset-0 rounded-2xl pointer-events-none"
         style={{
           background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%)',
         }}
       />
       
       {/* Top accent line */}
       <div 
         className="absolute inset-x-0 top-0 h-px opacity-60"
         style={{
           background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
         }}
       />
 
       {/* Content */}
       <div className="relative z-10 flex items-start justify-between gap-3">
         <div className="flex-1 min-w-0 space-y-1">
           <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
             {title}
           </p>
           <p className={cn("text-xl font-bold tabular-nums tracking-tight", colors.text)}>
             {value}
           </p>
           {subtitle && (
             <p className="text-xs text-muted-foreground tabular-nums">
               {subtitle}
             </p>
           )}
         </div>
         <div className={cn("shrink-0 p-2 rounded-xl", colors.iconBg)}>
           {icon}
         </div>
       </div>
 
       {/* Active indicator */}
       {isActive && (
         <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary animate-pulse" />
       )}
     </div>
   );
 }