UPDATE site_pages
SET blocks = jsonb_set(
  blocks,
  '{0,content,code}',
  to_jsonb(
    replace(
      replace(
        (blocks->0->'content'->>'code'),
        $_idlg_$            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div class="bg-coolgray-50 rounded-2xl border border-coolgray-200 p-8 shadow-sm hover:shadow-md transition flex flex-col">
                    <div class="w-14 h-14 rounded-xl bg-burgundy-50 text-burgundy-700 flex items-center justify-center text-2xl mb-6">
                        <i class="fa-solid fa-credit-card"></i>
                    </div>
                    <h3 class="text-2xl font-extrabold text-coolgray-900 mb-4">Корпоративной картой</h3>
                    <div class="space-y-4 flex-1">
                        <p class="text-xs font-extrabold uppercase tracking-widest text-skyaccent-600 mb-3">Плюсы:</p>
                        <ul class="space-y-3 text-sm text-coolgray-700 leading-relaxed">
                            <li class="flex items-start"><span class="text-skyaccent-500 mr-2">✔</span> Автоматическое списание без страха потерять функционал.</li>
                            <li class="flex items-start"><span class="text-skyaccent-500 mr-2">✔</span> Полный пакет закрывающих документов в личном кабинете для прозрачной бухгалтерии и лёгкого налогового учёта.</li>
                        </ul>
                    </div>
                    <button onclick="openModal('setup')" class="mt-8 w-full py-4 bg-burgundy-700 hover:bg-burgundy-600 text-white font-bold rounded-xl transition shadow-lg">
                        Оплатить картой
                    </button>
                </div>

                <div class="bg-coolgray-50 rounded-2xl border border-coolgray-200 p-8 shadow-sm hover:shadow-md transition flex flex-col">
                    <div class="w-14 h-14 rounded-xl bg-skyaccent-400/20 text-skyaccent-600 flex items-center justify-center text-2xl mb-6">
                        <i class="fa-solid fa-file-invoice"></i>
                    </div>
                    <h3 class="text-2xl font-extrabold text-coolgray-900 mb-4">По счёту</h3>
                    <div class="space-y-6 flex-1">
                        <div>
                            <p class="text-xs font-extrabold uppercase tracking-widest text-skyaccent-600 mb-3">Плюсы:</p>
                            <ul class="space-y-3 text-sm text-coolgray-700 leading-relaxed">
                                <li class="flex items-start"><span class="text-skyaccent-500 mr-2">✔</span> Автоматическая генерация генерального счёта на оплату по публичному договору.</li>
                                <li class="flex items-start"><span class="text-skyaccent-500 mr-2">✔</span> Оплата до 10 числа ежемесячно путём копирования платёжного поручения.</li>
                                <li class="flex items-start"><span class="text-skyaccent-500 mr-2">✔</span> Полный пакет закрывающих документов в личном кабинете для прозрачной бухгалтерии и лёгкого налогового учёта.</li>
                            </ul>
                        </div>
                        <div class="rounded-xl bg-burgundy-50 border border-burgundy-100 p-4">
                            <p class="text-xs font-extrabold uppercase tracking-widest text-burgundy-700 mb-2">Минусы:</p>
                            <p class="text-sm text-coolgray-800 leading-relaxed">Потеря функционала при просрочке платежа.</p>
                        </div>
                    </div>
                    <button onclick="openModal('setup')" class="mt-8 w-full py-4 bg-coolgray-900 hover:bg-coolgray-800 text-white font-bold rounded-xl transition shadow-lg">
                        Сгенерировать счёт
                    </button>
                </div>

                <div class="bg-burgundy-900 text-white rounded-2xl border-2 border-skyaccent-500 p-8 shadow-xl hover:shadow-2xl transition flex flex-col relative">
                    <div class="absolute -top-4 right-6 bg-skyaccent-500 text-white font-extrabold text-xs py-1 px-4 rounded-full uppercase tracking-widest shadow-md">
                        Премиум
                    </div>
                    <div class="w-14 h-14 rounded-xl bg-burgundy-800 text-skyaccent-400 flex items-center justify-center text-2xl mb-6">
                        <i class="fa-solid fa-gem"></i>
                    </div>
                    <h3 class="text-2xl font-extrabold text-white mb-4">Индивидуальный договор</h3>
                    <div class="space-y-4 flex-1">
                        <p class="text-xs font-extrabold uppercase tracking-widest text-skyaccent-400 mb-3">Плюсы:</p>
                        <ul class="space-y-3 text-sm text-coolgray-50 leading-relaxed">
                            <li class="flex items-start"><span class="text-skyaccent-400 mr-2">✔</span> Индивидуальный график оплаты.</li>
                            <li class="flex items-start"><span class="text-skyaccent-400 mr-2">✔</span> Расширенный функционал обслуживания.</li>
                            <li class="flex items-start"><span class="text-skyaccent-400 mr-2">✔</span> Уникальные темы мероприятий.</li>
                            <li class="flex items-start"><span class="text-skyaccent-400 mr-2">✔</span> Помощь эксперта с налоговым учётом.</li>
                            <li class="flex items-start"><span class="text-skyaccent-400 mr-2">✔</span> Сопровождение камеральных и выездных проверок и многое другое.</li>
                        </ul>
                    </div>
                    <button onclick="openModal('setup')" class="mt-8 w-full py-4 bg-white text-burgundy-900 font-extrabold rounded-xl transition shadow-lg hover:bg-coolgray-50">
                        Хочу премиальные условия
                    </button>
                </div>
            </div>$_idlg_$,
        $_idlg_$            <div id="ideolog-tariffs-root" class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div class="col-span-full text-center text-coolgray-600 py-12" id="ideolog-tariffs-loading">
                    <i class="fa-solid fa-spinner fa-spin text-3xl text-burgundy-700 mb-3"></i>
                    <p class="text-sm">Загружаем актуальные тарифы...</p>
                </div>
            </div>

            <script>
            (function() {
              var PRODUCT_ID = '3ea08f79-afe8-4361-81fe-4c0f318f9a2b';
              var API = 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/public-product?product_id=' + PRODUCT_ID;
              var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E';
              var PRESETS = [
                { icon: 'fa-credit-card', iconWrap: 'bg-burgundy-50 text-burgundy-700', card: 'bg-coolgray-50 border-coolgray-200', title: 'text-coolgray-900', text: 'text-coolgray-700', check: 'text-skyaccent-500', accent: 'text-skyaccent-600', btn: 'bg-burgundy-700 hover:bg-burgundy-600 text-white', badge: 'bg-burgundy-700 text-white' },
                { icon: 'fa-file-invoice', iconWrap: 'bg-skyaccent-400/20 text-skyaccent-600', card: 'bg-coolgray-50 border-coolgray-200', title: 'text-coolgray-900', text: 'text-coolgray-700', check: 'text-skyaccent-500', accent: 'text-skyaccent-600', btn: 'bg-coolgray-900 hover:bg-coolgray-800 text-white', badge: 'bg-coolgray-900 text-white' },
                { icon: 'fa-gem', iconWrap: 'bg-burgundy-800 text-skyaccent-400', card: 'bg-burgundy-900 border-2 border-skyaccent-500 text-white', title: 'text-white', text: 'text-coolgray-50', check: 'text-skyaccent-400', accent: 'text-skyaccent-400', btn: 'bg-white text-burgundy-900 hover:bg-coolgray-50', badge: 'bg-skyaccent-500 text-white' }
              ];
              function esc(s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; }
              function actionForOffer(o) { return o.offer_type === 'preregistration' ? 'open-preregistration' : 'open-offer'; }
              function priceLabel(o, t) {
                if (!o) return '';
                if (o.offer_type === 'preregistration') return 'По запросу';
                var a = Number(o.amount || 0);
                if (!a) return '';
                var per = t.period_label || 'BYN';
                return a.toLocaleString('ru-RU') + ' ' + per + (t.access_days ? ' / ' + t.access_days + ' дн.' : '');
              }
              function renderCard(t, idx) {
                var o = (t.offers || []).find(function(x){ return x.is_active !== false; });
                if (!o) return '';
                var p = PRESETS[idx] || PRESETS[PRESETS.length - 1];
                var feats = (t.features || []).filter(function(f){ return f && f.text; });
                var featsHtml = feats.map(function(f){ return '<li class="flex items-start"><span class="' + p.check + ' mr-2 mt-0.5">✔</span><span>' + esc(f.text) + '</span></li>'; }).join('');
                if (!featsHtml) featsHtml = '<li class="' + p.text + ' text-sm opacity-80">Индивидуальные условия обсуждаются лично.</li>';
                var badge = t.badge ? '<div class="absolute -top-4 right-6 ' + p.badge + ' font-extrabold text-xs py-1 px-4 rounded-full uppercase tracking-widest shadow-md">' + esc(t.badge) + '</div>' : '';
                var subt = t.subtitle ? '<p class="text-sm ' + p.text + ' opacity-80 mb-4">' + esc(t.subtitle) + '</p>' : '';
                var pl = priceLabel(o, t);
                var price = pl ? '<div class="mb-4"><span class="text-3xl font-black ' + p.title + '">' + esc(pl) + '</span></div>' : '';
                var attrs = 'data-lovable-action="' + actionForOffer(o) + '" data-offer-id="' + esc(o.id) + '" data-product-id="' + esc(PRODUCT_ID) + '"';
                return '<div class="' + p.card + ' rounded-2xl border p-8 shadow-sm hover:shadow-lg transition flex flex-col relative">'
                  + badge
                  + '<div class="w-14 h-14 rounded-xl ' + p.iconWrap + ' flex items-center justify-center text-2xl mb-6"><i class="fa-solid ' + p.icon + '"></i></div>'
                  + '<h3 class="text-2xl font-extrabold ' + p.title + ' mb-2">' + esc(t.name) + '</h3>'
                  + subt + price
                  + '<div class="space-y-4 flex-1"><p class="text-xs font-extrabold uppercase tracking-widest ' + p.accent + ' mb-3">Что входит:</p><ul class="space-y-3 text-sm ' + p.text + ' leading-relaxed">' + featsHtml + '</ul></div>'
                  + '<button ' + attrs + ' class="mt-8 w-full py-4 font-bold rounded-xl transition shadow-lg ' + p.btn + '">' + esc(o.button_label || 'Оформить') + '</button>'
                  + '</div>';
              }
              function render(data) {
                var root = document.getElementById('ideolog-tariffs-root');
                if (!root) return;
                var ts = (data && data.tariffs) || [];
                var payable = ts.filter(function(t){
                  var os = (t.offers || []).filter(function(o){ return o.is_active !== false; });
                  return os.some(function(o){ return o.offer_type === 'pay_now' || o.offer_type === 'preregistration'; });
                });
                payable.sort(function(a,b){ return (a.sort_order||0) - (b.sort_order||0); });
                if (!payable.length) { root.innerHTML = '<div class="col-span-full text-center text-coolgray-600 py-12"><p>Тарифы временно недоступны.</p></div>'; return; }
                root.innerHTML = payable.slice(0, 3).map(function(t, i){ return renderCard(t, i); }).join('');
              }
              function load() {
                fetch(API, { headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + ANON } })
                  .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                  .then(render)
                  .catch(function(e){
                    console.error('[ideolog-tariffs] load failed', e);
                    var root = document.getElementById('ideolog-tariffs-root');
                    if (root) root.innerHTML = '<div class="col-span-full text-center text-coolgray-600 py-12"><p>Не удалось загрузить тарифы. Обновите страницу.</p></div>';
                  });
              }
              if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
            })();
            </script>$_idlg_$
      ),
      $_idlg_$<button onclick="openModal('setup')" class="px-8 py-4 bg-white text-burgundy-900 font-extrabold rounded-xl shadow-lg hover:bg-coolgray-50 transition duration-300">
                    Настроить идеологическую работу
                </button>$_idlg_$,
      $_idlg_$<button onclick="scrollToSection('payment'); return false;" class="px-8 py-4 bg-white text-burgundy-900 font-extrabold rounded-xl shadow-lg hover:bg-coolgray-50 transition duration-300">
                    Настроить идеологическую работу
                </button>$_idlg_$
    )
  )
),
updated_at = now()
WHERE id = '7e672fed-13f1-4ff1-8786-71a228a0c011'
  AND position($_idlg_$<button onclick="openModal('setup')" class="px-8 py-4 bg-white text-burgundy-900 font-extrabold rounded-xl shadow-lg hover:bg-coolgray-50 transition duration-300">
                    Настроить идеологическую работу
                </button>$_idlg_$ IN (blocks->0->'content'->>'code')) > 0
  AND position($_idlg_$            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div class="bg-coolgray-50 rounded-2xl border border-coolgray-200 p-8 shadow-sm hover:shadow-md transition flex flex-col">
                    <div class="w-14 h-14 rounded-xl bg-burgundy-50 text-burgundy-700 flex items-center justify-center text-2xl mb-6">
                        <i class="fa-solid fa-credit-card"></i>
                    </div>
                    <h3 class="text-2xl font-extrabold text-coolgray-900 mb-4">Корпоративной картой</h3>$_idlg_$ IN (blocks->0->'content'->>'code')) > 0;