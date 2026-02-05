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
   default: { text: 'text-white/90', iconBg: 'bg-white/10' },
   success: { text: 'text-emerald-300', iconBg: 'bg-emerald-400/15' },
   warning: { text: 'text-amber-300', iconBg: 'bg-amber-400/15' },
   danger: { text: 'text-rose-300', iconBg: 'bg-rose-400/15' },
   info: { text: 'text-sky-300', iconBg: 'bg-sky-400/15' },
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
         // Real glass effect
         "relative overflow-hidden rounded-[28px] p-4",
         "bg-white/[0.06]",
         "border border-white/[0.22]",
         "shadow-[0_18px_60px_rgba(0,0,0,0.22),inset_0_0_0_1px_rgba(255,255,255,0.10)]",
         "ring-1 ring-white/[0.10]",
         "transition-all duration-300",
         // Hover & active states
         isClickable && "cursor-pointer hover:bg-white/[0.10] hover:border-white/[0.28] hover:scale-[1.02]",
         isActive && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background"
       )}
       style={{ 
         backdropFilter: 'blur(24px) saturate(170%)', 
         WebkitBackdropFilter: 'blur(24px) saturate(170%)' 
       }}
     >
       {/* Realistic glare overlay */}
       <div className="pointer-events-none absolute inset-0">
         {/* Main glare - rotated */}
         <div className="absolute -top-16 left-[-30%] h-40 w-[160%] rotate-[-12deg] bg-gradient-to-b from-white/30 via-white/10 to-transparent" />
         {/* Secondary glow */}
         <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-white/5" />
       </div>
 
       {/* Content */}
       <div className="relative z-10 flex items-start justify-between gap-3">
         <div className="flex-1 min-w-0 space-y-1">
           <p className="text-[10px] font-medium uppercase tracking-widest text-white/60">
             {title}
           </p>
           <p className={cn("text-xl font-medium tabular-nums tracking-tight", colors.text)}>
             {value}
           </p>
           {subtitle && (
             <p className="text-xs text-white/50 tabular-nums">
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