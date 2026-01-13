import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { Menu, X } from "lucide-react";
import logoImage from "@/assets/logo.png";

const NAV_SECTIONS = [
  { id: "benefits", label: "Преимущества" },
  { id: "content", label: "Наполнение" },
  { id: "pricing", label: "Тарифы" },
  { id: "faq", label: "FAQ" },
];

export function LandingHeader() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);

  const isHomePage = location.pathname === "/";

  // Check for impersonation mode
  useEffect(() => {
    const checkImpersonation = () => {
      setIsImpersonating(document.body.classList.contains("impersonation-active"));
    };
    
    checkImpersonation();
    
    // Observe body class changes
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

      // Track active section only on homepage
      if (isHomePage) {
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
      }
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll(); // Initial check
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isHomePage]);

  // Handle scrolling to anchor after navigation
  useEffect(() => {
    if (isHomePage && location.hash) {
      const element = document.querySelector(location.hash);
      if (element) {
        setTimeout(() => {
          element.scrollIntoView({ behavior: "smooth" });
        }, 100);
      }
    }
  }, [isHomePage, location.hash]);

  const handleLoginClick = () => {
    console.log("[Analytics] click_login");
    const returnUrl = window.location.pathname + window.location.search;
    navigate(`/auth?redirectTo=${encodeURIComponent(returnUrl)}`);
  };

  const handleDashboardClick = () => {
    navigate("/dashboard");
  };

  const handleAnchorClick = (e: React.MouseEvent<HTMLAnchorElement>, anchor: string) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    
    if (isHomePage) {
      const element = document.querySelector(anchor);
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      navigate("/" + anchor);
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
        <Link 
          to="/" 
          className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
        >
          <img src={logoImage} alt="Буква Закона" className="h-10 w-auto" />
          <div className="hidden sm:block">
            <span className="text-lg font-bold text-foreground">БУКВА ЗАКОНА</span>
            <span className="block text-xs text-muted-foreground">Клуб по законодательству</span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          {NAV_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={(e) => handleAnchorClick(e, `#${section.id}`)}
              className={`text-sm transition-colors relative ${
                activeSection === section.id && isHomePage
                  ? "text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {section.label}
              {activeSection === section.id && isHomePage && (
                <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-primary rounded-full animate-scale-in" />
              )}
            </a>
          ))}
          <Link 
            to="/contacts"
            className={`text-sm transition-colors ${
              location.pathname === "/contacts"
                ? "text-primary font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Контакты
          </Link>
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
          className="md:hidden absolute top-full left-0 right-0 border-b border-border/50 py-4 animate-fade-in"
          style={{
            background: "linear-gradient(135deg, hsl(var(--card) / 0.98), hsl(var(--card) / 0.95))",
            backdropFilter: "blur(20px)",
          }}
        >
          <nav className="container mx-auto px-4 flex flex-col gap-4">
            {NAV_SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className={`text-sm transition-colors py-2 ${
                  activeSection === section.id && isHomePage
                    ? "text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={(e) => handleAnchorClick(e, `#${section.id}`)}
              >
                {section.label}
              </a>
            ))}
            <Link
              to="/contacts"
              className={`text-sm transition-colors py-2 ${
                location.pathname === "/contacts"
                  ? "text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMobileMenuOpen(false)}
            >
              Контакты
            </Link>
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
