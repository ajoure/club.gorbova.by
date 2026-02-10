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
      {/* Avatar with inline unread dot */}
      <div className="relative shrink-0">
        <Avatar className="h-10 w-10">
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
        {hasUnread && (
          <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
        )}
      </div>

      {/* Content — 3-row layout: name+time, ticket#, subject+badge */}
      <div className="flex-1 min-w-0">
        {/* Row 1: Name / Subject + time */}
        <div className="flex items-center justify-between gap-2">
          <span className={cn(
            "text-sm truncate",
            hasUnread ? "font-bold" : "font-medium"
          )}>
            {showProfile 
              ? (ticket.profiles?.full_name || ticket.profiles?.email || "Неизвестный") 
              : ticket.subject}
          </span>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
            {formatDistanceToNow(new Date(ticket.updated_at), { locale: ru, addSuffix: false })}
          </span>
        </div>
        
        {/* Row 2: Ticket number + star */}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground font-mono">
            {ticket.ticket_number}
          </span>
          {ticket.is_starred && (
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 shrink-0" />
          )}
        </div>

        {/* Row 3: Subject + status badge on same row, badge never clips */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-xs text-muted-foreground truncate flex-1 min-w-0">
            {ticket.subject}
          </p>
          <div className="shrink-0">
            <TicketStatusBadge status={ticket.status} compact />
          </div>
        </div>
      </div>
    </div>
  );
}
