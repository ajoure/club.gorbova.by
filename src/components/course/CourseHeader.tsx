import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { Menu, X } from "lucide-react";
import logoImage from "@/assets/logo.png";

const NAV_SECTIONS = [
  { id: "audience", label: "Для кого" },
  { id: "program", label: "Программа" },
  { id: "expert", label: "Эксперт" },
  { id: "results", label: "Результат" },
  { id: "pricing", label: "Тарифы" },
];

export function CourseHeader() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);

  // Check for impersonation mode
  useEffect(() => {
    const checkImpersonation = () => {
      setIsImpersonating(document.body.classList.contains("impersonation-active"));
    };
    
    checkImpersonation();
    
    const observer = new MutationObserver(checkImpersonation);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    
    return () => observer.disconnect();
  }, []);

  // Animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Track scroll position and active section
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);

      const sections = NAV_SECTIONS.map(s => ({
        id: s.id,
        element: document.getElementById(s.id),
      })).filter(s => s.element);

      const scrollPosition = window.scrollY + 150;

      for (let i = sections.length - 1; i >= 0; i--) {
        const section = sections[i];
        if (section.element && section.element.offsetTop <= scrollPosition) {
          setActiveSection(section.id);
          return;
        }
      }
      setActiveSection(null);
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleLoginClick = () => {
    const returnUrl = window.location.pathname + window.location.search;
    navigate(`/auth?redirectTo=${encodeURIComponent(returnUrl)}`);
  };

  const handleDashboardClick = () => {
    navigate("/dashboard");
  };

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
        isScrolled
          ? "py-3 border-b border-border/50"
          : "py-4"
      } ${
        isVisible
          ? "opacity-100 translate-y-0"
          : "opacity-0 -translate-y-4"
      }`}
      style={{
        top: isImpersonating ? "44px" : "0",
        background: isScrolled
          ? "linear-gradient(135deg, hsl(var(--card) / 0.95), hsl(var(--card) / 0.85))"
          : "transparent",
        backdropFilter: isScrolled ? "blur(20px)" : "none",
      }}
    >
      <div className="container mx-auto px-4 flex items-center justify-between">
        {/* Logo links to main club site */}
        <a 
          href="https://club.gorbova.by" 
          className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
        >
          <img src={logoImage} alt="Буква Закона" className="h-10 w-auto" />
          <div className="hidden sm:block">
            <span className="text-lg font-bold text-foreground">БУКВА ЗАКОНА</span>
            <span className="block text-xs text-muted-foreground">Клуб по законодательству</span>
          </div>
        </a>

        {/* Desktop Navigation - internal sections */}
        <nav className="hidden md:flex items-center gap-6">
          {NAV_SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => scrollToSection(section.id)}
              className={`text-sm transition-colors relative ${
                activeSection === section.id
                  ? "text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {section.label}
              {activeSection === section.id && (
                <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-primary rounded-full animate-scale-in" />
              )}
            </button>
          ))}
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
            {NAV_SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                className={`text-sm transition-colors py-2 text-left ${
                  activeSection === section.id
                    ? "text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {section.label}
              </button>
            ))}
            <div className="pt-2 border-t border-border/50">
              {!loading && (
                user ? (
                  <Button onClick={handleDashboardClick} className="w-full">
                    Открыть кабинет
                  </Button>
                ) : (
                  <Button onClick={handleLoginClick} className="w-full">
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
