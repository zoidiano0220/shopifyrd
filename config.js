/* ==========================================================================
   CONFIGURACIÓN DE LA TIENDA
   Todo lo que cambia de un negocio a otro vive aquí: nombre, contacto,
   categorías, banners del inicio, envíos y preguntas frecuentes.
   ========================================================================== */
window.STORE = {
  name: 'shopifyRD',                      // nombre de la tienda
  tagline: 'Todo lo que necesitas, en un solo lugar',

  currency: 'RD$',
  locale: 'es-DO',
  storageKey: 'shopifyrd:',               // prefijo para guardar carrito/favoritos en el navegador

  // Datos de contacto. Si dejas uno VACÍO, la página no lo muestra.
  // WhatsApp en formato internacional, sin + ni espacios (ej. 18095551234).
  whatsapp: '',                           // ← PONER tu número cuando lo tengas
  email: '',                              // ← PONER tu correo
  phone: '',                              // ← PONER tu teléfono
  address: 'Santo Domingo, República Dominicana',
  social: { instagram: '#', facebook: '#', tiktok: '#' },

  // Envío: hoy es GRATIS en todos los pedidos (0 y 0).
  // Si algún día quieres cobrarlo: shippingFee = tarifa y freeShippingFrom = monto desde el que es gratis.
  freeShippingFrom: 0,
  shippingFee: 0,
  pageSize: 12,                           // productos que se muestran por "página"

  /* ------------------------------------------------------------------------
     CONEXIÓN CON SHOPIFY (opcional)
     Mientras "domain" y "storefrontToken" estén vacíos, la tienda usa los
     productos de js/products.js. Cuando los llenas, los productos, precios,
     fotos, variantes y disponibilidad salen directo de tu Shopify.

     Cómo conseguirlos (Shopify Admin):
       1. Instala el canal "Headless" desde la Shopify App Store.
       2. Dentro del canal: "Create storefront" → copia el "Public access token".
       3. En Ajustes → Dominios copia tu dominio  xxxx.myshopify.com
     ⚠ Solo el token PÚBLICO de la Storefront API. NUNCA pegues aquí el token
       de la Admin API ni el "private token": cualquiera podría verlo.
     ------------------------------------------------------------------------ */
  shopify: {
    domain: 'shoppyrd.myshopify.com',   // dominio de tu tienda en Shopify
    storefrontToken: '6bbafb6aa55e462e123c2132faa3d72e',   // token PÚBLICO del canal Headless (seguro para la web)
    apiVersion: '2026-07',
    checkout: 'shopify',      // 'shopify' = el cliente paga en el checkout de Shopify | 'whatsapp' = pedido por WhatsApp
    showWhatsAppOrder: true,  // con checkout 'shopify', mostrar también "Pedir por WhatsApp"
    readStock: false,         // true solo si el token tiene el permiso unauthenticated_read_product_inventory
    endpoint: ''              // avanzado: URL propia de la API (déjalo vacío)
  },

  // Formas de pago que se muestran en el pie de página (el checkout de Shopify manda las reales)
  paymentMethods: [
    'Pago contra entrega'
  ],

  // Mensajes que rotan en la barra superior
  announcements: [
    'Envío gratis y entrega el mismo día',
    'Paga en efectivo cuando recibas tu pedido',
    'Nuevos productos cada semana'
  ],

  // Categorías conocidas: con Shopify conectado, las categorías salen del "Tipo de producto"
  // de cada producto; aquí solo se define el emoji y el color de las que coincidan por nombre.
  categories: [
    { id: 'belleza-y-cuidado-personal',      name: 'Belleza y Cuidado Personal',      emoji: '💄', hue: 350 },
    { id: 'salud-y-bienestar',               name: 'Salud y Bienestar',               emoji: '🌿', hue: 140 },
    { id: 'hogar-y-oficina',                 name: 'Hogar y Oficina',                 emoji: '🏠', hue: 28  },
    { id: 'tecnologia-y-electronica',        name: 'Tecnología y Electrónica',        emoji: '💻', hue: 232 },
    { id: 'electrodomesticos',               name: 'Electrodomésticos',               emoji: '🔌', hue: 200 },
    { id: 'moda-para-mujer',                 name: 'Moda para Mujer',                 emoji: '👗', hue: 330 },
    { id: 'moda-para-hombre',                name: 'Moda para Hombre',                emoji: '👔', hue: 215 },
    { id: 'moda-unisex',                     name: 'Moda Unisex',                     emoji: '👕', hue: 280 },
    { id: 'herramientas-y-construccion',     name: 'Herramientas y Construcción',     emoji: '🛠️', hue: 40  },
    { id: 'automotriz',                      name: 'Automotriz',                      emoji: '🚗', hue: 5   },
    { id: 'juguetes-y-hobbies',              name: 'Juguetes y Hobbies',              emoji: '🧸', hue: 45  },
    { id: 'deporte-ejercicio-y-recreacion',  name: 'Deporte, Ejercicio y Recreación', emoji: '⚽', hue: 150 },
    { id: 'arte-y-papeleria',                name: 'Arte y Papelería',                emoji: '✏️', hue: 260 },
    { id: 'viaje-y-equipajes',               name: 'Viaje y Equipajes',               emoji: '🧳', hue: 190 },
    { id: 'bebes',                           name: 'Bebés',                           emoji: '🍼', hue: 320 },
    { id: 'mascotas',                        name: 'Mascotas',                        emoji: '🐾', hue: 25  },
    { id: 'alimentos-y-bebidas',             name: 'Alimentos y Bebidas',             emoji: '🍎', hue: 100 },
    { id: 'agro',                            name: 'Agro',                            emoji: '🌱', hue: 120 },
    { id: 'libros-musica-y-peliculas',       name: 'Libros, Música y Películas',      emoji: '📚', hue: 245 }
  ],

  // Banners grandes del inicio. "from"/"to" = colores del degradado.
  heroSlides: [
    {
      eyebrow: 'Bienvenido',
      title: 'Todo lo que necesitas, en un solo lugar',
      text: 'Tecnología, hogar, moda y mucho más. Compra fácil y recibe en la puerta de tu casa.',
      cta: 'Ver productos', href: '#catalogo',
      from: '#4338ca', to: '#7c3aed',
      emoji: '🛍️', chips: ['Nuevos productos', 'Envío gratis'], bubbles: ['🎧', '⌚']
    },
    {
      eyebrow: 'Catálogo',
      title: 'Encuentra lo que buscas',
      text: 'Belleza, salud, hogar, tecnología, moda y mucho más. Usa el buscador o explora por categoría.',
      cta: 'Explorar categorías', href: '#categorias',
      from: '#ea580c', to: '#db2777',
      emoji: '🔎', chips: ['Muchas categorías', 'Búscalo fácil'], bubbles: ['💄', '🏠']
    },
    {
      eyebrow: 'Paga al recibir',
      title: 'Recibe primero, paga después',
      text: 'Haz tu pedido, te lo llevamos a tu casa y pagas en efectivo cuando lo recibas.',
      cta: 'Cómo comprar', href: '#como-comprar',
      from: '#047857', to: '#0e7490',
      emoji: '📦', chips: ['Pago contra entrega', 'Envío gratis'], bubbles: ['💵', '🚚']
    }
  ],

  // Franja de beneficios. Ajusta los textos a lo que realmente ofreces.
  perks: [
    { icon: 'truck',  title: 'Envío gratis',          text: 'Recibe tu pedido el mismo día' },
    { icon: 'shield', title: 'Pago contra entrega',   text: 'Pagas en efectivo cuando recibes' },
    { icon: 'undo',   title: 'Garantía',              text: 'Respaldo en todos tus productos' },
    { icon: 'chat',   title: 'Atención directa',      text: 'Te ayudamos con tu pedido' }
  ],

  // Preguntas frecuentes. Ajusta las respuestas a tus políticas reales.
  faqs: [
    { q: '¿Cómo hago un pedido?',
      a: 'Agrega los productos al carrito, toca "Pagar", llena tus datos de entrega y elige "Pago contra entrega". Listo: te llevamos el pedido a tu casa.' },
    { q: '¿Cuánto tarda el envío?',
      a: 'Recibes tu producto el mismo día. ¡Y el envío es gratis!' },
    { q: '¿Qué métodos de pago aceptan?',
      a: 'Pago contra entrega: pagas en efectivo cuando recibes tu pedido.' }
  ]
};
