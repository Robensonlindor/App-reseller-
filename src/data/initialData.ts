import { Game, Service, Provider, Reseller, ApiKey, Order, AppSettings, SupportTicket, SystemLog, ProviderOrder } from '../types';

export const INITIAL_GAMES: Game[] = [
  {
    id: 'game_ff',
    slug: 'free-fire',
    name: 'Free Fire',
    externalGameId: 'freefire',
    providerId: 'prov_goxtop',
    supportsNameCheck: true,
    requiresPlayerId: true,
    category: 'Battle Royale',
    description: 'Recharges instantanées de Diamants Free Fire via ID Joueur direct avec vérification du nom de joueur.',
    logo: '/src/assets/images/game_cover_freefire_1790988876938.jpg',
    banner: '/src/assets/images/game_cover_freefire_1790988876938.jpg',
    isActive: true,
    displayOrder: 1,
    fields: [
      {
        id: 'f_ff_player_id',
        name: 'playerId',
        label: 'Player ID (Game ID)',
        placeholder: 'ex: 123456789',
        type: 'text',
        required: true,
        helperText: 'Votre UID numérique Free Fire (8 à 12 chiffres). Le nom du joueur sera vérifié avant confirmation.',
        validationRegex: '^[0-9]{8,12}$'
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
    description: 'Créditation instantanée de Unknown Cash (UC) officielle sur serveur Global.',
    logo: '/src/assets/images/game_cover_pubg_1790988886654.jpg',
    banner: '/src/assets/images/game_cover_pubg_1790988886654.jpg',
    isActive: true,
    displayOrder: 2,
    fields: [
      {
        id: 'f_pubg_character_id',
        name: 'characterId',
        label: 'Character ID (Player ID)',
        placeholder: 'ex: 5123984712',
        type: 'text',
        required: true,
        helperText: 'L’identifiant numérique situé à côté de votre avatar en jeu.',
        validationRegex: '^[0-9]{8,12}$'
      },
      {
        id: 'f_pubg_server_id',
        name: 'serverId',
        label: 'Server ID / Région',
        placeholder: 'Sélectionnez votre serveur',
        type: 'select',
        required: true,
        options: ['Global', 'Europe', 'North America', 'South America', 'Asia', 'Middle East'],
        helperText: 'Sélectionnez le serveur sur lequel votre compte est actif.'
      }
    ],
    createdAt: '2026-01-12T10:00:00Z',
    updatedAt: '2026-03-20T12:00:00Z'
  },
  {
    id: 'game_mlbb',
    slug: 'mobile-legends',
    name: 'Mobile Legends: Bang Bang',
    externalGameId: 'mlbb',
    providerId: 'prov_goxtop',
    supportsNameCheck: true,
    requiresPlayerId: true,
    category: 'MOBA',
    description: 'Recharges ultra-rapides de Diamants MLBB avec Player ID et Zone ID.',
    logo: '/src/assets/images/game_cover_mobilelegends_1790988897466.jpg',
    banner: '/src/assets/images/game_cover_mobilelegends_1790988897466.jpg',
    isActive: true,
    displayOrder: 3,
    fields: [
      {
        id: 'f_mlbb_player_id',
        name: 'playerId',
        label: 'Player ID (User ID)',
        placeholder: 'ex: 12345678',
        type: 'text',
        required: true,
        helperText: 'Votre User ID principal à 8 chiffres.',
        validationRegex: '^[0-9]{6,10}$'
      },
      {
        id: 'f_mlbb_zone_id',
        name: 'zoneId',
        label: 'Zone ID (entre parenthèses)',
        placeholder: 'ex: 2109',
        type: 'text',
        required: true,
        helperText: 'Les 4 ou 5 chiffres entre parenthèses à côté de votre User ID.',
        validationRegex: '^[0-9]{4,6}$'
      }
    ],
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-03-20T12:00:00Z'
  },
  {
    id: 'game_codm',
    slug: 'cod-mobile',
    name: 'Call of Duty: Mobile',
    externalGameId: 'codm',
    providerId: 'prov_goxtop',
    supportsNameCheck: false,
    requiresPlayerId: true,
    category: 'FPS Mobile',
    description: 'Packs CP Call of Duty Mobile avec livraison sécurisée.',
    logo: '/src/assets/images/game_cover_pubg_1790988886654.jpg',
    banner: '/src/assets/images/game_cover_pubg_1790988886654.jpg',
    isActive: true,
    displayOrder: 4,
    fields: [
      {
        id: 'f_codm_player_id',
        name: 'playerId',
        label: 'Player ID (OpenID)',
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
      trackOrderPath: '/api/v.1/:id/track',
      checkPlayerPath: 'REQUIRES GOXTOP DOCUMENTATION'
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
      trackOrderPath: '/api/v.1/:id/track',
      checkPlayerPath: 'REQUIRES GOXTOP DOCUMENTATION'
    },
    customParams: [],
    latencyMs: 0,
    lastPingStatus: 'untested',
    lastPingLabel: 'Inactif'
  }
];

export const INITIAL_SERVICES: Service[] = [
  {
    id: 'srv_ff_diamonds',
    gameId: 'game_ff',
    externalGameId: 'freefire',
    name: 'Free Fire Diamonds',
    description: 'Recharges directes de Diamants Free Fire via GoXtop avec vérification du nom du joueur.',
    category: 'diamonds',
    providerId: 'prov_goxtop',
    isActive: true,
    displayOrder: 1,
    packages: [
      { id: 'pkg_ff_100', serviceId: 'srv_ff_diamonds', externalProductId: 'ff_100', externalGameId: 'freefire', name: '100 Diamants', amount: 100, unit: 'Diamonds', supplierCost: 0.82, margin: 0.38, publicPrice: 1.20, resellerPrice: 0.95, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId'], displayOrder: 1 },
      { id: 'pkg_ff_310', serviceId: 'srv_ff_diamonds', externalProductId: 'ff_310', externalGameId: 'freefire', name: '310 Diamants', amount: 310, unit: 'Diamonds', supplierCost: 2.50, margin: 1.00, publicPrice: 3.50, resellerPrice: 2.85, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId'], displayOrder: 2 },
      { id: 'pkg_ff_520', serviceId: 'srv_ff_diamonds', externalProductId: 'ff_520', externalGameId: 'freefire', name: '520 Diamants', amount: 520, unit: 'Diamonds', supplierCost: 4.15, margin: 1.60, publicPrice: 5.75, resellerPrice: 4.70, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId'], displayOrder: 3 },
      { id: 'pkg_ff_1060', serviceId: 'srv_ff_diamonds', externalProductId: 'ff_1060', externalGameId: 'freefire', name: '1060 Diamants', amount: 1060, unit: 'Diamonds', supplierCost: 8.20, margin: 3.00, publicPrice: 11.20, resellerPrice: 9.30, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId'], displayOrder: 4 },
      { id: 'pkg_ff_2180', serviceId: 'srv_ff_diamonds', externalProductId: 'ff_2180', externalGameId: 'freefire', name: '2180 Diamants', amount: 2180, unit: 'Diamonds', supplierCost: 16.50, margin: 5.50, publicPrice: 22.00, resellerPrice: 18.50, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId'], displayOrder: 5 }
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
    providerId: 'prov_goxtop',
    isActive: true,
    displayOrder: 2,
    packages: [
      { id: 'pkg_pubg_60', serviceId: 'srv_pubg_uc', externalProductId: 'pubg_60', externalGameId: 'pubgm', name: '60 UC', amount: 60, unit: 'UC', supplierCost: 0.78, margin: 0.32, publicPrice: 1.10, resellerPrice: 0.88, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['characterId', 'serverId'], displayOrder: 1 },
      { id: 'pkg_pubg_325', serviceId: 'srv_pubg_uc', externalProductId: 'pubg_325', externalGameId: 'pubgm', name: '325 UC', amount: 325, unit: 'UC', supplierCost: 3.90, margin: 1.50, publicPrice: 5.40, resellerPrice: 4.40, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['characterId', 'serverId'], displayOrder: 2 },
      { id: 'pkg_pubg_660', serviceId: 'srv_pubg_uc', externalProductId: 'pubg_660', externalGameId: 'pubgm', name: '660 UC (Royal Pass)', amount: 660, unit: 'UC', supplierCost: 7.75, margin: 2.75, publicPrice: 10.50, resellerPrice: 8.70, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['characterId', 'serverId'], displayOrder: 3 },
      { id: 'pkg_pubg_1800', serviceId: 'srv_pubg_uc', externalProductId: 'pubg_1800', externalGameId: 'pubgm', name: '1800 UC', amount: 1800, unit: 'UC', supplierCost: 19.80, margin: 6.70, publicPrice: 26.50, resellerPrice: 22.00, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['characterId', 'serverId'], displayOrder: 4 }
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
    providerId: 'prov_goxtop',
    isActive: true,
    displayOrder: 3,
    packages: [
      { id: 'pkg_mlbb_86', serviceId: 'srv_mlbb_diamonds', externalProductId: 'mlbb_86', externalGameId: 'mlbb', name: '86 Diamants', amount: 86, unit: 'Diamonds', supplierCost: 1.15, margin: 0.50, publicPrice: 1.65, resellerPrice: 1.35, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId', 'zoneId'], displayOrder: 1 },
      { id: 'pkg_mlbb_257', serviceId: 'srv_mlbb_diamonds', externalProductId: 'mlbb_257', externalGameId: 'mlbb', name: '257 Diamants', amount: 257, unit: 'Diamonds', supplierCost: 3.45, margin: 1.35, publicPrice: 4.80, resellerPrice: 3.95, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId', 'zoneId'], displayOrder: 2 },
      { id: 'pkg_mlbb_706', serviceId: 'srv_mlbb_diamonds', externalProductId: 'mlbb_706', externalGameId: 'mlbb', name: '706 Diamants', amount: 706, unit: 'Diamonds', supplierCost: 9.20, margin: 3.30, publicPrice: 12.50, resellerPrice: 10.40, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId', 'zoneId'], displayOrder: 3 },
      { id: 'pkg_mlbb_pass', serviceId: 'srv_mlbb_diamonds', externalProductId: 'mlbb_wdp', externalGameId: 'mlbb', name: 'Weekly Diamond Pass', amount: 1, unit: 'Pass', supplierCost: 1.60, margin: 0.60, publicPrice: 2.20, resellerPrice: 1.85, currency: 'USD', isActive: true, requiresPlayerId: true, requiredFields: ['playerId', 'zoneId'], displayOrder: 4 }
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
    providerId: 'prov_goxtop',
    isActive: true,
    displayOrder: 4,
    packages: [
      { id: 'pkg_rbx_400', serviceId: 'srv_roblox_robux', externalProductId: 'rbx_pin_400', externalGameId: 'roblox', name: 'Code 400 Robux', amount: 400, unit: 'Robux PIN', supplierCost: 4.00, margin: 1.50, publicPrice: 5.50, resellerPrice: 4.60, currency: 'USD', isActive: true, requiresPlayerId: false, requiredFields: [], displayOrder: 1 },
      { id: 'pkg_rbx_800', serviceId: 'srv_roblox_robux', externalProductId: 'rbx_pin_800', externalGameId: 'roblox', name: 'Code 800 Robux', amount: 800, unit: 'Robux PIN', supplierCost: 8.00, margin: 2.80, publicPrice: 10.80, resellerPrice: 9.10, currency: 'USD', isActive: true, requiresPlayerId: false, requiredFields: [], displayOrder: 2 },
      { id: 'pkg_rbx_2000', serviceId: 'srv_roblox_robux', externalProductId: 'rbx_pin_2000', externalGameId: 'roblox', name: 'Code 2000 Robux', amount: 2000, unit: 'Robux PIN', supplierCost: 19.50, margin: 6.50, publicPrice: 26.00, resellerPrice: 22.00, currency: 'USD', isActive: true, requiresPlayerId: false, requiredFields: [], displayOrder: 3 }
    ],
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-03-20T12:00:00Z'
  }
];

export const INITIAL_RESELLERS: Reseller[] = [
  {
    id: 'res_demo_01',
    name: 'Robenson Alexis',
    email: 'leaderlindor@gmail.com',
    company: 'Alpha Games Network',
    balance: 485.50,
    currency: 'USD',
    status: 'active',
    webhookUrl: 'https://webhook.site/demo-playup-reseller-test',
    webhookSecret: 'whsec_playup_891278391203',
    createdAt: '2026-02-10T09:00:00Z',
    lastActiveAt: '2026-10-02T17:15:00Z',
    ordersCount: 142,
    totalSpent: 1290.30
  },
  {
    id: 'res_demo_02',
    name: 'Caribbean TopUp Tech',
    email: 'api@caribbeantopup.net',
    company: 'CTech International',
    balance: 124.00,
    currency: 'USD',
    status: 'active',
    webhookUrl: 'https://caribbeantopup.net/api/v1/webhook',
    webhookSecret: 'whsec_plup_7891238910',
    createdAt: '2026-03-01T11:00:00Z',
    lastActiveAt: '2026-10-02T14:30:00Z',
    ordersCount: 38,
    totalSpent: 412.50
  }
];

export const INITIAL_API_KEYS: ApiKey[] = [
  {
    id: 'key_live_01',
    resellerId: 'res_demo_01',
    name: 'Production Primary Key',
    key: 'plup_live_99f2b87a1c4e908d1234567890abcdef',
    maskedKey: 'plup_live_99f2...cdef',
    permissions: ['games.read', 'services.read', 'orders.create', 'orders.read', 'balance.read'],
    status: 'active',
    createdAt: '2026-02-10T09:15:00Z',
    lastUsedAt: '2026-10-02T17:10:00Z'
  },
  {
    id: 'key_sandbox_01',
    resellerId: 'res_demo_01',
    name: 'Sandbox Test Key',
    key: 'plup_test_aa12984ef00192837465abcde1234567',
    maskedKey: 'plup_test_aa12...4567',
    permissions: ['games.read', 'services.read', 'orders.create', 'orders.read', 'balance.read'],
    status: 'active',
    createdAt: '2026-02-12T14:00:00Z',
    lastUsedAt: '2026-10-01T19:40:00Z'
  }
];

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
    appVersion: 'v2.4.1 (Build 2026.10)',
    apkFileSize: '18.4 MB'
  },
  maintenanceMode: false,
  announcementNotice: 'Intégration officielle GoXtop API v.1 disponible : Catalogue, Name Checker, Création idempotente et Webhooks signés.',
  paymentGatewayConfigured: false,
  apiRateLimitPerMinute: 60,
  defaultProviderId: 'prov_goxtop'
};

export const INITIAL_TICKETS: SupportTicket[] = [
  {
    id: 'tkt_01',
    ticketNumber: 'TKT-9012',
    userId: 'user_gamer_01',
    email: 'leaderlindor@gmail.com',
    name: 'Robenson',
    subject: 'Question sur la recharge 310 Diamants Free Fire',
    category: 'order',
    orderId: 'PLUP-2026-98210',
    status: 'resolved',
    priority: 'medium',
    message: 'Bonjour, ma commande a été complétée très rapidement, merci ! Je voulais juste savoir si le bonus de premier rechargement s’applique aussi.',
    messages: [
      {
        id: 'msg_01',
        sender: 'user',
        senderName: 'Robenson',
        text: 'Bonjour, ma commande a été complétée très rapidement, merci ! Je voulais juste savoir si le bonus de premier rechargement s’applique aussi.',
        createdAt: '2026-10-02T16:20:00Z'
      },
      {
        id: 'msg_02',
        sender: 'agent',
        senderName: 'Support PlayUp',
        text: 'Bonjour Robenson ! Oui, si vous n’avez jamais rechargé ce pack en jeu, Garena crédite automatiquement le bonus 100% lors de la livraison.',
        createdAt: '2026-10-02T16:25:00Z'
      }
    ],
    createdAt: '2026-10-02T16:20:00Z',
    updatedAt: '2026-10-02T16:25:00Z'
  }
];

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
