
DO $mig$
DECLARE
  page_id uuid := 'd5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656';
  code_text text;
  patch_text text := $PATCH$<!-- lovable:mobile-clone-v3:start -->
<style id="lovable-cb20-mobile-clone-v3-css">
@media (max-width: 767px){
  #rec1219722591 .t396__artboard,
  #rec1219722591 .t396__filter,
  #rec1219722591 .t396__carrier { height: auto !important; min-height: 0 !important; }
  #rec1219722591 .t396__artboard > .tn-elem { display: none !important; }
  .lv-mobile-tariffs-v3 { display: block !important; }
}
@media (min-width: 768px){
  .lv-mobile-tariffs-v3 { display: none !important; }
}
.lv-mobile-tariffs-v3{padding:24px 16px 40px;box-sizing:border-box;font-family:'Sf-pro-display',Arial,sans-serif;background:#fff;}
.lv-mobile-tariffs-v3 *{box-sizing:border-box;}
.lv-mt-heading{font-size:22px;font-weight:700;text-align:center;margin:0 0 20px;color:#1a1a1a;letter-spacing:.02em;}
.lv-mt-card{border:2px solid #ccc;border-radius:20px;padding:22px 18px;margin:0 0 18px;background:#fff;}
.lv-mt-card.lv-c-buh{border-color:#00a6b6;}
.lv-mt-card.lv-c-gl{border-color:#7b3ff2;}
.lv-mt-card.lv-c-biz{border-color:#e422c2;}
.lv-mt-title{font-weight:700;font-size:20px;margin:0 0 10px;letter-spacing:.02em;line-height:1.2;}
.lv-mt-card.lv-c-buh .lv-mt-title{color:#00a6b6;}
.lv-mt-card.lv-c-gl .lv-mt-title{color:#7b3ff2;}
.lv-mt-card.lv-c-biz .lv-mt-title{color:#e422c2;}
.lv-mt-price{font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 2px;}
.lv-mt-full{font-size:13px;color:#555;margin:0 0 16px;}
.lv-mt-ctas{display:flex;flex-direction:column;gap:10px;margin-top:6px;}
.lv-mt-btn{width:100%;}
.lv-mt-btn > a, .lv-mt-btn > a.tn-atom{
  display:flex !important;align-items:center !important;justify-content:center !important;
  min-height:50px;padding:12px 14px !important;border-radius:12px !important;
  font-size:14px !important;font-weight:600 !important;text-decoration:none !important;
  text-align:center !important;line-height:1.2 !important;
  position:static !important;top:auto !important;left:auto !important;
  width:100% !important;height:auto !important;
  color:#fff !important;background:#1a1a1a !important;
  border:none !important;box-shadow:none !important;
  white-space:normal !important;overflow:visible !important;
  font-family:'Sf-pro-display',Arial,sans-serif !important;
}
.lv-mt-btn > a .tn-atom__button-text,
.lv-mt-btn > a .tn-atom__button-content{
  color:#fff !important;font-size:14px !important;font-weight:600 !important;
  background:transparent !important;border:none !important;
}
.lv-mt-btn.lv-primary > a{background:#e422c2 !important;}
.lv-mt-card.lv-c-buh .lv-mt-btn.lv-primary > a{background:#00a6b6 !important;}
.lv-mt-card.lv-c-gl .lv-mt-btn.lv-primary > a{background:#7b3ff2 !important;}
.lv-mt-card.lv-c-biz .lv-mt-btn.lv-primary > a{background:#e422c2 !important;}
</style>
<script id="lovable-cb20-mobile-clone-v3-js">
(function(){
  var MARKER='mobile-clone-v3';
  var CTA_TEXTS=['Оплатить обучение','Оплатить от юрлица','Оплата в два платежа','Заявка на рассрочку'];
  var CARDS=[
    {key:'buh', cls:'lv-c-buh', popup:'#popup:buh', title:'БУХГАЛТЕР',
     price:'ОТ 136 BYN/МЕС', full:'или 1490 BYN при 100% оплате'},
    {key:'gl_buh', cls:'lv-c-gl', popup:'#popup:gl_buh', title:'ГЛАВНЫЙ БУХГАЛТЕР',
     price:'ОТ 163 BYN/МЕС', full:'или 1790 BYN при 100% оплате'},
    {key:'biz-l', cls:'lv-c-biz', popup:'#popup:biz-l', title:'БИЗНЕС-ЛЕДИ',
     price:'ОТ 227 BYN/МЕС', full:'или 2490 BYN при 100% оплате'}
  ];
  function isMobile(){return window.matchMedia && window.matchMedia('(max-width: 767px)').matches;}
  function collect(rec){
    var anchors=rec.querySelectorAll('a');
    var found=[];
    for(var i=0;i<anchors.length;i++){
      var a=anchors[i];
      var t=(a.textContent||'').replace(/\s+/g,' ').trim();
      if(CTA_TEXTS.indexOf(t)>=0) found.push({t:t, a:a, href:(a.getAttribute('href')||'')});
    }
    return found;
  }
  function build(){
    if(document.querySelector('.lv-mobile-tariffs-v3[data-lv-marker="'+MARKER+'"]')) return true;
    var rec=document.getElementById('rec1219722591');
    if(!rec) return false;
    var pool=collect(rec);
    if(pool.length<12) return false;
    var groups=[pool.slice(0,4), pool.slice(4,8), pool.slice(8,12)];
    var wrap=document.createElement('div');
    wrap.className='lv-mobile-tariffs-v3';
    wrap.setAttribute('data-lv-marker', MARKER);
    var heading=document.createElement('div');
    heading.className='lv-mt-heading';
    heading.textContent='ТАРИФЫ И СТОИМОСТЬ ОБУЧЕНИЯ';
    wrap.appendChild(heading);
    for(var i=0;i<3;i++){
      var cfg=CARDS[i], g=groups[i];
      var card=document.createElement('div');
      card.className='lv-mt-card '+cfg.cls;
      var h=document.createElement('div'); h.className='lv-mt-title'; h.textContent=cfg.title; card.appendChild(h);
      var p=document.createElement('div'); p.className='lv-mt-price'; p.textContent=cfg.price; card.appendChild(p);
      var f=document.createElement('div'); f.className='lv-mt-full'; f.textContent=cfg.full; card.appendChild(f);
      var ctas=document.createElement('div'); ctas.className='lv-mt-ctas';
      for(var j=0;j<g.length;j++){
        var item=g[j];
        var btn=document.createElement('div');
        btn.className='lv-mt-btn'+(j===0?' lv-primary':'');
        btn.appendChild(item.a);
        ctas.appendChild(btn);
      }
      card.appendChild(ctas);
      wrap.appendChild(card);
    }
    rec.parentNode.insertBefore(wrap, rec.nextSibling);
    return true;
  }
  var attempts=0;
  function tick(){
    if(!isMobile()){ return; }
    if(build()) return;
    if(++attempts<60) setTimeout(tick, 500);
  }
  function boot(){
    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded', function(){ setTimeout(tick, 300); });
    } else {
      setTimeout(tick, 300);
    }
    window.addEventListener('load', function(){ setTimeout(tick, 500); });
  }
  boot();
})();
</script>
<!-- lovable:mobile-clone-v3:end -->
$PATCH$;
BEGIN
  SELECT (blocks->0->'content'->>'code') INTO code_text
    FROM public.site_pages WHERE id = page_id;
  IF code_text IS NULL THEN
    RAISE EXCEPTION 'site_pages row % has no content.code', page_id;
  END IF;
  code_text := regexp_replace(code_text, '<!-- lovable:mobile-clone-v3:start -->.*?<!-- lovable:mobile-clone-v3:end -->', '', 'gs');
  code_text := regexp_replace(code_text, '<style id="lovable-cb20[^"]*">.*?</style>', '', 'gs');
  code_text := regexp_replace(code_text, '<script id="lovable-cb20[^"]*">.*?</script>', '', 'gs');
  code_text := code_text || E'\n' || patch_text;
  UPDATE public.site_pages
    SET blocks = jsonb_set(blocks, '{0,content,code}', to_jsonb(code_text), false),
        updated_at = now()
    WHERE id = page_id;
END
$mig$;
