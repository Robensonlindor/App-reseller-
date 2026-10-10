import { Game, Service, ServicePackage, RechargeGamesProduct } from '../types';

export const OFFICIAL_GAME_COVER_IMAGES: Record<string, string> = {
  'free-fire': '/src/assets/images/game_cover_freefire_1790988876938.jpg',
  'pubg-mobile': '/src/assets/images/game_cover_pubg_1790988886654.jpg',
  'mobile-legends': '/src/assets/images/game_cover_mobilelegends_1790988897466.jpg',
  'roblox': '/src/assets/images/game_cover_roblox_1791597763017.jpg',
  'cod-mobile': '/src/assets/images/game_cover_codm_1791597775192.jpg',
  'genshin-impact': '/src/assets/images/game_cover_genshin_1791597787503.jpg',
  'valorant': '/src/assets/images/game_cover_valorant_1791597799488.jpg',
  'valorant-points': '/src/assets/images/game_cover_valorant_1791597799488.jpg',
  'blood-strike': '/src/assets/images/game_cover_bloodstrike_1791597808989.jpg'
};

function buildBespokeGameSvgDataUri(
  title: string,
  subtitle: string,
  bgStart: string,
  bgEnd: string,
  accent: string,
  badgeSymbol: string
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgStart}"/>
        <stop offset="100%" stop-color="${bgEnd}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="42%" r="50%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="coin" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="${accent}"/>
      </linearGradient>
    </defs>
    <rect width="800" height="500" fill="url(#bg)"/>
    <circle cx="400" cy="210" r="240" fill="url(#glow)"/>
    <g opacity="0.16" stroke="${accent}" stroke-width="2" fill="none">
      <polygon points="400,45 550,130 550,290 400,375 250,290 250,130"/>
      <polygon points="400,75 520,145 520,275 400,345 280,275 280,145"/>
    </g>
    <circle cx="400" cy="195" r="86" fill="${bgStart}" stroke="url(#coin)" stroke-width="6"/>
    <text x="400" y="218" text-anchor="middle" fill="url(#coin)" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="64">${badgeSymbol}</text>
    <text x="400" y="365" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="42" letter-spacing="1">${title}</text>
    <text x="400" y="410" text-anchor="middle" fill="${accent}" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="22" letter-spacing="3">${subtitle}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const BESPOKE_SVG_COVERS: Record<string, string> = {
  '8-ball-pool': buildBespokeGameSvgDataUri('8 BALL POOL', 'POOL CASH & COINS', '#071925', '#042f2e', '#10b981', '8'),
  'honkai-star-rail': buildBespokeGameSvgDataUri('HONKAI: STAR RAIL', 'ONEIRIC SHARDS', '#0f1026', '#1e1b4b', '#38bdf8', '✦'),
  'delta-force': buildBespokeGameSvgDataUri('DELTA FORCE', 'DELTA COINS', '#09130c', '#14281d', '#22c55e', 'Δ'),
  'yalla-ludo': buildBespokeGameSvgDataUri('YALLA LUDO', 'DIAMONDS & GOLD', '#2a0826', '#4a044e', '#f59e0b', '🎲'),
  'arena-breakout': buildBespokeGameSvgDataUri('ARENA BREAKOUT', 'TACTICAL BONDS', '#18120b', '#291d12', '#f97316', '⚔'),
  'league-of-legends': buildBespokeGameSvgDataUri('LEAGUE OF LEGENDS', 'RIOT POINTS (RP)', '#061428', '#0a2246', '#eab308', 'RP'),
  'eafc-mobile': buildBespokeGameSvgDataUri('EA SPORTS FC', 'FC POINTS & SILVER', '#051e14', '#064e3b', '#34d399', 'FC')
};

/**
 * Resolves the appropriate product image for a game slug or name.
 */
export function getDefaultImageForSlugOrName(slugOrName?: string | null): string {
  const s = String(slugOrName || '').toLowerCase().trim();
  if (!s) return OFFICIAL_GAME_COVER_IMAGES['free-fire'];

  if (s.includes('roblox') || s.includes('robux')) return OFFICIAL_GAME_COVER_IMAGES['roblox'];
  if (s.includes('cod') || s.includes('call of duty') || s.includes('call-of-duty')) return OFFICIAL_GAME_COVER_IMAGES['cod-mobile'];
  if (s.includes('genshin')) return OFFICIAL_GAME_COVER_IMAGES['genshin-impact'];
  if (s.includes('valorant')) return OFFICIAL_GAME_COVER_IMAGES['valorant'];
  if (s.includes('blood') && s.includes('strike')) return OFFICIAL_GAME_COVER_IMAGES['blood-strike'];
  if (s.includes('pubg') || s.includes('bgmi')) return OFFICIAL_GAME_COVER_IMAGES['pubg-mobile'];
  if (s.includes('mobile-legends') || s.includes('mobile legends') || s.includes('mlbb')) return OFFICIAL_GAME_COVER_IMAGES['mobile-legends'];
  if (s.includes('8-ball') || s.includes('8 ball')) return BESPOKE_SVG_COVERS['8-ball-pool'];
  if (s.includes('honkai') || s.includes('star-rail') || s.includes('star rail')) return BESPOKE_SVG_COVERS['honkai-star-rail'];
  if (s.includes('delta-force') || s.includes('delta force')) return BESPOKE_SVG_COVERS['delta-force'];
  if (s.includes('yalla')) return BESPOKE_SVG_COVERS['yalla-ludo'];
  if (s.includes('arena-breakout') || s.includes('arena breakout')) return BESPOKE_SVG_COVERS['arena-breakout'];
  if (s.includes('league-of-legends') || s.includes('league of legends')) return BESPOKE_SVG_COVERS['league-of-legends'];
  if (s.includes('eafc') || s.includes('ea sports fc') || s.includes('fc-2')) return BESPOKE_SVG_COVERS['eafc-mobile'];
  if (s.includes('free-fire') || s.includes('free fire')) return OFFICIAL_GAME_COVER_IMAGES['free-fire'];

  return OFFICIAL_GAME_COVER_IMAGES['free-fire'];
}

/**
 * Checks if a stored logo path on a non-FreeFire/non-PUBG game was an old mismatched default
 * (e.g., Roblox using Free Fire image or CODM using PUBG image) so we can upgrade it to its true product cover,
 * while strictly preserving any custom URL pasted by the administrator.
 */
export function resolveGameCoverImage(game?: Partial<Game> | null): string {
  if (!game) return OFFICIAL_GAME_COVER_IMAGES['free-fire'];
  const slug = String(game.slug || game.externalGameId || game.name || '').toLowerCase();
  const rawLogo = String(game.logo || '').trim();

  if (rawLogo) {
    const isOldMismatchedRoblox =
      slug.includes('roblox') && rawLogo.includes('game_cover_freefire');
    const isOldMismatchedCodm =
      (slug.includes('cod') || slug.includes('call')) &&
      (rawLogo.includes('game_cover_pubg') || rawLogo.includes('game_cover_codm_1790988899502'));
    const isOldBrokenMlbb =
      rawLogo.includes('game_cover_mlbb_1790988892334');

    if (!isOldMismatchedRoblox && !isOldMismatchedCodm && !isOldBrokenMlbb) {
      return rawLogo;
    }
  }

  return getDefaultImageForSlugOrName(slug || game.name);
}

/**
 * Resolves the authoritative image URL for any service package card:
 * 1. Package custom imageUrl (set in Admin Panel)
 * 2. Service custom imageUrl (set in Admin Panel)
 * 3. Game custom logo / resolved product cover image
 */
export function resolveServiceCardImage(
  game?: Partial<Game> | null,
  service?: Partial<Service> | null,
  pkg?: Partial<ServicePackage> | null,
  rgProduct?: Partial<RechargeGamesProduct> | null
): string {
  const pkgImg = String(pkg?.imageUrl || rgProduct?.image_url || '').trim();
  if (pkgImg) return pkgImg;

  const srvImg = String(service?.imageUrl || '').trim();
  if (srvImg) return srvImg;

  if (game) {
    return resolveGameCoverImage(game);
  }

  const fallbackHint =
    pkg?.externalGameId ||
    pkg?.productKey ||
    pkg?.name ||
    rgProduct?.game_slug ||
    rgProduct?.game ||
    service?.externalGameId ||
    service?.name ||
    '';

  return getDefaultImageForSlugOrName(fallbackHint);
}
