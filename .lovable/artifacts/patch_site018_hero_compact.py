#!/usr/bin/env python3
"""Compact hero + pull back photo zoom for SITE-000018."""
import json, base64, urllib.request, re

BLOCKS = '/tmp/hero2/blocks.json'
data = json.load(open(BLOCKS))
code = data[0]['content']['code']
open('.lovable/artifacts/site018-hero-compact-before.html','w').write(code)

START = '<style id="hero-fullbleed-override">'
END = '</style>'
i = code.index(START)
j = code.index(END, i) + len(END)

NEW = '''<style id="hero-fullbleed-override">
    /* === Compact hero v3 (2026-06-23): tighter, photo zoomed-out (shoulder/hand), guarantees fit on first screen === */
    .ir-hero-v2 .ir-hero-v2__wrap { align-items: stretch !important; }
    .ir-hero-v2, .ir-hero-v2__wrap, .ir-hero-v2 .ir-hero-v2__visual { min-height: 560px !important; }

    /* Visual column */
    .ir-hero-v2 .ir-hero-v2__visual {
        position: relative !important;
        height: 100% !important;
        min-height: 560px;
        padding: 0 !important;
        background: linear-gradient(180deg, #0f1722 0%, #121d28 100%) !important;
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
        object-position: right top !important;
        display: block !important;
        filter: none !important;
        transform: translateZ(0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        image-rendering: auto;
    }
    .ir-hero-v2 .ir-hero-v2__visual::after {
        content: "";
        position: absolute;
        left: 0; right: 0; bottom: 0;
        height: 14%;
        background: linear-gradient(to top, #121d28 0%, rgba(18,29,40,0) 100%);
        pointer-events: none;
        z-index: 1;
    }

    /* Tighten text column */
    .ir-hero-v2 .ir-hero-v2__title { font-size: clamp(34px, 4.2vw, 56px) !important; margin: 18px 0 14px !important; line-height: .98 !important; }
    .ir-hero-v2 .ir-hero-v2__content { padding: 14px 30px 20px 24px !important; }
    .ir-hero-v2 .ir-hero-v2__text { margin: 0 0 14px !important; font-size: 15px !important; line-height: 1.45 !important; }
    .ir-hero-v2 .ir-hero-v2__checks { gap: 10px !important; margin-bottom: 16px !important; }
    .ir-hero-v2 .ir-hero-v2__actions { margin-top: 12px !important; }
    .ir-hero-v2 .ir-hero-v2__badge { margin-bottom: 10px !important; }

    /* Guarantees strip — BASE styles (must stay here, this <style> is SOT for the strip) */
    .ir-guarantees-strip {
        background: #0f172a;
        padding: 1rem 1.25rem 1.25rem;
    }
    .ir-guarantees-strip__wrap {
        max-width: 1200px;
        margin: 0 auto;
        background: rgba(15,23,42,0.6);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 18px;
        padding: 1rem 1.5rem;
    }
    .ir-guarantees-strip__label {
        color: #38BDF8;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        margin-bottom: 0.7rem;
    }
    .ir-guarantees-strip__grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1.1rem;
    }
    .ir-guarantees-strip__item { display: flex; align-items: flex-start; gap: 0.85rem; }
    .ir-guarantees-strip__icon {
        flex-shrink: 0;
        width: 38px; height: 38px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(56,189,248,0.12);
        color: #38BDF8;
        border-radius: 10px;
        font-size: 1rem;
    }
    .ir-guarantees-strip__body h3 { color: #fff; font-weight: 700; font-size: 0.98rem; margin: 0 0 0.2rem; }
    .ir-guarantees-strip__body p { color: #94A3B8; font-size: 0.8rem; line-height: 1.4; margin: 0; }
    .ir-guarantees-strip__stats {
        display: flex; justify-content: space-between; align-items: center;
        margin-top: 0.85rem; padding-top: 0.7rem;
        border-top: 1px solid rgba(255,255,255,0.06);
        font-size: 0.85rem; color: #94A3B8;
    }
    .ir-guarantees-strip__stats b { color: #38BDF8; font-weight: 700; }
    .ir-guarantees-strip__stats b i { margin-right: 0.4rem; }

    @media (max-width: 1024px) {
        .ir-hero-v2, .ir-hero-v2__wrap, .ir-hero-v2 .ir-hero-v2__visual { min-height: auto !important; }
        .ir-hero-v2 .ir-hero-v2__visual { min-height: 380px !important; }
        .ir-hero-v2 .ir-hero-v2__visual .ir-hero-v2__person {
            object-position: center 18% !important;
        }
        .ir-guarantees-strip__grid { grid-template-columns: 1fr; gap: 1rem; }
        .ir-guarantees-strip__wrap { padding: 1rem 1.1rem; border-radius: 16px; }
        .ir-guarantees-strip__stats { flex-direction: column; gap: 0.5rem; align-items: flex-start; }
    }
    </style>'''

new_code = code[:i] + NEW + code[j:]
data[0]['content']['code'] = new_code
open('.lovable/artifacts/site018-hero-compact-after.html','w').write(new_code)
print('old override len', j-i, '-> new', len(NEW))
print('total len', len(new_code))

# upload via apply-site-blocks-patch
payload = json.dumps(data).encode('utf-8')
b64 = base64.b64encode(payload).decode('ascii')
body = json.dumps({'page_id':'7e672fed-13f1-4ff1-8786-71a228a0c011','blocks_base64':b64}).encode('utf-8')
req = urllib.request.Request(
    'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/apply-site-blocks-patch',
    data=body,
    headers={
        'Content-Type':'application/json',
        'Authorization':'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E',
    },
    method='POST')
resp = urllib.request.urlopen(req).read()
print('apply resp:', resp.decode())
