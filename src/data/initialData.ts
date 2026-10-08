import { Game, Service, Provider, Reseller, ApiKey, Order, AppSettings, SupportTicket, SystemLog, ProviderOrder } from '../types';

export const INITIAL_GAMES: Game[] = [
  {
    id: 'game_ff',
    slug: 'free-fire',
    name: 'Free Fire',
    externalGameId: 'freefire_global',
    providerId: 'prov_goxtop',
    supportsNameCheck: true,
    requiresPlayerId: true,
    category: 'Battle Royale',
    description: 'Recharges instantanées de Diamants Free Fire via GoXtop avec vérification réelle du Free Fire ID (Name Checker).',
    logo: '/src/assets/images/game_cover_freefire_1790988876938.jpg',
    banner: '/src/assets/images/game_cover_freefire_1790988876938.jpg',
    isActive: true,
    displayOrder: 1,
    fields: [
      {
        id: 'f_ff_player_id',
        name: 'playerId',
        label: 'Free Fire ID',
        placeholder: '16777227705',
        type: 'text',
        required: true,
        helperText: 'Votre Free Fire ID numérique (ex: 16777227705). Cliquez sur "Vérifier l’ID" pour valider votre compte auprès de GoXtop.',
        validationRegex: '^[0-9]{6,15}$'
      }
    ],
    createdAt: '2026-01-10T10:00:00Z',
    updatedAt: '2026-03-20T12:00:00Z'
  },
  {
    id: 'game_pubg',
    slug: 'pubg-mobile',
    name: 'PUBG Mobile',
    externalGameId: 'pubgm',
    providerId: 'prov_goxtop',
    supportsNameCheck: true,
    requiresPlayerId: true,
    category: 'Tactical Shooter',
    description: 'Créditation instantanée de Unknown Cash (UC) officielle sur serveur Global via GoXtop.',
    logo: '/src/assets/images/game_cover_pubg_1790988886654.jpg',
    banner: '/src/assets/images/game_cover_pubg_1790988886654.jpg',
    isActive: true,
    displayOrder: 2,
    fields: [
      {
        id: 'f_pubg_character_id',
        name: 'characterId',
        label: 'Character ID (PUBG ID)',
        placeholder: 'ex: 5123984712',
        type: 'text',
        required: true,
        helperText: 'L’identifiant numérique situé à côté de votre avatar en jeu.',
        validationRegex: '^[0-9]{6,15}$'
      }
    ],
    createdAt: '2026-01-12T10:00:00Z',
    updatedAt: '2026-03-20T12:00:00Z'
  },
  {
    id: 'game_mlbb',
    slug: 'mobile-legends',
    name: 'Mobile Legends: Bang Bang',
    externalGameId: 'mlbb_special',
    providerId: 'prov_goxtop',
    supportsNameCheck: true,
    requiresPlayerId: true,
    category: 'MOBA',
    description: 'Recharges ultra-rapides de Diamants MLBB via GoXtop avec vérification User ID et Zone ID.',
    logo: '/src/assets/images/game_cover_mobilelegends_1790988897466.jpg',
    banner: '/src/assets/images/game_cover_mobilelegends_1790988897466.jpg',
    isActive: true,
    displayOrder: 3,
    fields: [
      {
        id: 'f_mlbb_player_id',
        name: 'playerId',
        label: 'Player ID (User ID)',
        placeholder: 'ex: 2009663813',
        type: 'text',
        required: true,
        helperText: 'Votre User ID principal Mobile Legends.',
        validationRegex: '^[0-9]{5,15}$'
      },
      {
        id: 'f_mlbb_zone_id',
        name: 'zoneId',
        label: 'Zone ID (Server Code)',
        placeholder: 'ex: 6104',
        type: 'text',
        required: true,
        helperText: 'Les 4 ou 5 chiffres entre parenthèses à côté de votre User ID.',
        validationRegex: '^[0-9]{3,8}$'
      }
    ],
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-03-20T12:00:00Z'
  },
  {
    id: 'game_codm',
    slug: 'cod-mobile',
    name: 'Call of Duty: Mobile',
    externalGameId: 'codm_sgmy',
    providerId: 'prov_goxtop',
    supportsNameCheck: true,
    requiresPlayerId: true,
    category: 'FPS Mobile',
    description: 'Packs CP Call of Duty Mobile via GoXtop avec vérification du Player ID.',
    logo: '/src/assets/images/game_cover_pubg_1790988886654.jpg',
    banner: '/src/assets/images/game_cover_pubg_1790988886654.jpg',
    isActive: true,
    displayOrder: 4,
    fields: [
      {
        id: 'f_codm_player_id',
        name: 'playerId',
        label: 'Call of Duty Mobile ID',
        placeholder: 'ex: 68192309123849102',
        type: 'text',
        required: true,
        helperText: 'Retrouvez votre Player ID dans les Paramètres > Autre de COD Mobile.'
      }
    ],
    createdAt: '2026-01-20T10:00:00Z',
    updatedAt: '2026-03-20T12:00:00Z'
  },
  {
    id: 'game_roblox',
    slug: 'roblox',
    name: 'Roblox (Codes Digitaux / Vouchers)',
    externalGameId: 'roblox',
    providerId: 'prov_goxtop',
    supportsNameCheck: false,
    requiresPlayerId: false,
    category: 'Voucher / Gift Card',
    description: 'Codes Robux digitaux officiels livrés instantanément (aucun Player ID requis pour les codes PIN).',
    logo: '/src/assets/images/game_cover_freefire_1790988876938.jpg',
    banner: '/src/assets/images/game_cover_freefire_1790988876938.jpg',
    isActive: true,
    displayOrder: 5,
    fields: [], // Aucun champ inutile pour les vouchers qui ne nécessitent pas de Player ID
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-03-20T12:00:00Z'
  }
];

export const INITIAL_PROVIDERS: Provider[] = [
  {
    id: 'prov_rechargegames',
    slug: 'rechargegames',
    adapterType: 'rechargegames',
    name: 'RechargeGames',
    apiUrl: 'https://api.rechargegames.com',
    environment: 'sandbox',
    authHeaderName: 'Authorization',
    hasApiKey: false,
    apiKeyMasked: 'Non configurée',
    hasWebhookSecret: false,
    webhookSecretMasked: 'Non configuré',
    memberId: '',
    partnerId: '',
    merchantId: '',
    webhookUrl: '/api/webhooks/rechargegames',
    isActive: true,
    serviceType: 'RechargeGames Official Top-Up API (Catalogue par Région 🇧🇷/🇺🇸/Global, buyer_ref, Webhooks HMAC-SHA256 & GET /v1/orders/{order_id})',
    priority: 1,
    endpoints: {
      getGamesPath: '/v1/products',
      getProductsPath: '/v1/products',
      createOrderPath: '/v1/orders',
      orderStatusPath: '/v1/orders/{order_id}',
      trackOrderPath: '/v1/orders/{order_id}',
      checkPlayerPath: '/v1/players/verify'
    },
    customParams: [],
    latencyMs: 0,
    lastPingStatus: 'untested',
    lastPingLabel: 'Prêt (Mode TEST / PRODUCTION)'
  },
  {
    id: 'prov_goxtop',
    slug: 'goxtop',
    adapterType: 'goxtop',
    name: 'GoXtop',
    apiUrl: 'https://goxtop.com',
    environment: 'production',
    authHeaderName: 'x-api-key',
    hasApiKey: false,
    apiKeyMasked: 'Non configurée',
    hasWebhookSecret: false,
    webhookSecretMasked: 'Non configuré',
    memberId: '',
    partnerId: '',
    merchantId: '',
    webhookUrl: '/api/webhooks/goxtop',
    isActive: true,
    serviceType: 'Reseller Gaming API (Catalogue, Top-Up, Name Checker, Tracking & Webhooks)',
    priority: 1,
    endpoints: {
      getGamesPath: '/api/v.1/games',
      getProductsPath: '/api/v.1/products/{game}',
      createOrderPath: '/api/v.1/create',
      orderStatusPath: '/api/v.1/:partner_orderid',
      trackOrderPath: '/api/v.1/:partner_orderid/track',
      checkPlayerPath: '/api/check/game-check'
    },
    customParams: [],
    latencyMs: 0,
    lastPingStatus: 'untested',
    lastPingLabel: 'Non testé (Clé API requise)'
  },
  {
    id: 'prov_backup_b',
    slug: 'provider-b',
    adapterType: 'generic_rest',
    name: 'ProviderB (Modulaire)',
    apiUrl: 'https://api.provider-b.example',
    environment: 'production',
    authHeaderName: 'x-api-key',
    hasApiKey: false,
    apiKeyMasked: 'Non configurée',
    hasWebhookSecret: false,
    webhookSecretMasked: 'Non configuré',
    webhookUrl: '/api/webhooks/provider-b',
    isActive: false,
    serviceType: 'Fournisseur Secondaire Modulaire',
    priority: 2,
    endpoints: {
      getGamesPath: '/api/v.1/games',
      getProductsPath: '/api/v.1/products/{game}',
      createOrderPath: '/api/v.1/create',
      orderStatusPath: '/api/v.1/:partner_orderid',
      trackOrderPath: '/api/v.1/:partner_orderid/track',
      checkPlayerPath: '/api/check/game-check'
    },
    customParams: [],
    latencyMs: 0,
    lastPingStatus: 'untested',
    lastPingLabel: 'Inactif'
  }
];

const DEFAULT_USD_TO_HTG_RATE = 132;

function withHtgPricing<T extends { supplierCost: number; publicPrice: number; resellerPrice: number }>(pkg: T): T & {
  supplierCostUsd: number;
  supplierCostHtg: number;
  publicPriceHtg: number;
  resellerPriceHtg: number;
  profitHtg: number;
  marginHtg: number;
  marginPercent: number;
  exchangeRateUsdHtg: number;
  referenceCurrency: 'USD';
  sellingCurrency: 'HTG';
} {
  const supplierCostUsd = Number(pkg.supplierCost || 0);
  const supplierCostHtg = Number((supplierCostUsd * DEFAULT_USD_TO_HTG_RATE).toFixed(2));
  const publicPriceHtg = Math.round(Number(pkg.publicPrice || 0) * DEFAULT_USD_TO_HTG_RATE);
  const resellerPriceHtg = Math.round(Number(pkg.resellerPrice || 0) * DEFAULT_USD_TO_HTG_RATE);
  const profitHtg = Number((publicPriceHtg - supplierCostHtg).toFixed(2));
  const marginPercent = supplierCostHtg > 0 ? Number(((profitHtg / supplierCostHtg) * 100).toFixed(2)) : 20;
  return {
    ...pkg,
    supplierCostUsd,
    supplierCostHtg,
    publicPriceHtg,
    resellerPriceHtg,
    profitHtg,
    marginHtg: profitHtg,
    marginPercent,
    exchangeRateUsdHtg: DEFAULT_USD_TO_HTG_RATE,
    referenceCurrency: 'USD',
    sellingCurrency: 'HTG'
  };
}

export const INITIAL_SERVICES: Service[] = [
  {
    id: 'srv_ff_diamonds',
    gameId: 'game_ff',
    externalGameId: 'freefire_global',
    name: 'Free Fire Diamonds (Global)',
    description: 'Recharges directes de Diamants Free Fire via RechargeGames & GoXtop avec vérification réelle du nom du joueur.',
    category: 'diamonds',
    providerId: 'prov_rechargegames',
    isActive: true,
    displayOrder: 1,
    packages: [
      withHtgPricing({ id: 'pkg_freefire_global_110', serviceId: 'srv_ff_diamonds', externalProductId: 'FREEFIRE_GLOBAL_110', providerSlug: 'rechargegames', externalGameId: 'freefire_global', name: '110 Diamonds', amount: 110, unit: 'Diamonds', supplierCost: 0.78, margin: 0.19, publicPrice: 0.97, resellerPrice: 0.87, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId'], displayOrder: 1 }),
      withHtgPricing({ id: 'pkg_freefire_global_341', serviceId: 'srv_ff_diamonds', externalProductId: 'FREEFIRE_GLOBAL_341', providerSlug: 'rechargegames', externalGameId: 'freefire_global', name: '341 Diamonds', amount: 341, unit: 'Diamonds', supplierCost: 2.35, margin: 0.61, publicPrice: 2.96, resellerPrice: 2.67, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId'], displayOrder: 2 }),
      withHtgPricing({ id: 'pkg_freefire_global_572', serviceId: 'srv_ff_diamonds', externalProductId: 'FREEFIRE_GLOBAL_572', providerSlug: 'rechargegames', externalGameId: 'freefire_global', name: '572 Diamonds', amount: 572, unit: 'Diamonds', supplierCost: 3.90, margin: 0.92, publicPrice: 4.82, resellerPrice: 4.34, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId'], displayOrder: 3 }),
      withHtgPricing({ id: 'pkg_freefire_global_1166', serviceId: 'srv_ff_diamonds', externalProductId: 'FREEFIRE_GLOBAL_1166', providerSlug: 'rechargegames', externalGameId: 'freefire_global', name: '1166 Diamonds', amount: 1166, unit: 'Diamonds', supplierCost: 7.80, margin: 1.86, publicPrice: 9.66, resellerPrice: 8.69, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId'], displayOrder: 4 }),
      withHtgPricing({ id: 'pkg_freefire_global_2398', serviceId: 'srv_ff_diamonds', externalProductId: 'FREEFIRE_GLOBAL_2398', providerSlug: 'rechargegames', externalGameId: 'freefire_global', name: '2398 Diamonds', amount: 2398, unit: 'Diamonds', supplierCost: 15.50, margin: 3.81, publicPrice: 19.31, resellerPrice: 17.38, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId'], displayOrder: 5 }),
      withHtgPricing({ id: 'pkg_freefire_global_weekly_membership', serviceId: 'srv_ff_diamonds', externalProductId: 'FREEFIRE_GLOBAL_Weekly_Membership', providerSlug: 'rechargegames', externalGameId: 'freefire_global', name: 'Weekly Membership', amount: 1, unit: 'Pass', supplierCost: 1.50, margin: 0.44, publicPrice: 1.94, resellerPrice: 1.74, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId'], displayOrder: 6 }),
      withHtgPricing({ id: 'pkg_freefire_global_monthly_membership', serviceId: 'srv_ff_diamonds', externalProductId: 'FREEFIRE_GLOBAL_Monthly_Membership', providerSlug: 'rechargegames', externalGameId: 'freefire_global', name: 'Monthly Membership', amount: 1, unit: 'Pass', supplierCost: 5.565, margin: 1.39, publicPrice: 6.96, resellerPrice: 6.26, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId'], displayOrder: 7 })
    ],
    createdAt: '2026-01-10T10:00:00Z',
    updatedAt: '2026-03-20T12:00:00Z'
  },
  {
    id: 'srv_pubg_uc',
    gameId: 'game_pubg',
    externalGameId: 'pubgm',
    name: 'PUBG Mobile Unknown Cash (UC)',
    description: 'Packs Unknown Cash officiels pour PUBG Mobile Global.',
    category: 'uc',
    providerId: 'prov_rechargegames',
    isActive: true,
    displayOrder: 2,
    packages: [
      withHtgPricing({ id: 'pkg_pubg_60', serviceId: 'srv_pubg_uc', externalProductId: 'pubg_60', externalGameId: 'pubgm', name: '60 UC', amount: 60, unit: 'UC', supplierCost: 0.80, margin: 0.30, publicPrice: 1.10, resellerPrice: 0.88, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['characterId', 'serverId'], displayOrder: 1 }),
      withHtgPricing({ id: 'pkg_pubg_325', serviceId: 'srv_pubg_uc', externalProductId: 'pubg_325', externalGameId: 'pubgm', name: '325 UC', amount: 325, unit: 'UC', supplierCost: 3.95, margin: 1.45, publicPrice: 5.40, resellerPrice: 4.40, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['characterId', 'serverId'], displayOrder: 2 }),
      withHtgPricing({ id: 'pkg_pubg_660', serviceId: 'srv_pubg_uc', externalProductId: 'pubg_660', externalGameId: 'pubgm', name: '660 UC (Royal Pass)', amount: 660, unit: 'UC', supplierCost: 7.90, margin: 2.60, publicPrice: 10.50, resellerPrice: 8.70, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['characterId', 'serverId'], displayOrder: 3 }),
      withHtgPricing({ id: 'pkg_pubg_1800', serviceId: 'srv_pubg_uc', externalProductId: 'pubg_1800', externalGameId: 'pubgm', name: '1800 UC', amount: 1800, unit: 'UC', supplierCost: 19.80, margin: 6.70, publicPrice: 26.50, resellerPrice: 22.00, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['characterId', 'serverId'], displayOrder: 4 })
    ],
    createdAt: '2026-01-12T10:00:00Z',
    updatedAt: '2026-03-20T12:00:00Z'
  },
  {
    id: 'srv_mlbb_diamonds',
    gameId: 'game_mlbb',
    externalGameId: 'mlbb',
    name: 'Mobile Legends Diamants',
    description: 'Diamants Mobile Legends avec créditation via Player ID et Zone ID.',
    category: 'diamonds',
    providerId: 'prov_rechargegames',
    isActive: true,
    displayOrder: 3,
    packages: [
      withHtgPricing({ id: 'pkg_mlbb_86', serviceId: 'srv_mlbb_diamonds', externalProductId: 'mlbb_86', externalGameId: 'mlbb', name: '86 Diamants', amount: 86, unit: 'Diamonds', supplierCost: 1.10, margin: 0.55, publicPrice: 1.65, resellerPrice: 1.35, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId', 'zoneId'], displayOrder: 1 }),
      withHtgPricing({ id: 'pkg_mlbb_257', serviceId: 'srv_mlbb_diamonds', externalProductId: 'mlbb_257', externalGameId: 'mlbb', name: '257 Diamants', amount: 257, unit: 'Diamonds', supplierCost: 3.45, margin: 1.35, publicPrice: 4.80, resellerPrice: 3.95, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId', 'zoneId'], displayOrder: 2 }),
      withHtgPricing({ id: 'pkg_mlbb_706', serviceId: 'srv_mlbb_diamonds', externalProductId: 'mlbb_706', externalGameId: 'mlbb', name: '706 Diamants', amount: 706, unit: 'Diamonds', supplierCost: 9.20, margin: 3.30, publicPrice: 12.50, resellerPrice: 10.40, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId', 'zoneId'], displayOrder: 3 }),
      withHtgPricing({ id: 'pkg_mlbb_pass', serviceId: 'srv_mlbb_diamonds', externalProductId: 'mlbb_wdp', externalGameId: 'mlbb', name: 'Weekly Diamond Pass', amount: 1, unit: 'Pass', supplierCost: 1.60, margin: 0.60, publicPrice: 2.20, resellerPrice: 1.85, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId', 'zoneId'], displayOrder: 4 })
    ],
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-03-20T12:00:00Z'
  },
  {
    id: 'srv_roblox_robux',
    gameId: 'game_roblox',
    externalGameId: 'roblox',
    name: 'Roblox Robux Digital Vouchers',
    description: 'Codes digitaux Robux officiels (Aucun Player ID requis).',
    category: 'voucher',
    providerId: 'prov_rechargegames',
    isActive: true,
    displayOrder: 4,
    packages: [
      withHtgPricing({ id: 'pkg_rbx_400', serviceId: 'srv_roblox_robux', externalProductId: 'rbx_pin_400', externalGameId: 'roblox', name: 'Code 400 Robux', amount: 400, unit: 'Robux PIN', supplierCost: 3.90, margin: 1.60, publicPrice: 5.50, resellerPrice: 4.60, currency: 'USD', isActive: true, requiresPlayerId: false, requiredFields: [], displayOrder: 1 }),
      withHtgPricing({ id: 'pkg_rbx_800', serviceId: 'srv_roblox_robux', externalProductId: 'rbx_pin_800', externalGameId: 'roblox', name: 'Code 800 Robux', amount: 800, unit: 'Robux PIN', supplierCost: 8.00, margin: 2.80, publicPrice: 10.80, resellerPrice: 9.10, currency: 'USD', isActive: true, requiresPlayerId: false, requiredFields: [], displayOrder: 2 }),
      withHtgPricing({ id: 'pkg_rbx_2000', serviceId: 'srv_roblox_robux', externalProductId: 'rbx_pin_2000', externalGameId: 'roblox', name: 'Code 2000 Robux', amount: 2000, unit: 'Robux PIN', supplierCost: 19.50, margin: 6.50, publicPrice: 26.00, resellerPrice: 22.00, currency: 'USD', isActive: true, requiresPlayerId: false, requiredFields: [], displayOrder: 3 })
    ],
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-03-20T12:00:00Z'
  }
];

export const INITIAL_RESELLERS: Reseller[] = [];

export const INITIAL_API_KEYS: ApiKey[] = [];

export const INITIAL_ORDERS: Order[] = [];

export const INITIAL_PROVIDER_ORDERS: ProviderOrder[] = [];

export const INITIAL_SETTINGS: AppSettings = {
  platformName: 'PlayUp Reseller',
  primaryColor: '#FF6B00',
  supportEmail: 'contact@playup.io',
  contactTelegram: 'https://t.me/playup_support',
  contactWhatsApp: '+1 (509) 4412-8899',
  downloadLinks: {
    androidApkUrl: 'https://download.playup.io/releases/playup-latest.apk',
    googlePlayUrl: 'https://play.google.com/store/apps/details?id=io.playup.mobile',
    iosAppStoreUrl: 'https://apps.apple.com/app/playup-gaming-topup/id6498129012',
    appVersion: 'v2.4.4 (Build 2026.10)',
    apkFileSize: '18.4 MB'
  },
  maintenanceMode: false,
  announcementNotice: 'Intégration officielle RechargeGames & GoXtop API disponible : Devise de référence USD, prix de vente PlayUp en HTG et Webhooks signés.',
  paymentGatewayConfigured: false,
  apiRateLimitPerMinute: 60,
  defaultProviderId: 'prov_rechargegames',
  referenceCurrency: 'USD',
  sellingCurrency: 'HTG',
  usdToHtgRate: DEFAULT_USD_TO_HTG_RATE
};

export const INITIAL_TICKETS: SupportTicket[] = [];

export const INITIAL_LOGS: SystemLog[] = [
  {
    id: 'log_01',
    level: 'info',
    module: 'system',
    message: 'PlayUp Central Core started successfully on port 3000.',
    timestamp: '2026-10-02T17:00:00Z'
  },
  {
    id: 'log_02',
    level: 'info',
    module: 'provider',
    message: 'GoXtopProvider initialized with endpoints /api/v.1/games, /api/v.1/products/{game}, /api/v.1/create, /api/v.1/:partner_orderid, /api/v.1/:id/track.',
    timestamp: '2026-10-02T17:40:00Z'
  }
];
