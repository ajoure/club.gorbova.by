export function NativeFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="py-10 border-t border-border/60 bg-muted/20">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between text-sm text-muted-foreground">
          <p>© {year} Онлайн-курс «Центральный бухгалтер 2.0». Все права защищены.</p>
          <div className="flex gap-4">
            <a href="/privacy" className="hover:text-primary transition-colors">
              Политика конфиденциальности
            </a>
            <a href="/offer" className="hover:text-primary transition-colors">
              Договор-оферта
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
