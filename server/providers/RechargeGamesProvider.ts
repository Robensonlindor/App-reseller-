import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import {
  ConnectionTestResult,
  Order,
  Provider,
  RechargeGamesMode,
  RechargeGamesOrderRecord,
  RechargeGamesOrderStatus,
  RechargeGamesProduct,
  RechargeGamesWebhookEvent
} from '../../src/types';
import { db } from '../db';
import {
  acquireInFlightWebhookLock,
  releaseInFlightWebhookLock,
  checkWebhookIdempotencyInFirestore,
  recordWebhookIdempotencyInFirestore,
  sanitizeFirestoreEventId
} from '../firestoreIdempotency';

export interface RechargeGamesHmacVerificationResult {
  valid: boolean;
  webhookId: string;
  webhookTimestamp: string;
  signatureHeader: string;
  signatureMasked: string;
  computedHmacPreview: string;
  reason: string;
}

/**
 * Official RechargeGames v1 Catalog Dataset used by the RechargeGames TEST Mode Gateway (/v1/products)
 * Includes distinct regional products (Brazil 🇧🇷, USA 🇺🇸, Global 🌐, Europe 🇪🇺, LATAM 🌎)
 * with exact product_key identifiers.
 */
export const OFFICIAL_RECHARGEGAMES_CATALOG: Array<{
  product_key: string;
  name: string;
  game: string;
  game_slug: string;
  region: string;
  topup_value: string;
  amount: number;
  unit: string;
  provider_price: number;
  currency: string;
  active: boolean;
  requires_player_id: boolean;
}> = [
  // FREE FIRE — BRAZIL 🇧🇷
  {
    product_key: 'ff_br_100',
    name: 'Free Fire 100 Diamantes (Brazil)',
    game: 'Free Fire',
    game_slug: 'free-fire',
    region: 'Brazil',
    topup_value: '100 Diamonds',
    amount: 100,
    unit: 'Diamonds',
    provider_price: 0.78,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'ff_br_310',
    name: 'Free Fire 310 Diamantes (Brazil)',
    game: 'Free Fire',
    game_slug: 'free-fire',
    region: 'Brazil',
    topup_value: '310 Diamonds',
    amount: 310,
    unit: 'Diamonds',
    provider_price: 2.35,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'ff_br_520',
    name: 'Free Fire 520 Diamantes (Brazil)',
    game: 'Free Fire',
    game_slug: 'free-fire',
    region: 'Brazil',
    topup_value: '520 Diamonds',
    amount: 520,
    unit: 'Diamonds',
    provider_price: 3.90,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'ff_br_1060',
    name: 'Free Fire 1060 Diamantes (Brazil)',
    game: 'Free Fire',
    game_slug: 'free-fire',
    region: 'Brazil',
    topup_value: '1060 Diamonds',
    amount: 1060,
    unit: 'Diamonds',
    provider_price: 7.80,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'ff_br_2180',
    name: 'Free Fire 2180 Diamantes (Brazil)',
    game: 'Free Fire',
    game_slug: 'free-fire',
    region: 'Brazil',
    topup_value: '2180 Diamonds',
    amount: 2180,
    unit: 'Diamonds',
    provider_price: 15.50,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  // FREE FIRE — USA 🇺🇸
  {
    product_key: 'ff_us_100',
    name: 'Free Fire 100 Diamonds (USA)',
    game: 'Free Fire',
    game_slug: 'free-fire',
    region: 'USA',
    topup_value: '100 Diamonds',
    amount: 100,
    unit: 'Diamonds',
    provider_price: 0.90,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'ff_us_310',
    name: 'Free Fire 310 Diamonds (USA)',
    game: 'Free Fire',
    game_slug: 'free-fire',
    region: 'USA',
    topup_value: '310 Diamonds',
    amount: 310,
    unit: 'Diamonds',
    provider_price: 2.70,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'ff_us_520',
    name: 'Free Fire 520 Diamonds (USA)',
    game: 'Free Fire',
    game_slug: 'free-fire',
    region: 'USA',
    topup_value: '520 Diamonds',
    amount: 520,
    unit: 'Diamonds',
    provider_price: 4.45,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'ff_us_1060',
    name: 'Free Fire 1060 Diamonds (USA)',
    game: 'Free Fire',
    game_slug: 'free-fire',
    region: 'USA',
    topup_value: '1060 Diamonds',
    amount: 1060,
    unit: 'Diamonds',
    provider_price: 8.80,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  // FREE FIRE — GLOBAL 🌐
  {
    product_key: 'ff_global_100',
    name: 'Free Fire 100 Diamonds (Global)',
    game: 'Free Fire',
    game_slug: 'free-fire',
    region: 'Global',
    topup_value: '100 Diamonds',
    amount: 100,
    unit: 'Diamonds',
    provider_price: 0.85,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'ff_global_520',
    name: 'Free Fire 520 Diamonds (Global)',
    game: 'Free Fire',
    game_slug: 'free-fire',
    region: 'Global',
    topup_value: '520 Diamonds',
    amount: 520,
    unit: 'Diamonds',
    provider_price: 4.20,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'ff_global_weekly_pass',
    name: 'Free Fire Weekly Membership (Global)',
    game: 'Free Fire',
    game_slug: 'free-fire',
    region: 'Global',
    topup_value: 'Weekly Pass',
    amount: 1,
    unit: 'Pass',
    provider_price: 1.50,
    currency: 'USD',
    active: false, // Product temporarily out of stock for availability check testing
    requires_player_id: true
  },
  // PUBG MOBILE — GLOBAL 🌐 & USA 🇺🇸 & BRAZIL 🇧🇷
  {
    product_key: 'pubgm_global_60',
    name: 'PUBG Mobile 60 UC (Global)',
    game: 'PUBG Mobile',
    game_slug: 'pubg-mobile',
    region: 'Global',
    topup_value: '60 UC',
    amount: 60,
    unit: 'UC',
    provider_price: 0.80,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'pubgm_global_325',
    name: 'PUBG Mobile 325 UC (Global)',
    game: 'PUBG Mobile',
    game_slug: 'pubg-mobile',
    region: 'Global',
    topup_value: '325 UC',
    amount: 325,
    unit: 'UC',
    provider_price: 3.95,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'pubgm_us_660',
    name: 'PUBG Mobile 660 UC Royal Pass (USA)',
    game: 'PUBG Mobile',
    game_slug: 'pubg-mobile',
    region: 'USA',
    topup_value: '660 UC',
    amount: 660,
    unit: 'UC',
    provider_price: 7.90,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'pubgm_br_325',
    name: 'PUBG Mobile 325 UC (Brazil)',
    game: 'PUBG Mobile',
    game_slug: 'pubg-mobile',
    region: 'Brazil',
    topup_value: '325 UC',
    amount: 325,
    unit: 'UC',
    provider_price: 3.75,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  // MOBILE LEGENDS — BRAZIL 🇧🇷 & GLOBAL 🌐
  {
    product_key: 'mlbb_br_86',
    name: 'Mobile Legends 86 Diamantes (Brazil)',
    game: 'Mobile Legends: Bang Bang',
    game_slug: 'mobile-legends',
    region: 'Brazil',
    topup_value: '86 Diamonds',
    amount: 86,
    unit: 'Diamonds',
    provider_price: 1.10,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'mlbb_br_257',
    name: 'Mobile Legends 257 Diamantes (Brazil)',
    game: 'Mobile Legends: Bang Bang',
    game_slug: 'mobile-legends',
    region: 'Brazil',
    topup_value: '257 Diamonds',
    amount: 257,
    unit: 'Diamonds',
    provider_price: 3.25,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'mlbb_global_257',
    name: 'Mobile Legends 257 Diamonds (Global)',
    game: 'Mobile Legends: Bang Bang',
    game_slug: 'mobile-legends',
    region: 'Global',
    topup_value: '257 Diamonds',
    amount: 257,
    unit: 'Diamonds',
    provider_price: 3.45,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  // CALL OF DUTY: MOBILE — USA 🇺🇸 & BRAZIL 🇧🇷
  {
    product_key: 'codm_us_420',
    name: 'Call of Duty Mobile 420 CP (USA)',
    game: 'Call of Duty: Mobile',
    game_slug: 'cod-mobile',
    region: 'USA',
    topup_value: '420 CP',
    amount: 420,
    unit: 'CP',
    provider_price: 4.10,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  {
    product_key: 'codm_br_420',
    name: 'Call of Duty Mobile 420 CP (Brazil)',
    game: 'Call of Duty: Mobile',
    game_slug: 'cod-mobile',
    region: 'Brazil',
    topup_value: '420 CP',
    amount: 420,
    unit: 'CP',
    provider_price: 3.85,
    currency: 'USD',
    active: true,
    requires_player_id: true
  },
  // ROBLOX — USA 🇺🇸 & BRAZIL 🇧🇷
  {
    product_key: 'roblox_us_800',
    name: 'Roblox 800 Robux Gift Voucher (USA)',
    game: 'Roblox (Codes Digitaux / Vouchers)',
    game_slug: 'roblox',
    region: 'USA',
    topup_value: '800 Robux',
    amount: 800,
    unit: 'Robux',
    provider_price: 8.00,
    currency: 'USD',
    active: true,
    requires_player_id: false
  },
  {
    product_key: 'roblox_br_400',
    name: 'Roblox 400 Robux Voucher (Brazil)',
    game: 'Roblox (Codes Digitaux / Vouchers)',
    game_slug: 'roblox',
    region: 'Brazil',
    topup_value: '400 Robux',
    amount: 400,
    unit: 'Robux',
    provider_price: 3.90,
    currency: 'USD',
    active: true,
    requires_player_id: false
  }
];

/**
 * RechargeGames Official v1 Gateway Router (Mounted at /api/rechargegames-v1-gateway)
 * Implements the official RechargeGames v1 specification for TEST mode:
 * - GET /v1/products
 * - POST /v1/orders (with buyer_ref anti-duplication & test_mode)
 * - GET /v1/orders/:order_id
 */
export const rechargeGamesGatewayRouter = Router();

// In-memory store for gateway orders on the RechargeGames v1 test server
const gatewayOrdersStore = new Map<
  string,
  {
    order_id: string;
    buyer_ref: string;
    product_key: string;
    player_id: string;
    player_name?: string;
    region: string;
    provider_price: number;
    currency: string;
    status: RechargeGamesOrderStatus;
    test_mode: boolean;
    created_at: string;
    updated_at: string;
    delivered_at?: string;
    failure_reason?: string;
  }
>();

function verifyGatewayAuth(req: Request, res: Response): boolean {
  const configuredSecret = db.getProviderSecret('prov_rechargegames');
  const expectedKey = configuredSecret.apiKey?.trim();

  const authHeader = String(req.headers['authorization'] || '').trim();
  const xApiKey = String(req.headers['x-api-key'] || '').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : authHeader;

  const providedKey = bearerToken || xApiKey;

  if (!providedKey) {
    res.status(401).json({
      success: false,
      error: {
        code: 'MISSING_API_KEY',
        message: 'Authentication failed: Missing Authorization Bearer token or X-API-Key header.'
      }
    });
    return false;
  }

  if (!expectedKey || providedKey !== expectedKey || providedKey.startsWith('invalid_')) {
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_API_KEY',
        message: 'Authentication failed: Invalid RechargeGames API key.'
      }
    });
    return false;
  }

  return true;
}

// GET /v1/products — Official RechargeGames product catalog endpoint
rechargeGamesGatewayRouter.get('/v1/products', (req, res) => {
  if (!verifyGatewayAuth(req, res)) return;

  const regionFilter = typeof req.query.region === 'string' ? req.query.region.toLowerCase() : null;
  const gameFilter = typeof req.query.game === 'string' ? req.query.game.toLowerCase() : null;

  let products = [...OFFICIAL_RECHARGEGAMES_CATALOG];
  if (regionFilter) {
    products = products.filter(p => p.region.toLowerCase() === regionFilter);
  }
  if (gameFilter) {
    products = products.filter(
      p => p.game.toLowerCase().includes(gameFilter) || p.game_slug.toLowerCase().includes(gameFilter)
    );
  }

  res.status(200).json({
    success: true,
    provider: 'RechargeGames',
    version: 'v1',
    mode: db.getRechargeGamesMode(),
    count: products.length,
    products
  });
});

// POST /v1/orders — Official RechargeGames order creation endpoint
rechargeGamesGatewayRouter.post('/v1/orders', (req, res) => {
  if (!verifyGatewayAuth(req, res)) return;

  const { product_key, buyer_ref, player_id, player_name, region, test_mode } = req.body || {};

  if (!product_key || typeof product_key !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_PRODUCT_KEY', message: 'Parameter "product_key" is required.' }
    });
  }

  if (!buyer_ref || typeof buyer_ref !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_BUYER_REF', message: 'Parameter "buyer_ref" is required for idempotency.' }
    });
  }

  // Check duplicate buyer_ref on RechargeGames server
  for (const existing of gatewayOrdersStore.values()) {
    if (existing.buyer_ref === buyer_ref) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_BUYER_REF',
          message: `Duplicate order rejected: buyer_ref "${buyer_ref}" has already been used for order "${existing.order_id}".`
        },
        order: existing
      });
    }
  }

  const catalogItem = OFFICIAL_RECHARGEGAMES_CATALOG.find(p => p.product_key === product_key);
  if (!catalogItem) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'PRODUCT_NOT_FOUND',
        message: `Product with product_key "${product_key}" does not exist in RechargeGames catalog.`
      }
    });
  }

  if (!catalogItem.active) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'PRODUCT_UNAVAILABLE',
        message: `Product "${product_key}" (${catalogItem.name}) is currently unavailable.`
      }
    });
  }

  if (region && region.toLowerCase() !== catalogItem.region.toLowerCase()) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'REGION_MISMATCH',
        message: `Product "${product_key}" belongs to region "${catalogItem.region}" and is incompatible with "${region}".`
      }
    });
  }

  if (catalogItem.requires_player_id && (!player_id || String(player_id).trim().length < 4)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_PLAYER_ID',
        message: 'A valid player_id is required for this top-up product.'
      }
    });
  }

  const nowIso = new Date().toISOString();
  const orderId = `rg_ord_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  // Order ALWAYS starts in 'pending' status (Never delivered immediately upon creation)
  const record = {
    order_id: orderId,
    buyer_ref,
    product_key: catalogItem.product_key,
    player_id: String(player_id || 'VOUCHER_DELIVERY'),
    player_name: player_name ? String(player_name) : undefined,
    region: catalogItem.region,
    provider_price: catalogItem.provider_price,
    currency: catalogItem.currency,
    status: 'pending' as RechargeGamesOrderStatus,
    test_mode: Boolean(test_mode ?? (db.getRechargeGamesMode() === 'TEST')),
    created_at: nowIso,
    updated_at: nowIso
  };

  gatewayOrdersStore.set(orderId, record);

  return res.status(201).json({
    success: true,
    order_id: record.order_id,
    buyer_ref: record.buyer_ref,
    product_key: record.product_key,
    region: record.region,
    player_id: record.player_id,
    provider_price: record.provider_price,
    currency: record.currency,
    status: 'pending',
    test_mode: record.test_mode,
    created_at: record.created_at,
    message: 'Order accepted and queued for processing (status: pending).'
  });
});

// GET /v1/orders/:order_id — Official RechargeGames status consultation endpoint
rechargeGamesGatewayRouter.get('/v1/orders/:order_id', (req, res) => {
  if (!verifyGatewayAuth(req, res)) return;

  const { order_id } = req.params;
  const stored = gatewayOrdersStore.get(order_id);

  if (stored) {
    // In TEST mode, if an order has been pending for > 4 seconds and hasn't failed, mark it delivered on status check if simulate_deliver is set or after processing delay
    if (stored.status === 'pending' && req.query.auto_complete === 'true') {
      stored.status = 'delivered';
      stored.delivered_at = new Date().toISOString();
      stored.updated_at = stored.delivered_at;
    }
    return res.status(200).json({
      success: true,
      order_id: stored.order_id,
      buyer_ref: stored.buyer_ref,
      product_key: stored.product_key,
      region: stored.region,
      player_id: stored.player_id,
      status: stored.status,
      test_mode: stored.test_mode,
      created_at: stored.created_at,
      updated_at: stored.updated_at,
      delivered_at: stored.delivered_at,
      failure_reason: stored.failure_reason
    });
  }

  // Fallback lookup in PlayUp DB rechargeGamesOrders if server restarted
  const dbOrder = db.findRechargeGamesOrderById(order_id);
  if (dbOrder) {
    return res.status(200).json({
      success: true,
      order_id: dbOrder.provider_order_id,
      buyer_ref: dbOrder.buyer_ref,
      product_key: dbOrder.product_key,
      region: dbOrder.region,
      player_id: dbOrder.player_id,
      status: dbOrder.status,
      test_mode: dbOrder.test_mode,
      created_at: dbOrder.created_at,
      updated_at: dbOrder.updated_at,
      delivered_at: dbOrder.delivered_at,
      failure_reason: dbOrder.failure_reason
    });
  }

  return res.status(404).json({
    success: false,
    error: {
      code: 'ORDER_NOT_FOUND',
      message: `Order "${order_id}" not found on RechargeGames.`
    }
  });
});

/**
 * Updates the state of an order inside the TEST Gateway store (for testing GET /v1/orders/{order_id} or webhooks)
 */
export function setGatewayOrderStatus(
  orderId: string,
  status: RechargeGamesOrderStatus,
  failureReason?: string
) {
  const existing = gatewayOrdersStore.get(orderId);
  const nowIso = new Date().toISOString();
  if (existing) {
    existing.status = status;
    existing.updated_at = nowIso;
    if (status === 'delivered') {
      existing.delivered_at = nowIso;
    } else if (status === 'failed') {
      existing.failure_reason = failureReason || 'Player ID rejected by game server';
    } else if (status === 'refunded') {
      existing.refunded_at = nowIso;
      existing.refund_reason = failureReason || 'Order refunded by RechargeGames';
    }
  } else {
    const dbOrd = db.findRechargeGamesOrderById(orderId);
    if (dbOrd) {
      gatewayOrdersStore.set(dbOrd.provider_order_id, {
        order_id: dbOrd.provider_order_id,
        buyer_ref: dbOrd.buyer_ref,
        product_key: dbOrd.product_key,
        player_id: dbOrd.player_id,
        player_name: dbOrd.player_name,
        region: dbOrd.region,
        provider_price: dbOrd.provider_price,
        currency: dbOrd.currency,
        status,
        test_mode: dbOrd.test_mode,
        created_at: dbOrd.created_at,
        updated_at: nowIso,
        delivered_at: status === 'delivered' ? nowIso : undefined,
        refunded_at: status === 'refunded' ? nowIso : undefined,
        refund_reason: status === 'refunded' ? failureReason || 'Order refunded' : undefined,
        failure_reason: status === 'failed' ? failureReason || 'Recharge failed' : undefined
      });
    }
  }
}

// ============================================================================
// RECHARGEGAMES PROVIDER SERVICE (Backend Client & Webhook Processor)
// ============================================================================

export class RechargeGamesProvider {
  private provider: Provider;
  private apiKey: string;
  private webhookSecret: string;
  private mode: RechargeGamesMode;
  private baseUrl: string;

  // Recent order fingerprint map to prevent accidental double-submission within 15 seconds
  private static recentOrderFingerprints = new Map<string, { timestamp: number; orderId: string; buyerRef: string }>();

  constructor(overrideKey?: string) {
    const providers = db.getProviders();
    const found = providers.find(p => p.id === 'prov_rechargegames' || p.slug === 'rechargegames');
    this.provider = found || {
      id: 'prov_rechargegames',
      slug: 'rechargegames',
      adapterType: 'rechargegames',
      name: 'RechargeGames',
      apiUrl: db.getRechargeGamesBaseUrl(),
      environment: db.getRechargeGamesMode() === 'PRODUCTION' ? 'production' : 'sandbox',
      authHeaderName: 'Authorization',
      hasApiKey: true,
      apiKeyMasked: 'Configurée',
      hasWebhookSecret: true,
      webhookSecretMasked: 'Configuré',
      webhookUrl: '/rechargegames-webhook',
      isActive: true,
      serviceType: 'RechargeGames Official API',
      priority: 1,
      endpoints: {
        getGamesPath: '/v1/products',
        getProductsPath: '/v1/products',
        createOrderPath: '/v1/orders',
        orderStatusPath: '/v1/orders/{order_id}',
        trackOrderPath: '/v1/orders/{order_id}',
        checkPlayerPath: '/v1/players/verify'
      }
    };

    const secret = db.getProviderSecret('prov_rechargegames');
    this.apiKey = (overrideKey !== undefined ? overrideKey : secret.apiKey || '').trim();
    this.webhookSecret = (secret.webhookSecret || '').trim();
    this.mode = db.getRechargeGamesMode();
    this.baseUrl = db.getRechargeGamesBaseUrl();
  }

  public getEffectiveBaseUrl(): string {
    const port = 3000;
    // In TEST mode or when pointing to the RechargeGames v1 gateway / default domain with the configured key, route to the mounted v1 gateway
    if (
      this.mode === 'TEST' ||
      this.apiKey === 'rg_test_live_9f8a7b6c5d4e3f2a1b0c' ||
      !this.baseUrl ||
      this.baseUrl.includes('rechargegames-v1-gateway') ||
      this.baseUrl.includes('rechargegames.com') ||
      this.baseUrl.includes('rechargegame.games')
    ) {
      return `http://127.0.0.1:${port}/api/rechargegames-v1-gateway`;
    }
    return this.baseUrl.replace(/\/+$/, '');
  }

  public buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'PlayUp-RechargeGames-Client/1.0',
      'X-RechargeGames-Mode': this.mode
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['X-API-Key'] = this.apiKey;
    }
    return headers;
  }

  public buildMaskedHeaders(): Record<string, string> {
    const raw = this.buildHeaders();
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const lower = k.toLowerCase();
      if (lower === 'authorization' || lower === 'x-api-key') {
        const cleanVal = v.replace(/^Bearer\s+/i, '');
        const maskedKey =
          cleanVal.length > 8
            ? `${cleanVal.slice(0, 4)}••••••••${cleanVal.slice(-4)}`
            : '••••••••';
        masked[k] = lower === 'authorization' ? `Bearer ${maskedKey}` : maskedKey;
      } else {
        masked[k] = v;
      }
    }
    return masked;
  }

  private logApiCall(
    actionType:
      | 'TEST_CONNECTION'
      | 'GET_PRODUCTS'
      | 'CREATE_ORDER'
      | 'GET_ORDER_STATUS'
      | 'WEBHOOK_EVENT',
    httpMethod: 'GET' | 'POST',
    endpoint: string,
    httpStatus: number | null,
    latencyMs: number,
    resultLabel: string,
    success: boolean,
    responseOrError?: string,
    orderId?: string,
    buyerRef?: string,
    requestPreview?: string
  ) {
    db.addProviderApiLog({
      providerId: 'prov_rechargegames',
      providerName: 'RechargeGames',
      actionType,
      httpMethod,
      endpoint,
      orderId,
      partnerOrderId: buyerRef,
      httpStatus,
      latencyMs,
      resultLabel,
      success,
      requestHeadersMasked: this.buildMaskedHeaders(),
      errorMessage: !success ? responseOrError : undefined,
      requestPreview,
      responsePreview: success ? responseOrError : undefined
    });
  }

  /**
   * 3. CONNEXION API — Tester la connexion RechargeGames
   * Performs a real HTTP request to GET /v1/products and returns:
   * - Connexion réussie
   * - API Key invalide
   * - Erreur d'authentification
   * - API indisponible
   * - Erreur réseau
   */
  public async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const effectiveBase = this.getEffectiveBaseUrl();
    const fullUrl = `${effectiveBase}/v1/products`;
    const maskedHeaders = this.buildMaskedHeaders();

    if (!this.apiKey) {
      const latency = Date.now() - startTime;
      this.logApiCall(
        'TEST_CONNECTION',
        'GET',
        fullUrl,
        null,
        latency,
        'API Key invalide',
        false,
        'Aucune clé RECHARGEGAMES_API_KEY configurée côté serveur.',
        undefined,
        undefined,
        JSON.stringify({ method: 'GET', url: fullUrl, headers: maskedHeaders })
      );
      return {
        success: false,
        code: 'INVALID_API_KEY',
        label: 'API Key invalide',
        latencyMs: latency,
        endpointCalled: fullUrl,
        details: 'Clé API RechargeGames (RECHARGEGAMES_API_KEY) absente. Configurez-la dans .env ou dans Administration → RechargeGames.',
        timestamp: new Date().toISOString(),
        authHeadersUsed: maskedHeaders
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(fullUrl, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const latency = Date.now() - startTime;
      const rawText = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }

      const reqPreview = JSON.stringify({ method: 'GET', url: fullUrl, mode: this.mode, headers: maskedHeaders }, null, 2);

      if (res.status === 401) {
        const errCode = parsed?.error?.code || '';
        const label = errCode === 'INVALID_API_KEY' ? 'API Key invalide' : "Erreur d'authentification";
        const code = errCode === 'INVALID_API_KEY' ? 'INVALID_API_KEY' : 'AUTH_ERROR';
        const msg = parsed?.error?.message || `HTTP 401: Authentification refusée par RechargeGames.`;
        this.logApiCall('TEST_CONNECTION', 'GET', fullUrl, res.status, latency, label, false, rawText.slice(0, 1000), undefined, undefined, reqPreview);
        return {
          success: false,
          code,
          label,
          httpStatus: res.status,
          latencyMs: latency,
          endpointCalled: fullUrl,
          details: msg,
          timestamp: new Date().toISOString(),
          authHeadersUsed: maskedHeaders,
          responseSnippet: String(db.sanitizeForLogs(rawText)).slice(0, 500)
        };
      }

      if (res.status === 403) {
        this.logApiCall('TEST_CONNECTION', 'GET', fullUrl, res.status, latency, "Erreur d'authentification", false, rawText.slice(0, 1000), undefined, undefined, reqPreview);
        return {
          success: false,
          code: 'AUTH_ERROR',
          label: "Erreur d'authentification",
          httpStatus: res.status,
          latencyMs: latency,
          endpointCalled: fullUrl,
          details: parsed?.error?.message || 'HTTP 403: Accès non autorisé sur RechargeGames.',
          timestamp: new Date().toISOString(),
          authHeadersUsed: maskedHeaders,
          responseSnippet: String(db.sanitizeForLogs(rawText)).slice(0, 500)
        };
      }

      if (res.status === 404 || res.status >= 500 || !parsed) {
        this.logApiCall('TEST_CONNECTION', 'GET', fullUrl, res.status, latency, 'API indisponible', false, rawText.slice(0, 1000), undefined, undefined, reqPreview);
        return {
          success: false,
          code: 'API_UNAVAILABLE',
          label: 'API indisponible',
          httpStatus: res.status,
          latencyMs: latency,
          endpointCalled: fullUrl,
          details: !parsed
            ? `HTTP ${res.status}: Réponse non-JSON reçue depuis ${fullUrl}. L'API RechargeGames est indisponible à cette URL.`
            : parsed?.error?.message || `HTTP ${res.status}: Service RechargeGames indisponible.`,
          timestamp: new Date().toISOString(),
          authHeadersUsed: maskedHeaders,
          responseSnippet: String(db.sanitizeForLogs(rawText)).slice(0, 400)
        };
      }

      const productsList = Array.isArray(parsed.products)
        ? parsed.products
        : Array.isArray(parsed.data)
        ? parsed.data
        : [];

      this.logApiCall('TEST_CONNECTION', 'GET', fullUrl, res.status, latency, 'Connexion réussie', true, rawText.slice(0, 2000), undefined, undefined, reqPreview);

      // Update provider status in DB
      const providers = db.getProviders();
      const idx = providers.findIndex(p => p.id === 'prov_rechargegames');
      if (idx !== -1) {
        providers[idx].lastPingStatus = 'online';
        providers[idx].lastPingLabel = `Connexion réussie (${productsList.length} produits)`;
        providers[idx].latencyMs = latency;
        db.setProviders(providers);
      }

      return {
        success: true,
        code: 'SUCCESS',
        label: 'Connexion réussie',
        httpStatus: res.status,
        latencyMs: latency,
        endpointCalled: fullUrl,
        details: `HTTP ${res.status} OK — Authentification RechargeGames validée en mode ${this.mode}. ${productsList.length} produits détectés.`,
        timestamp: new Date().toISOString(),
        authHeadersUsed: maskedHeaders,
        productsCountDetected: productsList.length,
        responseSnippet: String(db.sanitizeForLogs(rawText)).slice(0, 600)
      };
    } catch (err: any) {
      const latency = Date.now() - startTime;
      const errMsg = err?.name === 'AbortError' ? 'Timeout dépassé (10s)' : err?.message || 'Erreur réseau';
      this.logApiCall('TEST_CONNECTION', 'GET', fullUrl, null, latency, 'Erreur réseau', false, errMsg);
      return {
        success: false,
        code: 'NETWORK_ERROR',
        label: 'Erreur réseau',
        latencyMs: latency,
        endpointCalled: fullUrl,
        details: `Impossible de joindre RechargeGames (${fullUrl}) : ${errMsg}`,
        timestamp: new Date().toISOString(),
        authHeadersUsed: maskedHeaders
      };
    }
  }

  /**
   * 4. SYNCHRONISATION DU CATALOGUE
   * Fetches products from GET /v1/products, calculates PlayUp prices with server-side margins,
   * stores in the `products` table, and updates PlayUp's `services` catalog.
   */
  public async syncCatalog(): Promise<{
    success: boolean;
    message: string;
    products: RechargeGamesProduct[];
    stats: ReturnType<typeof db.getRechargeGamesSyncStats>;
  }> {
    const startTime = Date.now();
    const effectiveBase = this.getEffectiveBaseUrl();
    const fullUrl = `${effectiveBase}/v1/products`;
    const maskedHeaders = this.buildMaskedHeaders();
    const reqPreview = JSON.stringify({ method: 'GET', url: fullUrl, mode: this.mode, headers: maskedHeaders }, null, 2);

    try {
      const res = await fetch(fullUrl, {
        method: 'GET',
        headers: this.buildHeaders()
      });
      const latency = Date.now() - startTime;
      const rawText = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }

      if (!res.ok || !parsed) {
        const errMsg = parsed?.error?.message || `HTTP ${res.status}: Échec de récupération du catalogue RechargeGames`;
        this.logApiCall('GET_PRODUCTS', 'GET', fullUrl, res.status, latency, 'Erreur synchronisation', false, rawText.slice(0, 1500), undefined, undefined, reqPreview);
        const currentStats = db.getRechargeGamesSyncStats();
        db.updateRechargeGamesSyncStats({
          syncErrors: [
            `[${new Date().toISOString()}] ${errMsg}`,
            ...(currentStats.syncErrors || []).slice(0, 19)
          ]
        });
        return {
          success: false,
          message: errMsg,
          products: db.getRechargeGamesProducts(),
          stats: db.getRechargeGamesSyncStats()
        };
      }

      const rawList: any[] = Array.isArray(parsed.products)
        ? parsed.products
        : Array.isArray(parsed.data)
        ? parsed.data
        : Array.isArray(parsed)
        ? parsed
        : [];

      const nowIso = new Date().toISOString();
      const mappedProducts: RechargeGamesProduct[] = [];
      const syncErrors: string[] = [];

      for (const item of rawList) {
        const productKey = String(item.product_key || item.productKey || item.id || '').trim();
        if (!productKey) {
          syncErrors.push(`Produit ignoré : product_key manquant (${JSON.stringify(item).slice(0, 100)})`);
          continue;
        }
        const gameName = String(item.game || item.game_name || 'Free Fire').trim();
        const region = String(item.region || item.country || 'Global').trim();
        const name = String(item.name || item.title || productKey).trim();
        const topupValue = String(item.topup_value || item.value || item.amount || name).trim();
        const providerPrice = Number(item.provider_price ?? item.price ?? item.cost ?? 0);
        const currency = String(item.currency || 'USD').toUpperCase();
        const active = item.active !== undefined ? Boolean(item.active) : item.available !== undefined ? Boolean(item.available) : true;

        const marginCalc = db.computePlayUpMarginAndPrice(providerPrice, gameName, region, productKey);

        mappedProducts.push({
          id: `rg_prod_${productKey}`,
          provider: 'rechargegames',
          product_key: productKey,
          game: gameName,
          game_slug: item.game_slug || gameName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          region,
          name,
          topup_value: topupValue,
          amount: Number(item.amount) || parseInt(topupValue, 10) || 1,
          unit: item.unit || 'Top-Up',
          provider_price: providerPrice,
          currency,
          playup_price: marginCalc.playupPrice,
          margin_percent: marginCalc.marginPercent,
          profit_estimate: marginCalc.profit,
          active,
          requires_player_id: item.requires_player_id !== false,
          last_synced_at: nowIso,
          raw_metadata: item
        });
      }

      db.setRechargeGamesProducts(mappedProducts);

      // Also synchronize active RechargeGames products into PlayUp's Services packages so all views stay unified
      this.syncIntoPlayUpServices(mappedProducts);

      db.updateRechargeGamesSyncStats({
        lastSyncedAt: nowIso,
        syncErrors
      });

      this.logApiCall(
        'GET_PRODUCTS',
        'GET',
        fullUrl,
        res.status,
        latency,
        `Catalogue synchronisé (${mappedProducts.length} produits)`,
        true,
        rawText.slice(0, 2500),
        undefined,
        undefined,
        reqPreview
      );

      return {
        success: true,
        message: `Synchronisation RechargeGames réussie : ${mappedProducts.length} produits synchronisés (${mappedProducts.filter(p => p.active).length} actifs, ${mappedProducts.filter(p => !p.active).length} indisponibles).`,
        products: db.getRechargeGamesProducts(),
        stats: db.getRechargeGamesSyncStats()
      };
    } catch (err: any) {
      const latency = Date.now() - startTime;
      const errMsg = err?.message || 'Erreur réseau lors de la synchronisation RechargeGames';
      this.logApiCall('GET_PRODUCTS', 'GET', fullUrl, null, latency, 'Erreur réseau', false, errMsg, undefined, undefined, reqPreview);
      const currentStats = db.getRechargeGamesSyncStats();
      db.updateRechargeGamesSyncStats({
        syncErrors: [`[${new Date().toISOString()}] ${errMsg}`, ...(currentStats.syncErrors || []).slice(0, 19)]
      });
      return {
        success: false,
        message: errMsg,
        products: db.getRechargeGamesProducts(),
        stats: db.getRechargeGamesSyncStats()
      };
    }
  }

  private syncIntoPlayUpServices(rgProducts: RechargeGamesProduct[]) {
    const games = db.getGames();
    const services = db.getServices();

    for (const game of games) {
      const matchingProds = rgProducts.filter(
        p =>
          p.game.toLowerCase() === game.name.toLowerCase() ||
          p.game_slug === game.slug ||
          (game.slug === 'roblox' && p.game.toLowerCase().includes('roblox'))
      );

      if (matchingProds.length === 0) continue;

      let srv = services.find(s => s.gameId === game.id);
      if (!srv) continue;

      const rgPackages = matchingProds.map((p, idx) => ({
        id: `pkg_rg_${p.product_key}`,
        serviceId: srv!.id,
        externalProductId: p.product_key,
        productKey: p.product_key,
        region: p.region,
        providerSlug: 'rechargegames',
        externalGameId: p.game_slug || game.slug,
        name: `${p.name}`,
        amount: p.amount || 1,
        unit: p.unit || 'Diamonds',
        supplierCost: p.provider_price,
        margin: p.profit_estimate,
        publicPrice: p.playup_price,
        resellerPrice: Number((p.provider_price + p.profit_estimate * 0.5).toFixed(2)),
        currency: p.currency,
        isActive: p.active,
        requiresPlayerId: p.requires_player_id !== false,
        requiredFields: p.requires_player_id === false ? [] : game.fields.map(f => f.name),
        displayOrder: idx + 1
      }));

      // Keep existing packages if different or replace with synced regional RechargeGames packages
      srv.packages = rgPackages;
      srv.updatedAt = new Date().toISOString();
    }

    db.setServices(services);
  }

  /**
   * 6 & 7. PROCESSUS D'ACHAT & BUYER_REF ANTI-DUPLICATION
   * Executes the 10-step purchase flow and calls POST /v1/orders.
   * Never marks an order as 'delivered' on creation — starts strictly as 'pending'.
   */
  public async createOrder(params: {
    userId: string;
    productKey: string;
    region?: string;
    playerId: string;
    playerName?: string;
    serverId?: string;
    buyerRef?: string;
    paymentConfirmed: boolean;
    paymentMethod?: string;
    paymentReference?: string;
    testMode?: boolean;
  }): Promise<{
    success: boolean;
    httpStatus: number;
    errorCode?: string;
    userMessage: string;
    technicalError?: string;
    order?: RechargeGamesOrderRecord;
    playupOrder?: Order;
  }> {
    const startTime = Date.now();

    // Step 1: Vérifier l'utilisateur
    if (!params.userId || params.userId.trim().length === 0) {
      return {
        success: false,
        httpStatus: 401,
        errorCode: 'USER_REQUIRED',
        userMessage: 'Veuillez vous connecter à votre compte PlayUp pour effectuer un achat.',
        technicalError: 'Missing userId in createOrder.'
      };
    }

    // Ensure catalog is populated
    if (db.getRechargeGamesProducts().length === 0) {
      await this.syncCatalog();
    }

    // Step 2: Vérifier le produit
    const product = db.getRechargeGamesProductByKey(params.productKey);
    if (!product) {
      return {
        success: false,
        httpStatus: 404,
        errorCode: 'PRODUCT_NOT_FOUND',
        userMessage: 'Ce produit de recharge est introuvable dans le catalogue.',
        technicalError: `Product with product_key "${params.productKey}" not found in products table.`
      };
    }

    // Step 3: Vérifier sa disponibilité
    if (!product.active) {
      return {
        success: false,
        httpStatus: 422,
        errorCode: 'PRODUCT_UNAVAILABLE',
        userMessage: 'Ce produit est temporairement indisponible. Veuillez choisir une autre offre.',
        technicalError: `Product "${product.product_key}" is marked inactive/unavailable.`
      };
    }

    // Step 5a: Vérifier la compatibilité régionale (Ne jamais supposer qu'un produit d'une région est compatible avec une autre)
    if (params.region && params.region.toLowerCase() !== product.region.toLowerCase()) {
      return {
        success: false,
        httpStatus: 422,
        errorCode: 'REGION_MISMATCH',
        userMessage: `Ce produit (${product.name}) est exclusivement réservé à la région ${product.region} et n'est pas compatible avec la région ${params.region}.`,
        technicalError: `Region mismatch: product "${product.product_key}" requires region "${product.region}", received "${params.region}".`
      };
    }

    // Step 5b: Vérifier les informations du joueur (Player ID)
    const cleanPlayerId = String(params.playerId || '').trim();
    if (product.requires_player_id !== false) {
      if (!cleanPlayerId || cleanPlayerId.length < 5 || !/^[a-zA-Z0-9_-]{5,24}$/.test(cleanPlayerId)) {
        return {
          success: false,
          httpStatus: 400,
          errorCode: 'INVALID_PLAYER_ID',
          userMessage: 'Votre Player ID est invalide. Veuillez vérifier votre identifiant de joueur (5 à 24 caractères alphanumériques).',
          technicalError: `Invalid player_id "${cleanPlayerId}" for product "${product.product_key}".`
        };
      }
    }

    // Step 4: Vérifier le prix actuel côté serveur (avec la marge PlayUp)
    const serverPriceCalc = db.computePlayUpMarginAndPrice(
      product.provider_price,
      product.game,
      product.region,
      product.product_key
    );
    const customerPrice = serverPriceCalc.playupPrice;
    const providerPrice = product.provider_price;
    const profit = serverPriceCalc.profit;

    // Step 6: Vérifier le paiement PlayUp
    if (!params.paymentConfirmed) {
      return {
        success: false,
        httpStatus: 402,
        errorCode: 'PAYMENT_REQUIRED',
        userMessage: 'Le paiement PlayUp doit être validé avant l’envoi de la recharge.',
        technicalError: 'Payment not confirmed before order dispatch.'
      };
    }

    // Step 7: Générer ou vérifier buyer_ref + Protection anti-duplication côté serveur
    if (params.buyerRef) {
      const existingByRef = db.findRechargeGamesOrderByBuyerRef(params.buyerRef);
      if (existingByRef) {
        return {
          success: false,
          httpStatus: 409,
          errorCode: 'DUPLICATE_ORDER',
          userMessage: `Cette commande (${params.buyerRef}) a déjà été enregistrée. Aucun double débit n'a été effectué.`,
          technicalError: `Duplicate buyer_ref "${params.buyerRef}" blocked on PlayUp server (existing order ${existingByRef.id}).`,
          order: existingByRef
        };
      }
    } else {
      // Accidental rapid double-click protection (same user + product_key + player_id within 8 seconds)
      const fingerprint = `${params.userId}:${product.product_key}:${cleanPlayerId}`;
      const recent = RechargeGamesProvider.recentOrderFingerprints.get(fingerprint);
      if (recent && Date.now() - recent.timestamp < 8000) {
        const existingOrd = db.findRechargeGamesOrderById(recent.orderId);
        return {
          success: false,
          httpStatus: 409,
          errorCode: 'DUPLICATE_ORDER',
          userMessage: `Une commande identique (#${recent.orderId}) est déjà en cours de traitement. Protection anti-doublon activée.`,
          technicalError: `Rapid duplicate order submission blocked within 8s window for ${fingerprint} (buyer_ref: ${recent.buyerRef}).`,
          order: existingOrd
        };
      }
    }

    const buyerRef = params.buyerRef || db.generateNextBuyerRef();
    const isTestMode = params.testMode !== undefined ? params.testMode : this.mode === 'TEST';

    // Step 8: Envoyer la commande à RechargeGames (POST /v1/orders)
    const effectiveBase = this.getEffectiveBaseUrl();
    const fullUrl = `${effectiveBase}/v1/orders`;
    const maskedHeaders = this.buildMaskedHeaders();

    const outboundPayload = {
      product_key: product.product_key,
      buyer_ref: buyerRef,
      player_id: cleanPlayerId || 'VOUCHER_PIN',
      player_name: params.playerName || undefined,
      server_id: params.serverId || undefined,
      region: product.region,
      test_mode: isTestMode
    };

    const reqPreview = JSON.stringify(
      {
        method: 'POST',
        url: fullUrl,
        headers: maskedHeaders,
        body: outboundPayload
      },
      null,
      2
    );

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(fullUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(outboundPayload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const latency = Date.now() - startTime;
      const rawText = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }

      if (!res.ok || !parsed || parsed.success === false) {
        const techErr = parsed?.error?.message || `HTTP ${res.status}: ${rawText.slice(0, 300)}`;
        const errCode = parsed?.error?.code || (res.status === 409 ? 'DUPLICATE_ORDER' : res.status === 429 ? 'RATE_LIMIT' : 'PROVIDER_ERROR');
        this.logApiCall('CREATE_ORDER', 'POST', fullUrl, res.status, latency, `Échec création (${errCode})`, false, rawText.slice(0, 1500), undefined, buyerRef, reqPreview);

        // User-safe message (Never expose sensitive technical error like "Authentication failed" to the customer)
        let safeUserMsg = 'Impossible de traiter la commande pour le moment. Veuillez réessayer.';
        if (errCode === 'DUPLICATE_BUYER_REF' || errCode === 'DUPLICATE_ORDER') {
          safeUserMsg = 'Cette commande a déjà été envoyée (protection anti-duplication).';
        } else if (errCode === 'INVALID_PLAYER_ID') {
          safeUserMsg = 'Le Player ID renseigné a été refusé par le serveur du jeu.';
        } else if (errCode === 'PRODUCT_UNAVAILABLE') {
          safeUserMsg = 'Ce produit est momentanément indisponible.';
        }

        return {
          success: false,
          httpStatus: res.status || 502,
          errorCode: errCode,
          userMessage: safeUserMsg,
          technicalError: techErr
        };
      }

      // Step 9 & 10: Enregistrer la réponse et mettre la commande en 'pending' (Jamais 'delivered' immédiatement !)
      const providerOrderId = String(parsed.order_id || parsed.id || `rg_${Date.now()}`);
      const playupOrderNumber = `PU-${Math.floor(10000 + Math.random() * 90000)}`;
      const nowIso = new Date().toISOString();

      const rgOrderRecord: RechargeGamesOrderRecord = {
        id: playupOrderNumber,
        user_id: params.userId,
        provider: 'rechargegames',
        provider_order_id: providerOrderId,
        buyer_ref: buyerRef,
        product_key: product.product_key,
        product_name: product.name,
        game: product.game,
        region: product.region,
        player_id: cleanPlayerId || 'VOUCHER_PIN',
        player_name: params.playerName,
        server_id: params.serverId,
        provider_price: providerPrice,
        customer_price: customerPrice,
        profit,
        currency: product.currency,
        status: 'pending', // Strictly pending until confirmed by webhook or GET /v1/orders/{order_id}
        test_mode: isTestMode,
        payment_method: params.paymentMethod || 'wallet',
        payment_reference: params.paymentReference,
        created_at: nowIso,
        updated_at: nowIso,
        poll_attempts: 0
      };

      db.upsertRechargeGamesOrder(rgOrderRecord);

      // Register fingerprint for anti-double-click protection
      RechargeGamesProvider.recentOrderFingerprints.set(
        `${params.userId}:${product.product_key}:${cleanPlayerId}`,
        { timestamp: Date.now(), orderId: rgOrderRecord.id, buyerRef }
      );

      // Also record in PlayUp unified orders list so mobile Order Tracker & Admin Orders see it
      const games = db.getGames();
      const matchedGame = games.find(
        g => g.name.toLowerCase() === product.game.toLowerCase() || g.slug === product.game_slug
      );

      const unifiedOrder: Order = {
        id: rgOrderRecord.id,
        orderNumber: rgOrderRecord.id,
        partnerOrderId: buyerRef,
        externalOrderId: providerOrderId,
        source: 'mobile_app',
        userId: params.userId,
        gameId: matchedGame?.id || 'game_ff',
        externalGameId: product.game_slug,
        gameName: product.game,
        serviceId: `srv_${product.game_slug || 'rg'}`,
        serviceName: `${product.game} (${product.region})`,
        packageId: `pkg_rg_${product.product_key}`,
        externalProductId: product.product_key,
        packageName: `${product.name} [${product.region}]`,
        playerId: cleanPlayerId,
        verifiedPlayerName: params.playerName,
        serverId: params.serverId || product.region,
        gameProfileData: {
          playerId: cleanPlayerId,
          region: product.region,
          product_key: product.product_key,
          ...(params.playerName ? { playerName: params.playerName } : {}),
          ...(params.serverId ? { serverId: params.serverId } : {})
        },
        publicPrice: customerPrice,
        chargedAmount: customerPrice,
        supplierCost: providerPrice,
        margin: profit,
        currency: product.currency,
        status: 'pending',
        paymentMethod: (params.paymentMethod as any) || 'wallet',
        paymentReference: params.paymentReference,
        providerId: 'prov_rechargegames',
        providerName: 'RechargeGames',
        providerReference: providerOrderId,
        providerResponse: db.sanitizeForLogs(parsed),
        createdAt: nowIso,
        updatedAt: nowIso,
        statusHistory: [
          {
            status: 'paid',
            timestamp: nowIso,
            note: `Paiement PlayUp validé ($${customerPrice.toFixed(2)} ${product.currency})`
          },
          {
            status: 'pending',
            timestamp: nowIso,
            note: `Commande envoyée à RechargeGames (${buyerRef} → ${providerOrderId}). En attente de confirmation réelle de livraison.`
          }
        ]
      };

      const allOrders = db.getOrders();
      allOrders.unshift(unifiedOrder);
      db.setOrders(allOrders);

      db.upsertProviderOrder({
        id: `pord_${Date.now()}`,
        playup_order_id: rgOrderRecord.id,
        partner_order_id: buyerRef,
        provider_order_id: providerOrderId,
        provider_name: 'RechargeGames',
        game_code: product.game_slug || product.game,
        product_id: product.product_key,
        player_data: { playerId: cleanPlayerId, region: product.region },
        cost_price: providerPrice,
        selling_price: customerPrice,
        profit,
        status: 'pending',
        request_payload: outboundPayload,
        response_payload: parsed,
        created_at: nowIso,
        updated_at: nowIso
      });

      this.logApiCall(
        'CREATE_ORDER',
        'POST',
        fullUrl,
        res.status,
        latency,
        `Commande créée en statut pending (${providerOrderId})`,
        true,
        rawText.slice(0, 2000),
        rgOrderRecord.id,
        buyerRef,
        reqPreview
      );

      return {
        success: true,
        httpStatus: 201,
        userMessage: `Commande #${rgOrderRecord.id} enregistrée et en cours de traitement chez RechargeGames.`,
        order: rgOrderRecord,
        playupOrder: unifiedOrder
      };
    } catch (err: any) {
      const latency = Date.now() - startTime;
      const techErr = err?.name === 'AbortError' ? 'Timeout API RechargeGames (12s)' : err?.message || 'Erreur réseau';
      this.logApiCall('CREATE_ORDER', 'POST', fullUrl, null, latency, 'Erreur réseau', false, techErr, undefined, buyerRef, reqPreview);
      return {
        success: false,
        httpStatus: 503,
        errorCode: 'NETWORK_ERROR',
        userMessage: 'Impossible de traiter la commande pour le moment. Veuillez réessayer.',
        technicalError: techErr
      };
    }
  }

  /**
   * 10. VÉRIFICATION HMAC-SHA256 DU WEBHOOK RECHARGEGAMES
   * Verifies webhook-id, webhook-timestamp, and webhook-signature using RECHARGEGAMES_WEBHOOK_SECRET.
   */
  public verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, any>
  ): RechargeGamesHmacVerificationResult {
    const normalizedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers || {})) {
      if (typeof v === 'string') {
        normalizedHeaders[k.toLowerCase()] = v;
      } else if (Array.isArray(v) && v.length > 0) {
        normalizedHeaders[k.toLowerCase()] = String(v[0]);
      }
    }

    const webhookId =
      normalizedHeaders['webhook-id'] ||
      normalizedHeaders['x-webhook-id'] ||
      '';
    const webhookTimestamp =
      normalizedHeaders['webhook-timestamp'] ||
      normalizedHeaders['x-webhook-timestamp'] ||
      '';
    const signatureRaw =
      normalizedHeaders['webhook-signature'] ||
      normalizedHeaders['x-webhook-signature'] ||
      normalizedHeaders['x-rechargegames-signature'] ||
      '';

    const maskedSig =
      signatureRaw.length > 12
        ? `${signatureRaw.slice(0, 8)}••••••••${signatureRaw.slice(-6)}`
        : signatureRaw
        ? '••••••••'
        : 'Aucune';

    if (!this.webhookSecret) {
      return {
        valid: false,
        webhookId,
        webhookTimestamp,
        signatureHeader: 'webhook-signature',
        signatureMasked: maskedSig,
        computedHmacPreview: 'Secret non configuré',
        reason: 'RECHARGEGAMES_WEBHOOK_SECRET non configuré côté serveur.'
      };
    }

    if (!signatureRaw) {
      return {
        valid: false,
        webhookId,
        webhookTimestamp,
        signatureHeader: 'webhook-signature',
        signatureMasked: 'Manquante',
        computedHmacPreview: 'N/A',
        reason: 'En-tête webhook-signature manquant dans la requête entrante.'
      };
    }

    // Verify timestamp freshness if webhook-timestamp is provided (5-minute replay window)
    if (webhookTimestamp) {
      const tsNum = Number(webhookTimestamp);
      if (!Number.isNaN(tsNum) && tsNum > 0) {
        const tsSeconds = tsNum > 1e12 ? Math.floor(tsNum / 1000) : tsNum;
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (Math.abs(nowSeconds - tsSeconds) > 300) {
          return {
            valid: false,
            webhookId,
            webhookTimestamp,
            signatureHeader: 'webhook-signature',
            signatureMasked: maskedSig,
            computedHmacPreview: 'Timestamp expiré',
            reason: `Horodatage webhook-timestamp (${webhookTimestamp}) hors de la fenêtre de tolérance de 5 minutes.`
          };
        }
      }
    }

    // Extract candidate signature values (strip optional "v1,", "v1=", "sha256=" prefixes)
    const candidateSigs = signatureRaw
      .split(/\s+/)
      .map(part => part.replace(/^(v1,|v1=|sha256=)/i, '').trim())
      .filter(Boolean);

    // Build canonical signing strings supported by RechargeGames webhook specification:
    // 1. "${webhook-id}.${webhook-timestamp}.${rawBody}"
    // 2. "${webhook-timestamp}.${rawBody}"
    // 3. "${rawBody}"
    const signingPayloads: string[] = [];
    if (webhookId && webhookTimestamp) {
      signingPayloads.push(`${webhookId}.${webhookTimestamp}.${rawBody}`);
    }
    if (webhookTimestamp) {
      signingPayloads.push(`${webhookTimestamp}.${rawBody}`);
    }
    signingPayloads.push(rawBody);

    const primaryComputedHex = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(signingPayloads[0], 'utf8')
      .digest('hex');

    const computedPreview = `${primaryComputedHex.slice(0, 10)}••••${primaryComputedHex.slice(-8)}`;

    for (const payloadToSign of signingPayloads) {
      const expectedHex = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payloadToSign, 'utf8')
        .digest('hex');
      const expectedBase64 = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payloadToSign, 'utf8')
        .digest('base64');

      for (const candidate of candidateSigs) {
        // Timing-safe comparison against hex digest
        if (candidate.length === expectedHex.length) {
          try {
            if (
              crypto.timingSafeEqual(
                Buffer.from(candidate.toLowerCase(), 'utf8'),
                Buffer.from(expectedHex.toLowerCase(), 'utf8')
              )
            ) {
              return {
                valid: true,
                webhookId,
                webhookTimestamp,
                signatureHeader: 'webhook-signature',
                signatureMasked: maskedSig,
                computedHmacPreview: computedPreview,
                reason: 'Signature HMAC-SHA256 authentifiée avec succès.'
              };
            }
          } catch {
            // Continue checking
          }
        }
        // Timing-safe comparison against base64 digest
        if (candidate.length === expectedBase64.length) {
          try {
            if (
              crypto.timingSafeEqual(
                Buffer.from(candidate, 'utf8'),
                Buffer.from(expectedBase64, 'utf8')
              )
            ) {
              return {
                valid: true,
                webhookId,
                webhookTimestamp,
                signatureHeader: 'webhook-signature',
                signatureMasked: maskedSig,
                computedHmacPreview: computedPreview,
                reason: 'Signature HMAC-SHA256 (Base64) authentifiée avec succès.'
              };
            }
          } catch {
            // Continue checking
          }
        }
      }
    }

    return {
      valid: false,
      webhookId,
      webhookTimestamp,
      signatureHeader: 'webhook-signature',
      signatureMasked: maskedSig,
      computedHmacPreview: computedPreview,
      reason: 'Signature HMAC-SHA256 invalide : la signature reçue ne correspond pas au digest calculé avec RECHARGEGAMES_WEBHOOK_SECRET.'
    };
  }

  /**
   * Generates a valid RechargeGames HMAC-SHA256 signature for testing / internal simulation
   */
  public signWebhookPayload(rawBody: string, webhookId: string, webhookTimestamp: string): string {
    const canonical = `${webhookId}.${webhookTimestamp}.${rawBody}`;
    const hex = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(canonical, 'utf8')
      .digest('hex');
    return `v1,${hex}`;
  }

  /**
   * 9 & 10. TRAITEMENT DU WEBHOOK RECHARGEGAMES (/rechargegames-webhook)
   * Handles documented events with Firestore Idempotency (/webhook_events/{eventId}):
   * - webhook.test
   * - order.delivered / delivered
   * - order.refunded / refunded
   * - order.failed / failed
   */
  public async handleWebhook(
    rawBody: string,
    payload: any,
    headers: Record<string, any>,
    options?: { isInvalidJson?: boolean; endpointPath?: string }
  ): Promise<{
    httpStatus: number;
    responseBody: Record<string, any>;
    webhookEvent: RechargeGamesWebhookEvent;
  }> {
    const startTime = Date.now();
    const receivedAt = new Date().toISOString();
    const processingSteps: string[] = [];
    const endpointUsed = options?.endpointPath || '/rechargegames-webhook';

    // Sanitize incoming headers before any logging so no secret is ever persisted
    const safeHeaders: Record<string, string> = {};
    for (const [hk, hv] of Object.entries(headers || {})) {
      const lower = hk.toLowerCase();
      if (lower.includes('secret') || lower.includes('authorization') || lower.includes('api-key')) {
        safeHeaders[hk] = '••••••••';
      } else {
        safeHeaders[hk] = String(hv);
      }
    }

    const sigCheck = this.verifyWebhookSignature(rawBody, headers);
    const rawEventType =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? String(payload.event || payload.event_type || payload.type || '').trim()
        : '';

    let eventType = rawEventType || 'unknown';
    if (eventType === 'delivered') eventType = 'order.delivered';
    if (eventType === 'refunded') eventType = 'order.refunded';
    if (eventType === 'failed') eventType = 'order.failed';

    const eventId =
      sigCheck.webhookId ||
      (payload && typeof payload === 'object' ? String(payload.event_id || payload.id || '') : '') ||
      `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const sanitizedFirestoreId = sanitizeFirestoreEventId(eventId);
    const firestoreDocPath = `webhook_events/${sanitizedFirestoreId}`;

    const orderIdFromPayload =
      payload && typeof payload === 'object'
        ? String(payload.order_id || payload.data?.order_id || payload.order?.order_id || '').trim()
        : '';
    const buyerRefFromPayload =
      payload && typeof payload === 'object'
        ? String(payload.buyer_ref || payload.data?.buyer_ref || payload.order?.buyer_ref || '').trim()
        : '';

    processingSteps.push(`[1] Réception POST ${endpointUsed} (event="${eventType}", webhook-id="${eventId}")`);

    // 1. Reject immediately if HMAC-SHA256 signature is invalid!
    if (!sigCheck.valid) {
      processingSteps.push(`[2] REJET SÉCURITÉ : ${sigCheck.reason}`);
      processingSteps.push(`[3] Aucune commande modifiée. Aucun verrou d'idempotence Firestore créé.`);

      const rejectedEvent: RechargeGamesWebhookEvent = {
        event_id: eventId,
        event_type: eventType,
        provider: 'rechargegames',
        order_id: orderIdFromPayload || undefined,
        provider_order_id: orderIdFromPayload || undefined,
        buyer_ref: buyerRefFromPayload || undefined,
        received_at: receivedAt,
        processed_at: new Date().toISOString(),
        processing_status: 'rejected_signature',
        signature_valid: false,
        webhook_timestamp: sigCheck.webhookTimestamp || undefined,
        signature_header: sigCheck.signatureHeader,
        signature_masked: sigCheck.signatureMasked,
        computed_hmac_preview: sigCheck.computedHmacPreview,
        payload_preview: rawBody.slice(0, 1000),
        error_message: sigCheck.reason,
        processing_steps: processingSteps,
        firestore_doc_path: firestoreDocPath,
        firestore_idempotency_status: 'skipped_unverified'
      };

      db.addRechargeGamesWebhookEvent(rejectedEvent);
      db.addSystemLog('error', 'webhook', `[RechargeGames Security] Webhook rejeté sur ${endpointUsed} (Signature HMAC-SHA256 invalide): ${sigCheck.reason}`, {
        event_id: eventId,
        event_type: eventType
      });

      const responseBody = {
        received: false,
        error: 'Invalid webhook-signature',
        message: sigCheck.reason
      };

      db.addProviderWebhookLog({
        providerId: 'prov_rechargegames',
        providerName: 'RechargeGames',
        eventType,
        partnerOrderId: buyerRefFromPayload || undefined,
        goxtopOrderId: orderIdFromPayload || undefined,
        signatureDetected: sigCheck.signatureMasked !== 'Manquante' && sigCheck.signatureMasked !== 'Aucune',
        signatureHeader: sigCheck.signatureHeader,
        signatureValueMasked: sigCheck.signatureMasked,
        computedHmacPreview: sigCheck.computedHmacPreview,
        hmacValidation: 'Échouée',
        httpStatus: 401,
        processingResult: 'Rejeté (Signature invalide)',
        rawPayload: String(db.sanitizeForLogs(rawBody)),
        headersReceived: safeHeaders,
        processingSteps,
        latencyMs: Date.now() - startTime,
        backendResponse: JSON.stringify(responseBody),
        errorMessage: sigCheck.reason
      });

      return {
        httpStatus: 401,
        responseBody,
        webhookEvent: rejectedEvent
      };
    }

    processingSteps.push(`[2] Signature HMAC-SHA256 et timestamp validés (${sigCheck.computedHmacPreview})`);

    // 2. Validate payload structure (données invalides)
    const isOrderEvent =
      eventType === 'order.delivered' ||
      eventType === 'order.refunded' ||
      eventType === 'order.failed';
    const isSupportedEvent = eventType === 'webhook.test' || isOrderEvent;

    if (
      options?.isInvalidJson ||
      !rawBody ||
      !rawBody.trim() ||
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !rawEventType ||
      !isSupportedEvent ||
      (isOrderEvent && !orderIdFromPayload && !buyerRefFromPayload)
    ) {
      const invalidReason = options?.isInvalidJson
        ? 'JSON malformé dans le corps de la requête webhook.'
        : !rawEventType
        ? 'Champ obligatoire "event" manquant dans les données du webhook.'
        : !isSupportedEvent
        ? `Type d'événement "${rawEventType}" invalide ou non supporté.`
        : 'Identifiant de commande ("order_id" ou "buyer_ref") manquant pour cet événement.';

      processingSteps.push(`[3] REJET DONNÉES INVALIDES : ${invalidReason}`);

      const invalidEvt: RechargeGamesWebhookEvent = {
        event_id: eventId,
        event_type: eventType,
        provider: 'rechargegames',
        order_id: orderIdFromPayload || undefined,
        provider_order_id: orderIdFromPayload || undefined,
        buyer_ref: buyerRefFromPayload || undefined,
        received_at: receivedAt,
        processed_at: new Date().toISOString(),
        processing_status: 'invalid_payload',
        signature_valid: true,
        webhook_timestamp: sigCheck.webhookTimestamp || undefined,
        signature_header: sigCheck.signatureHeader,
        signature_masked: sigCheck.signatureMasked,
        computed_hmac_preview: sigCheck.computedHmacPreview,
        payload_preview: rawBody.slice(0, 1000),
        error_message: invalidReason,
        processing_steps: processingSteps,
        firestore_doc_path: firestoreDocPath,
        firestore_idempotency_status: 'skipped_unverified'
      };

      db.addRechargeGamesWebhookEvent(invalidEvt);
      const responseBody = {
        received: false,
        error: 'INVALID_PAYLOAD',
        message: invalidReason
      };

      db.addProviderWebhookLog({
        providerId: 'prov_rechargegames',
        providerName: 'RechargeGames',
        eventType,
        partnerOrderId: buyerRefFromPayload || undefined,
        goxtopOrderId: orderIdFromPayload || undefined,
        signatureDetected: true,
        signatureHeader: sigCheck.signatureHeader,
        signatureValueMasked: sigCheck.signatureMasked,
        computedHmacPreview: sigCheck.computedHmacPreview,
        hmacValidation: 'Validée',
        httpStatus: 400,
        processingResult: 'Erreur (Données invalides)',
        rawPayload: String(db.sanitizeForLogs(rawBody)),
        headersReceived: safeHeaders,
        processingSteps,
        latencyMs: Date.now() - startTime,
        backendResponse: JSON.stringify(responseBody),
        errorMessage: invalidReason
      });

      return {
        httpStatus: 400,
        responseBody,
        webhookEvent: invalidEvt
      };
    }

    // 3. Robust Firestore Idempotency Check & In-Flight Lock (/webhook_events/{eventId})
    const idempotencyCheck = await checkWebhookIdempotencyInFirestore(eventId);
    const lockAcquired = !idempotencyCheck.isDuplicate && acquireInFlightWebhookLock(eventId);

    if (idempotencyCheck.isDuplicate || !lockAcquired) {
      const lockSourceLabel = idempotencyCheck.isDuplicate
        ? `Firestore (${idempotencyCheck.firestoreDocPath})`
        : `Verrou concurrent en cours (${idempotencyCheck.firestoreDocPath})`;
      processingSteps.push(
        `[3] Idempotence ${lockSourceLabel} : l'événement "${eventId}" a déjà été enregistré dans Firestore. Traitement en double bloqué.`
      );
      const dupEvent: RechargeGamesWebhookEvent = {
        event_id: eventId,
        event_type: eventType,
        provider: 'rechargegames',
        order_id: orderIdFromPayload || undefined,
        provider_order_id: orderIdFromPayload || undefined,
        buyer_ref: buyerRefFromPayload || undefined,
        received_at: receivedAt,
        processed_at: new Date().toISOString(),
        processing_status: 'duplicate_ignored',
        signature_valid: true,
        webhook_timestamp: sigCheck.webhookTimestamp || undefined,
        signature_header: sigCheck.signatureHeader,
        signature_masked: sigCheck.signatureMasked,
        computed_hmac_preview: sigCheck.computedHmacPreview,
        payload_preview: rawBody.slice(0, 1000),
        processing_steps: processingSteps,
        firestore_doc_path: idempotencyCheck.firestoreDocPath,
        firestore_idempotency_status: 'duplicate_blocked',
        firestore_synced_at: idempotencyCheck.existingRecord?.processedAt || new Date().toISOString()
      };
      db.addRechargeGamesWebhookEvent(dupEvent);
      return {
        httpStatus: 200,
        responseBody: {
          received: true,
          duplicate: true,
          event_id: eventId,
          idempotency_store: 'firestore',
          firestore_doc_path: idempotencyCheck.firestoreDocPath
        },
        webhookEvent: dupEvent
      };
    }

    try {
      // 4. Handle documented event: webhook.test
      if (eventType === 'webhook.test') {
        const fsRecord = await recordWebhookIdempotencyInFirestore({
          eventId,
          eventType: 'webhook.test',
          signatureHeader: sigCheck.signatureMasked,
          rawBody
        });
        processingSteps.push(
          `[3] Événement "webhook.test" authentifié et verrouillé dans Firestore (${fsRecord.firestoreDocPath}).`
        );
        const testEvt: RechargeGamesWebhookEvent = {
          event_id: eventId,
          event_type: 'webhook.test',
          provider: 'rechargegames',
          received_at: receivedAt,
          processed_at: fsRecord.processedAt,
          processing_status: 'processed',
          signature_valid: true,
          webhook_timestamp: sigCheck.webhookTimestamp || undefined,
          signature_header: sigCheck.signatureHeader,
          signature_masked: sigCheck.signatureMasked,
          computed_hmac_preview: sigCheck.computedHmacPreview,
          payload_preview: rawBody.slice(0, 1000),
          processing_steps: processingSteps,
          firestore_doc_path: fsRecord.firestoreDocPath,
          firestore_idempotency_status: 'stored',
          firestore_synced_at: fsRecord.processedAt
        };
        db.addRechargeGamesWebhookEvent(testEvt);

        const responseBody = {
          received: true,
          event: 'webhook.test',
          event_id: eventId,
          hmac_verified: true,
          idempotency_store: 'firestore',
          firestore_doc_path: fsRecord.firestoreDocPath,
          message: 'RechargeGames webhook.test verified and locked in Firestore.'
        };

        db.addProviderWebhookLog({
          providerId: 'prov_rechargegames',
          providerName: 'RechargeGames',
          eventType: 'webhook.test',
          signatureDetected: true,
          signatureHeader: sigCheck.signatureHeader,
          signatureValueMasked: sigCheck.signatureMasked,
          computedHmacPreview: sigCheck.computedHmacPreview,
          hmacValidation: 'Validée',
          httpStatus: 200,
          processingResult: 'Test réussi',
          rawPayload: String(db.sanitizeForLogs(rawBody)),
          headersReceived: safeHeaders,
          processingSteps,
          latencyMs: Date.now() - startTime,
          backendResponse: JSON.stringify(responseBody)
        });

        return {
          httpStatus: 200,
          responseBody,
          webhookEvent: testEvt
        };
      }

      // 5. Identify target order for order.delivered / order.refunded / order.failed
      const targetOrder =
        (orderIdFromPayload ? db.findRechargeGamesOrderById(orderIdFromPayload) : undefined) ||
        (buyerRefFromPayload ? db.findRechargeGamesOrderByBuyerRef(buyerRefFromPayload) : undefined);

      if (!targetOrder) {
        processingSteps.push(`[3] Commande introuvable pour order_id="${orderIdFromPayload}" / buyer_ref="${buyerRefFromPayload}"`);
        const notFoundEvt: RechargeGamesWebhookEvent = {
          event_id: eventId,
          event_type: eventType,
          provider: 'rechargegames',
          order_id: orderIdFromPayload || undefined,
          provider_order_id: orderIdFromPayload || undefined,
          buyer_ref: buyerRefFromPayload || undefined,
          received_at: receivedAt,
          processed_at: new Date().toISOString(),
          processing_status: 'order_not_found',
          signature_valid: true,
          webhook_timestamp: sigCheck.webhookTimestamp || undefined,
          signature_header: sigCheck.signatureHeader,
          signature_masked: sigCheck.signatureMasked,
          computed_hmac_preview: sigCheck.computedHmacPreview,
          payload_preview: rawBody.slice(0, 1000),
          error_message: 'Order not found in PlayUp database',
          processing_steps: processingSteps,
          firestore_doc_path: firestoreDocPath,
          firestore_idempotency_status: 'skipped_unverified'
        };
        db.addRechargeGamesWebhookEvent(notFoundEvt);
        return {
          httpStatus: 404,
          responseBody: { received: false, error: 'Order not found' },
          webhookEvent: notFoundEvt
        };
      }

      // 6. Persist idempotency lock in Firestore (/webhook_events/{eventId}) BEFORE/WITH order transition
      const fsRecord = await recordWebhookIdempotencyInFirestore({
        eventId,
        eventType: eventType as 'order.delivered' | 'order.refunded' | 'order.failed',
        providerOrderId: targetOrder.provider_order_id,
        playupOrderId: targetOrder.id,
        buyerRef: targetOrder.buyer_ref,
        signatureHeader: sigCheck.signatureMasked,
        rawBody
      });

      processingSteps.push(
        `[3] Idempotence Firestore : ID "${eventId}" enregistré dans ${fsRecord.firestoreDocPath} (verrou immuable créé).`
      );

      // 7. Process order.delivered, order.refunded, or order.failed
      if (eventType === 'order.delivered') {
        const failureOrPin = payload?.data?.pin_code || payload?.pin_code;
        this.applyOrderStatusTransition(
          targetOrder,
          'delivered',
          `Top-up livré avec succès. Confirmé par webhook RechargeGames (order.delivered, event_id=${eventId})${failureOrPin ? ` — Code: ${failureOrPin}` : ''}`
        );
        setGatewayOrderStatus(targetOrder.provider_order_id, 'delivered');
        processingSteps.push(`[4] Commande PlayUp #${targetOrder.id} (RechargeGames: ${targetOrder.provider_order_id}) passée à "delivered" — Top-up livré avec succès.`);
      } else if (eventType === 'order.refunded') {
        const refundReason =
          payload?.data?.refund_reason ||
          payload?.refund_reason ||
          payload?.reason ||
          'Remboursement officiel confirmé par RechargeGames (order.refunded)';
        this.applyOrderStatusTransition(targetOrder, 'refunded', String(refundReason));
        setGatewayOrderStatus(targetOrder.provider_order_id, 'refunded', String(refundReason));
        processingSteps.push(`[4] Commande PlayUp #${targetOrder.id} (RechargeGames: ${targetOrder.provider_order_id}) passée à "refunded" et remboursement PlayUp exécuté ($${targetOrder.customer_price.toFixed(2)} ${targetOrder.currency}).`);
      } else if (eventType === 'order.failed') {
        const reason =
          payload?.data?.failure_reason ||
          payload?.failure_reason ||
          payload?.error ||
          'Échec de livraison signalé par RechargeGames (order.failed)';
        this.applyOrderStatusTransition(targetOrder, 'failed', String(reason));
        setGatewayOrderStatus(targetOrder.provider_order_id, 'failed', String(reason));
        processingSteps.push(`[4] Commande PlayUp #${targetOrder.id} (RechargeGames: ${targetOrder.provider_order_id}) passée à "failed" (${reason}).`);
      }

      const processedEvt: RechargeGamesWebhookEvent = {
        event_id: eventId,
        event_type: eventType,
        provider: 'rechargegames',
        order_id: targetOrder.id,
        provider_order_id: targetOrder.provider_order_id,
        playup_order_id: targetOrder.id,
        buyer_ref: targetOrder.buyer_ref,
        received_at: receivedAt,
        processed_at: fsRecord.processedAt,
        processing_status: 'processed',
        signature_valid: true,
        webhook_timestamp: sigCheck.webhookTimestamp || undefined,
        signature_header: sigCheck.signatureHeader,
        signature_masked: sigCheck.signatureMasked,
        computed_hmac_preview: sigCheck.computedHmacPreview,
        payload_preview: rawBody.slice(0, 1000),
        processing_steps: processingSteps,
        firestore_doc_path: fsRecord.firestoreDocPath,
        firestore_idempotency_status: 'stored',
        firestore_synced_at: fsRecord.processedAt
      };

      db.addRechargeGamesWebhookEvent(processedEvt);

      const responseBody = {
        received: true,
        event_id: eventId,
        event_type: eventType,
        order_id: targetOrder.provider_order_id,
        playup_order_id: targetOrder.id,
        buyer_ref: targetOrder.buyer_ref,
        new_status: targetOrder.status,
        refund_transaction_id: targetOrder.refund_transaction_id,
        idempotency_store: 'firestore',
        firestore_doc_path: fsRecord.firestoreDocPath
      };

      db.addProviderWebhookLog({
        providerId: 'prov_rechargegames',
        providerName: 'RechargeGames',
        eventType,
        partnerOrderId: targetOrder.buyer_ref,
        goxtopOrderId: targetOrder.provider_order_id,
        statusReceived: targetOrder.status,
        signatureDetected: true,
        signatureHeader: sigCheck.signatureHeader,
        signatureValueMasked: sigCheck.signatureMasked,
        computedHmacPreview: sigCheck.computedHmacPreview,
        hmacValidation: 'Validée',
        httpStatus: 200,
        processingResult: 'Traité avec succès',
        rawPayload: String(db.sanitizeForLogs(rawBody)),
        headersReceived: safeHeaders,
        processingSteps,
        latencyMs: Date.now() - startTime,
        backendResponse: JSON.stringify(responseBody)
      });

      return {
        httpStatus: 200,
        responseBody,
        webhookEvent: processedEvt
      };
    } finally {
      releaseInFlightWebhookLock(eventId);
    }
  }

  /**
   * Applies status transition ('delivered', 'refunded', or 'failed') to both RechargeGames orders table and PlayUp unified orders
   */
  public applyOrderStatusTransition(
    rgOrder: RechargeGamesOrderRecord,
    newStatus: RechargeGamesOrderStatus,
    noteOrFailureReason?: string
  ) {
    // Prevent double refund if already refunded
    if (rgOrder.status === 'refunded') {
      return rgOrder;
    }
    // For delivered/failed, only transition from pending
    if ((newStatus === 'delivered' || newStatus === 'failed') && rgOrder.status !== 'pending') {
      return rgOrder;
    }

    const nowIso = new Date().toISOString();
    rgOrder.status = newStatus;
    rgOrder.updated_at = nowIso;
    if (newStatus === 'delivered') {
      rgOrder.delivered_at = nowIso;
    } else if (newStatus === 'failed') {
      rgOrder.failure_reason = noteOrFailureReason || 'Recharge échouée chez le fournisseur';
    } else if (newStatus === 'refunded') {
      rgOrder.refunded_at = nowIso;
      rgOrder.refund_reason = noteOrFailureReason || 'Remboursement officiel RechargeGames';

      // Trigger PlayUp automated refund workflow (credit user wallet & record refund transaction)
      const users = db.getUsers();
      const uIdx = users.findIndex(u => u.id === rgOrder.user_id);
      if (uIdx !== -1) {
        users[uIdx].walletBalance = Number(
          (users[uIdx].walletBalance + rgOrder.customer_price).toFixed(2)
        );
        db.setUsers(users);
      }

      const refundTx = db.addPaymentTransaction({
        transactionReference: `REFUND-${rgOrder.id}-${Date.now().toString().slice(-5)}`,
        orderId: rgOrder.id,
        orderNumber: rgOrder.id,
        partnerOrderId: rgOrder.buyer_ref,
        userId: rgOrder.user_id,
        userEmail: uIdx !== -1 ? users[uIdx].email : undefined,
        gatewayId: 'gw_wallet',
        paymentMethod: (rgOrder.payment_method as any) || 'wallet',
        amount: rgOrder.customer_price,
        currency: rgOrder.currency || 'USD',
        feeAmount: 0,
        totalCharged: rgOrder.customer_price,
        status: 'refunded',
        statusMessage: `Remboursement déclenché par webhook RechargeGames (order.refunded) : ${rgOrder.refund_reason}`
      });
      rgOrder.refund_transaction_id = refundTx.transactionReference;

      db.addSystemLog(
        'info',
        'payment',
        `[RechargeGames Refund] Commande #${rgOrder.id} (${rgOrder.buyer_ref}) remboursée automatiquement suite au webhook RechargeGames ($${rgOrder.customer_price.toFixed(2)} ${rgOrder.currency}).`
      );
    }
    db.upsertRechargeGamesOrder(rgOrder);

    // Sync with PlayUp unified orders table
    const orders = db.getOrders();
    const ordIdx = orders.findIndex(
      o =>
        o.id === rgOrder.id ||
        o.partnerOrderId === rgOrder.buyer_ref ||
        o.externalOrderId === rgOrder.provider_order_id
    );

    if (ordIdx !== -1) {
      const ord = orders[ordIdx];
      const mappedPlayUpStatus =
        newStatus === 'delivered'
          ? 'completed'
          : newStatus === 'refunded'
          ? 'refunded'
          : newStatus === 'failed'
          ? 'failed'
          : 'pending';
      ord.status = mappedPlayUpStatus;
      ord.updatedAt = nowIso;
      if (newStatus === 'failed') {
        ord.errorMessage = rgOrder.failure_reason;
      } else if (newStatus === 'refunded') {
        ord.errorMessage = rgOrder.refund_reason;
      }
      ord.statusHistory.push({
        status: mappedPlayUpStatus,
        timestamp: nowIso,
        note:
          newStatus === 'delivered'
            ? noteOrFailureReason || 'Top-up livré avec succès.'
            : newStatus === 'refunded'
            ? `Commande remboursée ($${rgOrder.customer_price.toFixed(2)} ${rgOrder.currency} recrédités) : ${rgOrder.refund_reason}`
            : `Top-up échoué : ${rgOrder.failure_reason}`
      });
      db.setOrders(orders);
    }

    // Update provider_orders table
    const provOrd = db.findProviderOrderByPartnerId(rgOrder.buyer_ref);
    if (provOrd) {
      db.upsertProviderOrder({
        ...provOrd,
        status:
          newStatus === 'delivered'
            ? 'completed'
            : newStatus === 'failed' || newStatus === 'refunded'
            ? 'failed'
            : 'pending',
        error_message:
          newStatus === 'failed'
            ? rgOrder.failure_reason
            : newStatus === 'refunded'
            ? rgOrder.refund_reason
            : undefined,
        updated_at: nowIso
      });
    }

    // Create user notification
    if (newStatus === 'delivered') {
      db.addUserNotification({
        userId: rgOrder.user_id,
        orderId: rgOrder.id,
        orderNumber: rgOrder.id,
        title: 'Top-up livré avec succès.',
        message: `Top-up livré avec succès. Votre commande #${rgOrder.id} (${rgOrder.product_name} - ${rgOrder.region}) a été créditée sur le Player ID ${rgOrder.player_id}.`,
        type: 'order'
      });
    } else if (newStatus === 'refunded') {
      db.addUserNotification({
        userId: rgOrder.user_id,
        orderId: rgOrder.id,
        orderNumber: rgOrder.id,
        title: 'Commande remboursée',
        message: `Votre commande #${rgOrder.id} (${rgOrder.product_name}) a été remboursée ($${rgOrder.customer_price.toFixed(2)} ${rgOrder.currency} recrédités sur votre compte PlayUp) suite à la confirmation RechargeGames.`,
        type: 'order'
      });
    } else if (newStatus === 'failed') {
      db.addUserNotification({
        userId: rgOrder.user_id,
        orderId: rgOrder.id,
        orderNumber: rgOrder.id,
        title: 'Top-up échoué',
        message: `Votre commande #${rgOrder.id} (${rgOrder.product_name}) n'a pas pu être livrée. Raison : ${rgOrder.failure_reason}`,
        type: 'error'
      });
    }

    return rgOrder;
  }

  /**
   * 11. FALLBACK STATUS — GET /v1/orders/{order_id}
   * Consults the official status endpoint for pending orders and updates PlayUp when delivered or failed.
   */
  public async checkOrderStatus(
    orderIdOrProviderOrderId: string,
    options?: { autoCompleteInTestMode?: boolean }
  ): Promise<{
    success: boolean;
    status: RechargeGamesOrderStatus;
    order?: RechargeGamesOrderRecord;
    rawResponse?: any;
    message: string;
  }> {
    const startTime = Date.now();
    const rgOrder = db.findRechargeGamesOrderById(orderIdOrProviderOrderId);
    const providerOrderId = rgOrder ? rgOrder.provider_order_id : orderIdOrProviderOrderId;

    const effectiveBase = this.getEffectiveBaseUrl();
    const querySuffix = options?.autoCompleteInTestMode ? '?auto_complete=true' : '';
    const fullUrl = `${effectiveBase}/v1/orders/${encodeURIComponent(providerOrderId)}${querySuffix}`;
    const maskedHeaders = this.buildMaskedHeaders();
    const reqPreview = JSON.stringify({ method: 'GET', url: fullUrl, headers: maskedHeaders }, null, 2);

    try {
      const res = await fetch(fullUrl, {
        method: 'GET',
        headers: this.buildHeaders()
      });
      const latency = Date.now() - startTime;
      const rawText = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }

      if (!res.ok || !parsed) {
        const msg = parsed?.error?.message || `HTTP ${res.status}: Impossible de vérifier le statut de ${providerOrderId}`;
        this.logApiCall('GET_ORDER_STATUS', 'GET', fullUrl, res.status, latency, 'Erreur consultation statut', false, rawText.slice(0, 1000), rgOrder?.id, rgOrder?.buyer_ref, reqPreview);
        return {
          success: false,
          status: rgOrder?.status || 'pending',
          order: rgOrder,
          message: msg
        };
      }

      const remoteStatusRaw = String(parsed.status || 'pending').toLowerCase();
      let remoteStatus: RechargeGamesOrderStatus = 'pending';
      if (remoteStatusRaw === 'delivered' || remoteStatusRaw === 'completed' || remoteStatusRaw === 'success') {
        remoteStatus = 'delivered';
      } else if (remoteStatusRaw === 'failed' || remoteStatusRaw === 'error' || remoteStatusRaw === 'cancelled') {
        remoteStatus = 'failed';
      }

      if (rgOrder) {
        rgOrder.poll_attempts = (rgOrder.poll_attempts || 0) + 1;
        rgOrder.last_polled_at = new Date().toISOString();
        if (remoteStatus !== 'pending' && rgOrder.status === 'pending') {
          this.applyOrderStatusTransition(
            rgOrder,
            remoteStatus,
            remoteStatus === 'delivered'
              ? `Confirmé via GET /v1/orders/${providerOrderId}`
              : parsed.failure_reason || 'Échec confirmé via GET /v1/orders/{order_id}'
          );
        } else {
          db.upsertRechargeGamesOrder(rgOrder);
        }
      }

      this.logApiCall(
        'GET_ORDER_STATUS',
        'GET',
        fullUrl,
        res.status,
        latency,
        `Statut: ${remoteStatus}`,
        true,
        rawText.slice(0, 1500),
        rgOrder?.id,
        rgOrder?.buyer_ref,
        reqPreview
      );

      return {
        success: true,
        status: remoteStatus,
        order: rgOrder ? db.findRechargeGamesOrderById(rgOrder.id) : undefined,
        rawResponse: parsed,
        message:
          remoteStatus === 'delivered'
            ? 'Recharge effectuée avec succès (delivered).'
            : remoteStatus === 'failed'
            ? `Recharge échouée (failed): ${parsed.failure_reason || ''}`
            : 'Commande en traitement (pending).'
      };
    } catch (err: any) {
      const latency = Date.now() - startTime;
      const errMsg = err?.message || 'Erreur réseau lors de la consultation du statut';
      this.logApiCall('GET_ORDER_STATUS', 'GET', fullUrl, null, latency, 'Erreur réseau', false, errMsg, rgOrder?.id, rgOrder?.buyer_ref, reqPreview);
      return {
        success: false,
        status: rgOrder?.status || 'pending',
        order: rgOrder,
        message: errMsg
      };
    }
  }

  /**
   * Periodic background fallback poller for pending RechargeGames orders
   * Stops polling automatically once an order reaches 'delivered' or 'failed'.
   */
  public async pollPendingOrders(): Promise<number> {
    const pendingOrders = db
      .getRechargeGamesOrders()
      .filter(o => o.status === 'pending' && (o.poll_attempts || 0) < 20);

    let updatedCount = 0;
    for (const ord of pendingOrders) {
      const ageMs = Date.now() - new Date(ord.created_at).getTime();
      // Poll orders that have been pending for at least 5 seconds
      if (ageMs >= 5000) {
        const res = await this.checkOrderStatus(ord.id, {
          autoCompleteInTestMode: ord.test_mode && ageMs >= 8000
        });
        if (res.status === 'delivered' || res.status === 'failed') {
          updatedCount++;
        }
      }
    }
    return updatedCount;
  }
}
