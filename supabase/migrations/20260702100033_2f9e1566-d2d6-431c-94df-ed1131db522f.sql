
UPDATE site_pages
SET blocks = jsonb_set(
  blocks,
  '{0,content,code}',
  to_jsonb(
    replace(
      replace(
        replace(
          blocks->0->'content'->>'code',
          $OLD1$              function priceLabel(o, t) {
                if (!o) return '';
                if (o.offer_type === 'preregistration') return 'По запросу';
                var a = Number(o.amount || 0);
                if (!a) return '';
                var per = t.period_label || 'BYN';
                return a.toLocaleString('ru-RU') + ' ' + per + (t.access_days ? ' / ' + t.access_days + ' дн.' : '');
              }$OLD1$,
          $NEW1$              function priceLabel(o, t) {
                if (!o) return '';
                var a = Number(o.amount || 0);
                if (!a && o.offer_type === 'preregistration') return 'По запросу';
                return a.toLocaleString('ru-RU') + ' BYN';
              }$NEW1$
        ),
        $OLD2$onclick="openModal('setup')" class="bz-cta-primary"$OLD2$,
        $NEW2$onclick="scrollToSection('payment'); return false;" class="bz-cta-primary"$NEW2$
      ),
      $OLD3$onclick="openModal('setup')" class="ir-hero-v2__btn ir-hero-v2__btn--primary"$OLD3$,
      $NEW3$onclick="scrollToSection('payment'); return false;" class="ir-hero-v2__btn ir-hero-v2__btn--primary"$NEW3$
    )
  )
)
WHERE id = '7e672fed-13f1-4ff1-8786-71a228a0c011';
