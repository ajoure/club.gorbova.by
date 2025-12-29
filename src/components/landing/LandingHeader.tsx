import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { Menu, X } from "lucide-react";
import logoImage from "@/assets/logo.png";

export function LandingHeader() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleLoginClick = () => {
    console.log("[Analytics] click_login");
    navigate("/auth");
  };

  const handleDashboardClick = () => {
    navigate("/dashboard");
  };

  const handleLogoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "py-3 border-b border-border/50"
          : "py-4"
      }`}
      style={{
        background: isScrolled
          ? "linear-gradient(135deg, hsl(var(--card) / 0.95), hsl(var(--card) / 0.85))"
          : "transparent",
        backdropFilter: isScrolled ? "blur(20px)" : "none",
      }}
    >
      <div className="container mx-auto px-4 flex items-center justify-between">
        <a 
          href="#" 
          onClick={handleLogoClick} 
          className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
        >
          <img src={logoImage} alt="Буква Закона" className="h-10 w-auto" />
          <div className="hidden sm:block">
            <span className="text-lg font-bold text-foreground">БУКВА ЗАКОНА</span>
            <span className="block text-xs text-muted-foreground">Клуб по законодательству</span>
          </div>
        </a>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          <a href="#benefits" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Преимущества
          </a>
          <a href="#content" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Наполнение
          </a>
          <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Тарифы
          </a>
          <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            FAQ
          </a>
        </nav>

        {/* Auth Buttons */}
        <div className="hidden md:flex items-center gap-3">
          {!loading && (
            user ? (
              <Button onClick={handleDashboardClick}>
                Открыть кабинет
              </Button>
            ) : (
              <Button onClick={handleLoginClick}>
                Войти в личный кабинет
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
          className="md:hidden absolute top-full left-0 right-0 border-b border-border/50 py-4"
          style={{
            background: "linear-gradient(135deg, hsl(var(--card) / 0.98), hsl(var(--card) / 0.95))",
            backdropFilter: "blur(20px)",
          }}
        >
          <nav className="container mx-auto px-4 flex flex-col gap-4">
            <a
              href="#benefits"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Преимущества
            </a>
            <a
              href="#content"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Наполнение
            </a>
            <a
              href="#pricing"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Тарифы
            </a>
            <a
              href="#faq"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              FAQ
            </a>
            <div className="pt-2 border-t border-border/50">
              {!loading && (
                user ? (
                  <Button onClick={handleDashboardClick} className="w-full">
                    Открыть кабинет
                  </Button>
                ) : (
                  <Button onClick={handleLoginClick} className="w-full">
                    Войти в личный кабинет
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
