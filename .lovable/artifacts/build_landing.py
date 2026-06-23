#!/usr/bin/env python3
"""Замена header и footer лендинга «ИдеоБизнес» на брендинг «Буква закона»."""
import re, sys, pathlib

SRC = pathlib.Path('.lovable/artifacts/site-018-landing-before.html')
DST = pathlib.Path('.lovable/artifacts/site-018-landing-after.html')

html = SRC.read_text(encoding='utf-8')

NAV_ITEMS = [
    ('paths', '3 пути'),
    ('benefits', 'Выгоды'),
    ('what-we-do', 'Что делаем'),
    ('roles', 'Для кого'),
    ('db', 'База знаний'),
    ('timeline', 'Как начать'),
    ('payment', 'Оплата'),
]

def nav_links(extra_class=''):
    return '\n'.join(
        f'<a href="#{aid}" onclick="return scrollToSection(\'{aid}\');" '
        f'class="bz-nav-link {extra_class}">{label}</a>'
        for aid, label in NAV_ITEMS
    )

NEW_HEADER = f'''    <!-- lovable-bz-header-v1 -->
    <header class="sticky top-0 z-40 bz-header transition-all duration-300">
      <style>
        .bz-header{{background:#1a0a0e;border-bottom:1px solid rgba(255,255,255,0.08);color:#f4ecec;}}
        .bz-brand{{display:flex;align-items:center;gap:12px;user-select:none;cursor:default;}}
        .bz-brand-mark{{width:44px;height:44px;border-radius:12px;background:#7a1f2b;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:16px;letter-spacing:.02em;box-shadow:0 4px 12px rgba(122,31,43,.4);}}
        .bz-brand-text{{display:flex;flex-direction:column;line-height:1.15;}}
        .bz-brand-title{{font-size:18px;font-weight:800;letter-spacing:.04em;color:#f4ecec;}}
        .bz-brand-sub{{font-size:12px;color:#b8a3a8;}}
        .bz-nav{{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}}
        .bz-nav-link{{padding:8px 12px;border-radius:10px;color:#cdb9bd;text-decoration:none;font-size:14px;font-weight:600;white-space:nowrap;transition:background .15s,color .15s;}}
        .bz-nav-link:hover{{background:rgba(255,255,255,0.06);color:#fff;}}
        .bz-cta-primary{{display:inline-flex;align-items:center;justify-content:center;padding:11px 18px;border-radius:10px;background:#7a1f2b;color:#fff;font-weight:700;font-size:14px;text-decoration:none;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(122,31,43,.35);transition:background .15s,transform .15s;line-height:1.2;}}
        .bz-cta-primary:hover{{background:#9a2a3a;}}
        .bz-cta-secondary{{display:inline-flex;align-items:center;justify-content:center;padding:9px 14px;border-radius:10px;background:transparent;color:#f4ecec;font-weight:600;font-size:13px;text-decoration:none;border:1px solid rgba(255,255,255,0.18);transition:background .15s,border-color .15s;line-height:1.2;}}
        .bz-cta-secondary:hover{{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.3);}}
        .bz-header-row{{display:flex;align-items:center;justify-content:space-between;gap:18px;min-h:72px;padding:14px 0;flex-wrap:wrap;}}
        .bz-actions{{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}}
        @media (max-width:1024px){{
          .bz-nav{{order:3;width:100%;overflow-x:auto;flex-wrap:nowrap;padding-bottom:4px;-webkit-overflow-scrolling:touch;}}
          .bz-nav::-webkit-scrollbar{{display:none;}}
          .bz-nav{{scrollbar-width:none;}}
        }}
        @media (max-width:640px){{
          .bz-brand-mark{{width:38px;height:38px;font-size:14px;}}
          .bz-brand-title{{font-size:15px;}}
          .bz-brand-sub{{font-size:11px;}}
          .bz-cta-primary{{padding:9px 12px;font-size:12px;}}
          .bz-cta-secondary{{padding:8px 10px;font-size:12px;}}
        }}
      </style>
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="bz-header-row">
          <div class="bz-brand" aria-label="Буква закона — Клуб по законодательству">
            <div class="bz-brand-mark">БЗ</div>
            <div class="bz-brand-text">
              <span class="bz-brand-title">БУКВА ЗАКОНА</span>
              <span class="bz-brand-sub">Клуб по законодательству</span>
            </div>
          </div>
          <nav class="bz-nav" aria-label="Навигация по разделам">
{nav_links()}
          </nav>
          <div class="bz-actions">
            <button type="button" onclick="openModal('setup')" class="bz-cta-primary">Настроить идеологическую работу</button>
            <a href="https://gorbova.by/auth" class="bz-cta-secondary">Войти в личный кабинет</a>
          </div>
        </div>
      </div>
    </header>
    <!-- /lovable-bz-header-v1 -->'''

NEW_FOOTER = f'''    <!-- lovable-bz-footer-v1 -->
    <footer class="bz-footer">
      <style>
        .bz-footer{{background:#0e0608;color:#cdb9bd;padding:48px 0 24px;border-top:1px solid rgba(255,255,255,0.06);font-size:14px;}}
        .bz-footer a{{color:#cdb9bd;text-decoration:none;transition:color .15s;}}
        .bz-footer a:hover{{color:#fff;text-decoration:underline;}}
        .bz-foot-grid{{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:40px;}}
        @media (max-width:900px){{.bz-foot-grid{{grid-template-columns:1fr;gap:28px;}}}}
        .bz-foot-h{{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#f4ecec;margin-bottom:14px;}}
        .bz-foot-list{{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;font-size:14px;}}
        .bz-req{{font-size:13px;line-height:1.6;color:#a89094;}}
        .bz-req strong{{color:#f4ecec;font-weight:700;}}
        .bz-pay{{display:flex;flex-wrap:wrap;align-items:center;gap:18px;margin-top:28px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.06);opacity:.85;}}
        .bz-pay img{{height:22px;width:auto;display:block;}}
        .bz-copy{{margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;font-size:12px;color:#8a7479;}}
        .bz-foot-brand{{display:flex;align-items:center;gap:10px;margin-bottom:18px;user-select:none;cursor:default;}}
        .bz-foot-brand .bz-brand-mark{{width:34px;height:34px;font-size:13px;}}
        .bz-foot-brand .bz-brand-title{{font-size:15px;}}
        .bz-foot-brand .bz-brand-sub{{font-size:11px;}}
      </style>
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="bz-foot-grid">
          <div>
            <div class="bz-foot-brand" aria-label="Буква закона — Клуб по законодательству">
              <div class="bz-brand-mark">БЗ</div>
              <div class="bz-brand-text">
                <span class="bz-brand-title">БУКВА ЗАКОНА</span>
                <span class="bz-brand-sub">Клуб по законодательству</span>
              </div>
            </div>
            <div class="bz-req">
              <strong>ЗАО «АЖУР инкам»</strong><br>
              УНП: 193405000<br>
              Юр. адрес: 220035, г. Минск, ул. Панфилова, 2, офис 49Л<br>
              Почтовый адрес: 220052, Республика Беларусь, г. Минск, а/я 63<br>
              Телефон: +375 29 171-43-21<br>
              E-mail: info@ajoure.by<br>
              Режим работы: Пн–Пт 9:00–18:00 (Минск)
            </div>
          </div>
          <div>
            <div class="bz-foot-h">Навигация</div>
            <ul class="bz-foot-list">
              <li><a href="#paths" onclick="return scrollToSection('paths');">3 пути</a></li>
              <li><a href="#benefits" onclick="return scrollToSection('benefits');">Выгоды</a></li>
              <li><a href="#what-we-do" onclick="return scrollToSection('what-we-do');">Что делаем</a></li>
              <li><a href="#roles" onclick="return scrollToSection('roles');">Для кого</a></li>
              <li><a href="#db" onclick="return scrollToSection('db');">База знаний</a></li>
              <li><a href="#timeline" onclick="return scrollToSection('timeline');">Как начать</a></li>
              <li><a href="#payment" onclick="return scrollToSection('payment');">Оплата</a></li>
            </ul>
          </div>
          <div>
            <div class="bz-foot-h">Документы</div>
            <ul class="bz-foot-list">
              <li><a href="https://gorbova.by/oferta" target="_blank" rel="noopener">Публичная оферта</a></li>
              <li><a href="https://gorbova.by/order-payment" target="_blank" rel="noopener">Заказ и оплата услуг</a></li>
              <li><a href="https://gorbova.by/privacy" target="_blank" rel="noopener">Политика конфиденциальности</a></li>
              <li><a href="https://gorbova.by/consent" target="_blank" rel="noopener">Согласие на обработку данных</a></li>
              <li><a href="https://gorbova.by/expense-instruction" target="_blank" rel="noopener">Инструкция по оформлению расходов</a></li>
            </ul>
          </div>
        </div>
        <div class="bz-pay" aria-label="Способы оплаты">
          <img src="https://gorbova.by/assets/pay/visa.svg" alt="Visa" onerror="this.style.display='none'">
          <img src="https://gorbova.by/assets/pay/mastercard.svg" alt="Mastercard" onerror="this.style.display='none'">
          <img src="https://gorbova.by/assets/pay/belkart.svg" alt="Белкарт" onerror="this.style.display='none'">
          <img src="https://gorbova.by/assets/pay/bepaid.svg" alt="bePaid" onerror="this.style.display='none'">
          <img src="https://gorbova.by/assets/pay/samsungpay.svg" alt="Samsung Pay" onerror="this.style.display='none'">
          <img src="https://gorbova.by/assets/pay/gpay.svg" alt="Google Pay" onerror="this.style.display='none'">
          <img src="https://gorbova.by/assets/pay/erip.svg" alt="ЕРИП" onerror="this.style.display='none'">
        </div>
        <div class="bz-copy">© 2026 ЗАО «АЖУР инкам». Все права защищены.</div>
      </div>
    </footer>
    <!-- /lovable-bz-footer-v1 -->'''

# Idempotency: если маркер уже есть — пересобираем поверх (вырезаем старые наши секции)
html = re.sub(r'<!-- lovable-bz-header-v1 -->.*?<!-- /lovable-bz-header-v1 -->', '', html, flags=re.S)
html = re.sub(r'<!-- lovable-bz-footer-v1 -->.*?<!-- /lovable-bz-footer-v1 -->', '', html, flags=re.S)

# Replace <header>...</header> (первое вхождение)
new_html, n_h = re.subn(r'    <header class="sticky top-0 z-40 bg-white.*?</header>', NEW_HEADER, html, count=1, flags=re.S)
assert n_h == 1, f"header replace failed: {n_h}"

# Replace <footer>...</footer>
new_html, n_f = re.subn(r'    <footer class="bg-coolgray-900 text-coolgray-400.*?</footer>', NEW_FOOTER, new_html, count=1, flags=re.S)
assert n_f == 1, f"footer replace failed: {n_f}"

DST.write_text(new_html, encoding='utf-8')
print(f"OK header={n_h} footer={n_f} size_before={len(html)} size_after={len(new_html)}")
