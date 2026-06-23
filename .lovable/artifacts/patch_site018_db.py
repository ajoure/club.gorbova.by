#!/usr/bin/env python3
"""Patch site-000018 HTML: replace static #db cards and filterDatabase()
with a dynamic, escaped, RPC-backed implementation."""
import json, urllib.request, base64, sys, os

SUPA = 'https://hdjgkjceownmmnrqqtuz.supabase.co'
ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E'
PAGE_ID = '7e672fed-13f1-4ff1-8786-71a228a0c011'

SRC = open('.lovable/artifacts/site018-db-before.html').read()

# ---------- 1. Replace the static cards block ----------
old_cards_start = SRC.index('<h3 class="text-2xl sm:text-3xl font-extrabold text-white mb-8 text-center">Темы ближайших эфиров')
old_cards_end = SRC.index('</section>', old_cards_start)
# closing </section> is at end of #db block; we keep the </div> wrapping max-w-7xl, then </section>
# Find the </div>\n    </section> pattern
end_marker = '            </div>\n        </div>\n    </section>'
end_idx = SRC.index(end_marker, old_cards_start)

new_cards_block = '''<h3 class="text-2xl sm:text-3xl font-extrabold text-white mb-8 text-center">Ответы экспертов клуба</h3>

            <div id="dbStatus" class="text-center text-coolgray-300 mb-6">Загружаем вопросы...</div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" id="dbResults"></div>

            <div id="dbFallback" class="hidden text-center mt-8">
                <p class="text-coolgray-300 mb-4">Не удалось загрузить базу вопросов. Попробуйте обновить страницу или оставьте заявку.</p>
                <button onclick="openModal('access')" class="px-6 py-3 bg-burgundy-700 hover:bg-burgundy-600 rounded-xl font-bold transition shadow-lg">Участвовать</button>
            </div>
'''

SRC = SRC[:old_cards_start] + new_cards_block + SRC[end_idx:]

# ---------- 2. Replace filterDatabase() + setSearchFilter() ----------
old_js_start = SRC.index('// Live Database filtering & Search')
old_js_end = SRC.index('// Modal triggers')
new_js = '''// =========== KB DATABASE (public RPC, escaped render) ===========
        const KB_SUPA_URL = 'https://hdjgkjceownmmnrqqtuz.supabase.co';
        const KB_SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E';
        const KB_DEFAULT_LIMIT = 12;
        const KB_SEARCH_LIMIT = 30;
        const KB_SYNONYMS = {
            'налоги': ['налог','ндс','прибыл','усн','подоходн','упрощ','доначисл'],
            'проверки': ['проверк','камераль','аудит','налогов','контрол','инспекц'],
            'безопасность': ['обыск','безопас','изъят','допрос','экстрем','правоохран','следств'],
            'персонал': ['зарплат','оплата труда','работник','сотрудник','кадр','персонал','пенси','отпуск','трудов']
        };
        let KB_DATA = [];
        let KB_CURRENT_QUERY = '';

        function kbEscape(s) {
            if (s == null) return '';
            return String(s)
                .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        }
        function kbExpandQuery(q) {
            const norm = (q || '').toLowerCase().trim();
            if (!norm) return [];
            const syn = KB_SYNONYMS[norm];
            return syn ? syn : [norm];
        }
        function kbMatch(item, terms) {
            if (!terms.length) return true;
            const hay = (
                (item.title || '') + ' ' +
                (item.full_question || '') + ' ' +
                ((item.tags || []).join(' '))
            ).toLowerCase();
            return terms.some(t => hay.includes(t));
        }
        function kbFormatDate(d) {
            if (!d) return '';
            try {
                const dt = new Date(d);
                return dt.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
            } catch(e){ return ''; }
        }
        function kbRender() {
            const container = document.getElementById('dbResults');
            const status = document.getElementById('dbStatus');
            if (!container) return;
            const terms = kbExpandQuery(KB_CURRENT_QUERY);
            const filtered = KB_DATA.filter(it => kbMatch(it, terms));
            const limit = KB_CURRENT_QUERY ? KB_SEARCH_LIMIT : KB_DEFAULT_LIMIT;
            const shown = filtered.slice(0, limit);
            if (!filtered.length) {
                container.innerHTML = '';
                status.innerHTML = '<span class="text-coolgray-300">Ничего не нашли по запросу «'+kbEscape(KB_CURRENT_QUERY)+'». Попробуйте другое ключевое слово или <button onclick="openModal(\\'access\\')" class="underline text-skyaccent-400 font-bold">оставьте заявку</button>.</span>';
                return;
            }
            if (filtered.length > limit) {
                status.innerHTML = 'Показано '+shown.length+' из '+filtered.length+'. Уточните запрос, чтобы сузить результат.';
            } else {
                status.innerHTML = (KB_CURRENT_QUERY ? 'Найдено ' : 'Доступно ')+filtered.length+' '+
                    (KB_CURRENT_QUERY ? 'ответ(ов).' : 'ответов в базе клуба.');
            }
            container.innerHTML = shown.map(item => {
                const title = kbEscape(item.title || 'Без заголовка');
                const full = kbEscape(item.full_question || '');
                const ep = item.episode_number ? ('Выпуск '+kbEscape(item.episode_number)) : '';
                const qn = item.question_number ? ('Вопрос '+kbEscape(item.question_number)) : '';
                const date = kbFormatDate(item.answer_date);
                const meta = [ep, qn, date].filter(Boolean).join(' · ');
                const tagsArr = (item.tags || []).slice(0,3).map(t => '<span class="text-xxs font-bold uppercase tracking-widest text-skyaccent-400 bg-skyaccent-900/40 px-2 py-1 rounded mr-1">'+kbEscape(t)+'</span>').join('');
                const fullBlock = full ? '<div class="kb-full hidden mt-3 text-xs text-coolgray-300 whitespace-pre-line border-l-2 border-skyaccent-500 pl-3">'+full+'</div>' : '';
                const toggleBtn = full ? '<button type="button" onclick="kbToggle(this)" class="text-xs font-bold text-coolgray-300 hover:text-skyaccent-400 transition">Показать полный вопрос <i class="fa-solid fa-chevron-down ml-1"></i></button>' : '<span></span>';
                return '<div class="db-card bg-coolgray-800 border border-coolgray-700 rounded-2xl p-6 hover:border-skyaccent-500 transition-all duration-300 relative group overflow-hidden">'+
                    (tagsArr || '')+
                    '<h4 class="text-base font-bold mt-3 text-white">'+title+'</h4>'+
                    (meta ? '<p class="text-xs text-coolgray-400 mt-2">'+kbEscape(meta)+'</p>' : '')+
                    fullBlock+
                    '<div class="mt-4 pt-4 border-t border-coolgray-700 flex justify-between items-center gap-3">'+
                        toggleBtn+
                        '<button onclick="openModal(\\'access\\')" class="text-xs font-bold text-skyaccent-400 group-hover:text-white transition whitespace-nowrap">Участвовать <i class="fa-solid fa-chevron-right ml-1"></i></button>'+
                    '</div>'+
                '</div>';
            }).join('');
        }
        function kbToggle(btn) {
            const block = btn.closest('.db-card').querySelector('.kb-full');
            if (!block) return;
            const hidden = block.classList.toggle('hidden');
            btn.innerHTML = (hidden ? 'Показать полный вопрос <i class="fa-solid fa-chevron-down ml-1"></i>' : 'Свернуть <i class="fa-solid fa-chevron-up ml-1"></i>');
        }
        async function kbLoad() {
            const status = document.getElementById('dbStatus');
            const fallback = document.getElementById('dbFallback');
            try {
                const res = await fetch(KB_SUPA_URL+'/rest/v1/rpc/get_kb_questions_public', {
                    method:'POST',
                    headers: {
                        'apikey': KB_SUPA_ANON,
                        'Authorization':'Bearer '+KB_SUPA_ANON,
                        'Content-Type':'application/json'
                    },
                    body: '{}'
                });
                if (!res.ok) throw new Error('HTTP '+res.status);
                KB_DATA = await res.json();
                kbRender();
            } catch (e) {
                if (status) status.textContent = '';
                if (fallback) fallback.classList.remove('hidden');
                console.error('KB load failed', e);
            }
        }
        function filterDatabase() {
            const input = document.getElementById('dbSearch');
            KB_CURRENT_QUERY = (input ? input.value : '').trim();
            kbRender();
        }
        function setSearchFilter(tag) {
            const searchBar = document.getElementById('dbSearch');
            if (!searchBar) return;
            searchBar.value = tag;
            filterDatabase();
            searchBar.scrollIntoView({ behavior:'smooth', block:'center' });
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', kbLoad);
        } else { kbLoad(); }

        '''
SRC = SRC[:old_js_start] + new_js + SRC[old_js_end:]

open('.lovable/artifacts/site018-db-after.html','w').write(SRC)
print('after len', len(SRC))

# ---------- 3. Upload back to DB ----------
# Use psql via env? Use REST PATCH with apikey? Need service role; use PG via psql.
import subprocess
# Build minimal JSON blocks: keep type=html, content.code = SRC. Need full blocks structure.
r = urllib.request.Request(f'{SUPA}/rest/v1/site_pages?id=eq.{PAGE_ID}&select=blocks',
                           headers={'apikey':ANON,'Authorization':'Bearer '+ANON})
blocks = json.loads(urllib.request.urlopen(r).read())[0]['blocks']
blocks[0]['content']['code'] = SRC
new_blocks_json = json.dumps(blocks, ensure_ascii=False)
print('new blocks json size', len(new_blocks_json))

# Write to temp file and update via psql to avoid arg-too-long
tmp = '/tmp/site018_blocks.json'
open(tmp,'w').write(new_blocks_json)

sql = f"UPDATE public.site_pages SET blocks = pg_read_file('{tmp}')::jsonb, updated_at = now() WHERE id = '{PAGE_ID}';"
# pg_read_file may be restricted. Use \set + psql variable.
script = f"""
\\set content `cat {tmp}`
UPDATE public.site_pages SET blocks = :'content'::jsonb, updated_at = now() WHERE id = '{PAGE_ID}';
SELECT length((blocks->0->'content'->>'code')) AS html_len FROM public.site_pages WHERE id='{PAGE_ID}';
"""
res = subprocess.run(['psql','-v','ON_ERROR_STOP=1'], input=script, capture_output=True, text=True)
print('STDOUT', res.stdout)
print('STDERR', res.stderr)
sys.exit(res.returncode)
