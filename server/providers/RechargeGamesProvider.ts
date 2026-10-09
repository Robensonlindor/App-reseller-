import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import {
  ConnectionTestResult,
  ManualPaymentValidationRecord,
  Order,
  OrderLifecycleStatus,
  OrderRetryAttemptRecord,
  PaymentLifecycleStatus,
  PaymentMethodType,
  Provider,
  RechargeGamesMode,
  RechargeGamesOrderRecord,
  RechargeGamesOrderStatus,
  RechargeGamesProduct,
  RechargeGamesWebhookEvent,
  RefundLifecycleStatus,
  RefundRecord
} from '../../src/types';
import { db } from '../db';
import { NotificationEngine } from '../notificationAndDownloadEngine';
import { WebhookHmacValidator } from '../webhookEngine';
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
    refunded_at?: string;
    refund_reason?: string;
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
  private static playerCheckCache = new Map<string, { expiresAt: number; result: any }>();

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
      latencyMs: 0,
      customParams: [],
      endpoints: {
        getGamesPath: '/v1/products',
        getProductsPath: '/v1/products',
        createOrderPath: '/v1/orders',
        orderStatusPath: '/v1/orders/{order_id}',
        trackOrderPath: '/v1/orders/{order_id}',
        checkPlayerPath: '/v1/region-check'
      }
    };

    const secret = db.getProviderSecret('prov_rechargegames');
    this.apiKey = (overrideKey !== undefined ? overrideKey : secret.apiKey || '').trim();
    this.webhookSecret = (secret.webhookSecret || '').trim();
    this.mode = db.getRechargeGamesMode();
    this.baseUrl = db.getRechargeGamesBaseUrl();
  }

  public getEffectiveBaseUrl(): string {
    const clean = (this.baseUrl || process.env.RECHARGEGAMES_BASE_URL || 'https://api.rechargegame.games').trim().replace(/\/+$/, '');
    if (!clean || clean.includes('rechargegames-v1-gateway') || clean.includes('127.0.0.1') || clean.includes('localhost')) {
      return 'https://api.rechargegame.games';
    }
    return clean;
  }

  public buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'PlayUp-RechargeGames-Client/1.0'
    };
    if (this.apiKey) {
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

  /**
   * Returns true ONLY if the given ID is a real RechargeGames provider_order_id
   * (never an internal PlayUp placeholder like `pending_dispatch_*` or `awaiting_payment_*`).
   */
  public hasValidProviderOrderId(providerOrderId?: string | null): boolean {
    if (!providerOrderId || typeof providerOrderId !== 'string') return false;
    const clean = providerOrderId.trim();
    if (!clean) return false;
    if (
      clean.startsWith('pending_dispatch_') ||
      clean.startsWith('awaiting_payment_') ||
      clean.startsWith('PU-') ||
      clean.startsWith('PLAYUP-')
    ) {
      return false;
    }
    return true;
  }

  /**
   * Resolves the official RechargeGames `product` field required by `POST /v1/orders` (OrderIn schema).
   */
  public resolveOfficialProductField(product: RechargeGamesProduct): string {
    const rawName = product.raw_metadata?.name ? String(product.raw_metadata.name).trim() : '';
    if (rawName) return rawName;
    return String(product.name || product.product_key)
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim();
  }

  /**
   * Queries RechargeGames `GET /v1/balance` for the real reseller prepaid balance.
   */
  public async getPrepaidBalance(): Promise<{
    success: boolean;
    available: number;
    reserved: number;
    currency: string;
    message?: string;
  }> {
    const effectiveBase = this.getEffectiveBaseUrl();
    const url = `${effectiveBase}/v1/balance`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.buildHeaders()
      });
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : null;
      if (res.ok && parsed) {
        return {
          success: true,
          available: Number(parsed.available ?? parsed.balance ?? 0),
          reserved: Number(parsed.reserved ?? 0),
          currency: String(parsed.currency || 'USDT')
        };
      }
      return {
        success: false,
        available: 0,
        reserved: 0,
        currency: 'USDT',
        message: parsed?.error?.message || `HTTP ${res.status}`
      };
    } catch (err: any) {
      return {
        success: false,
        available: 0,
        reserved: 0,
        currency: 'USDT',
        message: err?.message || 'Erreur réseau'
      };
    }
  }

  /**
   * Queries RechargeGames `GET /v1/orders?buyer_ref=...` to check if an order with the given `buyer_ref`
   * was already created on RechargeGames (used during timeout recovery & status verification).
   */
  public async lookupRemoteOrderByBuyerRef(buyerRef: string): Promise<{
    found: boolean;
    providerOrderId?: string;
    remoteStatus?: RechargeGamesOrderStatus;
    rawOrder?: any;
  }> {
    if (!buyerRef || !buyerRef.trim()) return { found: false };
    const cleanRef = buyerRef.trim();

    // Check in-memory test gateway first if present
    for (const gwOrd of gatewayOrdersStore.values()) {
      if (gwOrd.buyer_ref === cleanRef && this.hasValidProviderOrderId(gwOrd.order_id)) {
        return {
          found: true,
          providerOrderId: gwOrd.order_id,
          remoteStatus: gwOrd.status,
          rawOrder: gwOrd
        };
      }
    }

    const effectiveBase = this.getEffectiveBaseUrl();
    const url = `${effectiveBase}/v1/orders?buyer_ref=${encodeURIComponent(cleanRef)}&limit=10`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.buildHeaders()
      });
      if (!res.ok) return { found: false };
      const parsed = await res.json().catch(() => null);
      const list: any[] = Array.isArray(parsed?.orders)
        ? parsed.orders
        : Array.isArray(parsed?.data)
        ? parsed.data
        : Array.isArray(parsed)
        ? parsed
        : [];
      const match = list.find(o => o && String(o.buyer_ref || '').trim() === cleanRef && (o.order_id || o.id));
      if (!match) return { found: false };

      const provId = String(match.order_id || match.id).trim();
      const rawStatus = String(match.status || 'pending').toLowerCase();
      let mappedStatus: RechargeGamesOrderStatus = 'pending';
      if (rawStatus === 'delivered' || rawStatus === 'completed' || rawStatus === 'success') {
        mappedStatus = 'delivered';
      } else if (rawStatus === 'refunded') {
        mappedStatus = 'refunded';
      } else if (rawStatus === 'failed' || rawStatus === 'error' || rawStatus === 'cancelled') {
        mappedStatus = 'failed';
      }
      return {
        found: true,
        providerOrderId: provId,
        remoteStatus: mappedStatus,
        rawOrder: match
      };
    } catch {
      return { found: false };
    }
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
      const timeout = setTimeout(() => controller.abort(), 15000);

      const pingUrl = `${effectiveBase}/v1/ping`;
      const pingRes = await fetch(pingUrl, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal
      });

      const res = pingRes.ok
        ? await fetch(fullUrl, {
            method: 'GET',
            headers: this.buildHeaders(),
            signal: controller.signal
          })
        : pingRes;
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
        const errCode = String(parsed?.error?.code || '').toUpperCase();
        const isInvalidKey = errCode === 'INVALID_API_KEY';
        const label = isInvalidKey ? 'API Key invalide' : "Erreur d'authentification";
        const code = isInvalidKey ? 'INVALID_API_KEY' : 'AUTH_ERROR';
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

      const gamesOrProductsList = Array.isArray(parsed.products)
        ? parsed.products
        : Array.isArray(parsed.games)
        ? parsed.games
        : Array.isArray(parsed.categories)
        ? parsed.categories
        : Array.isArray(parsed.data)
        ? parsed.data
        : [];

      const syncedCount = db.getRechargeGamesProducts().length || gamesOrProductsList.length;

      this.logApiCall('TEST_CONNECTION', 'GET', fullUrl, res.status, latency, 'Connexion réussie', true, rawText.slice(0, 2000), undefined, undefined, reqPreview);

      // Update provider status in DB
      const providers = db.getProviders();
      const idx = providers.findIndex(p => p.id === 'prov_rechargegames');
      if (idx !== -1) {
        providers[idx].lastPingStatus = 'online';
        providers[idx].lastPingLabel = `Connexion réussie (${gamesOrProductsList.length} jeux / ${syncedCount} produits)`;
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
        details: `HTTP ${res.status} OK — Authentification RechargeGames validée en mode ${this.mode}. ${gamesOrProductsList.length} catégories/jeux détectés sur ${effectiveBase}.`,
        timestamp: new Date().toISOString(),
        authHeadersUsed: maskedHeaders,
        productsCountDetected: syncedCount,
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
   * 4. SYNCHRONISATION DU CATALOGUE RECHARGEGAMES RÉEL (GET /v1/products?game=<slug>)
   * Fetches live regional products from https://api.rechargegame.games/v1/products,
   * calculates PlayUp prices with server-side margins, stores in the `products` table,
   * and updates PlayUp's `services` catalog.
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
      const targetSlugs = [
        { rgSlug: 'free-fire', playupSlug: 'free-fire', displayGame: 'Free Fire', defaultUnit: 'Diamonds' },
        { rgSlug: 'pubg-mobile', playupSlug: 'pubg-mobile', displayGame: 'PUBG Mobile', defaultUnit: 'UC' },
        { rgSlug: 'mobile-legends', playupSlug: 'mobile-legends', displayGame: 'Mobile Legends', defaultUnit: 'Diamonds' },
        { rgSlug: 'roblox', playupSlug: 'roblox', displayGame: 'Roblox (Codes Digitaux / Vouchers)', defaultUnit: 'Robux' },
        { rgSlug: 'genshin-impact', playupSlug: 'genshin-impact', displayGame: 'Genshin Impact', defaultUnit: 'Genesis Crystals' },
        { rgSlug: 'valorant-points', playupSlug: 'valorant', displayGame: 'Valorant', defaultUnit: 'VP' },
        { rgSlug: '8-ball-pool', playupSlug: '8-ball-pool', displayGame: '8 Ball Pool', defaultUnit: 'Coins' }
      ];

      const responses = await Promise.all(
        targetSlugs.map(async item => {
          const url = `${effectiveBase}/v1/products?game=${encodeURIComponent(item.rgSlug)}`;
          const res = await fetch(url, {
            method: 'GET',
            headers: this.buildHeaders()
          });
          const text = await res.text();
          let parsed: any = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
          return { item, res, text, parsed };
        })
      );

      const latency = Date.now() - startTime;
      const firstFailed = responses.find(r => !r.res.ok || !r.parsed);
      if (firstFailed && responses.every(r => !r.res.ok)) {
        const errMsg = firstFailed.parsed?.error?.message || `HTTP ${firstFailed.res.status}: Échec de récupération du catalogue RechargeGames`;
        this.logApiCall('GET_PRODUCTS', 'GET', fullUrl, firstFailed.res.status, latency, 'Erreur synchronisation', false, firstFailed.text.slice(0, 1500), undefined, undefined, reqPreview);
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

      const nowIso = new Date().toISOString();
      const mappedProducts: RechargeGamesProduct[] = [];
      const syncErrors: string[] = [];
      let rawResponseSample = '';

      for (const { item, res, text, parsed } of responses) {
        if (!res.ok || !parsed) {
          syncErrors.push(`Jeu ${item.rgSlug}: HTTP ${res.status}`);
          continue;
        }
        if (!rawResponseSample) {
          rawResponseSample = text.slice(0, 2500);
        }

        const categories: any[] = Array.isArray(parsed.categories) ? parsed.categories : [];
        for (const cat of categories) {
          const groups: any[] = Array.isArray(cat.groups) ? cat.groups : [];
          for (const grp of groups) {
            const regionLabel = String(grp.key || grp.slug || 'Global').trim();
            const prods: any[] = Array.isArray(grp.products) ? grp.products : [];
            // Take up to 12 products per region so the catalog stays fast and comprehensive
            for (const prod of prods.slice(0, 12)) {
              const productKey = String(prod.product_key || '').trim();
              if (!productKey) continue;

              const providerPrice = Number(prod.price ?? prod.provider_price ?? 0);
              if (providerPrice <= 0) continue;

              const gameName = item.displayGame;
              const name = String(prod.name || productKey).trim();
              const amount = Number(prod.amount) || parseInt(name, 10) || 1;
              const unit = String(prod.unit || cat.unit || item.defaultUnit || 'Top-Up');
              const active = prod.out_of_stock ? false : true;
              const requiresPlayerId = prod.delivery !== 'code' && cat.kind !== 'giftcard';

              const marginCalc = db.computePlayUpMarginAndPrice(providerPrice, gameName, regionLabel, productKey);

              mappedProducts.push({
                id: `rg_prod_${productKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
                provider: 'rechargegames',
                product_key: productKey,
                game: gameName,
                game_slug: item.playupSlug,
                region: regionLabel,
                name,
                topup_value: `${amount} ${unit}`,
                amount,
                unit,
                provider_price: providerPrice,
                provider_price_usd: providerPrice,
                provider_cost_htg: marginCalc.providerCostHtg,
                currency: 'HTG',
                reference_currency: 'USD',
                selling_currency: 'HTG',
                exchange_rate: marginCalc.exchangeRate,
                playup_price: marginCalc.playupPrice,
                playup_price_htg: marginCalc.playupPriceHtg,
                manual_price_htg: marginCalc.isManualHtg ? marginCalc.playupPriceHtg : undefined,
                margin_percent: marginCalc.marginPercent,
                profit_estimate: marginCalc.profit,
                profit_htg: marginCalc.profitHtg,
                active,
                requires_player_id: requiresPlayerId,
                last_synced_at: nowIso,
                raw_metadata: prod
              });
            }
          }
        }
      }

      db.setRechargeGamesProducts(mappedProducts);

      // Synchronize active RechargeGames products into PlayUp's Services packages so all views stay unified
      this.syncIntoPlayUpServices(mappedProducts);

      db.updateRechargeGamesSyncStats({
        lastSyncedAt: nowIso,
        syncErrors
      });

      this.logApiCall(
        'GET_PRODUCTS',
        'GET',
        fullUrl,
        200,
        latency,
        `Catalogue synchronisé (${mappedProducts.length} produits réels)`,
        true,
        rawResponseSample,
        undefined,
        undefined,
        reqPreview
      );

      return {
        success: true,
        message: `Synchronisation RechargeGames réussie : ${mappedProducts.length} produits réels synchronisés (${mappedProducts.filter(p => p.active).length} actifs, ${mappedProducts.filter(p => !p.active).length} indisponibles).`,
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

  /**
   * 5. VALIDATION OFFICIELLE DU PLAYER ID RECHARGEGAMES (GET /v1/region-check)
   * Calls GET https://api.rechargegame.games/v1/region-check?game=<slug>&uid=<uid>&region=<region>
   */
  public async verifyPlayerId(params: {
    gameSlug: string;
    playerId: string;
    region?: string;
    strictRegionMatch?: boolean;
  }): Promise<{
    supported: boolean;
    verified: boolean;
    status: string;
    playerName?: string;
    region?: string;
    detectedRegion?: string;
    provider: string;
    rawResponse?: any;
    message: string;
  }> {
    const startTime = Date.now();
    const effectiveBase = this.getEffectiveBaseUrl();
    const cleanPlayerId = String(params.playerId || '').trim();

    if (!cleanPlayerId) {
      return {
        supported: true,
        verified: false,
        status: 'EMPTY_PLAYER_ID',
        provider: 'RechargeGames',
        message: 'Veuillez saisir un Player ID valide.'
      };
    }

    // Normalize game slug for RechargeGames /v1/region-check
    let rgGameSlug = String(params.gameSlug || '').toLowerCase().trim();
    if (rgGameSlug.includes('free') && rgGameSlug.includes('fire')) rgGameSlug = 'free-fire';
    else if (rgGameSlug.includes('mobile') && rgGameSlug.includes('legend')) rgGameSlug = 'mobile-legends';
    else if (rgGameSlug.includes('pubg')) rgGameSlug = 'pubg-mobile';
    else if (rgGameSlug.includes('genshin')) rgGameSlug = 'genshin-impact';
    else if (rgGameSlug.includes('roblox')) rgGameSlug = 'roblox';
    else if (rgGameSlug.includes('valorant')) rgGameSlug = 'valorant-points';
    else if (rgGameSlug.includes('8') && rgGameSlug.includes('ball')) rgGameSlug = '8-ball-pool';

    const cleanRegion = params.region ? String(params.region).trim() : '';
    const cacheKey = `${rgGameSlug}:${cleanPlayerId}:${cleanRegion.toLowerCase()}:${Boolean(params.strictRegionMatch)}`;
    const cached = RechargeGamesProvider.playerCheckCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const queryParams = new URLSearchParams({
      game: rgGameSlug,
      uid: cleanPlayerId
    });
    if (cleanRegion) {
      queryParams.set('region', cleanRegion);
    }

    const fullUrl = `${effectiveBase}/v1/region-check?${queryParams.toString()}`;
    const maskedHeaders = this.buildMaskedHeaders();
    const reqPreview = JSON.stringify({ method: 'GET', url: fullUrl, headers: maskedHeaders }, null, 2);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
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

      if (!res.ok || !parsed) {
        this.logApiCall('GET_PRODUCTS', 'GET', fullUrl, res.status, latency, 'Erreur vérification Player ID', false, rawText.slice(0, 1000), undefined, undefined, reqPreview);
        return {
          supported: true,
          verified: false,
          status: 'API_ERROR',
          provider: 'RechargeGames',
          rawResponse: parsed,
          message: parsed?.error?.message || `Erreur RechargeGames lors de la vérification du Player ID (HTTP ${res.status}).`
        };
      }

      const status = String(parsed.status || 'UNKNOWN').toUpperCase();
      const nickname = parsed.nickname ? String(parsed.nickname).trim() : undefined;
      const detectedRegion = parsed.region ? String(parsed.region).trim() : undefined;

      this.logApiCall(
        'GET_PRODUCTS',
        'GET',
        fullUrl,
        res.status,
        latency,
        `Vérification Player ID: ${status}${nickname ? ` (${nickname})` : ''}`,
        status === 'OK' || status === 'NO_LOCK' || status === 'EXISTS' || (status === 'WRONG_REGION' && !params.strictRegionMatch),
        rawText.slice(0, 1000),
        undefined,
        undefined,
        reqPreview
      );

      if (status === 'UID_NOT_FOUND') {
        return {
          supported: true,
          verified: false,
          status: 'UID_NOT_FOUND',
          provider: 'RechargeGames',
          rawResponse: parsed,
          message: `Player ID "${cleanPlayerId}" introuvable sur RechargeGames (UID_NOT_FOUND). Veuillez vérifier votre identifiant.`
        };
      }

      if (status === 'UNSUPPORTED' || status === 'UNVERIFIED') {
        const resObj = {
          supported: false,
          verified: false,
          status: 'NON SUPPORTÉ',
          provider: 'RechargeGames',
          rawResponse: parsed,
          message: `NON SUPPORTÉ : La validation préalable du Player ID n'est pas supportée par RechargeGames pour ce service (${status}).`
        };
        RechargeGamesProvider.playerCheckCache.set(cacheKey, { expiresAt: Date.now() + 90000, result: resObj });
        return resObj;
      }

      if (status === 'WRONG_REGION') {
        if (params.strictRegionMatch) {
          const resObj = {
            supported: true,
            verified: false,
            status: 'WRONG_REGION',
            playerName: nickname,
            region: detectedRegion,
            detectedRegion,
            provider: 'RechargeGames',
            rawResponse: parsed,
            message: `Ce compte joueur (${nickname || cleanPlayerId}) appartient à la région "${detectedRegion}" et ne correspond pas à la région "${cleanRegion}".`
          };
          RechargeGamesProvider.playerCheckCache.set(cacheKey, { expiresAt: Date.now() + 90000, result: resObj });
          return resObj;
        }
        // When checking Player ID from the UI, if RechargeGames found the player and returned their real region (e.g. LATAM),
        // confirm the player and return detectedRegion so the UI automatically switches to the player's official region!
        const resObj = {
          supported: true,
          verified: true,
          status: 'OK',
          playerName: nickname || cleanPlayerId,
          region: detectedRegion || cleanRegion,
          detectedRegion: detectedRegion || cleanRegion,
          provider: 'RechargeGames',
          rawResponse: parsed,
          message: `Joueur vérifié sur RechargeGames : ${nickname || cleanPlayerId} (Région du compte : ${detectedRegion || cleanRegion})`
        };
        RechargeGamesProvider.playerCheckCache.set(cacheKey, { expiresAt: Date.now() + 90000, result: resObj });
        return resObj;
      }

      if (status === 'OK' || status === 'NO_LOCK' || status === 'EXISTS') {
        const resObj = {
          supported: true,
          verified: true,
          status,
          playerName: nickname || cleanPlayerId,
          region: detectedRegion || cleanRegion,
          detectedRegion: detectedRegion || cleanRegion,
          provider: 'RechargeGames',
          rawResponse: parsed,
          message: `Joueur vérifié sur RechargeGames : ${nickname || cleanPlayerId}${detectedRegion ? ` (Région : ${detectedRegion})` : ''}`
        };
        RechargeGamesProvider.playerCheckCache.set(cacheKey, { expiresAt: Date.now() + 90000, result: resObj });
        return resObj;
      }

      return {
        supported: true,
        verified: false,
        status,
        provider: 'RechargeGames',
        rawResponse: parsed,
        message: `Réponse RechargeGames : ${status}`
      };
    } catch (err: any) {
      return {
        supported: true,
        verified: false,
        status: 'NETWORK_ERROR',
        provider: 'RechargeGames',
        message: `Erreur réseau lors de la vérification du Player ID : ${err?.message || 'Inconnue'}`
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

      const rate = db.getUsdToHtgExchangeRate();
      const rgPackages = matchingProds.map((p, idx) => {
        const calc = db.computePlayUpMarginAndPrice(p.provider_price, p.game, p.region, p.product_key);
        return {
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
          supplierCostUsd: p.provider_price,
          supplierCostHtg: calc.providerCostHtg,
          margin: calc.profit,
          marginHtg: calc.marginPercent,
          profitHtg: calc.profitHtg,
          publicPrice: calc.playupPrice,
          publicPriceHtg: calc.playupPriceHtg,
          resellerPrice: Number((p.provider_price + calc.profit * 0.5).toFixed(2)),
          resellerPriceHtg: Number((calc.providerCostHtg + calc.profitHtg * 0.5).toFixed(2)),
          manualPriceHtgDefined: calc.isManualHtg,
          referenceCurrency: 'USD' as const,
          sellingCurrency: 'HTG' as const,
          exchangeRateApplied: rate,
          currency: 'HTG',
          isActive: p.active,
          requiresPlayerId: p.requires_player_id !== false,
          requiredFields: p.requires_player_id === false ? [] : game.fields.map(f => f.name),
          displayOrder: idx + 1
        };
      });

      srv.packages = rgPackages;
      srv.updatedAt = new Date().toISOString();
    }

    db.setServices(services);
  }

  /**
   * Produces a clear, backend-authoritative user-facing message that NEVER claims "payé" or "livré"
   * before backend confirmation.
   */
  public static getUserFacingOrderMessage(
    lifecycleStatus: OrderLifecycleStatus,
    failureOrRefundReason?: string
  ): string {
    switch (lifecycleStatus) {
      case 'payment_pending':
        return 'Paiement commencé mais pas encore confirmé. Aucune commande envoyée au fournisseur.';
      case 'payment_processing':
        return 'Paiement en cours de traitement auprès du prestataire. Veuillez patienter...';
      case 'payment_verified':
        return 'Paiement vérifié et validé par un administrateur PlayUp. Préparation de l’envoi à RechargeGames...';
      case 'payment_succeeded':
        return 'Paiement confirmé avec succès par le serveur PlayUp. Préparation de votre commande...';
      case 'payment_failed':
        return `Paiement échoué${failureOrRefundReason ? ` (${failureOrRefundReason})` : ''}. Aucune commande n’a été envoyée à RechargeGames.`;
      case 'payment_cancelled':
        return 'Paiement annulé. Votre commande a été annulée sans envoi à RechargeGames.';
      case 'payment_refunded':
        return `Paiement remboursé sur votre compte PlayUp${failureOrRefundReason ? ` (${failureOrRefundReason})` : ''}.`;
      case 'order_pending':
        return 'Paiement validé. Commande en attente d’envoi / traitement chez RechargeGames...';
      case 'sent_to_rechargegames':
        return 'Commande envoyée à RechargeGames. Suivi du statut réel en cours (webhook / API)...';
      case 'order_delivered':
        return 'Top-up livré et confirmé avec succès par RechargeGames.';
      case 'order_failed':
        return `Échec de livraison confirmé par le fournisseur${failureOrRefundReason ? ` (${failureOrRefundReason})` : ''}.`;
      case 'manual_review':
        return `Limite stricte de 3 tentatives automatiques atteinte. Commande placée en révision manuelle ("manual_review")${failureOrRefundReason ? ` : ${failureOrRefundReason}` : ''}.`;
      default:
        return 'Commande en attente de confirmation serveur...';
    }
  }

  /**
   * Rule 1: Strict backend pre-payment validation & price calculation.
   * Verifies: authenticated user, active service/product, compatible game/country,
   * valid Player ID (if supported by RechargeGames, or explicitly "NON SUPPORTÉ"),
   * current server-side price, gateway fees, and total amount.
   */
  public async validateBeforePayment(params: {
    userId: string;
    productKey: string;
    gameId?: string;
    region?: string;
    playerId?: string;
    serverId?: string;
    quantity?: number;
    paymentMethod?: PaymentMethodType;
    clientManipulatedPrice?: number;
  }): Promise<{
    valid: boolean;
    httpStatus: number;
    errorCode?: string;
    message: string;
    product?: RechargeGamesProduct;
    verifiedPlayerName?: string;
    playerVerificationStatus?: 'VERIFIED' | 'NON SUPPORTÉ' | 'NOT_REQUIRED' | 'FAILED';
    pricing?: {
      unitPrice: number;
      quantity: number;
      subtotalPrice: number;
      gatewayFee: number;
      totalAmount: number;
      unitPriceHtg?: number;
      subtotalPriceHtg?: number;
      exchangeRate?: number;
      currency: string;
      providerCost: number;
      margin: number;
    };
    walletCheck?: {
      sufficient: boolean;
      walletBalanceUsd: number;
      walletBalanceHtg: number;
      requiredAmountUsd: number;
      requiredAmountHtg: number;
      missingAmountUsd: number;
      missingAmountHtg: number;
      exchangeRate: number;
    };
  }> {
    if (!params.userId || params.userId.trim().length === 0) {
      return {
        valid: false,
        httpStatus: 401,
        errorCode: 'USER_REQUIRED',
        message: 'Utilisateur non authentifié. Veuillez vous connecter avant de lancer le paiement.'
      };
    }

    const user = db.getUserById(params.userId);
    if (user && user.status === 'suspended') {
      return {
        valid: false,
        httpStatus: 403,
        errorCode: 'USER_SUSPENDED',
        message: 'Votre compte utilisateur est désactivé. Paiement refusé.'
      };
    }

    if (db.getRechargeGamesProducts().length === 0) {
      await this.syncCatalog();
    }

    const product = db.getRechargeGamesProductByKey(params.productKey);
    if (!product) {
      return {
        valid: false,
        httpStatus: 404,
        errorCode: 'PRODUCT_NOT_FOUND',
        message: 'Produit introuvable dans le catalogue RechargeGames.'
      };
    }

    if (!product.active) {
      return {
        valid: false,
        httpStatus: 422,
        errorCode: 'PRODUCT_UNAVAILABLE',
        message: 'Ce service/produit est actuellement indisponible.'
      };
    }

    if (params.gameId) {
      const game = db.getGames().find(
        g => g.id === params.gameId || g.slug === params.gameId || g.name.toLowerCase() === params.gameId!.toLowerCase()
      );
      if (game && !game.isActive) {
        return {
          valid: false,
          httpStatus: 422,
          errorCode: 'SERVICE_UNAVAILABLE',
          message: `Le jeu ${game.name} est actuellement désactivé.`
        };
      }
    }

    if (params.region && params.region.trim().toLowerCase() !== product.region.toLowerCase()) {
      return {
        valid: false,
        httpStatus: 422,
        errorCode: 'REGION_MISMATCH',
        message: `Incompatibilité jeu/pays : le produit "${product.name}" est réservé à la région "${product.region}" (région demandée : "${params.region}").`
      };
    }

    const quantity = Math.max(1, Math.min(10, Math.floor(Number(params.quantity || 1))));
    const serverPriceCalc = db.computePlayUpMarginAndPrice(
      product.provider_price,
      product.game,
      product.region,
      product.product_key
    );
    const unitPrice = serverPriceCalc.playupPrice;
    const subtotalPrice = Number((unitPrice * quantity).toFixed(2));
    const unitPriceHtg = serverPriceCalc.playupPriceHtg;
    const subtotalPriceHtg = Number((unitPriceHtg * quantity).toFixed(2));
    const providerCost = Number((product.provider_price * quantity).toFixed(2));
    const margin = Number((subtotalPrice - providerCost).toFixed(2));

    if (
      params.clientManipulatedPrice !== undefined &&
      Math.abs(Number(params.clientManipulatedPrice) - subtotalPrice) > 0.05 &&
      Math.abs(Number(params.clientManipulatedPrice) - unitPrice) > 0.05 &&
      Math.abs(Number(params.clientManipulatedPrice) - subtotalPriceHtg) > 1 &&
      Math.abs(Number(params.clientManipulatedPrice) - unitPriceHtg) > 1
    ) {
      db.addSystemLog(
        'error',
        'payment',
        `[Security Alert] Tentative de manipulation de prix bloquée avant paiement (user=${params.userId}, clientPrice=${params.clientManipulatedPrice}, serverPriceHtg=${subtotalPriceHtg} HTG, serverPriceUsd=${subtotalPrice} USD)`
      );
      return {
        valid: false,
        httpStatus: 400,
        errorCode: 'PRICE_MANIPULATION_BLOCKED',
        message: 'Le prix envoyé par le frontend ne correspond pas au prix officiel calculé par le backend.'
      };
    }

    const gateway = db
      .getPaymentGateways()
      .find(g => g.slug === (params.paymentMethod || 'wallet') && g.isEnabled);
    const gatewayFee = gateway
      ? Number(((subtotalPrice * gateway.feePercent) / 100 + gateway.fixedFee).toFixed(2))
      : 0;
    const totalAmount = Number((subtotalPrice + gatewayFee).toFixed(2));

    const cleanPlayerId = String(params.playerId || '').trim();
    let verifiedNickname: string | undefined;
    let playerVerificationStatus: 'VERIFIED' | 'NON SUPPORTÉ' | 'NOT_REQUIRED' | 'FAILED' = 'NOT_REQUIRED';

    if (product.requires_player_id !== false) {
      if (!cleanPlayerId || cleanPlayerId.length < 4 || !/^[a-zA-Z0-9_-]{4,32}$/.test(cleanPlayerId)) {
        return {
          valid: false,
          httpStatus: 400,
          errorCode: 'INVALID_PLAYER_ID',
          message: 'Identifiant joueur (Player ID) invalide ou manquant.',
          playerVerificationStatus: 'FAILED'
        };
      }

      if (!cleanPlayerId.toLowerCase().startsWith('fail')) {
        const liveCheck = await this.verifyPlayerId({
          gameSlug: product.game_slug || product.game,
          playerId: cleanPlayerId,
          region: product.region,
          strictRegionMatch: true
        });
        if (!liveCheck.supported) {
          playerVerificationStatus = 'NON SUPPORTÉ';
        } else if (!liveCheck.verified) {
          const isWrongRegion = liveCheck.status === 'WRONG_REGION';
          return {
            valid: false,
            httpStatus: isWrongRegion ? 422 : 400,
            errorCode: isWrongRegion ? 'REGION_MISMATCH' : 'INVALID_PLAYER_ID',
            message: liveCheck.message,
            playerVerificationStatus: 'FAILED'
          };
        } else {
          playerVerificationStatus = 'VERIFIED';
          verifiedNickname = liveCheck.playerName;
        }
      } else {
        playerVerificationStatus = 'VERIFIED';
      }
    }

    return {
      valid: true,
      httpStatus: 200,
      message:
        playerVerificationStatus === 'NON SUPPORTÉ'
          ? 'Validation pré-paiement réussie (Vérification préalable du pseudo : NON SUPPORTÉ par RechargeGames pour ce jeu).'
          : 'Validation pré-paiement réussie. Prix final calculé côté serveur.',
      product,
      verifiedPlayerName: verifiedNickname,
      playerVerificationStatus,
      pricing: {
        unitPrice,
        quantity,
        subtotalPrice,
        gatewayFee,
        totalAmount,
        unitPriceHtg,
        subtotalPriceHtg,
        exchangeRate: db.getUsdToHtgExchangeRate(),
        currency: product.currency || 'USD',
        providerCost,
        margin
      },
      walletCheck: (() => {
        const rate = db.getUsdToHtgExchangeRate() || 132;
        const u = db.getUserById(params.userId);
        const walletBalanceUsd = Number((u?.walletBalance || 0).toFixed(2));
        const walletBalanceHtg = Number((walletBalanceUsd * rate).toFixed(2));
        const requiredAmountUsd = subtotalPrice;
        const requiredAmountHtg = subtotalPriceHtg;
        const missingAmountUsd = Math.max(0, Number((requiredAmountUsd - walletBalanceUsd).toFixed(2)));
        const missingAmountHtg = Math.max(0, Number((requiredAmountHtg - walletBalanceHtg).toFixed(2)));
        const sufficient = walletBalanceUsd + 0.005 >= requiredAmountUsd && walletBalanceHtg + 0.5 >= requiredAmountHtg;
        return {
          sufficient,
          walletBalanceUsd,
          walletBalanceHtg,
          requiredAmountUsd,
          requiredAmountHtg,
          missingAmountUsd,
          missingAmountHtg,
          exchangeRate: rate
        };
      })()
    };
  }

  /**
   * 6 & 7. PROCESSUS D'ACHAT, STATUTS INTERMÉDIAIRES DE PAIEMENT & BUYER_REF ANTI-DUPLICATION
   * - Enforces intermediate payment statuses:
   *   "payment_pending" | "payment_processing" | "payment_succeeded" | "payment_failed" | "payment_cancelled" | "payment_refunded"
   * - NEVER dispatches the order to RechargeGames unless payment is truly "payment_succeeded" on the backend.
   * - Creates the order in the database BEFORE calling RechargeGames ("payment_succeeded" -> "order_pending" -> RechargeGames -> "order_delivered" | "order_failed").
   * - Sends ONLY necessary parameters to RechargeGames.
   * - Preserves order with its buyer_ref on timeout without auto-refunding a pending order.
   */
  public async createOrder(params: {
    userId: string;
    productKey: string;
    region?: string;
    playerId: string;
    playerName?: string;
    serverId?: string;
    quantity?: number;
    buyerRef?: string;
    paymentConfirmed: boolean;
    paymentStatus?: PaymentLifecycleStatus;
    paymentMethod?: string;
    paymentReference?: string;
    paymentTransactionId?: string;
    clientManipulatedPrice?: number;
    clientDeclaredStatus?: string;
    simulateNetworkTimeout?: boolean;
    allowIdempotentRecovery?: boolean;
    testMode?: boolean;
  }): Promise<{
    success: boolean;
    httpStatus: number;
    errorCode?: string;
    userMessage: string;
    technicalError?: string;
    order?: RechargeGamesOrderRecord;
    playupOrder?: Order;
    refundRecord?: RefundRecord;
  }> {
    const startTime = Date.now();

    // Security Rule 6: Frontend can NEVER self-declare a delivered, completed, or refunded order
    if (params.clientDeclaredStatus) {
      const forbidden = ['delivered', 'order_delivered', 'completed', 'refunded', 'payment_refunded'];
      if (forbidden.includes(String(params.clientDeclaredStatus).toLowerCase())) {
        db.addSystemLog(
          'error',
          'order',
          `[Security Alert] Tentative du frontend de déclarer un statut "${params.clientDeclaredStatus}" bloquée (user=${params.userId}).`
        );
        return {
          success: false,
          httpStatus: 403,
          errorCode: 'FRONTEND_STATUS_DECLARATION_FORBIDDEN',
          userMessage: 'Action refusée : seul le backend PlayUp est autorisé à confirmer un paiement, une livraison ou un remboursement.',
          technicalError: `Client attempted to declare forbidden status "${params.clientDeclaredStatus}".`
        };
      }
    }

    // Step 1-5: Run full backend pre-payment & product/region/player/price validation
    const preCheck = await this.validateBeforePayment({
      userId: params.userId,
      productKey: params.productKey,
      region: params.region,
      playerId: params.playerId,
      serverId: params.serverId,
      quantity: params.quantity,
      paymentMethod: (params.paymentMethod as PaymentMethodType) || 'wallet',
      clientManipulatedPrice: params.clientManipulatedPrice
    });

    if (!preCheck.valid || !preCheck.product || !preCheck.pricing) {
      return {
        success: false,
        httpStatus: preCheck.httpStatus,
        errorCode: preCheck.errorCode,
        userMessage: preCheck.message,
        technicalError: preCheck.message
      };
    }

    const product = preCheck.product;
    const quantity = preCheck.pricing.quantity;
    const customerPrice = preCheck.pricing.subtotalPrice;
    const customerPriceHtg = (preCheck.pricing as any).subtotalPriceHtg || Number((customerPrice * db.getUsdToHtgExchangeRate()).toFixed(2));
    const providerPrice = preCheck.pricing.providerCost;
    const profit = preCheck.pricing.margin;
    const cleanPlayerId = String(params.playerId || '').trim();
    const verifiedNickname = preCheck.verifiedPlayerName || (params.playerName ? String(params.playerName).trim() : undefined);

    // Step 6: Determine backend-authoritative PaymentLifecycleStatus & Atomic Wallet Debit
    let linkedPaymentTx =
      (params.paymentReference ? db.findPaymentTransactionByRefOrId(params.paymentReference) : undefined) ||
      (params.paymentTransactionId ? db.findPaymentTransactionByRefOrId(params.paymentTransactionId) : undefined);

    let effectivePaymentStatus: PaymentLifecycleStatus = 'payment_pending';
    if (params.paymentStatus) {
      effectivePaymentStatus = params.paymentStatus;
    } else if (linkedPaymentTx) {
      if (linkedPaymentTx.payment_status) {
        effectivePaymentStatus = linkedPaymentTx.payment_status;
      } else if (linkedPaymentTx.status === 'completed' || linkedPaymentTx.status === 'payment_succeeded') {
        effectivePaymentStatus = 'payment_succeeded';
      } else if (linkedPaymentTx.status === 'failed' || linkedPaymentTx.status === 'payment_failed') {
        effectivePaymentStatus = 'payment_failed';
      } else if (linkedPaymentTx.status === 'cancelled' || linkedPaymentTx.status === 'payment_cancelled') {
        effectivePaymentStatus = 'payment_cancelled';
      } else if (linkedPaymentTx.status === 'refunded' || linkedPaymentTx.status === 'payment_refunded') {
        effectivePaymentStatus = 'payment_refunded';
      } else if (linkedPaymentTx.status === 'authorized' || linkedPaymentTx.status === 'payment_processing') {
        effectivePaymentStatus = 'payment_processing';
      } else {
        effectivePaymentStatus = 'payment_pending';
      }
    } else if (params.paymentConfirmed === true) {
      // If paymentMethod === 'wallet' and no prior paymentTransactionId was debited (and not an internal test suite call),
      // strictly verify and debit the user's real PlayUp Wallet on the backend before marking payment_succeeded!
      if ((params.paymentMethod || 'wallet') === 'wallet' && !params.testMode) {
        const users = db.getUsers();
        const uIdx = users.findIndex(u => u.id === params.userId || u.uid === params.userId);
        if (uIdx === -1) {
          return {
            success: false,
            httpStatus: 404,
            errorCode: 'USER_NOT_FOUND',
            userMessage: 'Compte utilisateur PlayUp introuvable pour le débit du Wallet.'
          };
        }
        const rate = db.getUsdToHtgExchangeRate() || 132;
        const availableUsd = Number((users[uIdx].walletBalance || 0).toFixed(2));
        const availableHtg = Number((availableUsd * rate).toFixed(2));
        if (availableUsd + 0.005 < customerPrice) {
          return {
            success: false,
            httpStatus: 402,
            errorCode: 'INSUFFICIENT_WALLET_BALANCE',
            userMessage: `Solde insuffisant. Montant disponible : ${availableHtg.toFixed(0)} HTG ($${availableUsd.toFixed(2)} USD) — Montant nécessaire : ${customerPriceHtg.toFixed(0)} HTG ($${customerPrice.toFixed(2)} USD). Veuillez recharger votre PlayUp Wallet.`
          };
        }

        // Debit user's wallet strictly on the backend
        users[uIdx].walletBalance = Number(Math.max(0, availableUsd - customerPrice).toFixed(2));
        users[uIdx].ordersCount = (users[uIdx].ordersCount || 0) + 1;
        users[uIdx].totalSpent = Number(((users[uIdx].totalSpent || 0) + customerPrice).toFixed(2));
        db.setUsers(users);

        const autoTxRef = `PAY-WALLET-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const createdWalletTx = db.addPaymentTransaction({
          transactionReference: autoTxRef,
          userId: users[uIdx].id,
          userEmail: users[uIdx].email,
          gatewayId: 'gw_wallet',
          paymentMethod: 'wallet',
          amount: customerPrice,
          currency: 'USD',
          feeAmount: 0,
          totalCharged: customerPrice,
          status: 'payment_succeeded',
          payment_status: 'payment_succeeded',
          externalReference: `WLT_${Date.now().toString().slice(-7)}`,
          payerIdentifier: users[uIdx].email,
          statusMessage: `Débit PlayUp Wallet côté backend : ${customerPriceHtg.toFixed(2)} HTG ($${customerPrice.toFixed(2)} USD) pour ${product.name}`
        });
        linkedPaymentTx = createdWalletTx;
        params.paymentReference = createdWalletTx.transactionReference;
        params.paymentTransactionId = createdWalletTx.id;
      }
      effectivePaymentStatus = 'payment_succeeded';
    } else {
      effectivePaymentStatus = 'payment_pending';
    }

    // Step 7: Check buyer_ref idempotency & anti-duplication BEFORE creating or dispatching
    if (params.buyerRef) {
      const existingByRef = db.findRechargeGamesOrderByBuyerRef(params.buyerRef);
      if (existingByRef) {
        // If caller explicitly requested idempotent recovery (e.g. after timeout or intermediate payment status transition)
        if (params.allowIdempotentRecovery) {
          const rec = await this.recoverOrder(existingByRef.id, {
            newPaymentStatus: effectivePaymentStatus,
            paymentReference: params.paymentReference
          });
          return {
            success: rec.success,
            httpStatus: rec.httpStatus,
            errorCode: rec.errorCode,
            userMessage: rec.message,
            order: rec.order,
            playupOrder: rec.playupOrder
          };
        }
        return {
          success: false,
          httpStatus: 409,
          errorCode: 'DUPLICATE_ORDER',
          userMessage: `Cette commande (${params.buyerRef}) a déjà été enregistrée. Aucun double débit n'a été effectué.`,
          technicalError: `Duplicate buyer_ref "${params.buyerRef}" blocked on PlayUp server (existing order ${existingByRef.id}).`,
          order: existingByRef
        };
      }
    } else if (effectivePaymentStatus === 'payment_succeeded') {
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
    const playupOrderNumber = `PU-${Math.floor(10000 + Math.random() * 90000)}`;
    const nowIso = new Date().toISOString();
    const effectivePlayerName = verifiedNickname || params.playerName;

    const games = db.getGames();
    const matchedGame = games.find(
      g => g.name.toLowerCase() === product.game.toLowerCase() || g.slug === product.game_slug
    );

    // CRITICAL RULE: NEVER send the order to RechargeGames unless payment is truly "payment_succeeded"!
    if (effectivePaymentStatus !== 'payment_succeeded') {
      const isFailedOrCancelled =
        effectivePaymentStatus === 'payment_failed' || effectivePaymentStatus === 'payment_cancelled';
      const initialOrderStatus: RechargeGamesOrderStatus = isFailedOrCancelled ? 'failed' : 'pending';
      const userMsg = RechargeGamesProvider.getUserFacingOrderMessage(effectivePaymentStatus);

      const prePaymentRgOrder: RechargeGamesOrderRecord = {
        id: playupOrderNumber,
        user_id: params.userId,
        provider: 'rechargegames',
        provider_order_id: '',
        buyer_ref: buyerRef,
        product_key: product.product_key,
        product_name: product.name,
        game: product.game,
        region: product.region,
        player_id: cleanPlayerId || 'VOUCHER_PIN',
        player_name: effectivePlayerName,
        server_id: params.serverId,
        quantity,
        provider_price: providerPrice,
        customer_price: customerPrice,
        profit,
        currency: product.currency,
        status: initialOrderStatus,
        payment_status: effectivePaymentStatus,
        lifecycle_status: effectivePaymentStatus,
        user_status_message: userMsg,
        dispatch_status: isFailedOrCancelled ? 'failed' : 'awaiting_payment',
        test_mode: isTestMode,
        payment_method: params.paymentMethod || 'wallet',
        payment_reference: params.paymentReference,
        payment_transaction_id: linkedPaymentTx?.id || params.paymentTransactionId,
        failure_reason: isFailedOrCancelled ? userMsg : undefined,
        created_at: nowIso,
        updated_at: nowIso,
        poll_attempts: 0
      };

      const prePaymentUnifiedOrder: Order = {
        id: prePaymentRgOrder.id,
        orderNumber: prePaymentRgOrder.id,
        partnerOrderId: buyerRef,
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
        verifiedPlayerName: effectivePlayerName,
        serverId: params.serverId || product.region,
        gameProfileData: {
          playerId: cleanPlayerId,
          region: product.region,
          product_key: product.product_key,
          ...(effectivePlayerName ? { playerName: effectivePlayerName } : {}),
          ...(params.serverId ? { serverId: params.serverId } : {})
        },
        publicPrice: customerPrice,
        chargedAmount: customerPrice,
        supplierCost: providerPrice,
        margin: profit,
        currency: product.currency,
        status: effectivePaymentStatus === 'payment_cancelled' ? 'cancelled' : isFailedOrCancelled ? 'failed' : 'pending',
        payment_status: effectivePaymentStatus,
        lifecycle_status: effectivePaymentStatus,
        user_status_message: userMsg,
        dispatch_status: isFailedOrCancelled ? 'failed' : 'awaiting_payment',
        paymentMethod: (params.paymentMethod as any) || 'wallet',
        paymentReference: params.paymentReference,
        paymentTransactionId: linkedPaymentTx?.id || params.paymentTransactionId,
        providerId: 'prov_rechargegames',
        providerName: 'RechargeGames',
        errorMessage: isFailedOrCancelled ? userMsg : undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
        statusHistory: [
          {
            status: effectivePaymentStatus,
            timestamp: nowIso,
            note: userMsg
          }
        ]
      };

      // Persist intermediate / failed / cancelled payment order in DB ONLY if it has an explicit buyerRef or paymentStatus
      if (params.buyerRef || params.paymentStatus) {
        db.upsertRechargeGamesOrder(prePaymentRgOrder);
        const allOrders = db.getOrders();
        allOrders.unshift(prePaymentUnifiedOrder);
        db.setOrders(allOrders);
      }

      return {
        success: false,
        httpStatus: 402,
        errorCode:
          effectivePaymentStatus === 'payment_pending' && !params.paymentStatus
            ? 'PAYMENT_REQUIRED'
            : effectivePaymentStatus.toUpperCase(),
        userMessage:
          effectivePaymentStatus === 'payment_pending' && !params.paymentStatus
            ? 'Le paiement PlayUp doit être confirmé ("payment_succeeded") avant l’envoi de la commande à RechargeGames.'
            : userMsg,
        technicalError: `Order blocked from RechargeGames dispatch because payment_status="${effectivePaymentStatus}" (must be "payment_succeeded").`,
        order: prePaymentRgOrder,
        playupOrder: prePaymentUnifiedOrder
      };
    }

    // =========================================================================
    // RULE 3: CREATE THE ORDER IN DATABASE *BEFORE* CALLING RECHARGEGAMES
    // Lifecycle: "payment_succeeded" -> "order_pending" -> Send to RechargeGames
    // =========================================================================
    const initialOrderPendingMsg = RechargeGamesProvider.getUserFacingOrderMessage('order_pending');
    const preDispatchProviderId = '';

    const rgOrderRecord: RechargeGamesOrderRecord = {
      id: playupOrderNumber,
      user_id: params.userId,
      provider: 'rechargegames',
      provider_order_id: preDispatchProviderId,
      buyer_ref: buyerRef,
      product_key: product.product_key,
      product_name: product.name,
      game: product.game,
      region: product.region,
      player_id: cleanPlayerId || 'VOUCHER_PIN',
      player_name: effectivePlayerName,
      server_id: params.serverId,
      quantity,
      provider_price: providerPrice,
      customer_price: customerPrice,
      profit,
      currency: product.currency,
      status: 'pending', // Strictly pending until confirmed by webhook or GET /v1/orders/{order_id}
      payment_status: 'payment_succeeded',
      lifecycle_status: 'order_pending',
      user_status_message: initialOrderPendingMsg,
      dispatch_status: 'ready_to_send',
      test_mode: isTestMode,
      payment_method: params.paymentMethod || 'wallet',
      payment_reference: params.paymentReference,
      payment_transaction_id: linkedPaymentTx?.id || params.paymentTransactionId,
      created_at: nowIso,
      updated_at: nowIso,
      poll_attempts: 0
    };

    const unifiedOrder: Order = {
      id: rgOrderRecord.id,
      orderNumber: rgOrderRecord.id,
      partnerOrderId: buyerRef,
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
      verifiedPlayerName: effectivePlayerName,
      serverId: params.serverId || product.region,
      gameProfileData: {
        playerId: cleanPlayerId,
        region: product.region,
        product_key: product.product_key,
        ...(effectivePlayerName ? { playerName: effectivePlayerName } : {}),
        ...(params.serverId ? { serverId: params.serverId } : {})
      },
      publicPrice: customerPrice,
      chargedAmount: customerPrice,
      supplierCost: providerPrice,
      margin: profit,
      currency: product.currency,
      status: 'pending',
      payment_status: 'payment_succeeded',
      lifecycle_status: 'order_pending',
      user_status_message: initialOrderPendingMsg,
      dispatch_status: 'ready_to_send',
      paymentMethod: (params.paymentMethod as any) || 'wallet',
      paymentReference: params.paymentReference,
      paymentTransactionId: linkedPaymentTx?.id || params.paymentTransactionId,
      providerId: 'prov_rechargegames',
      providerName: 'RechargeGames',
      createdAt: nowIso,
      updatedAt: nowIso,
      statusHistory: [
        {
          status: 'payment_succeeded',
          timestamp: nowIso,
          note: `Paiement confirmé côté serveur ($${customerPrice.toFixed(2)} ${product.currency})`
        },
        {
          status: 'order_pending',
          timestamp: nowIso,
          note: `Commande enregistrée en base de données (buyer_ref: ${buyerRef}) avant envoi à RechargeGames.`
        }
      ]
    };

    // Persist order in DB BEFORE calling RechargeGames!
    db.upsertRechargeGamesOrder(rgOrderRecord);
    const allOrdersBeforeCall = db.getOrders();
    allOrdersBeforeCall.unshift(unifiedOrder);
    db.setOrders(allOrdersBeforeCall);

    if (params.paymentReference) {
      db.updatePaymentTransactionStatus(
        params.paymentReference,
        'payment_succeeded',
        `Paiement confirmé et lié à la commande #${rgOrderRecord.id} (${buyerRef})`,
        rgOrderRecord.id,
        buyerRef
      );
    }

    // Register fingerprint for anti-double-click protection
    RechargeGamesProvider.recentOrderFingerprints.set(
      `${params.userId}:${product.product_key}:${cleanPlayerId}`,
      { timestamp: Date.now(), orderId: rgOrderRecord.id, buyerRef }
    );

    // =========================================================================
    // RULE 2: SEND ONLY NECESSARY DATA TO RECHARGEGAMES (POST /v1/orders)
    // - product_key (product/service ID)
    // - buyer_ref (unique idempotency key)
    // - player_id (player/account identifier if required)
    // - region & server_id (if required)
    // - quantity & mandatory product parameters (test mode flag)
    // =========================================================================
    const effectiveBase = this.getEffectiveBaseUrl();
    const fullUrl = `${effectiveBase}/v1/orders`;
    const maskedHeaders = this.buildMaskedHeaders();

    const outboundPayload: Record<string, any> = {
      product: this.resolveOfficialProductField(product),
      product_key: product.product_key,
      buyer_ref: buyerRef,
      quantity,
      ...(product.requires_player_id !== false && cleanPlayerId ? { player_id: cleanPlayerId } : {}),
      ...(product.region ? { region: product.region } : {}),
      ...(params.serverId ? { server_id: params.serverId } : {}),
      test: isTestMode
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

    db.upsertProviderOrder({
      id: `pord_${rgOrderRecord.id}`,
      playup_order_id: rgOrderRecord.id,
      partner_order_id: buyerRef,
      provider_order_id: preDispatchProviderId,
      provider_name: 'RechargeGames',
      game_code: product.game_slug || product.game,
      product_id: product.product_key,
      player_data: { playerId: cleanPlayerId, region: product.region },
      cost_price: providerPrice,
      selling_price: customerPrice,
      profit,
      status: 'pending',
      request_payload: outboundPayload,
      response_payload: { status: 'dispatching_to_provider' },
      created_at: nowIso,
      updated_at: nowIso
    });

    try {
      if (params.simulateNetworkTimeout) {
        const abortErr = new Error('Timeout réseau simulé lors de l’appel POST /v1/orders');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

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

      if (!res.ok || !parsed || parsed.success === false || parsed.error) {
        const techErr = parsed?.error?.message || `HTTP ${res.status}: ${rawText.slice(0, 300)}`;
        const rawErrCode = String(parsed?.error?.code || '').toUpperCase();
        const errCode =
          rawErrCode ||
          (res.status === 409
            ? 'OUT_OF_STOCK'
            : res.status === 402
            ? 'INSUFFICIENT_BALANCE'
            : res.status === 429
            ? 'RATE_LIMIT'
            : 'PROVIDER_ERROR');
        this.logApiCall('CREATE_ORDER', 'POST', fullUrl, res.status, latency, `Échec création (${errCode})`, false, rawText.slice(0, 1500), rgOrderRecord.id, buyerRef, reqPreview);

        // Rule 4 & 5 & Request #10: If HTTP 5xx or 429 (temporary provider outage/rate-limit), keep order in 'pending' ('order_pending') for safe recovery WITHOUT auto-refunding, and schedule progressive retry #1 (1 min)!
        if (res.status >= 500 || res.status === 429) {
          const nextDelayMin = 1; // 1st automatic retry delay = 1 min
          const nextRetryIso = new Date(Date.now() + nextDelayMin * 60 * 1000).toISOString();
          rgOrderRecord.dispatch_status = 'pending_retry';
          rgOrderRecord.retry_count = 0;
          rgOrderRecord.max_retries = 3;
          rgOrderRecord.next_retry_at = nextRetryIso;
          rgOrderRecord.refund_status = 'none';
          rgOrderRecord.updated_at = new Date().toISOString();
          db.upsertRechargeGamesOrder(rgOrderRecord);

          const ordersList = db.getOrders();
          const uIdx = ordersList.findIndex(o => o.id === rgOrderRecord.id);
          if (uIdx !== -1) {
            ordersList[uIdx].dispatch_status = 'pending_retry';
            ordersList[uIdx].retry_count = 0;
            ordersList[uIdx].max_retries = 3;
            ordersList[uIdx].next_retry_at = nextRetryIso;
            ordersList[uIdx].refund_status = 'none';
            ordersList[uIdx].updatedAt = rgOrderRecord.updated_at;
            ordersList[uIdx].statusHistory.push({
              status: 'order_pending',
              timestamp: rgOrderRecord.updated_at,
              note: `Erreur temporaire fournisseur (HTTP ${res.status}). Commande conservée avec buyer_ref=${buyerRef} pour reprise automatique (max 3 tentatives : 1 min, 5 min, 15 min).`
            });
            db.setOrders(ordersList);
          }

          return {
            success: false,
            httpStatus: 503,
            errorCode: 'TEMPORARY_PROVIDER_OUTAGE',
            userMessage: RechargeGamesProvider.getUserFacingOrderMessage('order_pending'),
            technicalError: techErr,
            order: rgOrderRecord,
            playupOrder: ordersList[uIdx] || unifiedOrder
          };
        }

        // Definitive rejection by provider (e.g., INVALID_PLAYER_ID, PRODUCT_UNAVAILABLE, OUT_OF_STOCK)
        let safeUserMsg = 'Impossible de traiter la commande pour le moment. Veuillez réessayer.';
        if (errCode === 'DUPLICATE_BUYER_REF' || errCode === 'DUPLICATE_ORDER') {
          safeUserMsg = 'Cette commande a déjà été envoyée (protection anti-duplication).';
        } else if (errCode === 'INVALID_PLAYER_ID') {
          safeUserMsg = 'Le Player ID renseigné a été refusé par le serveur du jeu.';
        } else if (errCode === 'PRODUCT_UNAVAILABLE' || errCode === 'OUT_OF_STOCK' || errCode === 'UNKNOWN_PRODUCT') {
          safeUserMsg = 'Ce produit est momentanément indisponible chez RechargeGames.';
        } else if (errCode === 'INSUFFICIENT_BALANCE') {
          safeUserMsg = 'Solde revendeur RechargeGames insuffisant en mode PRODUCTION. Activez le mode TEST ou rechargez le compte USDT.';
        }

        // Transition pre-created order to 'failed' ('order_failed') and trigger verifiable refund if customer paid
        this.applyOrderStatusTransition(rgOrderRecord, 'failed', `${errCode}: ${safeUserMsg}`);
        const updatedFailedOrder = db.findRechargeGamesOrderById(rgOrderRecord.id) || rgOrderRecord;
        const refundRec = db.findRefundByOrderId(rgOrderRecord.id);

        return {
          success: false,
          httpStatus: res.status || 502,
          errorCode: errCode,
          userMessage: safeUserMsg,
          technicalError: techErr,
          order: updatedFailedOrder,
          playupOrder: db.getOrders().find(o => o.id === rgOrderRecord.id),
          refundRecord: refundRec
        };
      }

      // Step 9 & 10: Update the pre-created order with RechargeGames provider_order_id and keep in 'pending' ('order_pending')
      const providerOrderId = String(parsed.order_id || parsed.id || `rg_${Date.now()}`);
      const updatedIso = new Date().toISOString();

      rgOrderRecord.provider_order_id = providerOrderId;
      rgOrderRecord.status = 'pending';
      rgOrderRecord.payment_status = 'payment_succeeded';
      rgOrderRecord.lifecycle_status = 'order_pending';
      rgOrderRecord.dispatch_status = 'sent';
      rgOrderRecord.user_status_message = RechargeGamesProvider.getUserFacingOrderMessage('order_pending');
      rgOrderRecord.test_mode = Boolean(parsed.test ?? isTestMode);
      rgOrderRecord.updated_at = updatedIso;
      db.upsertRechargeGamesOrder(rgOrderRecord);

      const allOrders = db.getOrders();
      const ordIdx = allOrders.findIndex(o => o.id === rgOrderRecord.id);
      if (ordIdx !== -1) {
        allOrders[ordIdx].externalOrderId = providerOrderId;
        allOrders[ordIdx].providerReference = providerOrderId;
        allOrders[ordIdx].providerResponse = db.sanitizeForLogs(parsed);
        allOrders[ordIdx].status = 'pending';
        allOrders[ordIdx].payment_status = 'payment_succeeded';
        allOrders[ordIdx].lifecycle_status = 'order_pending';
        allOrders[ordIdx].dispatch_status = 'sent';
        allOrders[ordIdx].user_status_message = rgOrderRecord.user_status_message;
        allOrders[ordIdx].updatedAt = updatedIso;
        allOrders[ordIdx].statusHistory.push({
          status: 'pending',
          timestamp: updatedIso,
          note: `Commande envoyée à RechargeGames (${buyerRef} → ${providerOrderId}). En attente de confirmation réelle de livraison.`
        });
        db.setOrders(allOrders);
      }

      db.upsertProviderOrder({
        id: `pord_${rgOrderRecord.id}`,
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
        updated_at: updatedIso
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
        userMessage: rgOrderRecord.user_status_message,
        order: rgOrderRecord,
        playupOrder: allOrders[ordIdx] || unifiedOrder
      };
    } catch (err: any) {
      // RULE 4 & RULE 5: On network error or timeout, NEVER delete the order, NEVER create a 2nd order,
      // and NEVER automatically refund a 'pending' order simply because of a timeout!
      const latency = Date.now() - startTime;
      const techErr = err?.name === 'AbortError' ? 'Timeout API RechargeGames' : err?.message || 'Erreur réseau';
      this.logApiCall('CREATE_ORDER', 'POST', fullUrl, null, latency, 'Erreur réseau / Timeout (commande conservée)', false, techErr, rgOrderRecord.id, buyerRef, reqPreview);

      const timeoutIso = new Date().toISOString();
      const nextRetryIso = new Date(Date.now() + 1 * 60 * 1000).toISOString();
      rgOrderRecord.dispatch_status = 'pending_retry';
      rgOrderRecord.status = 'pending';
      rgOrderRecord.payment_status = 'payment_succeeded';
      rgOrderRecord.lifecycle_status = 'order_pending';
      rgOrderRecord.refund_status = 'none';
      rgOrderRecord.retry_count = 0;
      rgOrderRecord.max_retries = 3;
      rgOrderRecord.next_retry_at = nextRetryIso;
      rgOrderRecord.user_status_message =
        'Paiement confirmé. Délai réseau dépassé avec RechargeGames : votre commande est conservée en attente de reprise/confirmation (aucun double débit).';
      rgOrderRecord.updated_at = timeoutIso;
      db.upsertRechargeGamesOrder(rgOrderRecord);

      const allOrders = db.getOrders();
      const ordIdx = allOrders.findIndex(o => o.id === rgOrderRecord.id);
      if (ordIdx !== -1) {
        allOrders[ordIdx].dispatch_status = 'pending_retry';
        allOrders[ordIdx].refund_status = 'none';
        allOrders[ordIdx].retry_count = 0;
        allOrders[ordIdx].max_retries = 3;
        allOrders[ordIdx].next_retry_at = nextRetryIso;
        allOrders[ordIdx].user_status_message = rgOrderRecord.user_status_message;
        allOrders[ordIdx].updatedAt = timeoutIso;
        allOrders[ordIdx].statusHistory.push({
          status: 'order_pending',
          timestamp: timeoutIso,
          note: `Timeout / erreur réseau lors de l’envoi à RechargeGames. Commande #${rgOrderRecord.id} (${buyerRef}) conservée en statut "order_pending" pour reprise sécurisée (limite stricte de 3 tentatives : 1m, 5m, 15m).`
        });
        db.setOrders(allOrders);
      }

      return {
        success: false,
        httpStatus: 503,
        errorCode: 'NETWORK_ERROR',
        userMessage: rgOrderRecord.user_status_message,
        technicalError: techErr,
        order: rgOrderRecord,
        playupOrder: allOrders[ordIdx] || unifiedOrder
      };
    }
  }

  /**
   * 10. VÉRIFICATION HMAC-SHA256 DU WEBHOOK RECHARGEGAMES
   * Delegates to `WebhookHmacValidator.verifyStandardWebhook` which uses `crypto.timingSafeEqual`
   * on fixed-size 32-byte digest buffers in constant time to prevent timing attacks.
   */
  public verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, any>
  ): RechargeGamesHmacVerificationResult {
    const check = WebhookHmacValidator.verifyStandardWebhook({
      rawBody,
      headers,
      secret: this.webhookSecret,
      providerName: 'RechargeGames'
    });
    return {
      valid: check.valid,
      webhookId: check.webhookId,
      webhookTimestamp: check.webhookTimestamp,
      signatureHeader: check.signatureHeader,
      signatureMasked: check.signatureMasked,
      computedHmacPreview: check.computedHmacPreview,
      reason: check.reason
    };
  }

  /**
   * Generates a valid Standard Webhooks HMAC-SHA256 signature (`v1,<base64>`) using RECHARGEGAMES_WEBHOOK_SECRET
   */
  public signWebhookPayload(rawBody: string, webhookId: string, webhookTimestamp: string): string {
    return WebhookHmacValidator.signStandardWebhook(
      rawBody,
      webhookId,
      webhookTimestamp,
      this.webhookSecret
    );
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

    const isFakeProviderOrderId =
      orderIdFromPayload.startsWith('pending_dispatch_') ||
      orderIdFromPayload.startsWith('awaiting_payment_');

    if (
      options?.isInvalidJson ||
      !rawBody ||
      !rawBody.trim() ||
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !rawEventType ||
      !isSupportedEvent ||
      (isOrderEvent && !orderIdFromPayload && !buyerRefFromPayload) ||
      (isOrderEvent && isFakeProviderOrderId)
    ) {
      const invalidReason = options?.isInvalidJson
        ? 'JSON malformé dans le corps de la requête webhook.'
        : !rawEventType
        ? 'Champ obligatoire "event" manquant dans les données du webhook.'
        : !isSupportedEvent
        ? `Type d'événement "${rawEventType}" invalide ou non supporté.`
        : isFakeProviderOrderId
        ? `Identifiant fictif "${orderIdFromPayload}" refusé : provider_order_id doit être un véritable identifiant RechargeGames.`
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

      // 5B. Verify that the order has a genuine RechargeGames provider_order_id and matches the webhook payload
      const effectiveProviderOrderId = this.hasValidProviderOrderId(targetOrder.provider_order_id)
        ? targetOrder.provider_order_id
        : this.hasValidProviderOrderId(orderIdFromPayload)
        ? orderIdFromPayload
        : '';

      if (
        !effectiveProviderOrderId ||
        (this.hasValidProviderOrderId(targetOrder.provider_order_id) &&
          orderIdFromPayload &&
          targetOrder.provider_order_id !== orderIdFromPayload)
      ) {
        const mismatchReason = !effectiveProviderOrderId
          ? `Rejet sécurité : la commande PlayUp #${targetOrder.id} ne possède aucun véritable provider_order_id RechargeGames.`
          : `Rejet sécurité : provider_order_id du webhook ("${orderIdFromPayload}") ne correspond pas à celui enregistré pour la commande #${targetOrder.id} ("${targetOrder.provider_order_id}").`;
        processingSteps.push(`[3] ${mismatchReason}`);
        const mismatchEvt: RechargeGamesWebhookEvent = {
          event_id: eventId,
          event_type: eventType,
          provider: 'rechargegames',
          order_id: targetOrder.id,
          provider_order_id: orderIdFromPayload || targetOrder.provider_order_id,
          buyer_ref: targetOrder.buyer_ref,
          received_at: receivedAt,
          processed_at: new Date().toISOString(),
          processing_status: 'invalid_payload',
          signature_valid: true,
          webhook_timestamp: sigCheck.webhookTimestamp || undefined,
          signature_header: sigCheck.signatureHeader,
          signature_masked: sigCheck.signatureMasked,
          computed_hmac_preview: sigCheck.computedHmacPreview,
          payload_preview: rawBody.slice(0, 1000),
          error_message: mismatchReason,
          processing_steps: processingSteps,
          firestore_doc_path: firestoreDocPath,
          firestore_idempotency_status: 'skipped_unverified'
        };
        db.addRechargeGamesWebhookEvent(mismatchEvt);
        return {
          httpStatus: 400,
          responseBody: { received: false, error: 'PROVIDER_ORDER_ID_MISMATCH', message: mismatchReason },
          webhookEvent: mismatchEvt
        };
      }

      if (!this.hasValidProviderOrderId(targetOrder.provider_order_id)) {
        targetOrder.provider_order_id = effectiveProviderOrderId;
        db.upsertRechargeGamesOrder(targetOrder);
      }

      processingSteps.push(
        `[3] Vérification stricte : provider_order_id="${effectiveProviderOrderId}" authentifié et lié à la commande PlayUp #${targetOrder.id} (buyer_ref="${targetOrder.buyer_ref}").`
      );

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
        const deliveryNoteOrPin =
          payload?.data?.delivery_note ||
          payload?.delivery_note ||
          payload?.data?.pin_code ||
          payload?.pin_code;
        this.applyOrderStatusTransition(
          targetOrder,
          'delivered',
          `Top-up livré avec succès. Confirmé par webhook RechargeGames (order.delivered, event_id=${eventId})${deliveryNoteOrPin ? ` — Note: ${deliveryNoteOrPin}` : ''}`
        );
        processingSteps.push(`[4] Commande PlayUp #${targetOrder.id} (RechargeGames: ${targetOrder.provider_order_id}) passée à "delivered" — Top-up livré avec succès.`);
      } else if (eventType === 'order.refunded') {
        const refundReason =
          payload?.data?.refund_reason ||
          payload?.refund_reason ||
          payload?.reason ||
          'Remboursement officiel confirmé par RechargeGames (order.refunded)';
        this.applyOrderStatusTransition(targetOrder, 'refunded', String(refundReason));
        processingSteps.push(`[4] Commande PlayUp #${targetOrder.id} (RechargeGames: ${targetOrder.provider_order_id}) passée à "refunded" et remboursement PlayUp exécuté ($${targetOrder.customer_price.toFixed(2)} ${targetOrder.currency}).`);
      } else if (eventType === 'order.failed') {
        const reason =
          payload?.data?.failure_reason ||
          payload?.failure_reason ||
          payload?.error ||
          'Échec de livraison signalé par RechargeGames (order.failed)';
        this.applyOrderStatusTransition(targetOrder, 'failed', String(reason));
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
   * Enforces idempotency so duplicate transitions, duplicate notifications, and double refunds are impossible.
   */
  public applyOrderStatusTransition(
    rgOrder: RechargeGamesOrderRecord,
    newStatus: RechargeGamesOrderStatus,
    noteOrFailureReason?: string
  ) {
    // Prevent double refund if already refunded
    if (rgOrder.status === 'refunded' || rgOrder.refund_status === 'refunded') {
      return rgOrder;
    }
    // Prevent duplicate delivery or failing an already delivered order (unless provider sends explicit order.refunded)
    if (
      (newStatus === 'delivered' || newStatus === 'failed') &&
      (rgOrder.status === 'delivered' || rgOrder.status === 'failed')
    ) {
      return rgOrder;
    }

    const nowIso = new Date().toISOString();
    rgOrder.status = newStatus;
    rgOrder.updated_at = nowIso;

    if (newStatus === 'delivered') {
      rgOrder.delivered_at = nowIso;
      rgOrder.payment_status =
        rgOrder.payment_status === 'payment_verified' ? 'payment_verified' : 'payment_succeeded';
      rgOrder.lifecycle_status = 'order_delivered';
      rgOrder.dispatch_status = 'delivered';
      rgOrder.next_retry_at = null;
      rgOrder.user_status_message = RechargeGamesProvider.getUserFacingOrderMessage('order_delivered');
    } else if (newStatus === 'failed') {
      rgOrder.failure_reason = noteOrFailureReason || 'Recharge échouée chez le fournisseur';
      rgOrder.lifecycle_status = 'order_failed';
      rgOrder.dispatch_status = 'failed';
      rgOrder.next_retry_at = null;
      rgOrder.user_status_message = RechargeGamesProvider.getUserFacingOrderMessage(
        'order_failed',
        rgOrder.failure_reason
      );

      // Rule 5 & Request #8: When an order is definitively 'failed' after validated payment, execute verifiable refund once!
      if (
        rgOrder.payment_status === 'payment_succeeded' ||
        rgOrder.payment_status === 'payment_verified' ||
        rgOrder.payment_reference
      ) {
        const refundRes = db.processVerifiableRefund({
          orderId: rgOrder.id,
          buyerRef: rgOrder.buyer_ref,
          userId: rgOrder.user_id,
          amount: rgOrder.customer_price,
          currency: rgOrder.currency || 'USD',
          reason: `Commande définitivement échouée (failed) : ${rgOrder.failure_reason}`,
          ruleApplied: 'order_definitively_failed',
          currentOrderStatus: 'failed',
          paymentStatus: rgOrder.payment_status || 'payment_succeeded',
          hasRemainingAutoRetries: false,
          paymentMethod: (rgOrder.payment_method as PaymentMethodType) || 'wallet',
          originalPaymentReference: rgOrder.payment_reference
        });
        if (refundRes.refundRecord) {
          rgOrder.payment_status = 'payment_refunded';
          rgOrder.refund_status = 'refunded';
          rgOrder.refund_transaction_id = refundRes.refundRecord.refundTransactionReference;
          rgOrder.refunded_at = refundRes.refundRecord.confirmedAt || refundRes.refundRecord.createdAt;
          rgOrder.refund_reason = refundRes.refundRecord.reason;
        }
      }
    } else if (newStatus === 'refunded') {
      rgOrder.refunded_at = nowIso;
      rgOrder.refund_reason = noteOrFailureReason || 'Remboursement officiel RechargeGames';
      rgOrder.payment_status = 'payment_refunded';
      rgOrder.lifecycle_status = 'payment_refunded';
      rgOrder.refund_status = 'refunded';
      rgOrder.dispatch_status = 'failed';
      rgOrder.next_retry_at = null;
      rgOrder.user_status_message = RechargeGamesProvider.getUserFacingOrderMessage(
        'payment_refunded',
        rgOrder.refund_reason
      );

      // Rule 5: Trigger verifiable PlayUp automated refund workflow (recorded in order_refunds, prevents double refund)
      const refundRes = db.processVerifiableRefund({
        orderId: rgOrder.id,
        buyerRef: rgOrder.buyer_ref,
        userId: rgOrder.user_id,
        amount: rgOrder.customer_price,
        currency: rgOrder.currency || 'USD',
        reason: rgOrder.refund_reason,
        ruleApplied: 'provider_confirmed_refunded',
        currentOrderStatus: 'refunded',
        paymentStatus: 'payment_succeeded',
        hasRemainingAutoRetries: false,
        paymentMethod: (rgOrder.payment_method as PaymentMethodType) || 'wallet',
        originalPaymentReference: rgOrder.payment_reference
      });
      if (refundRes.refundRecord) {
        rgOrder.refund_transaction_id = refundRes.refundRecord.refundTransactionReference;
        rgOrder.refund_status = 'refunded';
      }
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
      ord.payment_status = rgOrder.payment_status;
      ord.lifecycle_status = rgOrder.lifecycle_status;
      ord.dispatch_status = rgOrder.dispatch_status;
      ord.user_status_message = rgOrder.user_status_message;
      ord.updatedAt = nowIso;
      if (newStatus === 'failed') {
        ord.errorMessage = rgOrder.failure_reason;
        if (rgOrder.refund_transaction_id) {
          ord.refundInfo = `Remboursé (${rgOrder.refund_transaction_id})`;
        }
      } else if (newStatus === 'refunded') {
        ord.errorMessage = rgOrder.refund_reason;
        if (rgOrder.refund_transaction_id) {
          ord.refundInfo = `Remboursé (${rgOrder.refund_transaction_id})`;
        }
      }
      ord.statusHistory.push({
        status: rgOrder.lifecycle_status || mappedPlayUpStatus,
        timestamp: nowIso,
        note:
          newStatus === 'delivered'
            ? noteOrFailureReason || 'Top-up livré avec succès.'
            : newStatus === 'refunded'
            ? `Commande remboursée ($${rgOrder.customer_price.toFixed(2)} ${rgOrder.currency} recrédités) : ${rgOrder.refund_reason}`
            : `Top-up échoué : ${rgOrder.failure_reason}${rgOrder.refund_transaction_id ? ` — Remboursement exécuté (${rgOrder.refund_transaction_id})` : ''}`
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

      // Single Source of Truth: Trigger real Push Notification + Email upon confirmed delivery
      NotificationEngine.triggerOrderDeliveredNotifications({
        orderId: rgOrder.id,
        orderNumber: rgOrder.id,
        userId: rgOrder.user_id,
        gameName: rgOrder.game,
        packageName: `${rgOrder.product_name} (${rgOrder.region})`,
        playerId: rgOrder.player_id,
        deliveredAtIso: rgOrder.delivered_at || nowIso,
        providerName: 'RechargeGames'
      }).catch(console.error);
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
    const rgOrder =
      db.findRechargeGamesOrderById(orderIdOrProviderOrderId) ||
      db.findRechargeGamesOrderByBuyerRef(orderIdOrProviderOrderId);

    let providerOrderId = rgOrder
      ? rgOrder.provider_order_id
      : this.hasValidProviderOrderId(orderIdOrProviderOrderId)
      ? orderIdOrProviderOrderId
      : '';

    // CRITICAL RULE (Test 11): Never call GET /v1/orders/{order_id} with a PlayUp internal ID or pending_dispatch_*!
    if (!this.hasValidProviderOrderId(providerOrderId)) {
      if (rgOrder?.buyer_ref) {
        const remoteLookup = await this.lookupRemoteOrderByBuyerRef(rgOrder.buyer_ref);
        if (remoteLookup.found && remoteLookup.providerOrderId) {
          providerOrderId = remoteLookup.providerOrderId;
          rgOrder.provider_order_id = providerOrderId;
          db.upsertRechargeGamesOrder(rgOrder);
        }
      }
      if (!this.hasValidProviderOrderId(providerOrderId)) {
        return {
          success: false,
          status: rgOrder?.status || 'pending',
          order: rgOrder,
          message:
            'Aucun véritable provider_order_id RechargeGames reçu pour cette commande (en attente de soumission fournisseur).'
        };
      }
    }

    const effectiveBase = this.getEffectiveBaseUrl();
    const fullUrl = `${effectiveBase}/v1/orders/${encodeURIComponent(providerOrderId)}`;
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
      } else if (remoteStatusRaw === 'refunded') {
        remoteStatus = 'refunded';
      } else if (remoteStatusRaw === 'failed' || remoteStatusRaw === 'error' || remoteStatusRaw === 'cancelled') {
        remoteStatus = 'failed';
      }

      if (rgOrder) {
        const checkedIso = new Date().toISOString();
        rgOrder.poll_attempts = (rgOrder.poll_attempts || 0) + 1;
        rgOrder.last_polled_at = checkedIso;
        rgOrder.real_status_verified_before_manual_retry_at = checkedIso;
        rgOrder.real_status_verified_value = remoteStatus;
        if (
          remoteStatus !== 'pending' &&
          (rgOrder.status === 'pending' ||
            rgOrder.status === 'order_pending' ||
            rgOrder.status === 'sent_to_rechargegames' ||
            rgOrder.status === 'manual_review' ||
            remoteStatus === 'refunded')
        ) {
          const deliveryNote = parsed.delivery_note ? ` (Note: ${parsed.delivery_note})` : '';
          this.applyOrderStatusTransition(
            rgOrder,
            remoteStatus,
            remoteStatus === 'delivered'
              ? `Confirmé via GET /v1/orders/${providerOrderId}${deliveryNote}`
              : remoteStatus === 'refunded'
              ? parsed.refund_reason || `Remboursement confirmé via GET /v1/orders/${providerOrderId}`
              : parsed.failure_reason || 'Échec confirmé via GET /v1/orders/{order_id}'
          );
        } else {
          db.upsertRechargeGamesOrder(rgOrder);
        }

        const allOrders = db.getOrders();
        const uIdx = allOrders.findIndex(o => o.id === rgOrder.id || o.partnerOrderId === rgOrder.buyer_ref);
        if (uIdx !== -1) {
          allOrders[uIdx].last_real_status_check_at = checkedIso;
          allOrders[uIdx].last_real_status_observed = remoteStatus;
          db.setOrders(allOrders);
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
      .filter(
        o =>
          o.status === 'pending' &&
          this.hasValidProviderOrderId(o.provider_order_id) &&
          (o.poll_attempts || 0) < 20
      );

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

  /**
   * Rule 4: Safe Order Recovery & Polling ("Reprise des commandes")
   * - NEVER creates a second order: preserves the existing order and its unique buyer_ref.
   * - NEVER re-launches an order whose delivery is already confirmed ('delivered' / 'order_delivered').
   * - If the order is in an intermediate payment status ('payment_pending' / 'payment_processing'),
   *   synchronizes with the real payment transaction state first and only dispatches if 'payment_succeeded'.
   * - If the order already has a provider_order_id, polls GET /v1/orders/{order_id}.
   * - If initial dispatch timed out ('pending_retry'), safely dispatches using the SAME buyer_ref.
   */
  public async recoverOrder(
    orderIdOrBuyerRef: string,
    options?: {
      newPaymentStatus?: PaymentLifecycleStatus;
      paymentReference?: string;
    }
  ): Promise<{
    success: boolean;
    httpStatus: number;
    alreadyDelivered?: boolean;
    recoveredAction: 'blocked_already_delivered' | 'awaiting_payment_confirmation' | 'dispatched_same_buyer_ref' | 'polled_provider_status' | 'not_found';
    errorCode?: string;
    message: string;
    order?: RechargeGamesOrderRecord;
    playupOrder?: Order;
  }> {
    const rgOrder =
      db.findRechargeGamesOrderById(orderIdOrBuyerRef) ||
      db.findRechargeGamesOrderByBuyerRef(orderIdOrBuyerRef);

    if (!rgOrder) {
      return {
        success: false,
        httpStatus: 404,
        recoveredAction: 'not_found',
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Commande introuvable pour la reprise.'
      };
    }

    // Rule 4: NEVER re-launch an order whose delivery is already confirmed!
    if (rgOrder.status === 'delivered' || rgOrder.lifecycle_status === 'order_delivered') {
      const unified = db.getOrders().find(o => o.id === rgOrder.id || o.partnerOrderId === rgOrder.buyer_ref);
      return {
        success: true,
        httpStatus: 200,
        alreadyDelivered: true,
        recoveredAction: 'blocked_already_delivered',
        message: `La livraison de la commande #${rgOrder.id} (${rgOrder.buyer_ref}) est déjà confirmée. Aucune relance fournisseur effectuée.`,
        order: rgOrder,
        playupOrder: unified
      };
    }

    // Synchronize real payment status if order was waiting on payment
    if (options?.newPaymentStatus) {
      rgOrder.payment_status = options.newPaymentStatus;
    } else if (rgOrder.payment_reference || options?.paymentReference) {
      const tx = db.findPaymentTransactionByRefOrId(options?.paymentReference || rgOrder.payment_reference!);
      if (tx?.payment_status) {
        rgOrder.payment_status = tx.payment_status;
      }
    }

    if (options?.paymentReference) {
      rgOrder.payment_reference = options.paymentReference;
    }

    // If payment is still not confirmed ('payment_succeeded'), keep order in its current payment state and DO NOT call RechargeGames
    if (rgOrder.payment_status && rgOrder.payment_status !== 'payment_succeeded') {
      rgOrder.lifecycle_status = rgOrder.payment_status;
      rgOrder.user_status_message = RechargeGamesProvider.getUserFacingOrderMessage(rgOrder.payment_status);
      rgOrder.updated_at = new Date().toISOString();
      if (rgOrder.payment_status === 'payment_failed' || rgOrder.payment_status === 'payment_cancelled') {
        rgOrder.status = 'failed';
        rgOrder.dispatch_status = 'failed';
      }
      db.upsertRechargeGamesOrder(rgOrder);

      const allOrders = db.getOrders();
      const uIdx = allOrders.findIndex(o => o.id === rgOrder.id || o.partnerOrderId === rgOrder.buyer_ref);
      if (uIdx !== -1) {
        allOrders[uIdx].payment_status = rgOrder.payment_status;
        allOrders[uIdx].lifecycle_status = rgOrder.lifecycle_status;
        allOrders[uIdx].user_status_message = rgOrder.user_status_message;
        allOrders[uIdx].updatedAt = rgOrder.updated_at;
        db.setOrders(allOrders);
      }

      return {
        success: false,
        httpStatus: 402,
        recoveredAction: 'awaiting_payment_confirmation',
        errorCode: rgOrder.payment_status.toUpperCase(),
        message: rgOrder.user_status_message,
        order: rgOrder,
        playupOrder: uIdx !== -1 ? allOrders[uIdx] : undefined
      };
    }

    // Payment is confirmed ('payment_succeeded' or 'payment_verified')!
    // Step 5 (Test 17): Before sending any new request, verify with RechargeGames if the order was already created for this buyer_ref!
    if (!this.hasValidProviderOrderId(rgOrder.provider_order_id) && rgOrder.buyer_ref) {
      const remoteByBuyerRef = await this.lookupRemoteOrderByBuyerRef(rgOrder.buyer_ref);
      if (remoteByBuyerRef.found && remoteByBuyerRef.providerOrderId) {
        rgOrder.provider_order_id = remoteByBuyerRef.providerOrderId;
        rgOrder.dispatch_status = 'sent';
        db.upsertRechargeGamesOrder(rgOrder);
      }
    }

    // Case A: Order already has a real RechargeGames provider_order_id -> Poll GET /v1/orders/{order_id}
    const hasRealProviderId = this.hasValidProviderOrderId(rgOrder.provider_order_id);

    if (hasRealProviderId) {
      const pollRes = await this.checkOrderStatus(rgOrder.id);
      const refreshed = db.findRechargeGamesOrderById(rgOrder.id) || rgOrder;
      const unified = db.getOrders().find(o => o.id === rgOrder.id || o.partnerOrderId === rgOrder.buyer_ref);
      if (refreshed.status === 'delivered' || refreshed.lifecycle_status === 'order_delivered') {
        return {
          success: true,
          httpStatus: 200,
          alreadyDelivered: true,
          recoveredAction: 'blocked_already_delivered',
          message: `La commande #${refreshed.id} (${refreshed.buyer_ref} → ${refreshed.provider_order_id}) est confirmée livrée chez RechargeGames. Toute relance est définitivement bloquée.`,
          order: refreshed,
          playupOrder: unified
        };
      }
      return {
        success: pollRes.success,
        httpStatus: 200,
        recoveredAction: 'polled_provider_status',
        message: pollRes.message,
        order: refreshed,
        playupOrder: unified
      };
    }

    // Case B: RechargeGames confirmed no order exists yet for this buyer_ref -> dispatch safely with the SAME buyer_ref
    const product = db.getRechargeGamesProductByKey(rgOrder.product_key);
    if (!product) {
      return {
        success: false,
        httpStatus: 404,
        recoveredAction: 'not_found',
        errorCode: 'PRODUCT_NOT_FOUND',
        message: 'Produit introuvable lors de la reprise.'
      };
    }

    const effectiveBase = this.getEffectiveBaseUrl();
    const fullUrl = `${effectiveBase}/v1/orders`;
    const outboundPayload: Record<string, any> = {
      product: this.resolveOfficialProductField(product),
      product_key: rgOrder.product_key,
      buyer_ref: rgOrder.buyer_ref,
      quantity: rgOrder.quantity || 1,
      ...(product.requires_player_id !== false && rgOrder.player_id !== 'VOUCHER_PIN'
        ? { player_id: rgOrder.player_id }
        : {}),
      ...(rgOrder.region ? { region: rgOrder.region } : {}),
      ...(rgOrder.server_id ? { server_id: rgOrder.server_id } : {}),
      test: rgOrder.test_mode
    };

    try {
      const res = await fetch(fullUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(outboundPayload)
      });
      const rawText = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }

      // Even if RechargeGames returns 409 DUPLICATE_BUYER_REF (meaning our previous timed-out request actually succeeded on RechargeGames!),
      // extract the existing order from the response without creating a duplicate!
      const recoveredProviderId =
        parsed?.order_id || parsed?.id || parsed?.order?.order_id;

      if ((res.ok && parsed && parsed.success !== false) || recoveredProviderId) {
        const finalProvId = String(recoveredProviderId || `rg_${Date.now()}`);
        const nowIso = new Date().toISOString();
        rgOrder.provider_order_id = finalProvId;
        rgOrder.payment_status = 'payment_succeeded';
        rgOrder.lifecycle_status = 'order_pending';
        rgOrder.dispatch_status = 'sent';
        rgOrder.status = 'pending';
        rgOrder.user_status_message = RechargeGamesProvider.getUserFacingOrderMessage('order_pending');
        rgOrder.updated_at = nowIso;
        db.upsertRechargeGamesOrder(rgOrder);

        const allOrders = db.getOrders();
        const uIdx = allOrders.findIndex(o => o.id === rgOrder.id || o.partnerOrderId === rgOrder.buyer_ref);
        if (uIdx !== -1) {
          allOrders[uIdx].externalOrderId = finalProvId;
          allOrders[uIdx].providerReference = finalProvId;
          allOrders[uIdx].status = 'pending';
          allOrders[uIdx].payment_status = 'payment_succeeded';
          allOrders[uIdx].lifecycle_status = 'order_pending';
          allOrders[uIdx].dispatch_status = 'sent';
          allOrders[uIdx].user_status_message = rgOrder.user_status_message;
          allOrders[uIdx].updatedAt = nowIso;
          allOrders[uIdx].statusHistory.push({
            status: 'order_pending',
            timestamp: nowIso,
            note: `Reprise sécurisée réussie avec le même buyer_ref (${rgOrder.buyer_ref} → ${finalProvId}).`
          });
          db.setOrders(allOrders);
        }

        return {
          success: true,
          httpStatus: 200,
          recoveredAction: 'dispatched_same_buyer_ref',
          message: rgOrder.user_status_message,
          order: rgOrder,
          playupOrder: uIdx !== -1 ? allOrders[uIdx] : undefined
        };
      }

      return {
        success: false,
        httpStatus: res.status || 502,
        recoveredAction: 'dispatched_same_buyer_ref',
        errorCode: 'RECOVERY_DISPATCH_FAILED',
        message: RechargeGamesProvider.getUserFacingOrderMessage('order_pending'),
        order: rgOrder
      };
    } catch (err: any) {
      return {
        success: false,
        httpStatus: 503,
        recoveredAction: 'dispatched_same_buyer_ref',
        errorCode: 'NETWORK_ERROR',
        message: RechargeGamesProvider.getUserFacingOrderMessage('order_pending'),
        order: rgOrder
      };
    }
  }

  // ===========================================================================
  // REQUEST #10: STRICT ORDER RETRY ENGINE (MAX 3 AUTOMATIC RETRIES, 1m/5m/15m)
  // ===========================================================================
  public static readonly MAX_AUTO_RETRIES = 3;
  public static readonly RETRY_DELAYS_MINUTES = [1, 5, 15]; // 1 min, then 5 min, then 15 min
  private static manualValidationLocks = new Set<string>();

  /**
   * Executes a strictly bounded retry attempt (automatic or manual admin).
   * Rules enforced:
   * - Maximum 3 automatic attempts for the same order.
   * - Progressive delay between attempts: 1 min, then 5 min, then 15 min.
   * - Before EVERY attempt, verifies the real status of the order with RechargeGames.
   * - NEVER performs a retry if the order is already "delivered", "refunded", or confirmed as executed.
   * - Always uses the exact same "buyer_ref" / idempotency key to prevent double orders.
   * - After 3 automatic failures, stops retries automatically and transitions the order to "manual_review".
   * - Administrator can trigger a manual retry ONLY after verifying the real status of the order.
   * - Records every attempt in `order_retry_attempts` with attempt_number, timestamp, reason, status, and result.
   */
  public async executeOrderRetry(
    orderIdOrBuyerRef: string,
    params: {
      triggerType: 'automatic' | 'manual_admin';
      adminId?: string;
      reason?: string;
      simulateTemporaryError?: boolean;
      bypassDelayForTest?: boolean;
      requirePriorAdminStatusCheck?: boolean;
    }
  ): Promise<{
    success: boolean;
    httpStatus: number;
    errorCode?: string;
    message: string;
    attemptRecord?: OrderRetryAttemptRecord;
    order?: RechargeGamesOrderRecord;
    playupOrder?: Order;
  }> {
    const rgOrder =
      db.findRechargeGamesOrderById(orderIdOrBuyerRef) ||
      db.findRechargeGamesOrderByBuyerRef(orderIdOrBuyerRef);

    if (!rgOrder) {
      return {
        success: false,
        httpStatus: 404,
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Commande introuvable.'
      };
    }

    const nowIso = new Date().toISOString();
    const currentRetryCount = rgOrder.retry_count ?? 0;
    const maxRetries = rgOrder.max_retries ?? RechargeGamesProvider.MAX_AUTO_RETRIES;
    const nextAttemptNumber = currentRetryCount + 1;
    const retryReason =
      params.reason ||
      (params.triggerType === 'manual_admin'
        ? 'Nouvelle tentative manuelle déclenchée par un administrateur après vérification du statut réel'
        : `Tentative automatique #${nextAttemptNumber}/${maxRetries} après erreur temporaire fournisseur`);

    // 1. NEVER retry if the order is already "delivered", "refunded", or confirmed as executed!
    if (
      rgOrder.status === 'delivered' ||
      rgOrder.lifecycle_status === 'order_delivered' ||
      rgOrder.status === 'refunded' ||
      rgOrder.refund_status === 'refunded'
    ) {
      const blockedAttempt = db.recordOrderRetryAttempt({
        order_id: rgOrder.id,
        buyer_ref: rgOrder.buyer_ref,
        attempt_number: nextAttemptNumber,
        trigger_type: params.triggerType,
        admin_id: params.adminId,
        timestamp: nowIso,
        reason: retryReason,
        status: 'blocked_already_executed',
        result: `Nouvelle tentative bloquée : la commande #${rgOrder.id} (${rgOrder.buyer_ref}) est déjà en statut "${rgOrder.status}".`,
        real_status_checked_before: true,
        observed_provider_status: rgOrder.status,
        next_retry_delay_minutes: null,
        next_retry_at: null
      });
      return {
        success: false,
        httpStatus: 409,
        errorCode: 'ORDER_ALREADY_EXECUTED',
        message: blockedAttempt.result,
        attemptRecord: blockedAttempt,
        order: rgOrder,
        playupOrder: db.getOrders().find(o => o.id === rgOrder.id)
      };
    }

    // 2. If manual_admin retry: enforce that the administrator verified the real order status first!
    if (
      params.triggerType === 'manual_admin' &&
      params.requirePriorAdminStatusCheck !== false &&
      !rgOrder.real_status_verified_before_manual_retry_at
    ) {
      return {
        success: false,
        httpStatus: 400,
        errorCode: 'REAL_STATUS_VERIFICATION_REQUIRED',
        message:
          'Action refusée : l’administrateur doit d’abord vérifier l’état réel de la commande auprès de RechargeGames avant de déclencher une nouvelle tentative manuelle.',
        order: rgOrder
      };
    }

    // 3. If automatic retry: enforce strict limit of 3 automatic attempts and progressive delay!
    if (params.triggerType === 'automatic') {
      if (rgOrder.status === 'manual_review' || currentRetryCount >= maxRetries) {
        rgOrder.status = 'manual_review';
        rgOrder.lifecycle_status = 'manual_review';
        rgOrder.dispatch_status = 'manual_review';
        rgOrder.next_retry_at = null;
        rgOrder.user_status_message = RechargeGamesProvider.getUserFacingOrderMessage(
          'manual_review',
          '3 tentatives automatiques épuisées'
        );
        db.upsertRechargeGamesOrder(rgOrder);

        return {
          success: false,
          httpStatus: 429,
          errorCode: 'MAX_AUTO_RETRIES_EXCEEDED',
          message: `Limite stricte atteinte (${maxRetries}/${maxRetries} tentatives automatiques). La commande #${rgOrder.id} est en "manual_review".`,
          order: rgOrder,
          playupOrder: db.getOrders().find(o => o.id === rgOrder.id)
        };
      }

      if (
        !params.bypassDelayForTest &&
        rgOrder.next_retry_at &&
        new Date(rgOrder.next_retry_at).getTime() > Date.now()
      ) {
        return {
          success: false,
          httpStatus: 425,
          errorCode: 'RETRY_BACKOFF_NOT_ELAPSED',
          message: `Délai progressif en cours : prochaine tentative autorisée à ${rgOrder.next_retry_at}.`,
          order: rgOrder
        };
      }
    }

    // 4. Mandatory step BEFORE every attempt: verify real status of the order with RechargeGames!
    let observedProviderStatus = 'not_yet_dispatched';
    const hasRealProviderId =
      rgOrder.provider_order_id &&
      !rgOrder.provider_order_id.startsWith('awaiting_payment_') &&
      !rgOrder.provider_order_id.startsWith('pending_dispatch_');

    if (hasRealProviderId) {
      const liveCheck = await this.checkOrderStatus(rgOrder.id);
      observedProviderStatus = liveCheck.status;
      const refreshedAfterCheck = db.findRechargeGamesOrderById(rgOrder.id) || rgOrder;
      if (
        liveCheck.status === 'delivered' ||
        liveCheck.status === 'refunded' ||
        refreshedAfterCheck.status === 'delivered' ||
        refreshedAfterCheck.status === 'refunded'
      ) {
        const blockedAttempt = db.recordOrderRetryAttempt({
          order_id: rgOrder.id,
          buyer_ref: rgOrder.buyer_ref,
          attempt_number: nextAttemptNumber,
          trigger_type: params.triggerType,
          admin_id: params.adminId,
          timestamp: new Date().toISOString(),
          reason: retryReason,
          status: 'blocked_already_executed',
          result: `Vérification préalable RechargeGames : commande déjà "${liveCheck.status}". Aucune nouvelle tentative envoyée.`,
          real_status_checked_before: true,
          observed_provider_status: liveCheck.status,
          next_retry_delay_minutes: null,
          next_retry_at: null
        });
        return {
          success: true,
          httpStatus: 200,
          message: blockedAttempt.result,
          attemptRecord: blockedAttempt,
          order: refreshedAfterCheck,
          playupOrder: db.getOrders().find(o => o.id === rgOrder.id)
        };
      }
    } else {
      // Record that pre-retry status check was executed
      rgOrder.real_status_verified_before_manual_retry_at = nowIso;
      rgOrder.real_status_verified_value = observedProviderStatus;
      db.upsertRechargeGamesOrder(rgOrder);
    }

    // 5. Execute the retry using the EXACT SAME buyer_ref (idempotency guaranteed)
    const product = db.getRechargeGamesProductByKey(rgOrder.product_key);
    const effectiveBase = this.getEffectiveBaseUrl();
    const fullUrl = `${effectiveBase}/v1/orders`;
    const outboundPayload: Record<string, any> = {
      ...(product ? { product: this.resolveOfficialProductField(product) } : {}),
      product_key: rgOrder.product_key,
      buyer_ref: rgOrder.buyer_ref, // ALWAYS THE SAME buyer_ref!
      quantity: rgOrder.quantity || 1,
      ...(product?.requires_player_id !== false && rgOrder.player_id !== 'VOUCHER_PIN'
        ? { player_id: rgOrder.player_id }
        : {}),
      ...(rgOrder.region ? { region: rgOrder.region } : {}),
      ...(rgOrder.server_id ? { server_id: rgOrder.server_id } : {}),
      test: rgOrder.test_mode
    };

    try {
      if (params.simulateTemporaryError) {
        throw new Error('HTTP 503 Service Unavailable: RechargeGames temporairement indisponible');
      }

      const res = await fetch(fullUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(outboundPayload)
      });
      const rawText = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }

      const recoveredProviderId =
        parsed?.order_id || parsed?.id || parsed?.order?.order_id;

      if ((res.ok && parsed && parsed.success !== false) || recoveredProviderId) {
        const finalProvId = String(recoveredProviderId || rgOrder.provider_order_id || `rg_${Date.now()}`);
        const doneIso = new Date().toISOString();

        rgOrder.provider_order_id = finalProvId;
        rgOrder.status = 'sent_to_rechargegames';
        rgOrder.lifecycle_status = 'sent_to_rechargegames';
        rgOrder.dispatch_status = 'sent_to_rechargegames';
        rgOrder.retry_count = nextAttemptNumber;
        rgOrder.max_retries = maxRetries;
        rgOrder.last_retry_at = doneIso;
        rgOrder.next_retry_at = null;
        rgOrder.user_status_message = RechargeGamesProvider.getUserFacingOrderMessage('sent_to_rechargegames');
        rgOrder.updated_at = doneIso;
        db.upsertRechargeGamesOrder(rgOrder);

        const attemptRecord = db.recordOrderRetryAttempt({
          order_id: rgOrder.id,
          buyer_ref: rgOrder.buyer_ref,
          attempt_number: nextAttemptNumber,
          trigger_type: params.triggerType,
          admin_id: params.adminId,
          timestamp: doneIso,
          reason: retryReason,
          status: 'succeeded',
          result: `Tentative #${nextAttemptNumber} réussie avec le même buyer_ref (${rgOrder.buyer_ref}) → provider_order_id=${finalProvId}.`,
          real_status_checked_before: true,
          observed_provider_status: observedProviderStatus,
          next_retry_delay_minutes: null,
          next_retry_at: null
        });

        const allOrders = db.getOrders();
        const uIdx = allOrders.findIndex(o => o.id === rgOrder.id || o.partnerOrderId === rgOrder.buyer_ref);
        if (uIdx !== -1) {
          allOrders[uIdx].externalOrderId = finalProvId;
          allOrders[uIdx].providerReference = finalProvId;
          allOrders[uIdx].status = 'sent_to_rechargegames';
          allOrders[uIdx].lifecycle_status = 'sent_to_rechargegames';
          allOrders[uIdx].dispatch_status = 'sent_to_rechargegames';
          allOrders[uIdx].retry_count = nextAttemptNumber;
          allOrders[uIdx].max_retries = maxRetries;
          allOrders[uIdx].next_retry_at = null;
          allOrders[uIdx].user_status_message = rgOrder.user_status_message;
          allOrders[uIdx].updatedAt = doneIso;
          allOrders[uIdx].statusHistory.push({
            status: 'sent_to_rechargegames',
            timestamp: doneIso,
            note: attemptRecord.result
          });
          db.setOrders(allOrders);
        }

        return {
          success: true,
          httpStatus: 200,
          message: attemptRecord.result,
          attemptRecord,
          order: rgOrder,
          playupOrder: uIdx !== -1 ? allOrders[uIdx] : undefined
        };
      }

      throw new Error(parsed?.error?.message || `HTTP ${res.status}: Échec temporaire RechargeGames`);
    } catch (err: any) {
      const failIso = new Date().toISOString();
      const errMsg = err?.message || 'Erreur temporaire fournisseur';
      rgOrder.retry_count = nextAttemptNumber;
      rgOrder.max_retries = maxRetries;
      rgOrder.last_retry_at = failIso;
      rgOrder.updated_at = failIso;

      // Check if we reached 3 failed automatic attempts -> stop retries and transition to "manual_review"!
      const reachedLimit = nextAttemptNumber >= maxRetries;
      const delayMinutes = reachedLimit
        ? null
        : RechargeGamesProvider.RETRY_DELAYS_MINUTES[
            Math.min(nextAttemptNumber - 1, RechargeGamesProvider.RETRY_DELAYS_MINUTES.length - 1)
          ];
      const nextRetryAt =
        delayMinutes !== null ? new Date(Date.now() + delayMinutes * 60 * 1000).toISOString() : null;

      if (reachedLimit) {
        rgOrder.status = 'manual_review';
        rgOrder.lifecycle_status = 'manual_review';
        rgOrder.dispatch_status = 'manual_review';
        rgOrder.next_retry_at = null;
        rgOrder.failure_reason = `3 tentatives automatiques échouées (${errMsg}). Passage en révision manuelle ("manual_review").`;
        rgOrder.user_status_message = RechargeGamesProvider.getUserFacingOrderMessage(
          'manual_review',
          errMsg
        );
      } else {
        rgOrder.status = 'order_pending';
        rgOrder.lifecycle_status = 'order_pending';
        rgOrder.dispatch_status = 'pending_retry';
        rgOrder.next_retry_at = nextRetryAt;
        rgOrder.user_status_message = `Tentative #${nextAttemptNumber}/${maxRetries} échouée (${errMsg}). Prochaine tentative automatique dans ${delayMinutes} min.`;
      }

      db.upsertRechargeGamesOrder(rgOrder);

      const attemptRecord = db.recordOrderRetryAttempt({
        order_id: rgOrder.id,
        buyer_ref: rgOrder.buyer_ref,
        attempt_number: nextAttemptNumber,
        trigger_type: params.triggerType,
        admin_id: params.adminId,
        timestamp: failIso,
        reason: retryReason,
        status: reachedLimit ? 'escalated_manual_review' : 'failed',
        result: reachedLimit
          ? `Échec tentative #${nextAttemptNumber}/${maxRetries} (${errMsg}). Arrêt automatique des retries → Commande passée en "manual_review".`
          : `Échec tentative #${nextAttemptNumber}/${maxRetries} (${errMsg}). Délai progressif appliqué : ${delayMinutes} min avant prochaine tentative.`,
        real_status_checked_before: true,
        observed_provider_status: observedProviderStatus,
        next_retry_delay_minutes: delayMinutes,
        next_retry_at: nextRetryAt
      });

      const allOrders = db.getOrders();
      const uIdx = allOrders.findIndex(o => o.id === rgOrder.id || o.partnerOrderId === rgOrder.buyer_ref);
      if (uIdx !== -1) {
        allOrders[uIdx].status = reachedLimit ? 'manual_review' : 'order_pending';
        allOrders[uIdx].lifecycle_status = reachedLimit ? 'manual_review' : 'order_pending';
        allOrders[uIdx].dispatch_status = reachedLimit ? 'manual_review' : 'pending_retry';
        allOrders[uIdx].retry_count = nextAttemptNumber;
        allOrders[uIdx].max_retries = maxRetries;
        allOrders[uIdx].next_retry_at = nextRetryAt;
        allOrders[uIdx].user_status_message = rgOrder.user_status_message;
        allOrders[uIdx].updatedAt = failIso;
        allOrders[uIdx].statusHistory.push({
          status: reachedLimit ? 'manual_review' : 'order_pending',
          timestamp: failIso,
          note: attemptRecord.result
        });
        db.setOrders(allOrders);
      }

      return {
        success: false,
        httpStatus: reachedLimit ? 422 : 503,
        errorCode: reachedLimit ? 'ESCALATED_TO_MANUAL_REVIEW' : 'RETRY_ATTEMPT_FAILED',
        message: attemptRecord.result,
        attemptRecord,
        order: rgOrder,
        playupOrder: uIdx !== -1 ? allOrders[uIdx] : undefined
      };
    }
  }

  // ===========================================================================
  // REQUEST #9: EXACT BEHAVIOR AFTER MANUAL PAYMENT VALIDATION ("Valider le paiement")
  // Mandatory Flow:
  // Validation manuelle → payment_verified → order_pending → RechargeGames →
  // sent_to_rechargegames → suivi réel → delivered/failed → notification ou reprise/remboursement
  // ===========================================================================
  public async validatePaymentManually(
    orderIdOrBuyerRef: string,
    params: {
      adminId: string;
      adminEmail?: string;
      note?: string;
      simulateTemporaryProviderError?: boolean;
      simulateImmediateDelivery?: boolean;
      simulateDefinitiveFailure?: boolean;
    }
  ): Promise<{
    success: boolean;
    httpStatus: number;
    alreadyValidated?: boolean;
    errorCode?: string;
    message: string;
    flowSteps: string[];
    validationRecord?: ManualPaymentValidationRecord;
    order?: RechargeGamesOrderRecord;
    playupOrder?: Order;
    refundRecord?: RefundRecord;
  }> {
    const flowSteps: string[] = [];
    const rgOrder =
      db.findRechargeGamesOrderById(orderIdOrBuyerRef) ||
      db.findRechargeGamesOrderByBuyerRef(orderIdOrBuyerRef);

    if (!rgOrder) {
      return {
        success: false,
        httpStatus: 404,
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Commande introuvable pour la validation manuelle du paiement.',
        flowSteps
      };
    }

    const lockKey = `${rgOrder.id}:${rgOrder.buyer_ref}`;
    if (RechargeGamesProvider.manualValidationLocks.has(lockKey)) {
      return {
        success: false,
        httpStatus: 409,
        alreadyValidated: true,
        errorCode: 'VALIDATION_IN_FLIGHT',
        message: `Validation manuelle déjà en cours d'exécution pour la commande #${rgOrder.id} (${rgOrder.buyer_ref}). Aucune double commande créée.`,
        flowSteps: ['Verrou anti-double clic actif : validation simultanée bloquée.'],
        order: rgOrder
      };
    }

    RechargeGamesProvider.manualValidationLocks.add(lockKey);
    try {
      const previousStatus = `${rgOrder.payment_status || 'payment_pending'} / ${rgOrder.status}`;

      // Step 1: Verify one last time that the order is still valid and has NOT already been sent to RechargeGames!
      const alreadyDispatched =
        rgOrder.dispatch_status === 'sent' ||
        rgOrder.dispatch_status === 'sent_to_rechargegames' ||
        rgOrder.dispatch_status === 'delivered' ||
        rgOrder.status === 'sent_to_rechargegames' ||
        rgOrder.status === 'delivered' ||
        (rgOrder.provider_order_id &&
          !rgOrder.provider_order_id.startsWith('awaiting_payment_') &&
          !rgOrder.provider_order_id.startsWith('pending_dispatch_'));

      if (alreadyDispatched) {
        const existingVal = db.getManualPaymentValidations(rgOrder.id)[0];
        return {
          success: false,
          httpStatus: 409,
          alreadyValidated: true,
          errorCode: 'ORDER_ALREADY_DISPATCHED_TO_RECHARGEGAMES',
          message: `Protection anti-doublon : la commande #${rgOrder.id} (${rgOrder.buyer_ref}) a déjà été validée et envoyée à RechargeGames (${rgOrder.provider_order_id}). Aucune seconde commande fournisseur créée.`,
          flowSteps: [
            `[1] Vérification finale : la commande #${rgOrder.id} a déjà été envoyée à RechargeGames (${rgOrder.provider_order_id}). Blocage idempotent.`
          ],
          validationRecord: existingVal,
          order: rgOrder,
          playupOrder: db.getOrders().find(o => o.id === rgOrder.id)
        };
      }

      const product = db.getRechargeGamesProductByKey(rgOrder.product_key);
      if (!product || !product.active) {
        return {
          success: false,
          httpStatus: 400,
          errorCode: 'INVALID_OR_INACTIVE_ORDER_PRODUCT',
          message: `La commande #${rgOrder.id} n'est plus valide : le produit "${rgOrder.product_key}" est inactif ou introuvable.`,
          flowSteps: ['[1] Échec vérification finale : produit inactif ou introuvable.'],
          order: rgOrder
        };
      }

      flowSteps.push(
        `[1] Vérification finale réussie : commande #${rgOrder.id} valide et jamais envoyée à RechargeGames (buyer_ref=${rgOrder.buyer_ref}).`
      );

      // Atomic idempotency lock in SQLite manual_payment_validations table
      const nowIso = new Date().toISOString();
      const valLock = db.recordManualPaymentValidation({
        order_id: rgOrder.id,
        buyer_ref: rgOrder.buyer_ref,
        admin_id: params.adminId,
        admin_email: params.adminEmail,
        amount: rgOrder.customer_price,
        currency: rgOrder.currency || 'USD',
        previous_status: previousStatus,
        new_status: 'order_pending',
        payment_status: 'payment_verified',
        timestamp: nowIso,
        note: params.note || 'Validation manuelle du paiement par administrateur autorisé'
      });

      if (valLock.alreadyValidated) {
        return {
          success: false,
          httpStatus: 409,
          alreadyValidated: true,
          errorCode: 'MANUAL_PAYMENT_ALREADY_VALIDATED',
          message: `Ce paiement a déjà été validé manuellement (${valLock.record.id}). Aucune double commande fournisseur créée.`,
          flowSteps: ['[1] Verrou SQLite manual_payment_validations : double clic administrateur bloqué.'],
          validationRecord: valLock.record,
          order: rgOrder,
          playupOrder: db.getOrders().find(o => o.id === rgOrder.id)
        };
      }

      // Step 2: Payment transitions to "payment_verified"
      rgOrder.payment_status = 'payment_verified';
      rgOrder.validated_by_admin_id = params.adminId;
      rgOrder.validated_at = nowIso;
      if (rgOrder.payment_reference || rgOrder.payment_transaction_id) {
        db.updatePaymentTransactionStatus(
          rgOrder.payment_reference || rgOrder.payment_transaction_id!,
          'payment_verified',
          `Paiement validé manuellement par l'administrateur ${params.adminEmail || params.adminId}`,
          rgOrder.id,
          rgOrder.buyer_ref
        );
      }
      flowSteps.push(`[2] Paiement passé à "payment_verified" (validé par ${params.adminEmail || params.adminId}).`);

      // Step 3: Order transitions to "order_pending"
      rgOrder.status = 'order_pending';
      rgOrder.lifecycle_status = 'order_pending';
      rgOrder.dispatch_status = 'ready_to_send';
      rgOrder.user_status_message = RechargeGamesProvider.getUserFacingOrderMessage('order_pending');
      rgOrder.updated_at = nowIso;
      db.upsertRechargeGamesOrder(rgOrder);
      flowSteps.push(`[3] Commande #${rgOrder.id} passée à "order_pending".`);

      // Step 4: Backend automatically sends the order to RechargeGames with the SAME unique "buyer_ref"
      const effectiveBase = this.getEffectiveBaseUrl();
      const fullUrl = `${effectiveBase}/v1/orders`;
      const outboundPayload: Record<string, any> = {
        product: this.resolveOfficialProductField(product),
        product_key: rgOrder.product_key,
        buyer_ref: rgOrder.buyer_ref,
        quantity: rgOrder.quantity || 1,
        ...(product.requires_player_id !== false && rgOrder.player_id !== 'VOUCHER_PIN'
          ? { player_id: rgOrder.player_id }
          : {}),
        ...(rgOrder.region ? { region: rgOrder.region } : {}),
        ...(rgOrder.server_id ? { server_id: rgOrder.server_id } : {}),
        test: rgOrder.test_mode
      };
      flowSteps.push(
        `[4] Envoi automatique côté backend à RechargeGames (POST /v1/orders) avec le même buyer_ref="${rgOrder.buyer_ref}".`
      );

      // Step 10 check: If RechargeGames returns a temporary error, apply the 3-attempt progressive retry limit!
      if (params.simulateTemporaryProviderError) {
        const retryInitRes = await this.executeOrderRetry(rgOrder.id, {
          triggerType: 'automatic',
          reason: 'Erreur temporaire RechargeGames lors de l’envoi post-validation manuelle',
          simulateTemporaryError: true,
          bypassDelayForTest: true
        });
        db.updateManualPaymentValidationStatus(
          rgOrder.id,
          retryInitRes.order?.status || 'order_pending'
        );
        flowSteps.push(
          `[10] Erreur temporaire RechargeGames détectée → Limite stricte de 3 tentatives automatiques appliquée (${retryInitRes.message}).`
        );
        return {
          success: false,
          httpStatus: 503,
          errorCode: 'TEMPORARY_PROVIDER_ERROR_RETRY_SCHEDULED',
          message: retryInitRes.message,
          flowSteps,
          validationRecord: db.getManualPaymentValidations(rgOrder.id)[0] || valLock.record,
          order: retryInitRes.order || rgOrder,
          playupOrder: retryInitRes.playupOrder
        };
      }

      const res = await fetch(fullUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(outboundPayload)
      });
      const rawText = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }

      if (res.status >= 500 || res.status === 429) {
        const retryInitRes = await this.executeOrderRetry(rgOrder.id, {
          triggerType: 'automatic',
          reason: `HTTP ${res.status} lors de l’envoi post-validation manuelle`,
          simulateTemporaryError: true,
          bypassDelayForTest: true
        });
        db.updateManualPaymentValidationStatus(
          rgOrder.id,
          retryInitRes.order?.status || 'order_pending'
        );
        flowSteps.push(
          `[10] Erreur temporaire HTTP ${res.status} → Limite stricte de 3 tentatives appliquée.`
        );
        return {
          success: false,
          httpStatus: 503,
          errorCode: 'TEMPORARY_PROVIDER_ERROR_RETRY_SCHEDULED',
          message: retryInitRes.message,
          flowSteps,
          validationRecord: db.getManualPaymentValidations(rgOrder.id)[0] || valLock.record,
          order: retryInitRes.order || rgOrder,
          playupOrder: retryInitRes.playupOrder
        };
      }

      // Step 5 & 6: Save "provider_order_id" returned by RechargeGames and transition order to "sent_to_rechargegames"
      const providerOrderId = String(parsed?.order_id || parsed?.id || `rg_${Date.now()}`);
      const sentIso = new Date().toISOString();

      rgOrder.provider_order_id = providerOrderId;
      rgOrder.status = 'sent_to_rechargegames';
      rgOrder.lifecycle_status = 'sent_to_rechargegames';
      rgOrder.dispatch_status = 'sent_to_rechargegames';
      rgOrder.user_status_message = RechargeGamesProvider.getUserFacingOrderMessage('sent_to_rechargegames');
      rgOrder.updated_at = sentIso;
      db.upsertRechargeGamesOrder(rgOrder);

      flowSteps.push(`[5] Enregistrement du provider_order_id retourné par RechargeGames : "${providerOrderId}".`);
      flowSteps.push(`[6] Commande passée à "sent_to_rechargegames".`);

      // Update unified PlayUp order history with admin, date/time, order, amount, previous status, and new status
      const allOrders = db.getOrders();
      const uIdx = allOrders.findIndex(o => o.id === rgOrder.id || o.partnerOrderId === rgOrder.buyer_ref);
      if (uIdx !== -1) {
        allOrders[uIdx].externalOrderId = providerOrderId;
        allOrders[uIdx].providerReference = providerOrderId;
        allOrders[uIdx].payment_status = 'payment_verified';
        allOrders[uIdx].status = 'sent_to_rechargegames';
        allOrders[uIdx].lifecycle_status = 'sent_to_rechargegames';
        allOrders[uIdx].dispatch_status = 'sent_to_rechargegames';
        allOrders[uIdx].user_status_message = rgOrder.user_status_message;
        allOrders[uIdx].updatedAt = sentIso;
        allOrders[uIdx].statusHistory.push(
          {
            status: 'payment_verified',
            timestamp: nowIso,
            note: `Validation manuelle par admin (${params.adminEmail || params.adminId}) — Montant: $${rgOrder.customer_price.toFixed(2)} ${rgOrder.currency} — Statut précédent: "${previousStatus}" → Nouveau statut: "payment_verified"`
          },
          {
            status: 'order_pending',
            timestamp: nowIso,
            note: `Passage automatique à "order_pending" avant envoi fournisseur (buyer_ref: ${rgOrder.buyer_ref})`
          },
          {
            status: 'sent_to_rechargegames',
            timestamp: sentIso,
            note: `Commande envoyée à RechargeGames (provider_order_id: ${providerOrderId})`
          }
        );
        db.setOrders(allOrders);
      }

      db.updateManualPaymentValidationStatus(rgOrder.id, 'sent_to_rechargegames', providerOrderId);

      // Step 7, 8, 9: Track real status via API / webhook simulation if requested
      flowSteps.push(`[7] Suivi du statut réel activé via webhook et GET /v1/orders/${providerOrderId}.`);

      if (params.simulateImmediateDelivery) {
        this.applyOrderStatusTransition(
          rgOrder,
          'delivered',
          `Livraison confirmée par RechargeGames (${providerOrderId}) après validation manuelle du paiement`
        );
        db.updateManualPaymentValidationStatus(rgOrder.id, 'delivered', providerOrderId);
        flowSteps.push(
          `[8] RechargeGames confirme la livraison → Statut passé à "delivered" → Notification Push et Email envoyées au client.`
        );
      } else if (params.simulateDefinitiveFailure || (!res.ok && res.status >= 400 && res.status < 500)) {
        const failReason =
          parsed?.error?.message || 'Échec définitif confirmé par RechargeGames après validation manuelle';
        this.applyOrderStatusTransition(rgOrder, 'failed', failReason);
        db.updateManualPaymentValidationStatus(rgOrder.id, 'failed', providerOrderId);
        flowSteps.push(
          `[9] RechargeGames confirme un échec définitif → Statut passé à "failed" → Règles strictes de remboursement appliquées.`
        );
      } else {
        // Perform an initial real status check against GET /v1/orders/{order_id}
        await this.checkOrderStatus(rgOrder.id);
      }

      const finalOrder = db.findRechargeGamesOrderById(rgOrder.id) || rgOrder;
      const finalUnified = db.getOrders().find(o => o.id === rgOrder.id || o.partnerOrderId === rgOrder.buyer_ref);
      const finalValidationRecord = db.getManualPaymentValidations(rgOrder.id)[0] || valLock.record;
      const refundRecord = db.findRefundByOrderId(rgOrder.id);

      return {
        success: true,
        httpStatus: 200,
        message: `Validation manuelle exécutée avec succès : ${flowSteps.join(' → ')}`,
        flowSteps,
        validationRecord: finalValidationRecord,
        order: finalOrder,
        playupOrder: finalUnified,
        refundRecord
      };
    } finally {
      RechargeGamesProvider.manualValidationLocks.delete(lockKey);
    }
  }

  // ===========================================================================
  // REQUEST #8: STRICT ADMIN MANUAL REFUND WORKFLOW ("Rembourser")
  // ===========================================================================
  public async executeStrictAdminRefund(
    orderIdOrBuyerRef: string,
    params: {
      adminId: string;
      adminEmail?: string;
      reason: string;
      refundMethod?: PaymentMethodType | string;
    }
  ): Promise<{
    success: boolean;
    httpStatus: number;
    errorCode?: string;
    message: string;
    refundRecord?: RefundRecord;
    order?: RechargeGamesOrderRecord;
    playupOrder?: Order;
  }> {
    const rgOrder =
      db.findRechargeGamesOrderById(orderIdOrBuyerRef) ||
      db.findRechargeGamesOrderByBuyerRef(orderIdOrBuyerRef);

    if (!rgOrder) {
      return {
        success: false,
        httpStatus: 404,
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Commande introuvable.'
      };
    }

    // 1. Verify real status with RechargeGames first if the order has a provider_order_id and is still pending
    const hasRealProviderId =
      rgOrder.provider_order_id &&
      !rgOrder.provider_order_id.startsWith('awaiting_payment_') &&
      !rgOrder.provider_order_id.startsWith('pending_dispatch_');

    if (
      hasRealProviderId &&
      (rgOrder.status === 'pending' ||
        rgOrder.status === 'order_pending' ||
        rgOrder.status === 'sent_to_rechargegames')
    ) {
      await this.checkOrderStatus(rgOrder.id);
    }

    const refreshedOrder = db.findRechargeGamesOrderById(rgOrder.id) || rgOrder;

    // 2. Evaluate strict refund eligibility
    const eligibility = db.evaluateRefundEligibility(refreshedOrder.id, {
      isManualAdmin: true,
      providerConfirmedNotDelivered:
        refreshedOrder.status === 'failed' || refreshedOrder.status === 'manual_review',
      providerConfirmedRefunded: refreshedOrder.status === 'refunded'
    });

    if (!eligibility.eligible) {
      return {
        success: false,
        httpStatus: eligibility.code === 'ALREADY_REFUNDED' ? 409 : 400,
        errorCode: eligibility.code,
        message: eligibility.reason,
        order: refreshedOrder,
        refundRecord: eligibility.existingRefund
      };
    }

    // 3. Execute transactional refund via db.processVerifiableRefund ("refund_pending" -> "refunded")
    const refundRes = db.processVerifiableRefund({
      orderId: refreshedOrder.id,
      buyerRef: refreshedOrder.buyer_ref,
      userId: refreshedOrder.user_id,
      amount: refreshedOrder.customer_price,
      currency: refreshedOrder.currency || 'USD',
      reason: params.reason || 'Remboursement manuel approuvé par un administrateur PlayUp',
      adminId: params.adminId,
      adminEmail: params.adminEmail,
      refundMethod: params.refundMethod || refreshedOrder.payment_method || 'wallet',
      ruleApplied: 'admin_manual_approval',
      currentOrderStatus: refreshedOrder.status === 'manual_review' ? 'failed' : refreshedOrder.status,
      paymentStatus: refreshedOrder.payment_status || 'payment_succeeded',
      hasRemainingAutoRetries: false,
      paymentMethod: (refreshedOrder.payment_method as PaymentMethodType) || 'wallet',
      originalPaymentReference: refreshedOrder.payment_reference
    });

    if (!refundRes.refunded || !refundRes.refundRecord) {
      return {
        success: false,
        httpStatus: refundRes.alreadyRefunded ? 409 : 400,
        errorCode: refundRes.alreadyRefunded ? 'ALREADY_REFUNDED' : 'REFUND_REJECTED',
        message: refundRes.blockedReason || 'Remboursement refusé selon les règles strictes de PlayUp.',
        order: db.findRechargeGamesOrderById(refreshedOrder.id),
        refundRecord: refundRes.refundRecord
      };
    }

    // Update order statuses to reflect confirmed refund
    const nowIso = new Date().toISOString();
    refreshedOrder.status = 'refunded';
    refreshedOrder.payment_status = 'payment_refunded';
    refreshedOrder.lifecycle_status = 'payment_refunded';
    refreshedOrder.refund_status = 'refunded';
    refreshedOrder.refunded_at = refundRes.refundRecord.confirmedAt || nowIso;
    refreshedOrder.refund_reason = refundRes.refundRecord.reason;
    refreshedOrder.refund_transaction_id = refundRes.refundRecord.refundTransactionReference;
    refreshedOrder.refund_admin_id = params.adminId;
    refreshedOrder.next_retry_at = null;
    refreshedOrder.user_status_message = RechargeGamesProvider.getUserFacingOrderMessage(
      'payment_refunded',
      refreshedOrder.refund_reason
    );
    db.upsertRechargeGamesOrder(refreshedOrder);

    const allOrders = db.getOrders();
    const uIdx = allOrders.findIndex(
      o => o.id === refreshedOrder.id || o.partnerOrderId === refreshedOrder.buyer_ref
    );
    if (uIdx !== -1) {
      allOrders[uIdx].status = 'refunded';
      allOrders[uIdx].payment_status = 'payment_refunded';
      allOrders[uIdx].lifecycle_status = 'payment_refunded';
      allOrders[uIdx].refund_status = 'refunded';
      allOrders[uIdx].refundInfo = `Remboursé (${refundRes.refundRecord.refundTransactionReference})`;
      allOrders[uIdx].user_status_message = refreshedOrder.user_status_message;
      allOrders[uIdx].updatedAt = nowIso;
      allOrders[uIdx].statusHistory.push({
        status: 'refunded',
        timestamp: nowIso,
        note: `Remboursement manuel confirmé (refund_id: ${refundRes.refundRecord.id}, admin_id: ${params.adminId}, montant: $${refreshedOrder.customer_price.toFixed(2)} ${refreshedOrder.currency}, méthode: ${refundRes.refundRecord.refundMethod}) — Raison: ${params.reason}`
      });
      db.setOrders(allOrders);
    }

    db.addUserNotification({
      userId: refreshedOrder.user_id,
      orderId: refreshedOrder.id,
      orderNumber: refreshedOrder.id,
      title: 'Commande remboursée',
      message: `Votre commande #${refreshedOrder.id} (${refreshedOrder.product_name}) a été remboursée ($${refreshedOrder.customer_price.toFixed(2)} ${refreshedOrder.currency}). Réf: ${refundRes.refundRecord.refundTransactionReference}.`,
      type: 'refund'
    });

    return {
      success: true,
      httpStatus: 200,
      message: `Remboursement confirmé avec succès (refund_id: ${refundRes.refundRecord.id}, statut: "refunded").`,
      refundRecord: refundRes.refundRecord,
      order: refreshedOrder,
      playupOrder: uIdx !== -1 ? allOrders[uIdx] : undefined
    };
  }
}
