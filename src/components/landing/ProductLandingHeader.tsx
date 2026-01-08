import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { Menu, X } from "lucide-react";

interface NavItem {
  label: string;
  sectionId: string;
}

interface ProductLandingHeaderProps {
  productName: string;
  subtitle?: string;
  navItems?: NavItem[];
}

export function ProductLandingHeader({ 
  productName, 
  subtitle,
  navItems = [
    { label: "Тарифы", sectionId: "tariffs" },
  ]
}: ProductLandingHeaderProps) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    setMobileMenuOpen(false);
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <header
      className={`fixed left-0 right-0 z-50 transition-all duration-500 ${
        isScrolled ? "py-3 border-b border-border/50" : "py-4"
      } ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"}`}
      style={{
        top: "0",
        background: isScrolled
          ? "linear-gradient(135deg, hsl(var(--card) / 0.95), hsl(var(--card) / 0.85))"
          : "transparent",
        backdropFilter: isScrolled ? "blur(20px)" : "none",
      }}
    >
      <div className="container mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
          <div>
            <span className="text-lg font-bold text-foreground uppercase">{productName}</span>
            {subtitle && (
              <span className="block text-xs text-muted-foreground">{subtitle}</span>
            )}
          </div>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          {navItems.map((item) => (
            <button
              key={item.sectionId}
              onClick={() => scrollToSection(item.sectionId)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Auth Button */}
        <div className="hidden md:flex items-center gap-3">
          {!loading && (
            user ? (
              <Button 
                onClick={() => navigate("/dashboard")} 
                variant="outline"
                className="border-border hover:bg-muted"
              >
                Личный кабинет
              </Button>
            ) : (
              <Button 
                onClick={() => navigate("/auth")} 
                variant="outline"
                className="border-border hover:bg-muted"
              >
                Войти
              </Button>
            )
          )}
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden p-2 text-foreground"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div
          className="md:hidden absolute top-full left-0 right-0 border-b border-border/50 py-4 animate-fade-in"
          style={{
            background: "linear-gradient(135deg, hsl(var(--card) / 0.98), hsl(var(--card) / 0.95))",
            backdropFilter: "blur(20px)",
          }}
        >
          <nav className="container mx-auto px-4 flex flex-col gap-4">
            {navItems.map((item) => (
              <button
                key={item.sectionId}
                onClick={() => scrollToSection(item.sectionId)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2 text-left"
              >
                {item.label}
              </button>
            ))}
            <div className="pt-2 border-t border-border/50">
              {!loading && (
                user ? (
                  <Button onClick={() => navigate("/dashboard")} className="w-full" variant="outline">
                    Личный кабинет
                  </Button>
                ) : (
                  <Button onClick={() => navigate("/auth")} className="w-full" variant="outline">
                    Войти
                  </Button>
                )
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
