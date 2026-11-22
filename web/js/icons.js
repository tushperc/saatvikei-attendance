// Line icons (Lucide-style, 24px grid, stroke = currentColor) and a few brand marks.
const p = (d, extra = '') => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const I = {
  today: p('<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/><circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none"/>'),
  approvals: p('<path d="M9 12l2 2 4-4"/><path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z"/>'),
  records: p('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  staff: p('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.3 3.3 0 010 6.5M18.5 14.8c1.7.8 2.8 2.6 3.2 5.2"/>'),
  setup: p('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  search: p('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  x: p('<path d="M18 6L6 18M6 6l12 12"/>'),
  camera: p('<path d="M3 8a2 2 0 012-2h2.5l1.5-2h6l1.5 2H19a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><circle cx="12" cy="13" r="4"/>'),
  login: p('<path d="M15 3h3a3 3 0 013 3v12a3 3 0 01-3 3h-3"/><path d="M10 17l5-5-5-5M15 12H3"/>'),
  logout: p('<path d="M9 21H6a3 3 0 01-3-3V6a3 3 0 013-3h3"/><path d="M16 17l5-5-5-5M21 12H9"/>'),
  coffee: p('<path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4z"/><path d="M6 2v2M10 2v2M14 2v2"/>'),
  back: p('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),
  clock: p('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  pin: p('<path d="M12 21s-7-6.2-7-11.5a7 7 0 1114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  phone: p('<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>'),
  refresh: p('<path d="M21 12a9 9 0 01-15.5 6.3L3 16"/><path d="M3 12A9 9 0 0118.5 5.7L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>'),
  left: p('<path d="M15 18l-6-6 6-6"/>'),
  right: p('<path d="M9 18l6-6-6-6"/>'),
  plus: p('<path d="M12 5v14M5 12h14"/>'),
  edit: p('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),
  trash: p('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  image: p('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>'),
  download: p('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  check: p('<path d="M20 6L9 17l-5-5"/>'),
  alert: p('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>'),
  bell: p('<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>'),
  shield: p('<path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>'),
  link: p('<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/>'),
  user: p('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6"/>'),
  calendar: p('<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/>'),
  sparkle: p('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
  chevronDown: p('<path d="M6 9l6 6 6-6"/>'),
  more: p('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),

  sheets: `<svg class="ic brandmark" viewBox="0 0 48 64" aria-hidden="true"><path d="M30 0H6a6 6 0 00-6 6v52a6 6 0 006 6h36a6 6 0 006-6V18z" fill="#0F9D58"/><path d="M30 0v12a6 6 0 006 6h12z" fill="#87CEAC"/><rect x="10" y="28" width="28" height="24" rx="2" fill="#fff"/><path d="M10 36h28M10 44h28M22 28v24" stroke="#0F9D58" stroke-width="2.4"/></svg>`,
  drive: `<svg class="ic brandmark" viewBox="0 0 87.3 78" aria-hidden="true"><path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9.06 9.06 0 000 53h27.5z" fill="#00ac47"/><path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335"/><path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="M73.4 26.5L60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>`,
  telegram: `<svg class="ic brandmark" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="#29A9EB"/><path d="M10.9 23.5l23.2-9c1.1-.4 2 .3 1.7 1.9l-3.9 18.6c-.3 1.3-1.1 1.6-2.2 1l-6-4.4-2.9 2.8c-.3.3-.6.6-1.2.6l.4-6.1 11.1-10c.5-.4-.1-.7-.8-.3L16.6 27.2l-5.9-1.8c-1.3-.4-1.3-1.3.2-1.9z" fill="#fff"/></svg>`,
  google: `<svg class="ic brandmark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`,
  // A light lotus outline used as an ornament.
  lotus: `<svg class="ornament" viewBox="0 0 120 60" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M60 52C52 40 52 22 60 6c8 16 8 34 0 46z"/><path d="M60 52c-12-6-20-18-22-34 12 4 20 16 22 34z"/><path d="M60 52c12-6 20-18 22-34-12 4-20 16-22 34z"/><path d="M60 52c-16-2-30-10-38-24 14 0 28 10 38 24z"/><path d="M60 52c16-2 30-10 38-24-14 0-28 10-38 24z"/><path d="M30 56h60"/><circle cx="60" cy="58" r="1" fill="currentColor"/></svg>`
};

export const LOGO_URL = 'https://saatvikei.com/cdn/shop/files/Horizontal_Black_R.png_new_1.png?v=1739510639&width=600';

// Editorial photos from saatvikei.com, used as soft backdrops behind glass.
export const PHOTOS = [
  'https://cdn.shopify.com/s/files/1/0793/3968/4143/files/CHI_OP_2.png?v=1746601276&width=900',
  'https://cdn.shopify.com/s/files/1/0793/3968/4143/files/CAP_CR_7.webp?v=1746601285&width=900',
  'https://cdn.shopify.com/s/files/1/0793/3968/4143/files/CHI_PB_1.png?v=1746601275&width=900',
  'https://cdn.shopify.com/s/files/1/0793/3968/4143/files/CAP_W_1.webp?v=1746601279&width=900'
];
