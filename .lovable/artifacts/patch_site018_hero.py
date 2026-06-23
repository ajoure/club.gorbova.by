#!/usr/bin/env python3
"""Patch site-000018 hero (v2): keep inline person img, surgically remove
ir-hero-v2__card subtree from visual, add guarantees strip, append override CSS."""
import json, re

BLOCKS_JSON = '/tmp/hero/blocks.json'
OUT_BEFORE = '.lovable/artifacts/site018-hero-before.html'
OUT_AFTER  = '.lovable/artifacts/site018-hero-after.html'

data = json.load(open(BLOCKS_JSON))
blocks = data[0]['blocks']
HTML = blocks[0]['content']['code']
open(OUT_BEFORE,'w').write(HTML)
print('before len', len(HTML))

# --- locate the card and its matching closing </div> ---
CARD_OPEN = '<div class="ir-hero-v2__card">'
card_start = HTML.index(CARD_OPEN)
# Walk DIVs to find matching close
i = card_start + len(CARD_OPEN)
depth = 1
n = len(HTML)
open_re = re.compile(r'<div\b[^>]*>', re.IGNORECASE)
close_re = re.compile(r'</div\s*>', re.IGNORECASE)
while i < n and depth > 0:
    om = open_re.search(HTML, i)
    cm = close_re.search(HTML, i)
    if not cm:
        raise SystemExit('no matching </div> for card')
    if om and om.start() < cm.start():
        depth += 1
        i = om.end()
    else:
        depth -= 1
        i = cm.end()
card_end = i
print('card span', card_start, '-', card_end, 'len', card_end - card_start)
print('card head sample:', HTML[card_start:card_start+120])
print('card tail sample:', HTML[card_end-120:card_end])

# Remove the card; also strip any whitespace right before it (newlines/indent) for cleanliness
left = HTML[:card_start].rstrip(' \t')
# Drop preceding empty line if any
left = re.sub(r'\n[ \t]*\n$', '\n', left)
HTML = left + HTML[card_end:]

# --- insert guarantees strip right after the hero </section> ---
HERO_OPEN_MARK = '<section class="ir-hero-v2">'
hero_open = HTML.index(HERO_OPEN_MARK)
# find closing </section> after hero open by depth tracking on <section>
sec_open = re.compile(r'<section\b[^>]*>', re.IGNORECASE)
sec_close = re.compile(r'</section\s*>', re.IGNORECASE)
i = hero_open + len(HERO_OPEN_MARK)
depth = 1
while i < len(HTML) and depth > 0:
    om = sec_open.search(HTML, i)
    cm = sec_close.search(HTML, i)
    if not cm:
        raise SystemExit('no closing </section> for hero')
    if om and om.start() < cm.start():
        depth += 1
        i = om.end()
    else:
        depth -= 1
        i = cm.end()
hero_close_end = i
print('hero ends at', hero_close_end)

GUARANTEES = '''

    <!-- GUARANTEES STRIP (moved out of hero card) -->
    <section class="ir-guarantees-strip">
        <div class="ir-guarantees-strip__wrap">
            <div class="ir-guarantees-strip__label">Гарантия безопасности</div>
            <div class="ir-guarantees-strip__grid">
                <div class="ir-guarantees-strip__item">
                    <div class="ir-guarantees-strip__icon"><i class="fa-solid fa-user-shield"></i></div>
                    <div class="ir-guarantees-strip__body">
                        <h3>Защита от проверок</h3>
                        <p>Эксперт с опытом 400+ проверок закроет все вопросы со стороны контролирующих органов.</p>
                    </div>
                </div>
                <div class="ir-guarantees-strip__item">
                    <div class="ir-guarantees-strip__icon"><i class="fa-solid fa-file-invoice-dollar"></i></div>
                    <div class="ir-guarantees-strip__body">
                        <h3>Законная экономия</h3>
                        <p>Перевод личных расходов в законные расходы компании без уплаты НДС и подоходного налога.</p>
                    </div>
                </div>
                <div class="ir-guarantees-strip__item">
                    <div class="ir-guarantees-strip__icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
                    <div class="ir-guarantees-strip__body">
                        <h3>Высвобождение времени</h3>
                        <p>Система сама рассылает обязательные материалы и собирает подтверждения сотрудников.</p>
                    </div>
                </div>
            </div>
            <div class="ir-guarantees-strip__stats">
                <span>Опыт лидера проекта:</span>
                <b><i class="fa-solid fa-circle-check"></i> 400+ проверок</b>
            </div>
        </div>
    </section>
'''

HTML = HTML[:hero_close_end] + GUARANTEES + HTML[hero_close_end:]

# --- append override CSS just before </head> ---
OVERRIDE_CSS = '''
    <style id="hero-fullbleed-override">
    /* Full-bleed photo: stretch visual to wrap height, full-cover person image */
    .ir-hero-v2 .ir-hero-v2__wrap { align-items: stretch !important; }
    .ir-hero-v2 .ir-hero-v2__visual {
        position: relative !important;
        height: 100% !important;
        min-height: 600px;
        padding: 0 !important;
        background: transparent !important;
        border: 0 !important;
        border-radius: 0 !important;
        overflow: hidden;
    }
    .ir-hero-v2 .ir-hero-v2__visual .ir-hero-v2__person {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        max-height: none !important;
        object-fit: cover !important;
        object-position: center top !important;
        display: block !important;
        filter: none !important;
        transform: none !important;
    }
    .ir-hero-v2 .ir-hero-v2__visual::after {
        content: "";
        position: absolute;
        left: 0; right: 0; bottom: 0;
        height: 28%;
        background: linear-gradient(to top, #121d28 0%, rgba(18,29,40,0) 100%);
        pointer-events: none;
        z-index: 1;
    }
    /* Guarantees strip */
    .ir-guarantees-strip {
        background: #0f172a;
        padding: 2.5rem 1.25rem 3rem;
    }
    .ir-guarantees-strip__wrap {
        max-width: 1200px;
        margin: 0 auto;
        background: rgba(15,23,42,0.6);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 24px;
        padding: 2rem 2.25rem;
    }
    .ir-guarantees-strip__label {
        color: #38BDF8;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        margin-bottom: 1.5rem;
    }
    .ir-guarantees-strip__grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 2rem;
    }
    .ir-guarantees-strip__item {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
    }
    .ir-guarantees-strip__icon {
        flex-shrink: 0;
        width: 44px; height: 44px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(56,189,248,0.12);
        color: #38BDF8;
        border-radius: 12px;
        font-size: 1.15rem;
    }
    .ir-guarantees-strip__body h3 {
        color: #fff;
        font-weight: 700;
        font-size: 1.05rem;
        margin: 0 0 0.35rem;
    }
    .ir-guarantees-strip__body p {
        color: #94A3B8;
        font-size: 0.875rem;
        line-height: 1.5;
        margin: 0;
    }
    .ir-guarantees-strip__stats {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 1.75rem;
        padding-top: 1.25rem;
        border-top: 1px solid rgba(255,255,255,0.06);
        font-size: 0.875rem;
        color: #94A3B8;
    }
    .ir-guarantees-strip__stats b { color: #38BDF8; font-weight: 700; }
    .ir-guarantees-strip__stats b i { margin-right: 0.4rem; }
    @media (max-width: 960px) {
        .ir-guarantees-strip__grid { grid-template-columns: 1fr; gap: 1.5rem; }
        .ir-guarantees-strip__wrap { padding: 1.5rem 1.25rem; border-radius: 18px; }
        .ir-guarantees-strip__stats { flex-direction: column; gap: 0.5rem; align-items: flex-start; }
        .ir-hero-v2 .ir-hero-v2__visual { min-height: 420px; }
    }
    </style>
'''

head_close = HTML.rindex('</head>')
HTML = HTML[:head_close] + OVERRIDE_CSS + HTML[head_close:]

open(OUT_AFTER,'w').write(HTML)
print('after len', len(HTML))

# sanity: DOM-level removal only (CSS rules with same selector OK)
assert '<div class="ir-hero-v2__card">' not in HTML, 'card DOM not removed'
assert 'ir-guarantees-strip__grid' in HTML, 'strip missing'
assert 'ir-hero-v2__person' in HTML, 'person img missing'
assert 'get_kb_questions_public' in HTML, 'kb RPC call missing'
print('sanity OK')

blocks[0]['content']['code'] = HTML
out_json = json.dumps(blocks, ensure_ascii=False)
open('/tmp/hero/blocks_new.json','w').write(out_json)
print('new blocks JSON size', len(out_json))
