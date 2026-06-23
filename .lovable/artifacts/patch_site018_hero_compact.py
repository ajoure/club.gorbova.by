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
    /* === Compact hero v3 (2026-06-23): show shoulder/hand, fit guarantees on first screen === */
    .ir-hero-v2 .ir-hero-v2__wrap { align-items: stretch !important; }
    .ir-hero-v2, .ir-hero-v2__wrap, .ir-hero-v2 .ir-hero-v2__visual { min-height: 560px !important; }

    /* Visual column: full-bleed container, photo aligned right-bottom and contained (no upscale blur) */
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

    /* Tighten text column to make room for guarantees on the first screen */
    .ir-hero-v2 .ir-hero-v2__title { font-size: clamp(34px, 4.2vw, 56px) !important; margin: 18px 0 14px !important; line-height: .98 !important; }
    .ir-hero-v2 .ir-hero-v2__content { padding: 14px 30px 20px 24px !important; }
    .ir-hero-v2 .ir-hero-v2__text { margin: 0 0 14px !important; font-size: 15px !important; line-height: 1.45 !important; }
    .ir-hero-v2 .ir-hero-v2__checks { gap: 10px !important; margin-bottom: 16px !important; }
    .ir-hero-v2 .ir-hero-v2__actions { margin-top: 12px !important; }
    .ir-hero-v2 .ir-hero-v2__badge { margin-bottom: 10px !important; }

    /* Compact guarantees strip below hero */
    .ir-guarantees-strip { padding: 0.85rem 1.25rem 1.1rem !important; }
    .ir-guarantees-strip__wrap { padding: 1rem 1.5rem !important; border-radius: 18px !important; }
    .ir-guarantees-strip__label { margin-bottom: 0.7rem !important; }
    .ir-guarantees-strip__grid { gap: 1.1rem !important; }
    .ir-guarantees-strip__body h3 { font-size: 0.98rem !important; margin-bottom: 0.2rem !important; }
    .ir-guarantees-strip__body p { font-size: 0.8rem !important; line-height: 1.4 !important; }
    .ir-guarantees-strip__stats { margin-top: 0.85rem !important; padding-top: 0.7rem !important; }
    .ir-guarantees-strip__icon { width: 38px !important; height: 38px !important; font-size: 1rem !important; }

    @media (max-width: 1024px) {
        .ir-hero-v2, .ir-hero-v2__wrap, .ir-hero-v2 .ir-hero-v2__visual { min-height: auto !important; }
        .ir-hero-v2 .ir-hero-v2__visual { min-height: 380px !important; }
        .ir-hero-v2 .ir-hero-v2__visual .ir-hero-v2__person {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            object-position: center 20% !important;
        }
        .ir-guarantees-strip__grid { grid-template-columns: 1fr !important; gap: 1rem !important; }
        .ir-guarantees-strip__wrap { padding: 1rem 1.1rem !important; border-radius: 16px !important; }
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
