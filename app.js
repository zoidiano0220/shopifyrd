/* ==========================================================================
   Lógica de la tienda (sin dependencias).
   Lee la configuración de js/config.js y los productos de js/products.js.
   ========================================================================== */
(() => {
  'use strict';

  const S = window.STORE;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const money = (n) => `${S.currency} ${Number(n).toLocaleString(S.locale, { maximumFractionDigits: 2 })}`;
  const icon = (n) => `<svg class="icon"><use href="#i-${n}"/></svg>`;
  const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const waLink = (text) => `https://wa.me/${S.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(S.storageKey + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(S.storageKey + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }
  };

  /* ==========================================================================
     Shopify (Storefront API) — opcional. Se activa con domain + storefrontToken
     en js/config.js. Si no están, la tienda usa js/products.js.
     ========================================================================== */
  const SH = S.shopify || {};
  const shopifyOn = !!(SH.domain && SH.storefrontToken);
  const checkoutMode = shopifyOn && SH.checkout !== 'whatsapp' ? 'shopify' : 'whatsapp';
  const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'otros';

  async function gql(query, variables) {
    const url = SH.endpoint || `https://${SH.domain}/api/${SH.apiVersion || '2026-07'}/graphql.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': SH.storefrontToken },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) throw new Error(`Shopify respondió ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
    return json.data;
  }

  // Catálogo grande: la lista pide solo lo liviano (250 por tanda). La descripción completa,
  // todas las fotos y todas las variantes se piden al abrir un producto (DETAIL_QUERY).
  const VARIANT_FIELDS = `id title availableForSale ${SH.readStock ? 'quantityAvailable' : ''}
    price { amount } compareAtPrice { amount } image { url(transform: { maxWidth: 700 }) }`;
  const PRODUCTS_QUERY = `query Products($after: String) {
    products(first: 250, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title productType tags category { name }
        featuredImage { url(transform: { maxWidth: 700 }) }
        variants(first: 10) { nodes { ${VARIANT_FIELDS} } }
      }
    }
  }`;
  const DETAIL_QUERY = `query Detail($handle: String!) {
    product(handle: $handle) {
      description descriptionHtml
      images(first: 12) { nodes { url(transform: { maxWidth: 900 }) } }
      variants(first: 50) { nodes { ${VARIANT_FIELDS} } }
    }
  }`;

  const shopifyVariant = (v) => ({
    id: v.id, title: v.title === 'Default Title' ? '' : v.title,
    price: v.price.amount, oldPrice: v.compareAtPrice?.amount,
    stock: v.availableForSale ? (v.quantityAvailable > 0 ? v.quantityAvailable : 99) : 0,
    image: v.image?.url || ''
  });

  // Convierte un producto de Shopify al formato interno de la tienda
  function fromShopify(n) {
    // Categoría: Tipo de producto > categoría de Shopify (taxonomía) > "Productos"
    const category = n.productType || n.category?.name || 'Productos';
    const tagValue = (prefix) => (n.tags || []).find((t) => t.toLowerCase().startsWith(prefix))?.slice(prefix.length).trim();
    return {
      id: n.handle, name: n.title, description: '',
      category: slug(category), categoryName: category,
      images: n.featuredImage?.url ? [n.featuredImage.url] : [],
      badge: tagValue('badge:'),
      featured: (n.tags || []).some((t) => norm(t) === 'destacado'),
      variants: (n.variants?.nodes || []).map(shopifyVariant)
    };
  }

  async function loadShopifyProducts() {
    const all = [];
    let after = null;
    for (let page = 0; page < 60; page++) {            // hasta 15,000 productos
      const { products } = await gql(PRODUCTS_QUERY, { after });
      all.push(...products.nodes.map(fromShopify));
      if (!products.pageInfo.hasNextPage) break;
      after = products.pageInfo.endCursor;
    }
    return all;
  }

  // Las categorías salen del "Tipo de producto" (o de la colección) de cada producto en Shopify
  function deriveCategories(list) {
    const known = S.categories;
    const found = new Map();
    list.forEach((p) => { if (!found.has(p.category)) found.set(p.category, p.categoryName); });
    S.categories = [...found].map(([id, name]) => {
      const k = known.find((c) => c.id === id || norm(c.name) === norm(name));
      return { id, name, emoji: k?.emoji || '🛍️', hue: k?.hue ?? hash(id) % 360 };
    });
  }

  /* ---------- Datos ---------- */
  const catById = (id) => S.categories.find((c) => c.id === id);
  let P = [];
  let variantMap = new Map();
  let loadError = false;
  const byId = (id) => P.find((p) => p.id === String(id));

  const mkVariant = (v) => {
    const price = Number(v.price) || 0, old = Number(v.oldPrice) || 0;
    return {
      id: String(v.id), title: v.title || '', price, oldPrice: old > price ? old : 0,
      discount: old > price ? Math.round((1 - price / old) * 100) : 0, stock: Number(v.stock ?? 99), image: v.image || ''
    };
  };

  function normalize(p) {
    const cat = catById(p.category);
    // Todo producto tiene al menos una variante (la que se agrega al carrito)
    const variants = (p.variants?.length ? p.variants : [{ id: p.id, price: p.price, oldPrice: p.oldPrice, stock: p.stock }]).map(mkVariant);
    const buyable = variants.filter((v) => v.stock > 0);
    const base = (buyable.length ? buyable : variants).reduce((a, v) => (v.price < a.price ? v : a));
    return {
      specs: [], reviews: 0, ...p,
      id: String(p.id), variants, price: base.price, oldPrice: base.oldPrice, discount: base.discount,
      from: new Set(variants.map((v) => v.price)).size > 1,
      stock: variants.reduce((a, v) => a + v.stock, 0), rating: Number(p.rating) || 0,
      images: p.images && p.images.length ? p.images : (p.image ? [p.image] : []),
      hue: p.hue ?? cat?.hue ?? hash(p.id) % 360,
      emoji: p.emoji || cat?.emoji || '🛍️'
    };
  }

  const lineName = (p, v) => (v.title ? `${p.name} — ${v.title}` : p.name);

  /* ---------- Estado ---------- */
  const f = { cat: 'all', q: '', sort: 'featured', max: 0, fav: false, shown: S.pageSize };
  let cart = {};                       // { idDeVariante: cantidad }
  const wish = new Set();
  let lastAdded = null;
  let rangeMax = 0, priceStep = 50;

  function setProducts(list) {
    if (shopifyOn) deriveCategories(list);
    P = list.map(normalize);
    variantMap = new Map(P.flatMap((p) => p.variants.map((v) => [v.id, { p, v }])));

    const maxPrice = P.length ? Math.max(...P.map((p) => p.price)) : 0;
    priceStep = maxPrice > 20000 ? 500 : maxPrice > 5000 ? 100 : 50;
    rangeMax = Math.max(priceStep, Math.ceil(maxPrice / priceStep) * priceStep);
    f.max = rangeMax;

    // Recuperar carrito y favoritos guardados (solo lo que todavía existe y hay en stock)
    cart = {};
    const saved = store.get('cart', {});
    Object.keys(saved).forEach((k) => { const e = variantMap.get(k); if (e && e.v.stock > 0) cart[k] = Math.min(saved[k], e.v.stock); });
    wish.clear();
    store.get('wish', []).forEach((id) => { if (byId(id)) wish.add(id); });
  }

  const cartLines = () => Object.entries(cart).map(([key, qty]) => ({ ...variantMap.get(key), qty })).filter((l) => l.p);
  const totals = () => {
    const lines = cartLines();
    const sub = lines.reduce((a, l) => a + l.v.price * l.qty, 0);
    const count = lines.reduce((a, l) => a + l.qty, 0);
    const ship = sub === 0 ? 0 : sub >= S.freeShippingFrom ? 0 : S.shippingFee;
    return { lines, sub, count, ship, total: sub + ship };
  };

  /* ---------- Tema ---------- */
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('#themeBtn use').setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
    $('meta[name="theme-color"]').setAttribute('content', t === 'dark' ? '#0a0f1f' : '#4f46e5');
  }
  applyTheme(store.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  /* ---------- Avisos ---------- */
  function toast(msg, { type = 'ok', action } = {}) {
    const box = $('#toasts');
    $$('.toast', box).filter((x) => x.dataset.msg === msg).forEach((x) => x.remove());
    while (box.children.length >= 3) box.firstElementChild.remove();
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'warn' ? ' toast--warn' : '');
    t.dataset.msg = msg;
    t.innerHTML = `<span class="toast__ico">${icon(type === 'warn' ? 'zap' : 'check')}</span><span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    if (action) t.querySelector('button').addEventListener('click', () => { action.run(); dismiss(); });
    box.appendChild(t);
    const dismiss = () => { t.classList.add('is-out'); setTimeout(() => t.remove(), 300); };
    setTimeout(dismiss, 3400);
  }

  /* ---------- Revelar al hacer scroll ---------- */
  const io = !reduced && 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      }), { threshold: 0.1, rootMargin: '0px 0px -30px 0px' })
    : null;
  const observeReveals = (root = document) => $$('.reveal:not(.in)', root).forEach((el) => (io ? io.observe(el) : el.classList.add('in')));

  /* ==========================================================================
     Plantillas
     ========================================================================== */
  const media = (p, v) => {
    const src = v?.image || p.images[0];
    return src
      ? `<img src="${esc(src)}" alt="${esc(p.name)}" loading="lazy">`
      : `<span class="ph" aria-hidden="true">${esc(p.emoji)}</span>`;
  };

  const stars = (p) => (p.rating > 0
    ? `<span class="stars" style="--r:${p.rating}" role="img" aria-label="${p.rating} de 5 estrellas">★★★★★</span><span>${p.rating.toFixed(1)}${p.reviews ? ` (${p.reviews})` : ''}</span>`
    : '');

  const badgesHTML = (p) => [
    p.discount ? `<span class="badge badge--off">-${p.discount}%</span>` : '',
    p.badge ? `<span class="badge">${esc(p.badge)}</span>` : '',
    p.stock <= 0 ? '<span class="badge badge--out">Agotado</span>' : p.stock <= 5 ? `<span class="badge badge--low">Quedan ${p.stock}</span>` : ''
  ].join('');

  function card(p, i = 0, reveal = true) {
    const out = p.stock <= 0;
    return `<article class="card${reveal ? ' reveal' : ''}${out ? ' is-out' : ''}" style="--h:${p.hue};--i:${Math.min(i, 8)}" data-id="${esc(p.id)}">
      <div class="card__media">
        <button class="card__open" data-action="view" aria-label="Ver detalles de ${esc(p.name)}">${media(p)}<span class="quick">${icon('eye')} Vista rápida</span></button>
        <div class="badges">${badgesHTML(p)}</div>
        <button class="wish${wish.has(p.id) ? ' is-on' : ''}" data-action="wish" aria-pressed="${wish.has(p.id)}" aria-label="Agregar a favoritos">${icon('heart')}</button>
      </div>
      <div class="card__body">
        <span class="card__cat">${esc(catById(p.category)?.name || '')}</span>
        <h3 class="card__title"><button data-action="view">${esc(p.name)}</button></h3>
        <div class="rating">${stars(p)}</div>
        <div class="card__price">${p.from ? '<span class="from">Desde</span>' : ''}<span class="now">${money(p.price)}</span>${p.oldPrice ? `<span class="was">${money(p.oldPrice)}</span>` : ''}</div>
        <button class="btn btn--soft btn--block" data-action="add" ${out ? 'disabled' : ''}>${out ? 'Agotado' : p.variants.length > 1 ? `${icon('eye')} Elegir opciones` : `${icon('cart')} Agregar`}</button>
      </div>
    </article>`;
  }

  /* ==========================================================================
     Contenido estático (desde config.js)
     ========================================================================== */
  function renderStatic() {
    document.title = `${S.name} — ${S.tagline}`;
    $$('[data-store="name"]').forEach((el) => (el.textContent = S.name));
    $$('[data-store="tagline"]').forEach((el) => (el.textContent = S.tagline));
    $('#year').textContent = new Date().getFullYear();
    // WhatsApp: solo se muestra si hay un número real en config.js
    const hasWa = !!S.whatsapp;
    $('#ctaWa').href = waLink(`Hola ${S.name}, quisiera información sobre un producto.`);
    $('#fabWa').href = waLink(`Hola ${S.name}, necesito ayuda con una compra.`);
    $('#fabWa').hidden = !hasWa;
    $('#ctaWa').closest('section').hidden = !hasWa;

    $('#perks').innerHTML = S.perks.map((k, i) =>
      `<div class="perk reveal" style="--i:${i}"><span class="perk__ico">${icon(k.icon)}</span><div><h3>${esc(k.title)}</h3><p>${esc(k.text)}</p></div></div>`).join('');

    const count = (id) => P.filter((p) => p.category === id).length;
    $('#cats').innerHTML = S.categories.map((c, i) =>
      `<button class="cat reveal" style="--h:${c.hue};--i:${i}" data-action="cat" data-cat="${esc(c.id)}">
        <span class="cat__emoji">${esc(c.emoji)}</span><b>${esc(c.name)}</b><small>${count(c.id) ? `${count(c.id)} producto${count(c.id) === 1 ? '' : 's'}` : 'Próximamente'}</small>${icon('arrow')}
      </button>`).join('');

    $('#catNav').innerHTML =
      `<button class="catlink is-active" data-action="cat" data-cat="all">Todo</button>` +
      S.categories.map((c) => `<button class="catlink" data-action="cat" data-cat="${esc(c.id)}">${esc(c.emoji)} ${esc(c.name)}</button>`).join('');

    $('#chips').innerHTML =
      `<button class="chip is-active" data-action="cat" data-cat="all" role="tab">Todos<small>${P.length}</small></button>` +
      S.categories.map((c) => `<button class="chip" data-action="cat" data-cat="${esc(c.id)}" role="tab">${esc(c.name)}<small>${count(c.id)}</small></button>`).join('');

    $('#faqList').innerHTML = S.faqs.map((x) =>
      `<details><summary>${esc(x.q)}${icon('down')}</summary><p>${esc(x.a)}</p></details>`).join('');

    $('#footCats').innerHTML = S.categories.map((c) => `<li><a href="#catalogo" data-action="cat" data-cat="${esc(c.id)}">${esc(c.name)}</a></li>`).join('');
    $('#footContact').innerHTML = [
      S.address && `<li>${icon('pin')}<span>${esc(S.address)}</span></li>`,
      S.phone && `<li>${icon('phone')}<a href="tel:${esc(S.phone.replace(/[^\d+]/g, ''))}">${esc(S.phone)}</a></li>`,
      S.email && `<li>${icon('mail')}<a href="mailto:${esc(S.email)}">${esc(S.email)}</a></li>`,
      S.whatsapp && `<li>${icon('wa')}<a href="${waLink()}" target="_blank" rel="noopener">WhatsApp</a></li>`
    ].filter(Boolean).join('');
    $('#social').innerHTML = Object.entries(S.social || {}).filter(([, u]) => u && u !== '#')
      .map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n[0].toUpperCase() + n.slice(1))}</a>`).join('');
    $('#payList').innerHTML = S.paymentMethods.map((m) => `<span>${esc(m)}</span>`).join('');
  }

  /* ---------- Barra superior rotativa ---------- */
  function initTopbar() {
    const el = $('#topbarMsg');
    const msgs = S.announcements?.length ? S.announcements : [S.tagline];
    let i = 0;
    el.textContent = msgs[0];
    if (msgs.length < 2) return;
    setInterval(() => {
      el.classList.add('is-out');
      setTimeout(() => { i = (i + 1) % msgs.length; el.textContent = msgs[i]; el.classList.remove('is-out'); }, 350);
    }, 4500);
  }

  /* ---------- Banner principal ---------- */
  function initHero() {
    const slides = S.heroSlides || [];
    if (!slides.length) { $('.hero').hidden = true; return; }
    $('#heroSlides').innerHTML = slides.map((s, i) => `
      <div class="hero__slide${i === 0 ? ' is-active' : ''}" style="--from:${esc(s.from)};--to:${esc(s.to)}" aria-hidden="${i !== 0}">
        <div class="hero__text">
          <span class="hero__tag">${esc(s.eyebrow)}</span>
          <${i === 0 ? 'h1' : 'h2'} class="hero__h">${esc(s.title)}</${i === 0 ? 'h1' : 'h2'}>
          <p>${esc(s.text)}</p>
          <a class="btn btn--light btn--lg" href="${esc(s.href)}">${esc(s.cta)} ${icon('arrow')}</a>
        </div>
        <div class="art" aria-hidden="true">
          <div class="art__orb">${esc(s.emoji)}</div>
          ${s.chips?.[0] ? `<span class="art__chip art__chip--a">${esc(s.chips[0])}</span>` : ''}
          ${s.chips?.[1] ? `<span class="art__chip art__chip--b">${esc(s.chips[1])}</span>` : ''}
          ${s.bubbles?.[0] ? `<span class="art__bubble art__bubble--a">${esc(s.bubbles[0])}</span>` : ''}
          ${s.bubbles?.[1] ? `<span class="art__bubble art__bubble--b">${esc(s.bubbles[1])}</span>` : ''}
        </div>
      </div>`).join('');
    $('#heroDots').innerHTML = slides.map((_, i) => `<button class="hero__dot${i === 0 ? ' is-active' : ''}" data-i="${i}" aria-label="Ir al banner ${i + 1}"></button>`).join('');

    const els = $$('.hero__slide');
    const dots = $$('.hero__dot');
    let cur = 0, timer;
    const show = (n) => {
      cur = (n + slides.length) % slides.length;
      els.forEach((e, i) => { e.classList.toggle('is-active', i === cur); e.setAttribute('aria-hidden', i !== cur); });
      dots.forEach((d, i) => d.classList.toggle('is-active', i === cur));
    };
    const play = () => { clearInterval(timer); if (!reduced && slides.length > 1) timer = setInterval(() => show(cur + 1), 6500); };
    $('#heroPrev').addEventListener('click', () => { show(cur - 1); play(); });
    $('#heroNext').addEventListener('click', () => { show(cur + 1); play(); });
    $('#heroDots').addEventListener('click', (e) => { const d = e.target.closest('.hero__dot'); if (d) { show(+d.dataset.i); play(); } });
    const wrap = $('#hero');
    wrap.addEventListener('mouseenter', () => clearInterval(timer));
    wrap.addEventListener('mouseleave', play);
    let x0 = null;
    wrap.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; clearInterval(timer); }, { passive: true });
    wrap.addEventListener('touchend', (e) => {
      if (x0 !== null) { const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1)); }
      x0 = null; play();
    });
    play();
  }

  /* ---------- Ofertas + cuenta regresiva ---------- */
  function renderDeals() {
    const deals = P.filter((p) => p.discount > 0 && p.stock > 0).sort((a, b) => b.discount - a.discount).slice(0, 10);
    $('#ofertas').hidden = !deals.length;
    $('#dealsRow').innerHTML = deals.map((p, i) => card(p, i, false)).join('');
    const row = $('#dealsRow');
    $('#dealsPrev').onclick = () => row.scrollBy({ left: -row.clientWidth * 0.8, behavior: 'smooth' });
    $('#dealsNext').onclick = () => row.scrollBy({ left: row.clientWidth * 0.8, behavior: 'smooth' });
    const pad = (n) => String(n).padStart(2, '0');
    const tick = () => {
      const end = new Date(); end.setHours(24, 0, 0, 0);
      const d = Math.max(0, end - Date.now());
      $('[data-t="h"]').textContent = pad(Math.floor(d / 36e5));
      $('[data-t="m"]').textContent = pad(Math.floor(d % 36e5 / 6e4));
      $('[data-t="s"]').textContent = pad(Math.floor(d % 6e4 / 1e3));
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ==========================================================================
     Catálogo: filtros, orden, paginación
     ========================================================================== */
  const filtersActive = () => f.cat !== 'all' || f.q || f.max < rangeMax || f.fav;

  function filtered() {
    const q = norm(f.q);
    const list = P.filter((p) =>
      (f.cat === 'all' || p.category === f.cat) &&
      p.price <= f.max &&
      (!f.fav || wish.has(p.id)) &&
      (!q || norm(`${p.name} ${p.description || ''} ${catById(p.category)?.name || ''} ${p.badge || ''}`).includes(q)));
    const sorts = {
      featured: (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0),
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      rating: (a, b) => b.rating - a.rating,
      discount: (a, b) => b.discount - a.discount
    };
    return list.sort(sorts[f.sort]);
  }

  function renderCatalog({ append = false } = {}) {
    const grid = $('#grid'), empty = $('#empty'), more = $('#loadMore'), bar = $('#resultBar');
    $('#toolbar').hidden = !P.length;

    if (!P.length) {
      grid.innerHTML = ''; more.hidden = true; bar.innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = loadError
        ? `<div class="empty__emoji">📡</div><h3>No pudimos cargar los productos</h3>
          <p>Revisa tu conexión e inténtalo otra vez. Si sigue pasando, escríbenos y te atendemos por WhatsApp.</p>
          <button class="btn btn--primary btn--lg" data-action="reload">Reintentar</button>`
        : `<div class="empty__emoji">🛒</div><h3>Muy pronto, nuestro catálogo</h3>
          <p>Estamos cargando los productos. Vuelve en un momento.</p>
          ${S.whatsapp ? `<a class="btn btn--primary btn--lg" href="${waLink()}" target="_blank" rel="noopener">${icon('wa')} Escribir por WhatsApp</a>` : ''}`;
      return;
    }

    const list = filtered();
    const prev = append ? grid.children.length : 0;
    const slice = list.slice(prev, f.shown);

    if (append) grid.insertAdjacentHTML('beforeend', slice.map((p, i) => card(p, i)).join(''));
    else grid.innerHTML = list.slice(0, f.shown).map((p, i) => card(p, i)).join('');
    observeReveals(grid);

    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.innerHTML = `<div class="empty__emoji">🔎</div><h3>No encontramos resultados</h3>
        <p>${f.fav ? 'Aún no tienes favoritos con estos filtros.' : 'Prueba con otra palabra o quita algún filtro.'}</p>
        <button class="btn btn--primary" data-action="reset">Ver todos los productos</button>`;
    }
    more.hidden = list.length <= f.shown;
    more.textContent = `Ver más productos (${list.length - f.shown} restantes)`;

    bar.innerHTML = list.length
      ? `<span>${list.length} producto${list.length === 1 ? '' : 's'}${f.q ? ` para “${esc(f.q)}”` : ''}</span>` +
        (filtersActive() ? `<button data-action="reset">${icon('x')} Limpiar filtros</button>` : '')
      : '';
  }

  function syncCatUI() {
    $$('.catlink, .chip').forEach((el) => {
      const on = el.dataset.cat === f.cat;
      el.classList.toggle('is-active', on);
      if (el.classList.contains('chip')) el.setAttribute('aria-selected', on);
    });
    $('#favFilter').setAttribute('aria-pressed', f.fav);
    $('#priceOut').textContent = money(f.max);
  }

  const refresh = () => { f.shown = S.pageSize; renderCatalog(); syncCatUI(); };
  const goCatalog = () => { leaveProduct(); $('#catalogo').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); };

  function setCategory(id) { f.cat = id; f.q = ''; $('#searchInput').value = ''; refresh(); goCatalog(); }
  function setFav(on) {
    if (on && !wish.size) { toast('Aún no tienes favoritos. Toca el corazón en un producto.', { type: 'warn' }); return; }
    f.fav = on; refresh(); if (on) goCatalog();
  }
  function resetFilters() {
    Object.assign(f, { cat: 'all', q: '', sort: 'featured', max: rangeMax, fav: false });
    $('#searchInput').value = ''; $('#sortSel').value = 'featured'; $('#priceRange').value = rangeMax;
    refresh();
  }

  /* ==========================================================================
     Favoritos
     ========================================================================== */
  function toggleWish(id) {
    const p = byId(id); if (!p) return;
    if (wish.has(id)) { wish.delete(id); toast('Quitado de favoritos'); } else { wish.add(id); toast(`${p.name} guardado en favoritos`); }
    store.set('wish', [...wish]);
    syncWishUI();
    if (f.fav) { if (!wish.size) f.fav = false; refresh(); }
  }
  function syncWishUI() {
    $$('[data-action="wish"]').forEach((b) => {
      const id = b.closest('[data-id]')?.dataset.id;
      const on = wish.has(id);
      b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on);
    });
    const c = $('#wishCount');
    c.textContent = wish.size; c.hidden = !wish.size;
  }

  /* ==========================================================================
     Carrito
     ========================================================================== */
  const save = () => store.set('cart', cart);

  // "key" es el id de la variante (en productos sin variantes, es el id del producto)
  function addToCart(key, qty = 1, quiet = false) {
    const e = variantMap.get(key); if (!e || e.v.stock <= 0) return false;
    const { p, v } = e;
    const cur = cart[key] || 0;
    const next = Math.min(v.stock, cur + qty);
    if (next === cur) { toast(`Solo hay ${v.stock} disponible${v.stock === 1 ? '' : 's'} de este producto`, { type: 'warn' }); return false; }
    cart[key] = next; lastAdded = key; save(); renderCart();
    const b = $('#cartBtn'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    if (!quiet) toast(`${lineName(p, v)} agregado`, openName === 'cart' ? {} : { action: { label: 'Ver carrito', run: () => openLayer('cart') } });
    return true;
  }
  function setQty(key, qty) {
    const e = variantMap.get(key); if (!e) return;
    if (qty <= 0) delete cart[key]; else cart[key] = Math.min(qty, e.v.stock);
    lastAdded = null; save(); renderCart();
  }

  function renderCart() {
    const t = totals();
    const badge = $('#cartCount');
    badge.textContent = t.count; badge.hidden = !t.count;
    $('#cartTitleCount').textContent = t.count ? `(${t.count})` : '';

    const ship = $('#shipBar');
    ship.hidden = !t.count;
    if (t.count) {
      if (S.freeShippingFrom <= 0 || S.shippingFee <= 0) {
        // Envío gratis en todos los pedidos: sin barra de progreso
        ship.classList.add('is-done');
        ship.innerHTML = `${icon('check')} Envío gratis en tu pedido`;
      } else {
        const left = S.freeShippingFrom - t.sub;
        ship.classList.toggle('is-done', left <= 0);
        ship.innerHTML = (left <= 0 ? `${icon('check')} ¡Genial! Tu envío es gratis` : `Te faltan <b>${money(left)}</b> para envío gratis`) +
          `<div class="ship__bar"><i style="width:${Math.min(100, t.sub / S.freeShippingFrom * 100)}%"></i></div>`;
      }
    }

    const body = $('#cartBody'), foot = $('#cartFoot');
    if (!t.count) {
      body.innerHTML = `<div class="cart-empty"><div><div class="cart-empty__emoji">🛒</div><h3>Tu carrito está vacío</h3><p>Agrega productos para empezar tu compra.</p>
        <button class="btn btn--primary" data-action="close-layer">Seguir comprando</button></div></div>`;
      foot.hidden = true;
      return;
    }
    body.innerHTML = t.lines.map(({ p, v, qty }) => `
      <div class="line${v.id === lastAdded ? ' is-new' : ''}" data-id="${esc(v.id)}" style="--h:${p.hue}">
        <div class="line__thumb">${media(p, v)}</div>
        <div>
          <div class="line__name">${esc(lineName(p, v))}</div>
          <div class="line__unit">${money(v.price)} c/u</div>
          <div class="stepper">
            <button data-action="dec" aria-label="Quitar uno">${icon('minus')}</button>
            <output aria-live="polite">${qty}</output>
            <button data-action="inc" aria-label="Agregar uno" ${qty >= v.stock ? 'disabled' : ''}>${icon('plus')}</button>
          </div>
        </div>
        <div class="line__right">
          <div class="line__total">${money(v.price * qty)}</div>
          <button class="line__del" data-action="remove" aria-label="Eliminar ${esc(lineName(p, v))}">${icon('trash')}</button>
        </div>
      </div>`).join('');
    foot.hidden = false;
    foot.innerHTML = `
      <div class="sum">
        <div><span>Subtotal</span><span>${money(t.sub)}</span></div>
        <div><span>Envío</span><span class="${t.ship ? '' : 'free'}">${t.ship ? money(t.ship) : 'Gratis'}</span></div>
        <div class="total"><span>Total</span><span>${money(t.total)}</span></div>
      </div>
      <button class="btn btn--primary btn--lg btn--block" data-action="checkout">${checkoutMode === 'shopify' ? 'Pagar' : 'Finalizar compra'} ${icon('arrow')}</button>
      ${checkoutMode === 'shopify' && S.whatsapp && SH.showWhatsAppOrder !== false ? `<button class="btn btn--wa btn--block" data-action="wa-checkout">${icon('wa')} Pedir por WhatsApp</button>` : ''}
      <button class="btn btn--ghost btn--block" data-action="close-layer">Seguir comprando</button>`;
  }

  /* ==========================================================================
     Capas (carrito, vista rápida, checkout)
     ========================================================================== */
  const layers = { cart: $('#cartDrawer'), checkout: $('#checkoutModal') };
  const overlay = $('#overlay');
  let openName = null, lastFocus = null;

  function openLayer(name) {
    if (openName && openName !== name) closeLayer({ keepOverlay: true });
    if (!openName) lastFocus = document.activeElement;
    const el = layers[name];
    el.classList.add('is-open'); el.setAttribute('aria-hidden', 'false');
    overlay.classList.add('is-open'); document.documentElement.classList.add('no-scroll');
    openName = name;
    setTimeout(() => (el.querySelector('input, [data-close]') || el).focus?.({ preventScroll: true }), 80);
  }
  function closeLayer({ keepOverlay = false } = {}) {
    if (!openName) return;
    const el = layers[openName];
    el.classList.remove('is-open'); el.setAttribute('aria-hidden', 'true');
    openName = null;
    if (!keepOverlay) {
      overlay.classList.remove('is-open'); document.documentElement.classList.remove('no-scroll');
      lastFocus?.focus?.({ preventScroll: true });
    }
  }
  overlay.addEventListener('click', () => closeLayer());
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeLayer()));

  /* ---------- Vista rápida ---------- */
  let pd = null;
  // Trae la descripción completa, todas las fotos y todas las variantes (la lista solo trae lo liviano)
  async function loadDetail(p) {
    if (!shopifyOn || p.detailed) return false;
    try {
      const { product } = await gql(DETAIL_QUERY, { handle: p.id });
      p.detailed = true;
      if (!product) return false;
      p.description = product.description || '';
      p.descriptionHtml = product.descriptionHtml || '';
      const imgs = (product.images?.nodes || []).map((i) => i.url);
      if (imgs.length) p.images = imgs;
      const vs = (product.variants?.nodes || []).map((v) => mkVariant(shopifyVariant(v)));
      if (vs.length) {
        p.variants.forEach((v) => variantMap.delete(v.id));
        p.variants = vs;
        vs.forEach((v) => variantMap.set(v.id, { p, v }));
      }
      return true;
    } catch (err) { console.error('No se pudo cargar el detalle del producto', err); return false; }
  }

  /* ==========================================================================
     Página de producto: cada producto tiene su propio apartado (#/producto/<handle>)
     con galería, precio, compra y descripción completa. Funciona con el botón
     "atrás" del navegador y el enlace se puede compartir.
     ========================================================================== */
  const home = $('#top'), view = $('#productView');
  const baseTitle = document.title, descMeta = $('meta[name="description"]');
  const baseDesc = descMeta?.getAttribute('content') || '';
  let inProduct = false, homeY = 0;

  const productHash = () => {
    const m = location.hash.match(/^#\/producto\/(.+)$/) || location.hash.match(/^#producto=(.+)$/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  };

  // Deja solo formato básico (párrafos, saltos, listas, negritas): la descripción viene de Shopify
  const KEEP = new Set(['P', 'BR', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'H4']);
  const DROP = /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|FORM|INPUT|BUTTON|IMG|SVG|LINK|META|VIDEO|AUDIO)$/;
  function cleanHTML(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const walk = (node) => {
      [...node.childNodes].forEach((c) => {
        if (c.nodeType === 3) return;
        if (c.nodeType !== 1 || DROP.test(c.tagName)) { c.remove(); return; }
        walk(c);
        if (/^H[1-6]$/.test(c.tagName)) { const h = doc.createElement('h4'); h.append(...c.childNodes); c.replaceWith(h); return; }
        if (!KEEP.has(c.tagName)) { c.replaceWith(...c.childNodes); return; }
        [...c.attributes].forEach((a) => c.removeAttribute(a.name));
      });
    };
    walk(doc.body);
    return doc.body.innerHTML.trim();
  }
  const descHTML = (p) => {
    const rich = p.descriptionHtml ? cleanHTML(p.descriptionHtml) : '';
    if (rich) return rich;
    return String(p.description || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');
  };

  function showHome() {
    if (!inProduct) return;
    inProduct = false; view.hidden = true; home.hidden = false;
    document.title = baseTitle; descMeta?.setAttribute('content', baseDesc);
  }
  // Salir de la ficha sin tocar el historial del producto (para filtros, búsqueda, categorías)
  function leaveProduct() {
    if (!inProduct) return;
    history.pushState(null, '', location.pathname + location.search);
    showHome();
  }
  // Maneja "atrás", enlaces directos y anclas (#catalogo, #faq…)
  function route() {
    const id = productHash();
    if (id) { renderProductPage(id); return; }
    const was = inProduct;
    showHome();
    if (!was) return;
    const anchor = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (anchor) anchor.scrollIntoView(); else window.scrollTo(0, homeY);
  }
  window.addEventListener('hashchange', route);

  function openProduct(id, keep = false) {
    if (openName) closeLayer();
    if (!keep) {
      if (!inProduct) homeY = scrollY;
      if (productHash() !== id) history.pushState({ pp: 1 }, '', '#/producto/' + encodeURIComponent(id));
    }
    renderProductPage(id, keep);
  }

  function renderProductPage(id, keep = false) {
    const p = byId(id);
    inProduct = true; home.hidden = true; view.hidden = false;
    if (!p) {
      view.innerHTML = `<div class="container"><div class="empty"><div class="empty__emoji">🔎</div><h3>No encontramos este producto</h3>
        <p>Puede que ya no esté disponible. Mira el resto de nuestro catálogo.</p>
        <button class="btn btn--primary" data-action="home">Ver la tienda</button></div></div>`;
      window.scrollTo(0, 0);
      return;
    }
    const first = keep && pd && pd.p === p && p.variants[pd.vi] ? pd.vi : Math.max(0, p.variants.findIndex((v) => v.stock > 0));
    pd = { p, vi: first, qty: keep && pd && pd.p === p ? pd.qty : 1 };
    const catName = catById(p.category)?.name || '';
    const desc = descHTML(p);
    const related = P.filter((x) => x.id !== p.id && x.category === p.category && x.stock > 0)
      .sort((a, b) => hash(p.id + a.id) - hash(p.id + b.id)).slice(0, 8);
    const loadingDesc = shopifyOn && !p.detailed;
    view.innerHTML = `
      <div class="container">
        <nav class="crumbs" aria-label="Ruta">
          <button data-action="back">${icon('arrow')} Volver</button>
          <span aria-hidden="true">·</span>
          <button data-action="home">Inicio</button>
          ${catName ? `<span aria-hidden="true">›</span><button data-action="cat" data-cat="${esc(p.category)}">${esc(catName)}</button>` : ''}
          <span aria-hidden="true">›</span><span class="cur">${esc(p.name)}</span>
        </nav>
      <div class="pd" data-id="${esc(p.id)}" style="--h:${p.hue}">
        <div class="pd__gallery">
          <div class="pd__main" id="pdMain">${media(p)}<div class="badges">${badgesHTML(p)}</div></div>
          ${p.images.length > 1 ? `<div class="pd__thumbs">${p.images.map((src, i) =>
            `<button data-action="thumb" data-src="${esc(src)}" class="${i === 0 ? 'is-active' : ''}" aria-label="Foto ${i + 1}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>` : ''}
        </div>
        <div class="pd__info">
          <span class="card__cat">${esc(catName)}</span>
          <h1>${esc(p.name)}</h1>
          ${p.rating > 0 ? `<div class="rating">${stars(p)}</div>` : ''}
          <div class="pd__price" id="pdPrice"></div>
          ${p.specs.length ? `<ul class="pd__specs">${p.specs.map((s) => `<li>${icon('check')}${esc(s)}</li>`).join('')}</ul>` : ''}
          ${p.variants.length > 1 ? `<div class="pd__opts"><span class="pd__optlabel">Elige una opción</span><div class="pills">${p.variants.map((v, i) =>
            `<button class="pill${i === pd.vi ? ' is-active' : ''}" data-action="variant" data-i="${i}" ${v.stock <= 0 ? 'disabled' : ''} aria-pressed="${i === pd.vi}">${esc(v.title)}</button>`).join('')}</div></div>` : ''}
          <div class="pd__stock" id="pdStock"></div>
          <div class="pd__buy">
            <div class="stepper stepper--lg">
              <button data-action="pd-dec" aria-label="Menos" disabled>${icon('minus')}</button>
              <output id="pdQty">1</output>
              <button data-action="pd-inc" aria-label="Más">${icon('plus')}</button>
            </div>
            <button class="btn btn--primary btn--lg" data-action="pd-add">${icon('cart')} Agregar al carrito</button>
            <button class="iconbtn wishbtn${wish.has(p.id) ? ' is-on' : ''}" data-action="wish" aria-label="Favorito" aria-pressed="${wish.has(p.id)}">${icon('heart')}</button>
          </div>
          <button class="btn btn--ghost btn--block" data-action="pd-buy">Comprar ahora</button>
          <div class="pd__trust"><span>${icon('truck')} Envío gratis, mismo día</span><span>${icon('shield')} Compra segura</span></div>
          <div class="pshare"><span>Compartir:</span>
            <a href="https://wa.me/?text=${encodeURIComponent(`${p.name} — ${location.origin}${location.pathname}#/producto/${encodeURIComponent(p.id)}`)}" target="_blank" rel="noopener">${icon('wa')} WhatsApp</a>
            <button data-action="copy-link">Copiar enlace</button>
          </div>
        </div>
      </div>
      <section class="pdesc" aria-labelledby="pdescTitle">
        <h2 id="pdescTitle">Descripción del producto</h2>
        ${desc ? `<div class="pdesc__body">${desc}</div>`
          : `<p class="muted">${loadingDesc ? 'Cargando descripción…' : 'Este producto aún no tiene descripción. Escríbenos y te damos todos los detalles.'}</p>`}
      </section>
      ${related.length ? `<section class="prelated" aria-labelledby="prelTitle">
        <h2 id="prelTitle">También te puede gustar</h2>
        <div class="grid">${related.map((x, i) => card(x, i, false)).join('')}</div>
      </section>` : ''}
      </div>`;
    pdSync();
    if (!keep) {
      window.scrollTo(0, 0);
      document.title = `${p.name} — ${S.name}`;
      const blurb = (p.description || '').replace(/\s+/g, ' ').trim().slice(0, 155);
      descMeta?.setAttribute('content', blurb || baseDesc);
    }
    // Si faltan datos completos (descripción, fotos, variantes), se piden y se refresca la página sin moverla
    if (!keep && shopifyOn && !p.detailed) {
      loadDetail(p).then((changed) => {
        if (!changed || !inProduct || !pd || pd.p !== p) return;
        const y = scrollY; renderProductPage(p.id, true); window.scrollTo(0, y);
      });
    }
  }

  // Actualiza precio, disponibilidad y botones según la variante elegida
  function pdSync() {
    const v = pd.p.variants[pd.vi];
    const out = v.stock <= 0;
    $('#pdPrice').innerHTML = `<span class="now">${money(v.price)}</span>${v.oldPrice ? `<span class="was">${money(v.oldPrice)}</span><span class="badge badge--off">Ahorras ${money(v.oldPrice - v.price)}</span>` : ''}`;
    const st = $('#pdStock');
    st.className = 'pd__stock ' + (out ? 'is-out' : v.stock <= 5 ? 'is-low' : '');
    st.textContent = out ? 'Agotado' : v.stock <= 5 ? `¡Solo quedan ${v.stock}!` : 'Disponible';
    $$('[data-action="pd-add"], [data-action="pd-buy"]').forEach((b) => (b.disabled = out));
    const img = $('#pdMain img');
    if (img && v.image) img.src = v.image;
    pdSetQty(pd.qty);
  }
  function pdSetQty(n) {
    const max = Math.max(1, Math.min(pd.p.variants[pd.vi].stock, 99));
    pd.qty = Math.max(1, Math.min(max, n));
    $('#pdQty').textContent = pd.qty;
    $('[data-action="pd-dec"]').disabled = pd.qty <= 1;
    $('[data-action="pd-inc"]').disabled = pd.qty >= max;
  }

  /* ---------- Pago en Shopify: crea el carrito y manda al cliente a su checkout ---------- */
  async function shopifyCheckout(btn) {
    const lines = cartLines().map((l) => ({ merchandiseId: l.v.id, quantity: l.qty }));
    if (!lines.length) return;
    const label = btn.innerHTML;
    btn.disabled = true; btn.textContent = 'Abriendo el pago…';
    try {
      const data = await gql(`mutation Checkout($lines: [CartLineInput!]!) {
        cartCreate(input: { lines: $lines }) { cart { checkoutUrl } userErrors { message } }
      }`, { lines });
      const { cart: created, userErrors } = data.cartCreate;
      if (userErrors?.length || !created?.checkoutUrl) throw new Error(userErrors?.[0]?.message || 'Shopify no devolvió el enlace de pago');
      window.location.href = created.checkoutUrl;
    } catch (err) {
      console.error(err);
      toast('No pudimos abrir el pago. Inténtalo de nuevo o pídelo por WhatsApp.', { type: 'warn' });
      btn.disabled = false; btn.innerHTML = label;
    }
  }

  /* ---------- Checkout por WhatsApp ---------- */
  function openCheckout() {
    const t = totals();
    if (!t.count) return;
    const c = store.get('customer', {});
    $('#checkoutBody').innerHTML = `
      <form class="co" id="coForm" novalidate>
        <h2>Finalizar compra</h2>
        <p>Completa tus datos y te abrimos WhatsApp con tu pedido listo para enviar.</p>
        <div class="form">
          <div class="field"><label for="coName">Nombre completo</label><input id="coName" name="name" required autocomplete="name" value="${esc(c.name)}"></div>
          <div class="field"><label for="coPhone">Teléfono / WhatsApp</label><input id="coPhone" name="phone" type="tel" required inputmode="tel" autocomplete="tel" placeholder="809-000-0000" pattern="[0-9+()\\-\\s]{7,}" value="${esc(c.phone)}"></div>
          <div class="field"><label for="coCity">Ciudad / sector</label><input id="coCity" name="city" required autocomplete="address-level2" value="${esc(c.city)}"></div>
          <div class="field"><label for="coPay">Forma de pago</label><select id="coPay" name="pay">${S.paymentMethods.map((m) => `<option>${esc(m)}</option>`).join('')}</select></div>
          <div class="field field--full"><label for="coAddr">Dirección de entrega</label><input id="coAddr" name="address" required autocomplete="street-address" placeholder="Calle, número, referencia…" value="${esc(c.address)}"></div>
          <div class="field field--full"><label for="coNotes">Notas (opcional)</label><textarea id="coNotes" name="notes" placeholder="Color, talla, hora de entrega…"></textarea></div>
        </div>
        <div class="co__sum">
          <div class="co__list">${t.lines.map(({ p, v, qty }) => `<div><span>${qty} × ${esc(lineName(p, v))}</span><b>${money(v.price * qty)}</b></div>`).join('')}</div>
          <div class="sum">
            <div><span>Subtotal</span><span>${money(t.sub)}</span></div>
            <div><span>Envío</span><span class="${t.ship ? '' : 'free'}">${t.ship ? money(t.ship) : 'Gratis'}</span></div>
            <div class="total"><span>Total</span><span>${money(t.total)}</span></div>
          </div>
        </div>
        <button class="btn btn--wa btn--lg btn--block" type="submit">${icon('wa')} Enviar pedido por WhatsApp</button>
        <p class="co__note">No se cobra nada en este paso. Confirmamos el pago y la entrega contigo por WhatsApp.</p>
      </form>`;
    openLayer('checkout');
    $('#coForm').addEventListener('submit', submitOrder);
  }

  function submitOrder(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const d = Object.fromEntries(new FormData(form));
    const t = totals();
    const ref = Date.now().toString(36).slice(-5).toUpperCase();
    store.set('customer', { name: d.name, phone: d.phone, city: d.city, address: d.address });
    const msg = [
      `*Nuevo pedido #${ref}* — ${S.name}`, '',
      `*Cliente:* ${d.name}`, `*Teléfono:* ${d.phone}`, `*Ciudad/Sector:* ${d.city}`, `*Dirección:* ${d.address}`, `*Pago:* ${d.pay}`, '',
      '*Productos:*', ...t.lines.map(({ p, v, qty }) => `• ${qty} x ${lineName(p, v)} — ${money(v.price * qty)}`), '',
      `Subtotal: ${money(t.sub)}`, `Envío: ${t.ship ? money(t.ship) : 'Gratis'}`, `*Total: ${money(t.total)}*`,
      ...(d.notes ? ['', `*Notas:* ${d.notes}`] : [])
    ].join('\n');
    const url = waLink(msg);
    window.open(url, '_blank', 'noopener');
    cart = {}; save(); renderCart();
    $('#checkoutBody').innerHTML = `
      <div class="done">
        <div class="done__check">${icon('check')}</div>
        <h2>¡Pedido listo, ${esc(d.name.split(' ')[0])}!</h2>
        <p>Tu pedido <b>#${ref}</b> está preparado. Envía el mensaje en WhatsApp para que lo confirmemos contigo.</p>
        <a class="btn btn--wa btn--lg btn--block" href="${esc(url)}" target="_blank" rel="noopener">${icon('wa')} Abrir WhatsApp de nuevo</a>
        <button class="btn btn--ghost btn--block" data-action="close-layer">Seguir comprando</button>
      </div>`;
  }

  /* ==========================================================================
     Búsqueda
     ========================================================================== */
  const si = $('#searchInput'), sug = $('#suggest');
  const closeSuggest = () => sug.classList.remove('is-open');
  function renderSuggest(raw) {
    const q = norm(raw.trim());
    if (!q || !P.length) { closeSuggest(); return; }
    const hits = P.filter((p) => norm(`${p.name} ${catById(p.category)?.name || ''}`).includes(q));
    sug.innerHTML = hits.length
      ? hits.slice(0, 5).map((p) => `
          <button class="suggest__item" role="option" data-action="suggest" data-id="${esc(p.id)}" style="--h:${p.hue}">
            <span class="suggest__thumb">${media(p)}</span>
            <span class="suggest__name">${esc(p.name)}</span><span class="suggest__price">${money(p.price)}</span>
          </button>`).join('') + `<button class="suggest__all" data-action="search-all">Ver los ${hits.length} resultado${hits.length === 1 ? '' : 's'}</button>`
      : `<div class="suggest__none">Sin resultados para “${esc(raw)}”</div>`;
    sug.classList.add('is-open');
  }
  function applySearch() {
    f.q = si.value.trim(); f.cat = 'all'; closeSuggest(); refresh(); goCatalog();
  }
  si.addEventListener('input', debounce(() => renderSuggest(si.value), 120));
  si.addEventListener('focus', () => renderSuggest(si.value));
  si.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); $('.suggest__item', sug)?.focus(); } });
  sug.addEventListener('keydown', (e) => {
    const items = $$('.suggest__item, .suggest__all', sug);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i <= 0 ? si : items[i - 1]).focus(); }
  });
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); applySearch(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#search')) closeSuggest(); });

  /* ==========================================================================
     Eventos globales
     ========================================================================== */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const id = el.closest('[data-id]')?.dataset.id;
    switch (el.dataset.action) {
      case 'view': openProduct(id); break;
      case 'home': leaveProduct(); window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); break;
      case 'back':
        if (history.state?.pp) history.back();
        else { leaveProduct(); window.scrollTo(0, homeY); }
        break;
      case 'copy-link': {
        const url = `${location.origin}${location.pathname}#/producto/${encodeURIComponent(id)}`;
        (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => toast('Enlace copiado'), () => toast('No pudimos copiar el enlace', { type: 'warn' }));
        break;
      }
      case 'suggest': closeSuggest(); openProduct(id); break;
      case 'search-all': applySearch(); break;
      case 'add': {
        const p = byId(id); if (!p) break;
        if (p.variants.length > 1) openProduct(id); else addToCart(p.variants[0].id);
        break;
      }
      case 'wish': toggleWish(id); break;
      case 'cat': e.preventDefault(); setCategory(el.dataset.cat); break;
      case 'reset': resetFilters(); break;
      case 'reload': location.reload(); break;
      case 'inc': setQty(id, (cart[id] || 0) + 1); break;
      case 'dec': setQty(id, (cart[id] || 0) - 1); break;
      case 'remove': { const e2 = variantMap.get(id); setQty(id, 0); if (e2) toast(`${lineName(e2.p, e2.v)} eliminado`); break; }
      case 'checkout': if (checkoutMode === 'shopify') shopifyCheckout(el); else openCheckout(); break;
      case 'wa-checkout': openCheckout(); break;
      case 'close-layer': closeLayer(); break;
      case 'variant': {
        pd.vi = +el.dataset.i;
        $$('.pill').forEach((b) => { const on = b === el; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on); });
        pdSync();
        break;
      }
      case 'thumb': {
        $$('.pd__thumbs button').forEach((b) => b.classList.toggle('is-active', b === el));
        const img = $('#pdMain img'); if (img) img.src = el.dataset.src;
        break;
      }
      case 'pd-inc': pdSetQty(pd.qty + 1); break;
      case 'pd-dec': pdSetQty(pd.qty - 1); break;
      case 'pd-add': if (addToCart(pd.p.variants[pd.vi].id, pd.qty, true)) openLayer('cart'); break;
      case 'pd-buy':
        if (addToCart(pd.p.variants[pd.vi].id, pd.qty, true)) { if (checkoutMode === 'shopify') shopifyCheckout(el); else openCheckout(); }
        break;
    }
  });

  $('#cartBtn').addEventListener('click', () => openLayer('cart'));
  $('#wishBtn').addEventListener('click', () => setFav(!f.fav));
  $('#favFilter').addEventListener('click', () => setFav(!f.fav));
  $('#themeBtn').addEventListener('click', () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(t); store.set('theme', t);
  });
  $('#sortSel').addEventListener('change', (e) => { f.sort = e.target.value; refresh(); });
  $('#loadMore').addEventListener('click', () => { f.shown += S.pageSize; renderCatalog({ append: true }); });
  const range = $('#priceRange');
  range.addEventListener('input', () => { f.max = +range.value; refresh(); });
  function setupRange() {
    range.min = 0; range.max = rangeMax; range.step = priceStep; range.value = rangeMax;
    range.closest('.price').hidden = P.length < 2;
  }
  $('#toTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (openName) closeLayer(); closeSuggest(); }
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); si.focus(); }
    if (e.key === 'Tab' && openName) {
      const foc = $$('button:not([disabled]), a[href], input, select, textarea, summary', layers[openName]).filter((x) => x.offsetParent !== null);
      if (!foc.length) return;
      const first = foc[0], last = foc[foc.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      $('#header').classList.toggle('is-stuck', scrollY > 8);
      $('#toTop').classList.toggle('is-show', scrollY > 700);
      ticking = false;
    });
  }, { passive: true });

  // Si cambian las pestañas, mantener el carrito sincronizado
  window.addEventListener('storage', (e) => {
    if (e.key === S.storageKey + 'cart') { cart = store.get('cart', {}); renderCart(); }
  });

  /* ---------- Arranque ---------- */
  const skeletons = (n) => Array.from({ length: n }, () =>
    '<div class="card card--skeleton" aria-hidden="true"><div class="card__media"></div><div class="card__body"><i></i><i></i><i class="short"></i></div></div>').join('');

  async function start() {
    initTopbar();
    initHero();
    $('#toolbar').hidden = true;
    $('#grid').innerHTML = skeletons(8);
    // Enlace directo a un producto: mostrar la ficha (cargando) en vez de la portada
    if (productHash()) { inProduct = true; home.hidden = true; view.hidden = false; view.innerHTML = '<div class="container"><p class="muted pview__loading">Cargando producto…</p></div>'; }

    let list = window.PRODUCTS || [];
    if (shopifyOn) {
      try { list = await loadShopifyProducts(); }
      catch (err) { console.error('No se pudieron cargar los productos de Shopify:', err); list = []; loadError = true; }
    }
    setProducts(list);
    setupRange();

    renderStatic();
    renderDeals();
    renderCatalog();
    syncCatUI();
    syncWishUI();
    renderCart();
    observeReveals();

    // Enlaces directos: /#/producto/<handle> (también /#producto=<handle>, que usa el tema de Shopify) y /#carrito
    if (productHash()) route();
    else if (location.hash === '#carrito') openLayer('cart');
  }
  start();
})();
