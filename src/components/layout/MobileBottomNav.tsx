import { NavLink, useLocation } from "react-router-dom";
import { Settings, BookOpen, LayoutGrid, Package, User } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    title: "Обзор",
    url: "/dashboard",
    icon: LayoutGrid,
  },
  {
    title: "Продукты",
    url: "/products",
    icon: Package,
  },
  {
    title: "FAQ",
    url: "/docs",
    icon: BookOpen,
  },
  {
    title: "Настройки",
    url: "/settings/profile",
    icon: Settings,
    matchPrefix: "/settings",
  },
];

export function MobileBottomNav() {
  const location = useLocation();

  const isActive = (item: typeof navItems[0]) => {
    if (item.matchPrefix) {
      return location.pathname.startsWith(item.matchPrefix);
    }
    return location.pathname === item.url;
  };

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="flex items-center justify-around h-14">
        {navItems.map((item) => {
          const active = isActive(item);
          return (
            <NavLink
              key={item.url}
              to={item.url}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors",
                active 
                  ? "text-primary" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.title}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
