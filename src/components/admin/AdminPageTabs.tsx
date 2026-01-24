import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LucideIcon, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface AdminTab {
  id: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  dropdown?: {
    id: string;
    label: string;
    icon?: LucideIcon;
    count?: number;
    badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  }[];
}

interface AdminPageTabsProps {
  tabs: AdminTab[];
  defaultTab?: string;
  onTabChange?: (tabId: string, dropdownId?: string) => void;
  syncWithUrl?: boolean;
  urlParam?: string;
  className?: string;
}

export function AdminPageTabs({
  tabs,
  defaultTab,
  onTabChange,
  syncWithUrl = true,
  urlParam = "tab",
  className,
}: AdminPageTabsProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(
    syncWithUrl ? (searchParams.get(urlParam) || defaultTab || tabs[0]?.id) : (defaultTab || tabs[0]?.id)
  );
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);

  // Sync with URL on mount and URL change
  useEffect(() => {
    if (syncWithUrl) {
      const tabFromUrl = searchParams.get(urlParam);
      if (tabFromUrl && tabFromUrl !== activeTab) {
        setActiveTab(tabFromUrl);
      }
    }
  }, [searchParams, syncWithUrl, urlParam]);

  const handleTabChange = (tabId: string, dropdownId?: string) => {
    setActiveTab(tabId);
    setActiveDropdownId(dropdownId || null);
    
    if (syncWithUrl) {
      const newParams = new URLSearchParams(searchParams);
      newParams.set(urlParam, tabId);
      setSearchParams(newParams, { replace: true });
    }
    
    onTabChange?.(tabId, dropdownId);
  };

  const renderBadge = (count: number | undefined, variant?: AdminTab["badgeVariant"]) => {
    if (count === undefined || count === 0) return null;
    
    return (
      <Badge 
        className={cn(
          "h-4 min-w-4 px-1 text-[10px] font-semibold rounded-full",
          variant === "destructive" && "bg-destructive text-destructive-foreground",
          variant === "secondary" && "bg-muted text-muted-foreground",
          (!variant || variant === "default") && "bg-primary text-primary-foreground"
        )}
      >
        {count > 99 ? "99+" : count}
      </Badge>
    );
  };

  return (
    <div className={cn("px-3 md:px-4 pt-1 pb-1.5 shrink-0", className)}>
      <div className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20 overflow-x-auto max-w-full scrollbar-none">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          // Tab with dropdown
          if (tab.dropdown && tab.dropdown.length > 0) {
            return (
              <DropdownMenu key={tab.id}>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap",
                      isActive
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">{tab.label}</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                    {renderBadge(tab.count, tab.badgeVariant)}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="min-w-[160px] bg-background/95 backdrop-blur-xl border border-border/30 shadow-lg rounded-lg"
                >
                  {tab.dropdown.map((item) => {
                    const ItemIcon = item.icon;
                    return (
                      <DropdownMenuItem
                        key={item.id}
                        onClick={() => handleTabChange(tab.id, item.id)}
                        className={cn(
                          "flex items-center gap-2 text-xs cursor-pointer rounded-md",
                          activeDropdownId === item.id && isActive && "bg-muted"
                        )}
                      >
                        {ItemIcon && <ItemIcon className="h-3.5 w-3.5" />}
                        {item.label}
                        {item.count !== undefined && item.count > 0 && (
                          <Badge
                            className={cn(
                              "ml-auto h-4 min-w-4 px-1 text-[10px] rounded-full",
                              item.badgeVariant === "destructive"
                                ? "bg-destructive text-destructive-foreground"
                                : "bg-primary text-primary-foreground"
                            )}
                          >
                            {item.count}
                          </Badge>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          }

          // Regular tab
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{tab.label}</span>
              {renderBadge(tab.count, tab.badgeVariant)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Hook for easy tab state management
export function useAdminTabs(tabs: AdminTab[], defaultTab?: string, syncWithUrl = true) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlParam = "tab";
  
  const [activeTab, setActiveTab] = useState<string>(
    syncWithUrl ? (searchParams.get(urlParam) || defaultTab || tabs[0]?.id) : (defaultTab || tabs[0]?.id)
  );

  useEffect(() => {
    if (syncWithUrl) {
      const tabFromUrl = searchParams.get(urlParam);
      if (tabFromUrl && tabFromUrl !== activeTab) {
        setActiveTab(tabFromUrl);
      }
    }
  }, [searchParams, syncWithUrl]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    if (syncWithUrl) {
      const newParams = new URLSearchParams(searchParams);
      newParams.set(urlParam, tabId);
      setSearchParams(newParams, { replace: true });
    }
  };

  return { activeTab, setActiveTab: handleTabChange };
}
