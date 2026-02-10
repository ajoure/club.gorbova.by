import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Star } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TicketStatusBadge } from "./TicketStatusBadge";
import { cn } from "@/lib/utils";
import type { SupportTicket } from "@/hooks/useTickets";

interface TicketCardProps {
  ticket: SupportTicket;
  onClick?: () => void;
  isSelected?: boolean;
  showProfile?: boolean;
}

export function TicketCard({ ticket, onClick, isSelected, showProfile }: TicketCardProps) {
  const hasUnread = ticket.has_unread_user || ticket.has_unread_admin;
  
  // Generate initials from profile name or email
  const initials = ticket.profiles?.full_name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || ticket.profiles?.email?.[0]?.toUpperCase() || '?';

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative flex items-start gap-3 p-2 rounded-xl cursor-pointer transition-all",
        "hover:bg-accent/50",
        isSelected && "bg-primary/10 ring-1 ring-inset ring-primary/30",
        hasUnread && !isSelected && "bg-primary/10"
      )}
    >
      {/* Avatar */}
      <Avatar className="h-10 w-10 shrink-0">
        {ticket.profiles?.avatar_url && (
          <AvatarImage src={ticket.profiles.avatar_url} />
        )}
        <AvatarFallback className={cn(
          "text-xs font-medium",
          hasUnread ? "bg-primary/20 text-primary" : "bg-muted"
        )}>
          {initials}
        </AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn(
            "text-sm",
            hasUnread ? "font-bold" : "font-medium"
          )}>
            {showProfile 
              ? (ticket.profiles?.full_name || ticket.profiles?.email || "Неизвестный") 
              : ticket.subject}
          </span>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {formatDistanceToNow(new Date(ticket.updated_at), { locale: ru, addSuffix: false })}
          </span>
        </div>
        
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground font-mono">
            {ticket.ticket_number}
          </span>
          {ticket.is_starred && (
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
          )}
        </div>

        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {ticket.subject}
        </p>
      </div>

      {/* Status Badge */}
      <div className="shrink-0 self-center">
        <TicketStatusBadge status={ticket.status} />
      </div>
      
      {/* Unread indicator dot — bright & prominent */}
      {hasUnread && (
        <div className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-primary/30" />
      )}
    </div>
  );
}
