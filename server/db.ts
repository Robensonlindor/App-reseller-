import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { 
  Game, Service, Provider, Reseller, ApiKey, Order, 
  AppSettings, SupportTicket, SystemLog, Transaction, WebhookLog, 
  ProviderApiLog, ProviderOrder, UserNotification, ProviderWebhookLog,
  AppUser, PaymentGatewayConfig, PaymentTransaction,
  PaymentLifecycleStatus, OrderLifecycleStatus, RefundLifecycleStatus, RefundRecord, PaymentMethodType,
  ManualPaymentValidationRecord, OrderRetryAttemptRecord,
  RechargeGamesMode, RechargeGamesProduct, RechargeGamesOrderRecord,
  RechargeGamesWebhookEvent, RechargeGamesMarginConfig, RechargeGamesSyncStats,
  FirestoreWebhookIdempotencyRecord, PushSubscriptionRecord, PushNotificationLog, EmailDeliveryLog,
  PLAYUP_OFFICIAL_PAYMENT_NUMBERS, PaymentFinalCreditStatus, PaymentAntiFraudDecision,
  PaymentRequestStage, PaymentProofOcrExtraction, PaymentProofForensicAnalysis,
  PaymentRequestRecord, PaymentAuditEventType, PaymentAuditLogEntry, AntiFraudIncidentRecord,
  PaymentIdempotentOperationType, PaymentIdempotencyRecord, PaymentSecurityNonceRecord, PaymentSecurityRateLimitLog,
  PaymentProofRecord, ValidatedPaymentRecord, IdempotencyKeyRecord, WalletTransactionType, WalletTransactionRecord, AuditLogRecord, WalletLedgerReconciliation,
  Wallet2FAChannel, Wallet2FAOperationType, Wallet2FAChallengeRecord
} from '../src/types';
import { 
  INITIAL_GAMES, INITIAL_SERVICES, INITIAL_PROVIDERS, 
  INITIAL_RESELLERS, INITIAL_API_KEYS, INITIAL_ORDERS, 
  INITIAL_SETTINGS, INITIAL_TICKETS, INITIAL_LOGS, INITIAL_PROVIDER_ORDERS 
} from '../src/data/initialData';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'playup_database.json');
const SQLITE_DB_FILE = path.join(DATA_DIR, 'playup_auth.sqlite');

export interface SystemBootstrapRecord {
  id: 1;
  admin_initialized: boolean;
  first_admin_user_id: string | null;
  initialized_at: string | null;
  updated_at: string;
}

export interface PendingSecondaryTaskRecord {
  id: string;
  user_id: string;
  task_type: string;
  status: 'pending' | 'completed' | 'failed';
  error_message?: string;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export type BootstrapTestFailStage =
  | 'during_user_creation'
  | 'after_user_creation_before_role'
  | 'during_bootstrap_init'
  | 'before_commit'
  | 'post_commit_secondary';

export interface ProviderSecretRecord {
  apiKey: string;
  webhookSecret: string;
}

export interface UserCredentialRecord {
  passwordHash: string;
  passwordSalt: string;
  resetToken?: string;
  resetTokenExpiresAt?: string;
  totpSecret?: string;
  totpPendingSecret?: string;
}

export interface PaymentGatewaySecretRecord {
  apiKey: string;
  clientSecret: string;
  webhookSecret: string;
}

export const DEFAULT_PAYMENT_GATEWAYS: PaymentGatewayConfig[] = [
  {
    id: 'gw_card',
    slug: 'card',
    name: 'Carte Bancaire (Visa / Mastercard)',
    providerName: 'Stripe / 3D Secure Card Gateway',
    description: 'Paiement instantané sécurisé par carte de crédit ou de débit internationale (Visa, Mastercard, Amex).',
    isEnabled: true,
    mode: 'sandbox',
    supportedCurrencies: ['USD', 'EUR', 'HTG'],
    feePercent: 2.9,
    fixedFee: 0.30,
    hasCredentials: false,
    credentialsMasked: 'Mode Sandbox Actif',
    webhookUrl: '/api/webhooks/payments/card',
    instructions: 'Saisissez les informations de votre carte bancaire (validation 3D Secure instantanée).'
  },
  {
    id: 'gw_moncash',
    slug: 'moncash',
    name: 'MonCash (Digicel)',
    providerName: 'Digicel MonCash REST API',
    description: 'Paiement mobile rapide via compte MonCash Digicel avec confirmation par numéro et code PIN/OTP.',
    isEnabled: true,
    mode: 'sandbox',
    supportedCurrencies: ['HTG', 'USD'],
    feePercent: 1.5,
    fixedFee: 0.0,
    hasCredentials: false,
    credentialsMasked: 'Mode Sandbox Actif',
    webhookUrl: '/api/webhooks/payments/moncash',
    instructions: 'Entrez votre numéro de téléphone Digicel MonCash (ex: +509 37XX-XXXX) et validez la transaction.'
  },
  {
    id: 'gw_natcash',
    slug: 'natcash',
    name: 'NatCash (Natcom)',
    providerName: 'Natcom NatCash Merchant API',
    description: 'Paiement mobile sécurisé via portefeuille NatCash Natcom avec confirmation instantanée.',
    isEnabled: true,
    mode: 'sandbox',
    supportedCurrencies: ['HTG', 'USD'],
    feePercent: 1.5,
    fixedFee: 0.0,
    hasCredentials: false,
    credentialsMasked: 'Mode Sandbox Actif',
    webhookUrl: '/api/webhooks/payments/natcash',
    instructions: 'Entrez votre numéro de téléphone Natcom NatCash (ex: +509 40XX-XXXX) pour autoriser le débit.'
  },
  {
    id: 'gw_wallet',
    slug: 'wallet',
    name: 'Solde PlayUp Wallet',
    providerName: 'PlayUp Internal Ledger',
    description: 'Débit instantané sans frais depuis le solde prépayé de votre compte PlayUp.',
    isEnabled: true,
    mode: 'live',
    supportedCurrencies: ['USD', 'HTG', 'EUR'],
    feePercent: 0,
    fixedFee: 0,
    hasCredentials: true,
    credentialsMasked: 'Interne PlayUp',
    webhookUrl: '/api/webhooks/payments/wallet',
    instructions: 'Utilisez directement le solde disponible sur votre compte PlayUp.'
  }
];

export interface DatabaseSchema {
  games: Game[];
  services: Service[];
  providers: Provider[];
  providerSecrets: Record<string, ProviderSecretRecord>; // Server-side only
  providerOrders: ProviderOrder[];                       // Table provider_orders
  providerApiLogs: ProviderApiLog[];
  providerWebhookLogs: ProviderWebhookLog[];             // Real-time GoXtop Webhook Diagnostic Logs
  processedWebhookEvents: string[];                      // Deduplication of webhook events
  userNotifications: UserNotification[];
  users: AppUser[];
  userCredentials: Record<string, UserCredentialRecord>; // Server-side password hashes & reset tokens
  revokedSessionTokens?: string[];                       // Server-side revoked session tokens on logout
  systemBootstrap?: SystemBootstrapRecord;               // Mirror of system_bootstrap (id = 1)
  pendingSecondaryTasks?: PendingSecondaryTaskRecord[];  // Recoverable post-commit secondary tasks
  paymentGateways: PaymentGatewayConfig[];
  paymentGatewaySecrets: Record<string, PaymentGatewaySecretRecord>; // Server-side only
  paymentTransactions: PaymentTransaction[];
  refunds?: RefundRecord[];                              // Table: order_refunds (verifiable refunds)
  manualPaymentValidations?: ManualPaymentValidationRecord[]; // Table: manual_payment_validations
  orderRetryAttempts?: OrderRetryAttemptRecord[];        // Table: order_retry_attempts
  resellers: Reseller[];
  apiKeys: ApiKey[];
  orders: Order[];
  transactions: Transaction[];
  webhookLogs: WebhookLog[];
  supportTickets: SupportTicket[];
  settings: AppSettings;
  systemLogs: SystemLog[];
  adminToken: string;
  // RechargeGames tables & config
  rechargeGamesMode?: RechargeGamesMode;
  rechargeGamesBaseUrl?: string;
  rechargeGamesProducts?: RechargeGamesProduct[];        // Table: products
  rechargeGamesOrders?: RechargeGamesOrderRecord[];      // Table: orders
  webhookEvents?: RechargeGamesWebhookEvent[];           // Table: webhook_events
  firestoreWebhookIdempotencyLocks?: Record<string, FirestoreWebhookIdempotencyRecord>; // Firestore /webhook_events/{eventId} mirror
  rechargeGamesMargins?: RechargeGamesMarginConfig;      // PlayUp Margin System
  rechargeGamesSyncStats?: RechargeGamesSyncStats;
  rechargeGamesBuyerRefCounter?: number;
  // Real-time Push Notifications & Email Delivery logs
  pushSubscriptions?: PushSubscriptionRecord[];
  pushNotificationLogs?: PushNotificationLog[];
  emailDeliveryLogs?: EmailDeliveryLog[];
  processedOrderDeliveries?: string[];
  // Real MonCash/NatCash OCR Payment Requests, Anti-Fraud & Immutable Audit Logs
  paymentRequests?: PaymentRequestRecord[];
  paymentRequestOcrSecrets?: Record<string, string>; // Server-only map of request_id -> detectedTranscode
  usedPaymentTranscodes?: Record<string, {
    transcode: string;
    payment_request_id: string;
    transaction_id: string;
    user_id: string;
    amount: number;
    payment_method: string;
    used_at: string;
  }>;
  usedPaymentProofs?: Record<string, {
    proof_hash: string;
    perceptual_hash: string;
    payment_request_id: string;
    transaction_id?: string;
    user_id: string;
    status: string;
    recorded_at: string;
  }>;
  paymentAuditLogs?: PaymentAuditLogEntry[];
  antiFraudIncidents?: AntiFraudIncidentRecord[];
  paymentIdempotencyRecords?: Record<string, PaymentIdempotencyRecord>;
  paymentSecurityNonces?: Record<string, PaymentSecurityNonceRecord>;
  paymentRateLimitLogs?: PaymentSecurityRateLimitLog[];
}

export class PlayUpDatabase {
  private data: DatabaseSchema;
  private sqlite!: DatabaseSync;
  private txLockChain: Promise<void> = Promise.resolve();
  private inFlightIdempotencyPromises: Map<string, Promise<{ httpStatus: number; body: any; replayed: boolean }>> = new Map();
  private perPaymentOperationLocks: Map<string, Promise<any>> = new Map();

  constructor() {
    this.ensureDataDir();
    this.data = this.load();
    this.ensureMigrations();
    this.initSqliteAuthEngine();
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Produces a safe masked version of a secret (Never returns full key)
   */
  public maskSecretValue(secret?: string): string {
    if (!secret || secret.trim().length === 0) return 'Non configurée';
    return '••••••••••••••••';
  }

  /**
   * Sanitizes any object or string to ensure no API Key, Webhook Secret, or Environment Variable is ever written in plaintext to logs or payloads
   */
  public sanitizeForLogs(raw: any): any {
    if (raw === null || raw === undefined) return raw;
    const isObj = typeof raw === 'object';
    let str = isObj ? JSON.stringify(raw) : String(raw);

    if (this.data?.providerSecrets) {
      for (const sec of Object.values(this.data.providerSecrets)) {
        if (sec.apiKey && sec.apiKey.trim().length >= 4) {
          str = str.split(sec.apiKey.trim()).join('••••••••••••••••');
        }
        if (sec.webhookSecret && sec.webhookSecret.trim().length >= 4) {
          str = str.split(sec.webhookSecret.trim()).join('••••••••••••••••');
        }
      }
    }

    const envKeysToMask = [
      process.env.GOXTOP_API_KEY,
      process.env.GOXTOP_API_KEY_SECRET,
      process.env.GOXTOP_WEBHOOK_SECRET,
      process.env.RECHARGEGAMES_API_KEY,
      process.env.RECHARGEGAMES_WEBHOOK_SECRET,
      process.env.PLAYUP_SESSION_SECRET,
      process.env.GEMINI_API_KEY
    ];
    for (const val of envKeysToMask) {
      if (val && val.trim().length >= 4) {
        str = str.split(val.trim()).join('••••••••••••••••');
      }
    }

    str = str.replace(/("x-api-key"\s*:\s*")([^"]+)(")/gi, '$1••••••••••••••••$3');
    str = str.replace(/("x-api-secret"\s*:\s*")([^"]+)(")/gi, '$1••••••••••••••••$3');
    str = str.replace(/("api_key"\s*:\s*")([^"]+)(")/gi, '$1[MASKED]$3');
    str = str.replace(/("apiKey"\s*:\s*")([^"]+)(")/gi, '$1[MASKED]$3');
    str = str.replace(/("webhookSecret"\s*:\s*")([^"]+)(")/gi, '$1[MASKED]$3');
    str = str.replace(/("secret"\s*:\s*")([^"]+)(")/gi, '$1[MASKED]$3');
    str = str.replace(/("authorization"\s*:\s*")([^"]+)(")/gi, '$1[MASKED]$3');

    if (isObj) {
      try {
        return JSON.parse(str);
      } catch {
        return { sanitized: str.slice(0, 3500) };
      }
    }
    return str.slice(0, 3500);
  }

  private ensureMigrations() {
    let changed = false;

    const envGoxKey = process.env.GOXTOP_API_KEY || '';
    const envGoxSecret = process.env.GOXTOP_API_KEY_SECRET || process.env.GOXTOP_WEBHOOK_SECRET || '';
    const envRgKey = process.env.RECHARGEGAMES_API_KEY || '';
    const envRgSecret = process.env.RECHARGEGAMES_WEBHOOK_SECRET || '';

    if (!this.data.providerSecrets) {
      this.data.providerSecrets = {
        prov_rechargegames: {
          apiKey: envRgKey,
          webhookSecret: envRgSecret
        },
        prov_goxtop: {
          apiKey: envGoxKey,
          webhookSecret: envGoxSecret
        }
      };
      changed = true;
    } else {
      if (!this.data.providerSecrets.prov_rechargegames) {
        this.data.providerSecrets.prov_rechargegames = {
          apiKey: envRgKey,
          webhookSecret: envRgSecret
        };
        changed = true;
      } else {
        if (envRgKey && this.data.providerSecrets.prov_rechargegames.apiKey !== envRgKey) {
          this.data.providerSecrets.prov_rechargegames.apiKey = envRgKey;
          changed = true;
        }
        if (envRgSecret && this.data.providerSecrets.prov_rechargegames.webhookSecret !== envRgSecret) {
          this.data.providerSecrets.prov_rechargegames.webhookSecret = envRgSecret;
          changed = true;
        }
      }
      if (!this.data.providerSecrets.prov_goxtop) {
        this.data.providerSecrets.prov_goxtop = { apiKey: '', webhookSecret: '' };
      }
      if (envGoxKey && !this.data.providerSecrets.prov_goxtop.apiKey) {
        this.data.providerSecrets.prov_goxtop.apiKey = envGoxKey;
        changed = true;
      }
      if (envGoxSecret && !this.data.providerSecrets.prov_goxtop.webhookSecret) {
        this.data.providerSecrets.prov_goxtop.webhookSecret = envGoxSecret;
        changed = true;
      }
    }

    // Ensure RechargeGames provider exists in providers list
    const rgIdx = this.data.providers.findIndex(p => p.id === 'prov_rechargegames' || p.slug === 'rechargegames');
    if (rgIdx === -1) {
      const rgInitial = INITIAL_PROVIDERS.find(p => p.id === 'prov_rechargegames');
      if (rgInitial) {
        this.data.providers.unshift(rgInitial);
        changed = true;
      }
    }

    if (!this.data.rechargeGamesMode) {
      this.data.rechargeGamesMode = 'TEST';
      changed = true;
    }
    if (!this.data.rechargeGamesBaseUrl || this.data.rechargeGamesBaseUrl.includes('rechargegames-v1-gateway')) {
      this.data.rechargeGamesBaseUrl = process.env.RECHARGEGAMES_BASE_URL || 'https://api.rechargegame.games';
      changed = true;
    }
    if (!this.data.rechargeGamesProducts) {
      this.data.rechargeGamesProducts = [];
      changed = true;
    }
    if (!this.data.rechargeGamesOrders) {
      this.data.rechargeGamesOrders = [];
      changed = true;
    }
    if (!this.data.webhookEvents) {
      this.data.webhookEvents = [];
      changed = true;
    }
    if (!this.data.rechargeGamesMargins) {
      this.data.rechargeGamesMargins = {
        globalMarginPercent: 20,
        gameMargins: {
          'Free Fire': 20,
          'PUBG Mobile': 18,
          'Mobile Legends': 20,
          'Call of Duty: Mobile': 20,
          'Roblox': 15
        },
        regionMargins: {
          'Brazil': 18,
          'USA': 20,
          'Global': 20
        },
        productMargins: {},
        updatedAt: new Date().toISOString()
      };
      changed = true;
    }
    if (!this.data.rechargeGamesSyncStats) {
      this.data.rechargeGamesSyncStats = {
        lastSyncedAt: null,
        totalProducts: 0,
        activeProducts: 0,
        unavailableProducts: 0,
        regionsAvailable: ['Brazil', 'USA', 'Global'],
        gamesAvailable: [],
        syncErrors: [],
        autoSyncEnabled: true,
        autoSyncIntervalMinutes: 30
      };
      changed = true;
    }
    if (typeof this.data.rechargeGamesBuyerRefCounter !== 'number') {
      this.data.rechargeGamesBuyerRefCounter = 0;
      changed = true;
    }

    if (!this.data.providerOrders) {
      this.data.providerOrders = INITIAL_PROVIDER_ORDERS;
      changed = true;
    }

    if (!this.data.providerApiLogs) {
      this.data.providerApiLogs = [];
      changed = true;
    }

    if (!this.data.providerWebhookLogs) {
      this.data.providerWebhookLogs = [];
      changed = true;
    }

    if (!this.data.processedWebhookEvents) {
      this.data.processedWebhookEvents = [];
      changed = true;
    }

    if (!this.data.userNotifications) {
      this.data.userNotifications = [];
      changed = true;
    }

    if (!this.data.userCredentials) {
      this.data.userCredentials = {};
      changed = true;
    }

    if (!this.data.users) {
      this.data.users = [];
      changed = true;
    }

    // Rotate any non-HMAC session secret to a fresh cryptographic secret
    if (
      !this.data.adminToken ||
      !this.data.adminToken.startsWith('plup_hmac_')
    ) {
      this.data.adminToken =
        process.env.PLAYUP_SESSION_SECRET?.trim() ||
        'plup_hmac_' + crypto.randomBytes(32).toString('hex');
      changed = true;
    }

    if (this.data.resellers) {
      const beforeResLen = this.data.resellers.length;
      this.data.resellers = this.data.resellers.filter(r => r.id !== 'res_demo_01' && r.id !== 'res_demo_02');
      if (this.data.resellers.length !== beforeResLen) changed = true;
    }

    if (this.data.apiKeys) {
      const beforeKeysLen = this.data.apiKeys.length;
      this.data.apiKeys = this.data.apiKeys.filter(k => k.id !== 'key_live_01' && k.id !== 'key_sandbox_01');
      if (this.data.apiKeys.length !== beforeKeysLen) changed = true;
    }

    // Ensure every user record has an explicit role ('USER' | 'ADMIN') and pushNotificationsEnabled
    for (const u of this.data.users) {
      if (u.role !== 'ADMIN' && u.role !== 'USER') {
        u.role = 'USER';
        changed = true;
      }
      if (typeof u.pushNotificationsEnabled !== 'boolean') {
        u.pushNotificationsEnabled = true;
        changed = true;
      }
    }

    if (!this.data.paymentGateways || this.data.paymentGateways.length === 0) {
      this.data.paymentGateways = DEFAULT_PAYMENT_GATEWAYS;
      changed = true;
    }

    if (!this.data.paymentGatewaySecrets) {
      this.data.paymentGatewaySecrets = {};
      changed = true;
    }

    if (!this.data.paymentTransactions) {
      this.data.paymentTransactions = [];
      changed = true;
    }

    // Remove any legacy demo/fictitious GoXtop order records if present
    if (this.data.orders.some(o => o.id === 'ord_98210' || o.externalOrderId === 'GOX-ORD-881920')) {
      this.data.orders = this.data.orders.filter(o => o.id !== 'ord_98210' && o.externalOrderId !== 'GOX-ORD-881920');
      changed = true;
    }
    if (this.data.providerOrders.some(po => po.id === 'pord_01' || po.provider_order_id === 'GOX-ORD-881920')) {
      this.data.providerOrders = this.data.providerOrders.filter(po => po.id !== 'pord_01' && po.provider_order_id !== 'GOX-ORD-881920');
      changed = true;
    }
    if (this.data.userNotifications.some(n => n.id === 'notif_init_1')) {
      this.data.userNotifications = this.data.userNotifications.filter(n => n.id !== 'notif_init_1');
      changed = true;
    }

    // Ensure GoXtop provider has the exact documented v.1 endpoints and base URL
    const goxIdx = this.data.providers.findIndex(p => p.id === 'prov_goxtop' || p.slug === 'goxtop');
    if (goxIdx === -1) {
      this.data.providers.unshift(INITIAL_PROVIDERS[0]);
      changed = true;
    } else {
      const p = this.data.providers[goxIdx];
      if (!p.endpoints?.getGamesPath) {
        p.endpoints = {
          getGamesPath: '/api/v.1/games',
          getProductsPath: '/api/v.1/products/{game}',
          createOrderPath: '/api/v.1/create',
          orderStatusPath: '/api/v.1/:partner_orderid',
          trackOrderPath: '/api/v.1/:id/track',
          checkPlayerPath: 'REQUIRES GOXTOP DOCUMENTATION'
        };
        changed = true;
      }
    }

    // Align default game externalGameIds with GoXtop real gamecode identifiers
    for (const g of this.data.games) {
      if (g.id === 'game_ff' && g.externalGameId === 'freefire') {
        g.externalGameId = 'freefire_global';
        changed = true;
      }
      if (g.id === 'game_mlbb' && g.externalGameId === 'mlbb') {
        g.externalGameId = 'mlbb_special';
        changed = true;
      }
      if (g.id === 'game_codm' && g.externalGameId === 'codm') {
        g.externalGameId = 'codm_sgmy';
        changed = true;
      }
    }

    // Deduplicate games by id so duplicate keys (e.g. game_mlbb) never occur
    if (Array.isArray(this.data.games)) {
      const seenGameIds = new Set<string>();
      const uniqueGames: Game[] = [];
      for (const g of this.data.games) {
        if (!seenGameIds.has(g.id)) {
          seenGameIds.add(g.id);
          uniqueGames.push(g);
        } else {
          changed = true;
        }
      }
      this.data.games = uniqueGames;
    }

    if (changed) {
      this.save();
    }
  }

  private load(): DatabaseSchema {
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        return JSON.parse(raw);
      } catch (err) {
        console.error('[DB] Failed to read database file, resetting to initial seed:', err);
      }
    }

    const initialSchema: DatabaseSchema = {
      games: INITIAL_GAMES,
      services: INITIAL_SERVICES,
      providers: INITIAL_PROVIDERS,
      providerSecrets: {
        prov_goxtop: {
          apiKey: process.env.GOXTOP_API_KEY || '',
          webhookSecret: process.env.GOXTOP_WEBHOOK_SECRET || ''
        }
      },
      providerOrders: INITIAL_PROVIDER_ORDERS,
      providerApiLogs: [],
      providerWebhookLogs: [],
      processedWebhookEvents: [],
      userNotifications: [],
      users: [],
      userCredentials: {},
      paymentGateways: DEFAULT_PAYMENT_GATEWAYS,
      paymentGatewaySecrets: {},
      paymentTransactions: [],
      resellers: INITIAL_RESELLERS,
      apiKeys: INITIAL_API_KEYS,
      orders: INITIAL_ORDERS,
      transactions: [
        {
          id: 'tx_01',
          transactionNumber: 'TXN-2026-001',
          entityType: 'reseller',
          entityId: 'res_demo_01',
          type: 'credit',
          amount: 500.00,
          currency: 'USD',
          note: 'Initial Reseller Deposit (Bank Wire / USDT)',
          createdAt: '2026-02-10T09:00:00Z'
        }
      ],
      webhookLogs: [],
      supportTickets: INITIAL_TICKETS,
      settings: INITIAL_SETTINGS,
      systemLogs: INITIAL_LOGS,
      adminToken:
        process.env.PLAYUP_SESSION_SECRET?.trim() ||
        'plup_hmac_' + crypto.randomBytes(32).toString('hex')
    };

    this.saveDirect(initialSchema);
    return initialSchema;
  }

  private saveDirect(dataToSave: DatabaseSchema) {
    try {
      this.ensureDataDir();
      const tmpFile = `${DB_FILE}.tmp.${process.pid}`;
      fs.writeFileSync(tmpFile, JSON.stringify(dataToSave, null, 2), 'utf-8');
      fs.renameSync(tmpFile, DB_FILE);
    } catch (err) {
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf-8');
      } catch (fallbackErr) {
        console.error('[DB] Failed to save database file:', fallbackErr);
      }
    }
  }

  public save() {
    this.saveDirect(this.data);
  }

  public getGames(): Game[] {
    const seen = new Set<string>();
    return (this.data.games || []).filter(g => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
  }

  public setGames(games: Game[]) {
    const seen = new Set<string>();
    this.data.games = games.filter(g => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
    this.save();
  }

  public getServices(): Service[] {
    return this.data.services;
  }

  public setServices(services: Service[]) {
    this.data.services = services;
    this.save();
  }

  /**
   * Returns providers with strictly masked API Keys (Never exposes full key)
   */
  public getProviders(): Provider[] {
    return this.data.providers.map(p => {
      const sec = this.getProviderSecret(p.id);
      const hasKey = Boolean(sec.apiKey && sec.apiKey.trim().length > 0);
      const hasWh = Boolean(sec.webhookSecret && sec.webhookSecret.trim().length > 0);
      return {
        ...p,
        hasApiKey: hasKey,
        apiKeyMasked: hasKey ? this.maskSecretValue(sec.apiKey) : 'Non configurée',
        hasWebhookSecret: hasWh,
        webhookSecretMasked: hasWh ? this.maskSecretValue(sec.webhookSecret) : 'Non configuré'
      };
    });
  }

  public setProviders(providers: Provider[]) {
    this.data.providers = providers;
    this.save();
  }

  /**
   * Server-only secret retrieval (checks env vars first for GoXtop, then server vault)
   */
  public getProviderSecret(providerId: string): ProviderSecretRecord {
    const stored = this.data.providerSecrets?.[providerId] || { apiKey: '', webhookSecret: '' };
    if (providerId === 'prov_goxtop') {
      return {
        apiKey: stored.apiKey || process.env.GOXTOP_API_KEY || '',
        webhookSecret: stored.webhookSecret || process.env.GOXTOP_API_KEY_SECRET || process.env.GOXTOP_WEBHOOK_SECRET || ''
      };
    }
    if (providerId === 'prov_rechargegames') {
      return {
        apiKey: process.env.RECHARGEGAMES_API_KEY || stored.apiKey || '',
        webhookSecret: process.env.RECHARGEGAMES_WEBHOOK_SECRET || stored.webhookSecret || ''
      };
    }
    return stored;
  }

  public setProviderSecret(providerId: string, update: Partial<ProviderSecretRecord>) {
    if (!this.data.providerSecrets) {
      this.data.providerSecrets = {};
    }
    const existing = this.data.providerSecrets[providerId] || { apiKey: '', webhookSecret: '' };
    this.data.providerSecrets[providerId] = {
      ...existing,
      ...update
    };
    this.save();
  }

  // Table: provider_orders
  public getProviderOrders(): ProviderOrder[] {
    return this.data.providerOrders || [];
  }

  public findProviderOrderByPartnerId(partnerOrderId: string): ProviderOrder | undefined {
    return (this.data.providerOrders || []).find(po => po.partner_order_id === partnerOrderId);
  }

  public upsertProviderOrder(record: Omit<ProviderOrder, 'request_payload' | 'response_payload'> & { request_payload: any; response_payload: any }): ProviderOrder {
    if (!this.data.providerOrders) {
      this.data.providerOrders = [];
    }
    const sanitizedRecord: ProviderOrder = {
      ...record,
      request_payload: this.sanitizeForLogs(record.request_payload),
      response_payload: this.sanitizeForLogs(record.response_payload),
      error_message: record.error_message ? String(this.sanitizeForLogs(record.error_message)) : undefined
    };

    const idx = this.data.providerOrders.findIndex(
      po => po.id === sanitizedRecord.id || po.partner_order_id === sanitizedRecord.partner_order_id
    );
    if (idx !== -1) {
      this.data.providerOrders[idx] = {
        ...this.data.providerOrders[idx],
        ...sanitizedRecord,
        updated_at: new Date().toISOString()
      };
      this.save();
      return this.data.providerOrders[idx];
    } else {
      this.data.providerOrders.unshift(sanitizedRecord);
      this.save();
      return sanitizedRecord;
    }
  }

  // Webhook Event Deduplication
  public hasProcessedWebhookEvent(eventKey: string): boolean {
    return (this.data.processedWebhookEvents || []).includes(eventKey);
  }

  public markWebhookEventProcessed(eventKey: string) {
    if (!this.data.processedWebhookEvents) {
      this.data.processedWebhookEvents = [];
    }
    if (!this.data.processedWebhookEvents.includes(eventKey)) {
      this.data.processedWebhookEvents.unshift(eventKey);
      if (this.data.processedWebhookEvents.length > 500) {
        this.data.processedWebhookEvents = this.data.processedWebhookEvents.slice(0, 500);
      }
      this.save();
    }
  }

  // User Notifications (Strictly scoped to the authenticated user)
  public getUserNotifications(userId?: string): UserNotification[] {
    if (!userId) return [];
    const list = this.data.userNotifications || [];
    return list.filter(n => n.userId === userId);
  }

  public markNotificationRead(id: string) {
    if (!this.data.userNotifications) return;
    const item = this.data.userNotifications.find(n => n.id === id);
    if (item) {
      item.read = true;
      this.save();
    }
  }

  public addUserNotification(notif: Omit<UserNotification, 'id' | 'createdAt' | 'read'>) {
    if (!this.data.userNotifications) {
      this.data.userNotifications = [];
    }
    const entry: UserNotification = {
      ...notif,
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      read: false,
      createdAt: new Date().toISOString()
    };
    this.data.userNotifications.unshift(entry);
    if (this.data.userNotifications.length > 100) {
      this.data.userNotifications = this.data.userNotifications.slice(0, 100);
    }
    this.save();
    return entry;
  }

  // Provider Webhook Diagnostic Logs (Admin -> Providers -> GoXtop -> Webhook Logs)
  public getProviderWebhookLogs(providerId?: string): ProviderWebhookLog[] {
    const logs = this.data.providerWebhookLogs || [];
    if (providerId && providerId !== 'all') {
      return logs.filter(l => l.providerId === providerId);
    }
    return logs;
  }

  public addProviderWebhookLog(entry: Omit<ProviderWebhookLog, 'id' | 'timestamp'>): ProviderWebhookLog {
    if (!this.data.providerWebhookLogs) {
      this.data.providerWebhookLogs = [];
    }
    const nowIso = new Date().toISOString();
    const log: ProviderWebhookLog = {
      ...entry,
      id: 'wlog_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: nowIso,
      rawPayload: entry.rawPayload ? String(this.sanitizeForLogs(entry.rawPayload)) : undefined,
      headersReceived: entry.headersReceived ? this.sanitizeForLogs(entry.headersReceived) : undefined,
      backendResponse: String(this.sanitizeForLogs(entry.backendResponse)),
      errorMessage: entry.errorMessage ? String(this.sanitizeForLogs(entry.errorMessage)) : undefined
    };
    this.data.providerWebhookLogs.unshift(log);
    if (this.data.providerWebhookLogs.length > 300) {
      this.data.providerWebhookLogs = this.data.providerWebhookLogs.slice(0, 300);
    }

    // Update provider last webhook reception telemetry
    const pIdx = this.data.providers.findIndex(p => p.id === entry.providerId);
    if (pIdx !== -1) {
      this.data.providers[pIdx].webhookLastReceivedAt = nowIso;
      this.data.providers[pIdx].webhookLastEvent = entry.eventType;
      this.data.providers[pIdx].webhookLastHttpStatus = entry.httpStatus;
      this.data.providers[pIdx].webhookLastHmacStatus = entry.hmacValidation;
    }

    this.save();
    return log;
  }

  // Provider API Logs
  public getProviderApiLogs(providerId?: string): ProviderApiLog[] {
    const logs = this.data.providerApiLogs || [];
    if (providerId && providerId !== 'all') {
      return logs.filter(l => l.providerId === providerId);
    }
    return logs;
  }

  public addProviderApiLog(entry: Omit<ProviderApiLog, 'id' | 'timestamp'>) {
    if (!this.data.providerApiLogs) {
      this.data.providerApiLogs = [];
    }
    const log: ProviderApiLog = {
      ...entry,
      id: 'plog_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      requestHeadersMasked: entry.requestHeadersMasked ? this.sanitizeForLogs(entry.requestHeadersMasked) : undefined,
      errorMessage: entry.errorMessage ? String(this.sanitizeForLogs(entry.errorMessage)) : undefined,
      requestPreview: entry.requestPreview ? String(this.sanitizeForLogs(entry.requestPreview)) : undefined,
      responsePreview: entry.responsePreview ? String(this.sanitizeForLogs(entry.responsePreview)) : undefined
    };
    this.data.providerApiLogs.unshift(log);
    if (this.data.providerApiLogs.length > 300) {
      this.data.providerApiLogs = this.data.providerApiLogs.slice(0, 300);
    }
    this.save();
    return log;
  }

  public getResellers(): Reseller[] {
    return this.data.resellers;
  }

  public setResellers(resellers: Reseller[]) {
    this.data.resellers = resellers;
    this.save();
  }

  public getApiKeys(): ApiKey[] {
    return this.data.apiKeys;
  }

  public setApiKeys(keys: ApiKey[]) {
    this.data.apiKeys = keys;
    this.save();
  }

  public getOrders(): Order[] {
    return this.data.orders;
  }

  public setOrders(orders: Order[]) {
    this.data.orders = orders;
    this.save();
  }

  public getTransactions(): Transaction[] {
    return this.data.transactions;
  }

  public setTransactions(txs: Transaction[]) {
    this.data.transactions = txs;
    this.save();
  }

  public getWebhookLogs(): WebhookLog[] {
    return this.data.webhookLogs;
  }

  public addWebhookLog(log: WebhookLog) {
    this.data.webhookLogs.unshift(log);
    if (this.data.webhookLogs.length > 200) {
      this.data.webhookLogs = this.data.webhookLogs.slice(0, 200);
    }
    this.save();
  }

  public getSupportTickets(): SupportTicket[] {
    return this.data.supportTickets;
  }

  public setSupportTickets(tickets: SupportTicket[]) {
    this.data.supportTickets = tickets;
    this.save();
  }

  public getSettings(): AppSettings {
    return this.data.settings;
  }

  public setSettings(settings: AppSettings) {
    this.data.settings = settings;
    this.save();
  }

  public getSystemLogs(): SystemLog[] {
    return this.data.systemLogs;
  }

  public addSystemLog(level: 'info' | 'warn' | 'error', module: 'api' | 'order' | 'provider' | 'webhook' | 'auth' | 'system' | 'payment', message: string, meta?: any) {
    const log: SystemLog = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      level,
      module,
      message: String(this.sanitizeForLogs(message)),
      meta: meta ? this.sanitizeForLogs(meta) : undefined,
      timestamp: new Date().toISOString()
    };
    this.data.systemLogs.unshift(log);
    if (this.data.systemLogs.length > 300) {
      this.data.systemLogs = this.data.systemLogs.slice(0, 300);
    }
    this.save();
  }

  public getAdminToken(): string {
    return this.data.adminToken;
  }

  // ==========================================
  // USER AUTHENTICATION & PASSWORD HASHING
  // ==========================================
  public hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
    const salt = existingSalt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { hash, salt };
  }

  public verifyPassword(password: string, userId: string): boolean {
    const cred = this.data.userCredentials?.[userId];
    if (!cred || !cred.passwordHash || !cred.passwordSalt) return false;
    const { hash } = this.hashPassword(password, cred.passwordSalt);
    try {
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(cred.passwordHash, 'hex'));
    } catch {
      return false;
    }
  }

  public getUsers(): AppUser[] {
    this.syncFromSqliteToMemory();
    return this.data.users || [];
  }

  public setUsers(users: AppUser[]) {
    const existingById = new Map((this.data.users || []).map(u => [u.id, u]));
    let adminSeen = false;
    this.data.users = users.map(u => {
      const prev = existingById.get(u.id);
      let lockedRole: 'ADMIN' | 'USER' = prev ? prev.role : u.role === 'ADMIN' ? 'ADMIN' : 'USER';
      if (lockedRole === 'ADMIN') {
        if (adminSeen) {
          lockedRole = 'USER';
        } else {
          adminSeen = true;
        }
      }
      return {
        ...u,
        role: lockedRole
      };
    });
    this.syncMemoryUsersToSqlite();
    this.save();
  }

  public getUserById(userId: string): AppUser | undefined {
    this.syncFromSqliteToMemory();
    return (this.data.users || []).find(u => u.id === userId || (u.uid && u.uid === userId));
  }

  public getUserByEmail(email: string): AppUser | undefined {
    this.syncFromSqliteToMemory();
    const clean = email.trim().toLowerCase();
    return (this.data.users || []).find(u => u.email.toLowerCase() === clean);
  }

  public setUserCredential(userId: string, cred: UserCredentialRecord) {
    if (!this.data.userCredentials) {
      this.data.userCredentials = {};
    }
    const existing = this.data.userCredentials[userId] || {};
    const merged: UserCredentialRecord = {
      ...existing,
      ...cred
    };
    this.data.userCredentials[userId] = merged;
    try {
      this.sqlite
        .prepare(
          `UPDATE users SET password_hash = ?, password_salt = ?, reset_token = ?, reset_token_expires_at = ?, totp_secret = ?, totp_pending_secret = ? WHERE id = ?`
        )
        .run(
          merged.passwordHash || null,
          merged.passwordSalt || null,
          merged.resetToken || null,
          merged.resetTokenExpiresAt || null,
          merged.totpSecret || null,
          merged.totpPendingSecret || null,
          userId
        );
    } catch {
      // ignore if user row not yet synced
    }
    this.save();
  }

  public getUserCredential(userId: string): UserCredentialRecord | undefined {
    try {
      const row = this.sqlite
        .prepare(
          `SELECT password_hash, password_salt, reset_token, reset_token_expires_at, totp_secret, totp_pending_secret FROM users WHERE id = ?`
        )
        .get(userId) as any;
      if (row && (row.password_hash || row.totp_secret || row.totp_pending_secret)) {
        return {
          passwordHash: row.password_hash ? String(row.password_hash) : '',
          passwordSalt: row.password_salt ? String(row.password_salt) : '',
          ...(row.reset_token ? { resetToken: String(row.reset_token) } : {}),
          ...(row.reset_token_expires_at ? { resetTokenExpiresAt: String(row.reset_token_expires_at) } : {}),
          ...(row.totp_secret ? { totpSecret: String(row.totp_secret) } : {}),
          ...(row.totp_pending_secret ? { totpPendingSecret: String(row.totp_pending_secret) } : {})
        };
      }
    } catch {
      // fallback to memory
    }
    return this.data.userCredentials?.[userId];
  }

  // ==========================================
  // RFC 6238 TOTP (GOOGLE AUTHENTICATOR) ENGINE
  // ==========================================
  private static readonly BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  public generateTotpSecret(byteLength = 20): string {
    const bytes = crypto.randomBytes(byteLength);
    let bits = 0;
    let value = 0;
    let output = '';
    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        output += PlayUpDatabase.BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) {
      output += PlayUpDatabase.BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }
    return output;
  }

  private decodeBase32(secret: string): Buffer {
    const cleaned = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];
    for (let i = 0; i < cleaned.length; i++) {
      const idx = PlayUpDatabase.BASE32_ALPHABET.indexOf(cleaned[i]);
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return Buffer.from(bytes);
  }

  public computeTotpToken(secret: string, counter?: number): string {
    const stepCounter = counter !== undefined ? counter : Math.floor(Date.now() / 1000 / 30);
    const key = this.decodeBase32(secret);
    const buf = Buffer.alloc(8);
    let tmp = stepCounter;
    for (let i = 7; i >= 0; i--) {
      buf[i] = tmp & 0xff;
      tmp = Math.floor(tmp / 256);
    }
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    const otp = binary % 1000000;
    return String(otp).padStart(6, '0');
  }

  public verifyTotpToken(secret: string, code: string, window = 1): boolean {
    const cleanCode = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanCode) || !secret) return false;
    const currentCounter = Math.floor(Date.now() / 1000 / 30);
    for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
      const expected = this.computeTotpToken(secret, currentCounter + errorWindow);
      if (
        expected.length === cleanCode.length &&
        crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(cleanCode, 'utf8'))
      ) {
        return true;
      }
    }
    return false;
  }

  public setupUserTotp(userId: string): {
    secret: string;
    otpauthUrl: string;
    issuer: string;
    accountName: string;
    period: number;
    digits: number;
  } {
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error('Utilisateur introuvable');
    }
    const existingCred = this.getUserCredential(userId) || { passwordHash: '', passwordSalt: '' };
    const secret = this.generateTotpSecret(20);
    this.setUserCredential(userId, {
      ...existingCred,
      totpPendingSecret: secret
    });
    const issuer = 'PlayUp';
    const label = encodeURIComponent(`${issuer}:${user.email}`);
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    return {
      secret,
      otpauthUrl,
      issuer,
      accountName: user.email,
      period: 30,
      digits: 6
    };
  }

  public verifyAndEnableUserTotp(userId: string, code: string): { verified: boolean; user?: AppUser } {
    const user = this.getUserById(userId);
    if (!user) return { verified: false };
    const cred = this.getUserCredential(userId);
    const secretToVerify = cred?.totpPendingSecret || cred?.totpSecret;
    if (!secretToVerify) return { verified: false };
    if (!this.verifyTotpToken(secretToVerify, code)) {
      return { verified: false };
    }

    this.setUserCredential(userId, {
      passwordHash: cred?.passwordHash || '',
      passwordSalt: cred?.passwordSalt || '',
      ...(cred?.resetToken ? { resetToken: cred.resetToken } : {}),
      ...(cred?.resetTokenExpiresAt ? { resetTokenExpiresAt: cred.resetTokenExpiresAt } : {}),
      totpSecret: secretToVerify,
      totpPendingSecret: undefined
    });

    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      users[idx].twoFactorEnabled = true;
      this.setUsers(users);
      return { verified: true, user: users[idx] };
    }
    return { verified: true, user };
  }

  public verifyUserTotp(userId: string, code: string): boolean {
    const cred = this.getUserCredential(userId);
    const secret = cred?.totpSecret || cred?.totpPendingSecret;
    if (!secret) return false;
    return this.verifyTotpToken(secret, code);
  }

  public hasActiveTotpSecret(userId: string): boolean {
    const cred = this.getUserCredential(userId);
    return Boolean(cred?.totpSecret);
  }

  public disableUserTotp(userId: string): AppUser | undefined {
    const cred = this.getUserCredential(userId);
    if (cred) {
      this.setUserCredential(userId, {
        passwordHash: cred.passwordHash || '',
        passwordSalt: cred.passwordSalt || '',
        ...(cred.resetToken ? { resetToken: cred.resetToken } : {}),
        ...(cred.resetTokenExpiresAt ? { resetTokenExpiresAt: cred.resetTokenExpiresAt } : {}),
        totpSecret: undefined,
        totpPendingSecret: undefined
      });
    }
    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      users[idx].twoFactorEnabled = false;
      this.setUsers(users);
      return users[idx];
    }
    return this.getUserById(userId);
  }

  /**
   * Initializes the SQLite relational engine for transactional bootstrap locking (`system_bootstrap`),
   * partial unique constraint (`CREATE UNIQUE INDEX idx_users_single_admin ON users (role) WHERE role = 'ADMIN'`),
   * idempotency (`registration_idempotency`), and post-commit secondary tasks (`pending_secondary_tasks`).
   */
  private initSqliteAuthEngine() {
    this.sqlite = new DatabaseSync(SQLITE_DB_FILE);
    this.sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS system_bootstrap (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        admin_initialized INTEGER NOT NULL DEFAULT 0 CHECK (admin_initialized IN (0, 1)),
        first_admin_user_id TEXT,
        initialized_at TEXT,
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO system_bootstrap (id, admin_initialized, first_admin_user_id, initialized_at, updated_at)
      VALUES (1, 0, NULL, NULL, datetime('now'));

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        uid TEXT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        phone TEXT,
        avatar_url TEXT,
        role TEXT NOT NULL CHECK (role IN ('ADMIN', 'USER')),
        auth_provider TEXT NOT NULL DEFAULT 'email',
        email_verified INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        preferred_currency TEXT NOT NULL DEFAULT 'USD',
        two_factor_enabled INTEGER NOT NULL DEFAULT 0,
        email_notifications INTEGER NOT NULL DEFAULT 1,
        push_notifications_enabled INTEGER NOT NULL DEFAULT 1,
        wallet_balance REAL NOT NULL DEFAULT 0,
        orders_count INTEGER NOT NULL DEFAULT 0,
        total_spent REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL,
        password_hash TEXT,
        password_salt TEXT,
        reset_token TEXT,
        reset_token_expires_at TEXT,
        totp_secret TEXT,
        totp_pending_secret TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_admin
      ON users (role)
      WHERE role = 'ADMIN';

      CREATE TABLE IF NOT EXISTS registration_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        email TEXT NOT NULL COLLATE NOCASE,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('ADMIN', 'USER')),
        is_first_user_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_secondary_tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
        error_message TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS order_refunds (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        buyer_ref TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        user_email TEXT,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        reason TEXT NOT NULL,
        admin_id TEXT,
        refund_method TEXT DEFAULT 'wallet',
        rule_applied TEXT NOT NULL,
        status TEXT NOT NULL,
        payment_transaction_ref TEXT,
        refund_transaction_ref TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        confirmed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS manual_payment_validations (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        buyer_ref TEXT NOT NULL UNIQUE,
        admin_id TEXT NOT NULL,
        admin_email TEXT,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        previous_status TEXT NOT NULL,
        new_status TEXT NOT NULL,
        payment_status TEXT NOT NULL DEFAULT 'payment_verified',
        provider_order_id TEXT,
        timestamp TEXT NOT NULL,
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS order_retry_attempts (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        buyer_ref TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        trigger_type TEXT NOT NULL CHECK (trigger_type IN ('automatic', 'manual_admin')),
        admin_id TEXT,
        timestamp TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'blocked_already_executed', 'escalated_manual_review')),
        result TEXT NOT NULL,
        real_status_checked_before INTEGER NOT NULL DEFAULT 1,
        observed_provider_status TEXT,
        next_retry_delay_minutes INTEGER,
        next_retry_at TEXT
      );

      CREATE TABLE IF NOT EXISTS payment_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'service_order',
        order_id TEXT,
        partner_order_id TEXT,
        game_id TEXT,
        game_name TEXT,
        service_id TEXT,
        service_name TEXT,
        package_id TEXT,
        package_name TEXT,
        product_key TEXT,
        region TEXT,
        player_id TEXT,
        player_name TEXT,
        server_id TEXT,
        game_profile_json TEXT,
        payment_method TEXT NOT NULL CHECK (payment_method IN ('moncash', 'natcash')),
        recipient_number TEXT NOT NULL,
        expected_amount REAL NOT NULL,
        expected_amount_htg REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        stage TEXT NOT NULL DEFAULT 'awaiting_copy',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verifying', 'verified', 'credited', 'rejected', 'refunded', 'manual_review')),
        idempotency_key TEXT UNIQUE,
        request_hash TEXT,
        expires_at TEXT,
        number_copied INTEGER NOT NULL DEFAULT 0,
        copied_at TEXT,
        countdown_duration_seconds INTEGER NOT NULL DEFAULT 69,
        countdown_ends_at TEXT,
        countdown_completed INTEGER NOT NULL DEFAULT 0,
        proof_uploaded INTEGER NOT NULL DEFAULT 0,
        proof_uploaded_at TEXT,
        proof_hash TEXT,
        proof_perceptual_hash TEXT,
        proof_file_path TEXT,
        ocr_detected_transcode TEXT,
        ocr_detected_length INTEGER,
        ocr_detected_amount REAL,
        ocr_detected_method TEXT,
        ocr_raw_json TEXT,
        forensic_raw_json TEXT,
        entered_transcode TEXT,
        verified_transcode TEXT UNIQUE,
        anti_fraud_score INTEGER DEFAULT 0,
        anti_fraud_decision TEXT NOT NULL DEFAULT 'PENDING',
        rejection_reason TEXT,
        credited_transaction_id TEXT UNIQUE,
        credited_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, idempotency_key)
      );

      CREATE TABLE IF NOT EXISTS payment_proofs (
        id TEXT PRIMARY KEY,
        payment_request_id TEXT NOT NULL REFERENCES payment_requests(id) ON DELETE RESTRICT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        file_hash TEXT NOT NULL UNIQUE,
        perceptual_hash TEXT,
        transcode TEXT,
        detected_amount REAL,
        detected_method TEXT,
        detected_datetime TEXT,
        ocr_result TEXT NOT NULL DEFAULT '{}',
        fraud_score INTEGER NOT NULL DEFAULT 0,
        verification_status TEXT NOT NULL DEFAULT 'received' CHECK (
          verification_status IN ('received', 'pending', 'verifying', 'verified', 'credited', 'rejected', 'manual_review')
        ),
        rejection_reason TEXT,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_proofs_one_verified_per_request
        ON payment_proofs (payment_request_id)
        WHERE verification_status IN ('verified', 'credited');

      CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_proofs_validated_transcode
        ON payment_proofs (transcode)
        WHERE verification_status IN ('verified', 'credited')
          AND transcode IS NOT NULL
          AND transcode != '';

      CREATE INDEX IF NOT EXISTS idx_payment_proofs_payment_request_id
        ON payment_proofs (payment_request_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_payment_proofs_user_id
        ON payment_proofs (user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS validated_payments (
        id TEXT PRIMARY KEY,
        payment_request_id TEXT NOT NULL UNIQUE REFERENCES payment_requests(id) ON DELETE RESTRICT,
        payment_proof_id TEXT NOT NULL UNIQUE REFERENCES payment_proofs(id) ON DELETE RESTRICT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        payment_method TEXT NOT NULL CHECK (payment_method IN ('moncash', 'natcash')),
        transcode TEXT NOT NULL UNIQUE CHECK (length(trim(transcode)) >= 6),
        validated_amount REAL NOT NULL CHECK (validated_amount > 0),
        currency TEXT NOT NULL DEFAULT 'HTG' CHECK (currency IN ('HTG', 'USD')),
        validation_source TEXT NOT NULL DEFAULT 'ocr_antifraud' CHECK (validation_source IN ('ocr_antifraud', 'manual_admin')),
        validated_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'validated' CHECK (status IN ('validated', 'credited', 'refunded', 'revoked')),
        validated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(payment_method, transcode)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_validated_payments_active_transcode
        ON validated_payments (transcode)
        WHERE status IN ('validated', 'credited');

      CREATE INDEX IF NOT EXISTS idx_validated_payments_user_id
        ON validated_payments (user_id, validated_at DESC);

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        endpoint TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_status INTEGER,
        response_body TEXT,
        resource_id TEXT REFERENCES payment_requests(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(user_id, endpoint, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_idempotency_keys_resource_id
        ON idempotency_keys (resource_id)
        WHERE resource_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        payment_request_id TEXT REFERENCES payment_requests(id) ON DELETE RESTRICT,
        validated_payment_id TEXT REFERENCES validated_payments(id) ON DELETE RESTRICT,
        type TEXT NOT NULL CHECK (type IN ('deposit', 'debit', 'refund', 'adjustment')),
        amount REAL NOT NULL CHECK (amount > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
        idempotency_key TEXT NOT NULL UNIQUE,
        reference TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_transactions_single_deposit_per_payment
        ON wallet_transactions (payment_request_id)
        WHERE type = 'deposit' AND status = 'completed' AND payment_request_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_transactions_single_refund_per_payment
        ON wallet_transactions (payment_request_id)
        WHERE type = 'refund' AND status = 'completed' AND payment_request_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id
        ON wallet_transactions (user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        payment_request_id TEXT REFERENCES payment_requests(id) ON DELETE RESTRICT,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        idempotency_key TEXT,
        request_id TEXT,
        ip TEXT,
        user_agent TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS used_payment_transcodes (
        transcode TEXT PRIMARY KEY,
        payment_request_id TEXT NOT NULL UNIQUE,
        transaction_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        proof_hash TEXT,
        used_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS used_payment_proofs (
        proof_hash TEXT PRIMARY KEY,
        perceptual_hash TEXT NOT NULL,
        payment_request_id TEXT NOT NULL,
        transaction_id TEXT,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_audit_logs (
        id TEXT PRIMARY KEY,
        payment_request_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_email TEXT,
        order_id TEXT,
        event_type TEXT NOT NULL,
        payment_method TEXT,
        expected_amount REAL,
        detected_amount REAL,
        detected_transcode_masked TEXT,
        entered_transcode_masked TEXT,
        proof_hash TEXT,
        anti_fraud_decision TEXT,
        status_after TEXT,
        summary TEXT NOT NULL,
        details_json TEXT,
        immutable_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_antifraud_incidents (
        id TEXT PRIMARY KEY,
        payment_request_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_email TEXT,
        payment_method TEXT NOT NULL,
        expected_amount REAL NOT NULL,
        detected_amount REAL,
        detected_transcode TEXT,
        entered_transcode TEXT,
        proof_hash TEXT,
        duplicate_of_request_id TEXT,
        risk_score INTEGER NOT NULL,
        decision TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        reason_message TEXT NOT NULL,
        anomalies_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_idempotency_keys (
        idempotency_key TEXT PRIMARY KEY,
        operation_type TEXT NOT NULL,
        user_id TEXT NOT NULL,
        payment_request_id TEXT NOT NULL DEFAULT 'global',
        request_id TEXT NOT NULL,
        nonce TEXT,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
        http_status INTEGER NOT NULL DEFAULT 200,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        expires_at TEXT NOT NULL,
        replay_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(operation_type, user_id, payment_request_id, payload_hash)
      );

      CREATE TABLE IF NOT EXISTS payment_used_nonces (
        nonce TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        payment_request_id TEXT,
        operation_type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        client_timestamp INTEGER NOT NULL,
        server_timestamp INTEGER NOT NULL,
        ip_address TEXT NOT NULL,
        consumed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wallet_credit_locks (
        payment_request_id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        amount REAL NOT NULL,
        transcode TEXT NOT NULL UNIQUE,
        proof_hash TEXT NOT NULL,
        locked_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_security_rate_limits (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        ip_address TEXT NOT NULL,
        session_id TEXT,
        api_key_id TEXT,
        endpoint TEXT NOT NULL,
        bucket_type TEXT NOT NULL,
        request_count INTEGER NOT NULL,
        limit_max INTEGER NOT NULL,
        window_ms INTEGER NOT NULL,
        blocked INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wallet_2fa_challenges (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        operation_type TEXT NOT NULL CHECK (operation_type IN ('wallet_credit', 'wallet_withdrawal')),
        channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
        destination TEXT NOT NULL,
        masked_destination TEXT NOT NULL,
        payment_request_id TEXT,
        amount REAL NOT NULL CHECK (amount > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        code_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'consumed', 'expired', 'locked')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        verification_token TEXT UNIQUE,
        expires_at TEXT NOT NULL,
        verified_at TEXT,
        consumed_at TEXT,
        created_at TEXT NOT NULL
      );

      DROP TRIGGER IF EXISTS prevent_irreversible_payment_state_regression;
      CREATE TRIGGER IF NOT EXISTS prevent_irreversible_payment_state_regression
      BEFORE UPDATE ON payment_requests
      FOR EACH ROW
      BEGIN
        SELECT
          CASE
            WHEN OLD.status = 'credited' AND NEW.status NOT IN ('credited', 'refunded') THEN
              RAISE(ABORT, 'IRREVERSIBLE_STATE_VIOLATION: credited payment cannot revert to pending, verifying, verified, rejected, or manual_review')
            WHEN OLD.status = 'rejected' AND NEW.status != 'rejected' THEN
              RAISE(ABORT, 'IRREVERSIBLE_STATE_VIOLATION: rejected payment is permanently locked')
            WHEN OLD.status = 'refunded' AND NEW.status != 'refunded' THEN
              RAISE(ABORT, 'IRREVERSIBLE_STATE_VIOLATION: refunded payment is permanently locked')
            WHEN OLD.status = 'manual_review' AND NEW.status IN ('pending', 'verifying') THEN
              RAISE(ABORT, 'IRREVERSIBLE_STATE_VIOLATION: manual_review payment cannot revert to pending or verifying')
          END;
      END;
    `);

    // Migrate existing payment_requests table if it was created before 'verifying'/'verified' or idempotency_key columns
    try {
      const prMaster = this.sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payment_requests'`)
        .get() as any;
      if (prMaster?.sql && (!String(prMaster.sql).includes("'verifying'") || !String(prMaster.sql).includes('idempotency_key'))) {
        this.sqlite.exec(`
          DROP TRIGGER IF EXISTS prevent_irreversible_payment_state_regression;
          ALTER TABLE payment_requests RENAME TO payment_requests_legacy_mig;
          CREATE TABLE payment_requests (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            user_email TEXT NOT NULL,
            purpose TEXT NOT NULL DEFAULT 'service_order',
            order_id TEXT,
            partner_order_id TEXT,
            game_id TEXT,
            game_name TEXT,
            service_id TEXT,
            service_name TEXT,
            package_id TEXT,
            package_name TEXT,
            product_key TEXT,
            region TEXT,
            player_id TEXT,
            player_name TEXT,
            server_id TEXT,
            game_profile_json TEXT,
            payment_method TEXT NOT NULL CHECK (payment_method IN ('moncash', 'natcash')),
            recipient_number TEXT NOT NULL,
            expected_amount REAL NOT NULL,
            expected_amount_htg REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            stage TEXT NOT NULL DEFAULT 'awaiting_copy',
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verifying', 'verified', 'credited', 'rejected', 'refunded', 'manual_review')),
            idempotency_key TEXT UNIQUE,
            request_hash TEXT,
            expires_at TEXT,
            number_copied INTEGER NOT NULL DEFAULT 0,
            copied_at TEXT,
            countdown_duration_seconds INTEGER NOT NULL DEFAULT 69,
            countdown_ends_at TEXT,
            countdown_completed INTEGER NOT NULL DEFAULT 0,
            proof_uploaded INTEGER NOT NULL DEFAULT 0,
            proof_uploaded_at TEXT,
            proof_hash TEXT,
            proof_perceptual_hash TEXT,
            proof_file_path TEXT,
            ocr_detected_transcode TEXT,
            ocr_detected_length INTEGER,
            ocr_detected_amount REAL,
            ocr_detected_method TEXT,
            ocr_raw_json TEXT,
            forensic_raw_json TEXT,
            entered_transcode TEXT,
            verified_transcode TEXT UNIQUE,
            anti_fraud_score INTEGER DEFAULT 0,
            anti_fraud_decision TEXT NOT NULL DEFAULT 'PENDING',
            rejection_reason TEXT,
            credited_transaction_id TEXT UNIQUE,
            credited_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, idempotency_key)
          );
          INSERT INTO payment_requests (
            id, user_id, user_email, purpose, order_id, partner_order_id,
            game_id, game_name, service_id, service_name, package_id, package_name,
            product_key, region, player_id, player_name, server_id, game_profile_json,
            payment_method, recipient_number, expected_amount, expected_amount_htg, currency,
            stage, status, number_copied, copied_at, countdown_duration_seconds,
            countdown_ends_at, countdown_completed, proof_uploaded, proof_uploaded_at,
            proof_hash, proof_perceptual_hash, proof_file_path, ocr_detected_transcode,
            ocr_detected_length, ocr_detected_amount, ocr_detected_method, ocr_raw_json,
            forensic_raw_json, entered_transcode, verified_transcode, anti_fraud_score,
            anti_fraud_decision, rejection_reason, credited_transaction_id, credited_at,
            created_at, updated_at
          )
          SELECT
            id, user_id, user_email, purpose, order_id, partner_order_id,
            game_id, game_name, service_id, service_name, package_id, package_name,
            product_key, region, player_id, player_name, server_id, game_profile_json,
            payment_method, recipient_number, expected_amount, expected_amount_htg, currency,
            stage, status, number_copied, copied_at, countdown_duration_seconds,
            countdown_ends_at, countdown_completed, proof_uploaded, proof_uploaded_at,
            proof_hash, proof_perceptual_hash, proof_file_path, ocr_detected_transcode,
            ocr_detected_length, ocr_detected_amount, ocr_detected_method, ocr_raw_json,
            forensic_raw_json, entered_transcode, verified_transcode, anti_fraud_score,
            anti_fraud_decision, rejection_reason, credited_transaction_id, credited_at,
            created_at, updated_at
          FROM payment_requests_legacy_mig;
          DROP TABLE payment_requests_legacy_mig;
          CREATE TRIGGER IF NOT EXISTS prevent_irreversible_payment_state_regression
          BEFORE UPDATE ON payment_requests
          FOR EACH ROW
          BEGIN
            SELECT
              CASE
                WHEN OLD.status = 'credited' AND NEW.status NOT IN ('credited', 'refunded') THEN
                  RAISE(ABORT, 'IRREVERSIBLE_STATE_VIOLATION: credited payment cannot revert to pending, verifying, verified, rejected, or manual_review')
                WHEN OLD.status = 'rejected' AND NEW.status != 'rejected' THEN
                  RAISE(ABORT, 'IRREVERSIBLE_STATE_VIOLATION: rejected payment is permanently locked')
                WHEN OLD.status = 'refunded' AND NEW.status != 'refunded' THEN
                  RAISE(ABORT, 'IRREVERSIBLE_STATE_VIOLATION: refunded payment is permanently locked')
                WHEN OLD.status = 'manual_review' AND NEW.status IN ('pending', 'verifying') THEN
                  RAISE(ABORT, 'IRREVERSIBLE_STATE_VIOLATION: manual_review payment cannot revert to pending or verifying')
              END;
          END;
        `);
      }
    } catch (migErr) {
      console.error('[DB] payment_requests schema migration notice:', migErr);
    }

    // Migrate payment_proofs, wallet_transactions, and audit_logs to latest relational schema + triggers
    try {
      const ppMaster = this.sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payment_proofs'`)
        .get() as any;
      if (ppMaster?.sql && !String(ppMaster.sql).includes("'received'")) {
        this.sqlite.exec(`
          ALTER TABLE payment_proofs RENAME TO payment_proofs_legacy_mig;
          CREATE TABLE payment_proofs (
            id TEXT PRIMARY KEY,
            payment_request_id TEXT NOT NULL REFERENCES payment_requests(id) ON DELETE RESTRICT,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            file_hash TEXT NOT NULL UNIQUE,
            perceptual_hash TEXT,
            transcode TEXT,
            detected_amount REAL,
            detected_method TEXT,
            detected_datetime TEXT,
            ocr_result TEXT NOT NULL DEFAULT '{}',
            fraud_score INTEGER NOT NULL DEFAULT 0,
            verification_status TEXT NOT NULL DEFAULT 'received' CHECK (
              verification_status IN ('received', 'pending', 'verifying', 'verified', 'credited', 'rejected', 'manual_review')
            ),
            rejection_reason TEXT,
            created_at TEXT NOT NULL
          );
          INSERT INTO payment_proofs (
            id, payment_request_id, user_id, file_hash, transcode,
            detected_amount, detected_method, detected_datetime, ocr_result,
            fraud_score, verification_status, created_at
          )
          SELECT
            id, payment_request_id, user_id, file_hash, transcode,
            detected_amount, detected_method, detected_datetime, ocr_result,
            fraud_score, verification_status, created_at
          FROM payment_proofs_legacy_mig;
          DROP TABLE payment_proofs_legacy_mig;
          CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_proofs_one_verified_per_request
            ON payment_proofs (payment_request_id)
            WHERE verification_status IN ('verified', 'credited');
          CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_proofs_validated_transcode
            ON payment_proofs (transcode)
            WHERE verification_status IN ('verified', 'credited')
              AND transcode IS NOT NULL
              AND transcode != '';
        `);
      }

      const vpMaster = this.sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'validated_payments'`)
        .get() as any;
      if (vpMaster?.sql && String(vpMaster.sql).includes('payment_proofs_legacy_mig')) {
        this.sqlite.exec(`
          DROP TABLE IF EXISTS validated_payments;
          CREATE TABLE validated_payments (
            id TEXT PRIMARY KEY,
            payment_request_id TEXT NOT NULL UNIQUE REFERENCES payment_requests(id) ON DELETE RESTRICT,
            payment_proof_id TEXT NOT NULL UNIQUE REFERENCES payment_proofs(id) ON DELETE RESTRICT,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            payment_method TEXT NOT NULL CHECK (payment_method IN ('moncash', 'natcash')),
            transcode TEXT NOT NULL UNIQUE CHECK (length(trim(transcode)) >= 6),
            validated_amount REAL NOT NULL CHECK (validated_amount > 0),
            currency TEXT NOT NULL DEFAULT 'HTG' CHECK (currency IN ('HTG', 'USD')),
            validation_source TEXT NOT NULL DEFAULT 'ocr_antifraud' CHECK (validation_source IN ('ocr_antifraud', 'manual_admin')),
            validated_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
            status TEXT NOT NULL DEFAULT 'validated' CHECK (status IN ('validated', 'credited', 'refunded', 'revoked')),
            validated_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(payment_method, transcode)
          );
          CREATE UNIQUE INDEX IF NOT EXISTS uq_validated_payments_active_transcode
            ON validated_payments (transcode)
            WHERE status IN ('validated', 'credited');
          CREATE INDEX IF NOT EXISTS idx_validated_payments_user_id
            ON validated_payments (user_id, validated_at DESC);
        `);
      }

      const wtCols = this.sqlite.prepare(`PRAGMA table_info(wallet_transactions)`).all() as any[];
      if (!wtCols.some(c => c.name === 'validated_payment_id')) {
        this.sqlite.exec(`ALTER TABLE wallet_transactions ADD COLUMN validated_payment_id TEXT REFERENCES validated_payments(id) ON DELETE RESTRICT;`);
        this.sqlite.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_transactions_single_deposit_per_validated_payment
            ON wallet_transactions (validated_payment_id)
            WHERE type = 'deposit' AND status = 'completed' AND validated_payment_id IS NOT NULL;
        `);
      }

      const alCols = this.sqlite.prepare(`PRAGMA table_info(audit_logs)`).all() as any[];
      if (!alCols.some(c => c.name === 'payment_request_id')) {
        this.sqlite.exec(`ALTER TABLE audit_logs ADD COLUMN payment_request_id TEXT REFERENCES payment_requests(id) ON DELETE RESTRICT;`);
      }

      // Enforce SQL trigger: a wallet deposit linked to a payment_request_id REQUIRES a validated_payments record
      this.sqlite.exec(`
        DROP TRIGGER IF EXISTS trg_require_validated_payment_before_wallet_deposit;
        CREATE TRIGGER trg_require_validated_payment_before_wallet_deposit
        BEFORE INSERT ON wallet_transactions
        FOR EACH ROW
        WHEN NEW.type = 'deposit' AND NEW.payment_request_id IS NOT NULL
        BEGIN
          SELECT
            CASE
              WHEN NOT EXISTS (
                SELECT 1 FROM validated_payments
                WHERE payment_request_id = NEW.payment_request_id
                  AND status IN ('validated', 'credited')
              ) THEN
                RAISE(ABORT, 'SEPARATION_VIOLATION: cannot credit wallet without a validated_payments record (a received payment_proof is never a validated payment)')
            END;
        END;
      `);
    } catch (relMigErr) {
      console.error('[DB] relational payment schema migration notice:', relMigErr);
    }

    // Ensure unique indexes on payment_requests
    try {
      this.sqlite.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_user_idempotency
          ON payment_requests (user_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_idempotency_key
          ON payment_requests (idempotency_key)
          WHERE idempotency_key IS NOT NULL;
      `);
    } catch {
      // ignore
    }

    // Ensure new columns exist on existing order_refunds table if migrated
    for (const colSql of [
      `ALTER TABLE order_refunds ADD COLUMN admin_id TEXT;`,
      `ALTER TABLE order_refunds ADD COLUMN refund_method TEXT DEFAULT 'wallet';`,
      `ALTER TABLE order_refunds ADD COLUMN confirmed_at TEXT;`
    ]) {
      try {
        this.sqlite.exec(colSql);
      } catch {
        // column already exists
      }
    }

    // Ensure totp_secret and totp_pending_secret columns exist on existing SQLite databases
    try {
      this.sqlite.exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT;`);
    } catch {
      // column already exists
    }
    try {
      this.sqlite.exec(`ALTER TABLE users ADD COLUMN totp_pending_secret TEXT;`);
    } catch {
      // column already exists
    }

    // Synchronize existing JSON state with SQLite on startup
    const sqliteUsersCount = (this.sqlite.prepare('SELECT COUNT(*) as cnt FROM users').get() as any)?.cnt || 0;
    const jsonUsers = this.data.users || [];
    if (jsonUsers.length === 0 && sqliteUsersCount > 0 && !this.data.systemBootstrap?.admin_initialized) {
      // JSON was reset externally to 0 users -> reset SQLite tables to match clean state
      this.sqlite.exec(`
        DELETE FROM users;
        DELETE FROM registration_idempotency;
        DELETE FROM pending_secondary_tasks;
        UPDATE system_bootstrap
        SET admin_initialized = 0, first_admin_user_id = NULL, initialized_at = NULL, updated_at = datetime('now')
        WHERE id = 1;
      `);
    } else if (jsonUsers.length > 0 && sqliteUsersCount === 0) {
      this.syncMemoryUsersToSqlite();
    } else {
      this.syncFromSqliteToMemory();
    }
  }

  private syncMemoryUsersToSqlite() {
    if (!this.sqlite) return;
    const upsertStmt = this.sqlite.prepare(`
      INSERT INTO users (
        id, uid, name, email, phone, avatar_url, role, auth_provider, email_verified,
        status, preferred_currency, two_factor_enabled, email_notifications, push_notifications_enabled,
        wallet_balance, orders_count, total_spent, created_at, last_login_at,
        password_hash, password_salt, reset_token, reset_token_expires_at, totp_secret, totp_pending_secret
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        uid = excluded.uid,
        name = excluded.name,
        email = excluded.email,
        phone = excluded.phone,
        avatar_url = excluded.avatar_url,
        status = excluded.status,
        preferred_currency = excluded.preferred_currency,
        two_factor_enabled = excluded.two_factor_enabled,
        email_notifications = excluded.email_notifications,
        push_notifications_enabled = excluded.push_notifications_enabled,
        wallet_balance = excluded.wallet_balance,
        orders_count = excluded.orders_count,
        total_spent = excluded.total_spent,
        last_login_at = excluded.last_login_at,
        password_hash = COALESCE(excluded.password_hash, users.password_hash),
        password_salt = COALESCE(excluded.password_salt, users.password_salt),
        reset_token = excluded.reset_token,
        reset_token_expires_at = excluded.reset_token_expires_at,
        totp_secret = excluded.totp_secret,
        totp_pending_secret = excluded.totp_pending_secret
    `);

    for (const u of this.data.users || []) {
      const cred = this.data.userCredentials?.[u.id];
      upsertStmt.run(
        u.id,
        u.uid || null,
        u.name,
        u.email,
        u.phone || null,
        u.avatarUrl || null,
        u.role === 'ADMIN' ? 'ADMIN' : 'USER',
        u.authProvider || 'email',
        u.emailVerified ? 1 : 0,
        u.status || 'active',
        u.preferredCurrency || 'USD',
        u.twoFactorEnabled ? 1 : 0,
        u.emailNotifications !== false ? 1 : 0,
        u.pushNotificationsEnabled !== false ? 1 : 0,
        Number(u.walletBalance || 0),
        Number(u.ordersCount || 0),
        Number(u.totalSpent || 0),
        u.createdAt || new Date().toISOString(),
        u.lastLoginAt || new Date().toISOString(),
        cred?.passwordHash || null,
        cred?.passwordSalt || null,
        cred?.resetToken || null,
        cred?.resetTokenExpiresAt || null,
        cred?.totpSecret || null,
        cred?.totpPendingSecret || null
      );
    }

    const adminUser = (this.data.users || []).find(u => u.role === 'ADMIN');
    if (adminUser) {
      this.sqlite
        .prepare(
          `UPDATE system_bootstrap SET admin_initialized = 1, first_admin_user_id = COALESCE(first_admin_user_id, ?), initialized_at = COALESCE(initialized_at, ?), updated_at = ? WHERE id = 1`
        )
        .run(adminUser.id, adminUser.createdAt, new Date().toISOString());
    }
  }

  private mapSqliteRowToUser(row: any): AppUser {
    return {
      id: String(row.id),
      ...(row.uid ? { uid: String(row.uid) } : {}),
      name: String(row.name),
      email: String(row.email),
      ...(row.phone ? { phone: String(row.phone) } : {}),
      ...(row.avatar_url ? { avatarUrl: String(row.avatar_url) } : {}),
      role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
      authProvider: row.auth_provider === 'google' ? 'google' : 'email',
      emailVerified: Boolean(row.email_verified),
      status: row.status === 'suspended' ? 'suspended' : 'active',
      preferredCurrency: ['USD', 'HTG', 'EUR'].includes(row.preferred_currency) ? row.preferred_currency : 'USD',
      twoFactorEnabled: Boolean(row.two_factor_enabled),
      emailNotifications: Boolean(row.email_notifications),
      pushNotificationsEnabled: Boolean(row.push_notifications_enabled),
      walletBalance: Number(row.wallet_balance || 0),
      ordersCount: Number(row.orders_count || 0),
      totalSpent: Number(row.total_spent || 0),
      createdAt: String(row.created_at),
      lastLoginAt: String(row.last_login_at)
    };
  }

  public syncFromSqliteToMemory() {
    if (!this.sqlite) return;
    const rows = this.sqlite.prepare('SELECT * FROM users ORDER BY created_at ASC, rowid ASC').all() as any[];
    const creds: Record<string, UserCredentialRecord> = {};
    this.data.users = rows.map(r => {
      if (r.password_hash || r.totp_secret || r.totp_pending_secret) {
        creds[String(r.id)] = {
          passwordHash: r.password_hash ? String(r.password_hash) : '',
          passwordSalt: r.password_salt ? String(r.password_salt) : '',
          ...(r.reset_token ? { resetToken: String(r.reset_token) } : {}),
          ...(r.reset_token_expires_at ? { resetTokenExpiresAt: String(r.reset_token_expires_at) } : {}),
          ...(r.totp_secret ? { totpSecret: String(r.totp_secret) } : {}),
          ...(r.totp_pending_secret ? { totpPendingSecret: String(r.totp_pending_secret) } : {})
        };
      }
      return this.mapSqliteRowToUser(r);
    });
    this.data.userCredentials = creds;

    const bRow = this.sqlite.prepare('SELECT * FROM system_bootstrap WHERE id = 1').get() as any;
    if (bRow) {
      this.data.systemBootstrap = {
        id: 1,
        admin_initialized: Boolean(bRow.admin_initialized),
        first_admin_user_id: bRow.first_admin_user_id ? String(bRow.first_admin_user_id) : null,
        initialized_at: bRow.initialized_at ? String(bRow.initialized_at) : null,
        updated_at: String(bRow.updated_at)
      };
    }

    const taskRows = this.sqlite.prepare('SELECT * FROM pending_secondary_tasks ORDER BY created_at DESC').all() as any[];
    this.data.pendingSecondaryTasks = taskRows.map(t => ({
      id: String(t.id),
      user_id: String(t.user_id),
      task_type: String(t.task_type),
      status: t.status as 'pending' | 'completed' | 'failed',
      ...(t.error_message ? { error_message: String(t.error_message) } : {}),
      attempts: Number(t.attempts || 0),
      created_at: String(t.created_at),
      updated_at: String(t.updated_at)
    }));
  }

  public getSystemBootstrapState(): SystemBootstrapRecord {
    const bRow = this.sqlite.prepare('SELECT * FROM system_bootstrap WHERE id = 1').get() as any;
    return {
      id: 1,
      admin_initialized: Boolean(bRow?.admin_initialized),
      first_admin_user_id: bRow?.first_admin_user_id ? String(bRow.first_admin_user_id) : null,
      initialized_at: bRow?.initialized_at ? String(bRow.initialized_at) : null,
      updated_at: bRow?.updated_at ? String(bRow.updated_at) : new Date().toISOString()
    };
  }

  public getPendingSecondaryTasks(userId?: string): PendingSecondaryTaskRecord[] {
    this.syncFromSqliteToMemory();
    const list = this.data.pendingSecondaryTasks || [];
    return userId ? list.filter(t => t.user_id === userId) : list;
  }

  public retryPendingSecondaryTasks(userId: string): {
    retriedCount: number;
    completedCount: number;
    tasks: PendingSecondaryTaskRecord[];
  } {
    const tasks = this.sqlite
      .prepare(`SELECT * FROM pending_secondary_tasks WHERE user_id = ? AND status != 'completed'`)
      .all(userId) as any[];
    const user = this.getUserById(userId);
    let completedCount = 0;
    const nowIso = new Date().toISOString();

    for (const t of tasks) {
      if (user) {
        this.addUserNotification({
          userId: user.id,
          title: user.role === 'ADMIN' ? 'Bienvenue Administrateur PlayUp' : 'Bienvenue sur PlayUp',
          message:
            user.role === 'ADMIN'
              ? 'Votre compte Premier Administrateur a été initialisé avec succès.'
              : 'Votre compte PlayUp est actif.',
          type: 'info'
        });
      }
      this.sqlite
        .prepare(
          `UPDATE pending_secondary_tasks SET status = 'completed', error_message = NULL, attempts = attempts + 1, updated_at = ? WHERE id = ?`
        )
        .run(nowIso, String(t.id));
      completedCount++;
    }

    this.syncFromSqliteToMemory();
    this.save();
    return {
      retriedCount: tasks.length,
      completedCount,
      tasks: this.getPendingSecondaryTasks(userId)
    };
  }

  /**
   * Deletes a user account (including if the user is ADMIN) WITHOUT ever resetting `system_bootstrap.admin_initialized`.
   * Thus, deleting the ADMIN user never allows a subsequent registration to automatically become ADMIN.
   */
  public deleteUser(userId: string): boolean {
    const res = this.sqlite.prepare('DELETE FROM users WHERE id = ?').run(userId);
    this.syncFromSqliteToMemory();
    this.save();
    if (res.changes > 0) {
      this.addSystemLog(
        'warn',
        'auth',
        `User ${userId} deleted from users table. system_bootstrap.admin_initialized remains ${this.getSystemBootstrapState().admin_initialized}.`
      );
      return true;
    }
    return false;
  }

  /**
   * Controlled full reset of all application user accounts & bootstrap state for clean initialization/testing,
   * without touching games, services, providers, API configurations, or system tables.
   */
  public resetAllUsers(options?: { resetBootstrap?: boolean }): {
    removedUsersCount: number;
    removedCredentialsCount: number;
    remainingUsersCount: number;
    bootstrapAdminInitialized: boolean;
  } {
    this.syncFromSqliteToMemory();
    const removedUsersCount = (this.data.users || []).length;
    const removedCredentialsCount = Object.keys(this.data.userCredentials || {}).length;
    const shouldResetBootstrap = options?.resetBootstrap !== false;

    this.sqlite.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      this.sqlite.exec('DELETE FROM users;');
      this.sqlite.exec('DELETE FROM registration_idempotency;');
      this.sqlite.exec('DELETE FROM pending_secondary_tasks;');
      if (shouldResetBootstrap) {
        this.sqlite
          .prepare(
            `UPDATE system_bootstrap SET admin_initialized = 0, first_admin_user_id = NULL, initialized_at = NULL, updated_at = ? WHERE id = 1`
          )
          .run(new Date().toISOString());
      }
      this.sqlite.exec('COMMIT');
    } catch (err) {
      try {
        this.sqlite.exec('ROLLBACK');
      } catch {}
      throw err;
    }

    this.data.users = [];
    this.data.userCredentials = {};
    this.data.revokedSessionTokens = [];
    this.data.userNotifications = [];
    this.data.pushSubscriptions = [];
    // Rotate HMAC session signing secret so any old session token on any device is immediately invalidated
    this.data.adminToken =
      process.env.PLAYUP_SESSION_SECRET?.trim() ||
      'plup_hmac_' + crypto.randomBytes(32).toString('hex');
    this.syncFromSqliteToMemory();
    this.save();
    this.addSystemLog(
      'info',
      'auth',
      `Database user accounts reset completed: ${removedUsersCount} user(s) removed, 0 remaining, admin_initialized=${this.getSystemBootstrapState().admin_initialized}.`
    );
    return {
      removedUsersCount,
      removedCredentialsCount,
      remainingUsersCount: this.data.users.length,
      bootstrapAdminInitialized: this.getSystemBootstrapState().admin_initialized
    };
  }

  /**
   * Serializes concurrent transaction execution in FIFO order so simultaneous HTTP requests
   * wait cleanly for the active database transaction lock (`BEGIN IMMEDIATE` on `system_bootstrap WHERE id = 1`)
   * to be released via `COMMIT` or `ROLLBACK`.
   */
  private async runWithBootstrapLock<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.txLockChain;
    let releaseLock!: () => void;
    this.txLockChain = new Promise<void>(resolve => {
      releaseLock = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      releaseLock();
    }
  }

  /**
   * Async transactional wrapper around `registerUserAtomic` that queues concurrent requests
   * rather than rejecting them when 20+ simultaneous requests arrive at the same millisecond.
   */
  public async registerUserTransactional(params: {
    name: string;
    email: string;
    password?: string;
    phone?: string;
    preferredCurrency?: 'USD' | 'HTG' | 'EUR';
    authProvider?: 'email' | 'google';
    uid?: string;
    avatarUrl?: string;
    idempotencyKey?: string;
    retryAfterTimeout?: boolean;
    _testFailStage?: BootstrapTestFailStage;
  }): Promise<{
    user: AppUser;
    token: string;
    isFirstUserAdmin: boolean;
    idempotentReplay?: boolean;
    secondaryOperationWarning?: string;
  }> {
    return this.runWithBootstrapLock(() => this.registerUserAtomic(params));
  }

  /**
   * Atomic, database-locked user registration with `system_bootstrap` (id = 1) transaction locking,
   * partial unique index enforcement (`UNIQUE WHERE role = 'ADMIN'`), full `ROLLBACK` on pre-commit failure,
   * idempotency on timeout retries, and isolated post-commit secondary task recovery.
   */
  public registerUserAtomic(params: {
    name: string;
    email: string;
    password?: string;
    phone?: string;
    preferredCurrency?: 'USD' | 'HTG' | 'EUR';
    authProvider?: 'email' | 'google';
    uid?: string;
    avatarUrl?: string;
    idempotencyKey?: string;
    retryAfterTimeout?: boolean;
    _testFailStage?: BootstrapTestFailStage;
  }): {
    user: AppUser;
    token: string;
    isFirstUserAdmin: boolean;
    idempotentReplay?: boolean;
    secondaryOperationWarning?: string;
  } {
    const cleanName = String(params.name || '').trim().slice(0, 80);
    const cleanEmail = String(params.email || '').trim().toLowerCase().slice(0, 160);
    const cleanPhone = params.phone ? String(params.phone).trim().slice(0, 32) : undefined;
    const cleanIdempotencyKey = params.idempotencyKey ? String(params.idempotencyKey).trim().slice(0, 128) : undefined;

    // 1. Check Idempotency Registry BEFORE starting a new write transaction
    if (cleanIdempotencyKey) {
      const existingIdem = this.sqlite
        .prepare('SELECT * FROM registration_idempotency WHERE idempotency_key = ?')
        .get(cleanIdempotencyKey) as any;
      if (existingIdem) {
        const existingUserRow = this.sqlite
          .prepare('SELECT * FROM users WHERE id = ?')
          .get(String(existingIdem.user_id)) as any;
        if (existingUserRow) {
          const existingUser = this.mapSqliteRowToUser(existingUserRow);
          return {
            user: existingUser,
            token: this.generateUserSessionToken(existingUser.id),
            isFirstUserAdmin: Boolean(existingIdem.is_first_user_admin),
            idempotentReplay: true
          };
        }
      }
    }

    // Also handle network timeout retry without explicit idempotency key if retryAfterTimeout is flagged
    if (params.retryAfterTimeout && cleanEmail && params.password) {
      const existingByEmail = this.sqlite
        .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
        .get(cleanEmail) as any;
      if (existingByEmail && this.verifyPassword(String(params.password), String(existingByEmail.id))) {
        const existingUser = this.mapSqliteRowToUser(existingByEmail);
        return {
          user: existingUser,
          token: this.generateUserSessionToken(existingUser.id),
          isFirstUserAdmin: existingUser.role === 'ADMIN',
          idempotentReplay: true
        };
      }
    }

    // Take pre-transaction in-memory snapshot for compensatory consistency on rollback
    const snapshotUsers = JSON.parse(JSON.stringify(this.data.users || []));
    const snapshotCreds = JSON.parse(JSON.stringify(this.data.userCredentials || {}));
    const snapshotBootstrap = this.data.systemBootstrap
      ? JSON.parse(JSON.stringify(this.data.systemBootstrap))
      : undefined;

    let committedUser: AppUser | null = null;
    let committedIsFirstAdmin = false;

    // 2. BEGIN TRANSACTION & lock system_bootstrap (id = 1)
    this.sqlite.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      // Lock and read the single bootstrap row (id = 1) inside the exclusive write transaction
      const bootstrapRow = this.sqlite
        .prepare('SELECT id, admin_initialized, first_admin_user_id FROM system_bootstrap WHERE id = 1')
        .get() as any;
      if (!bootstrapRow) {
        throw new Error('Ressource system_bootstrap (id = 1) introuvable.');
      }

      // Field validation inside transaction
      if (!cleanName || cleanName.length < 2) {
        throw new Error('Le nom complet doit contenir au moins 2 caractères.');
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!cleanEmail || !emailRegex.test(cleanEmail)) {
        throw new Error('Veuillez fournir une adresse email valide.');
      }

      let passwordCred: { hash: string; salt: string } | null = null;
      if (params.authProvider !== 'google') {
        const rawPassword = String(params.password || '');
        if (rawPassword.length < 6) {
          throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
        }
        passwordCred = this.hashPassword(rawPassword);
      }

      const duplicateRow = this.sqlite
        .prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
        .get(cleanEmail) as any;
      if (duplicateRow) {
        throw new Error('Un compte PlayUp existe déjà avec cette adresse email.');
      }

      if (params._testFailStage === 'during_user_creation') {
        throw new Error('Échec critique pendant la création de l’utilisateur (avant insertion).');
      }

      // Role decision strictly from locked system_bootstrap.admin_initialized (NEVER from COUNT(users) = 0)
      let isFirstUser = Number(bootstrapRow.admin_initialized) === 0;
      let assignedRole: 'ADMIN' | 'USER' = isFirstUser ? 'ADMIN' : 'USER';

      const userId = 'usr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
      const nowIso = new Date().toISOString();
      const preferredCurrency =
        params.preferredCurrency && ['USD', 'HTG', 'EUR'].includes(params.preferredCurrency)
          ? params.preferredCurrency
          : 'USD';

      const insertUserStmt = this.sqlite.prepare(`
        INSERT INTO users (
          id, uid, name, email, phone, avatar_url, role, auth_provider, email_verified,
          status, preferred_currency, two_factor_enabled, email_notifications, push_notifications_enabled,
          wallet_balance, orders_count, total_spent, created_at, last_login_at,
          password_hash, password_salt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, 0, 1, 1, 0.0, 0, 0.0, ?, ?, ?, ?)
      `);

      try {
        insertUserStmt.run(
          userId,
          params.uid ? String(params.uid).slice(0, 128) : null,
          cleanName,
          cleanEmail,
          cleanPhone || null,
          params.avatarUrl || null,
          assignedRole,
          params.authProvider === 'google' ? 'google' : 'email',
          preferredCurrency,
          nowIso,
          nowIso,
          passwordCred?.hash || null,
          passwordCred?.salt || null
        );
      } catch (insertErr: any) {
        // Section 6: If the partial unique constraint `idx_users_single_admin` (UNIQUE WHERE role = 'ADMIN') triggers,
        // reload state from database and fall back cleanly to role = 'USER'
        const errMsg = String(insertErr?.message || '');
        if (assignedRole === 'ADMIN' && errMsg.includes('UNIQUE constraint failed') && errMsg.includes('users.role')) {
          this.sqlite
            .prepare(`UPDATE system_bootstrap SET admin_initialized = 1, updated_at = ? WHERE id = 1`)
            .run(nowIso);
          isFirstUser = false;
          assignedRole = 'USER';
          insertUserStmt.run(
            userId,
            params.uid ? String(params.uid).slice(0, 128) : null,
            cleanName,
            cleanEmail,
            cleanPhone || null,
            params.avatarUrl || null,
            'USER',
            params.authProvider === 'google' ? 'google' : 'email',
            preferredCurrency,
            nowIso,
            nowIso,
            passwordCred?.hash || null,
            passwordCred?.salt || null
          );
        } else {
          throw insertErr;
        }
      }

      if (params._testFailStage === 'after_user_creation_before_role') {
        throw new Error('Échec critique après insertion utilisateur mais avant validation du rôle.');
      }

      // If this transaction is initializing the first ADMIN, atomically mark system_bootstrap.admin_initialized = 1
      if (isFirstUser && assignedRole === 'ADMIN') {
        if (params._testFailStage === 'during_bootstrap_init') {
          throw new Error('Échec critique pendant l’initialisation de system_bootstrap.');
        }

        const updateBootstrapRes = this.sqlite
          .prepare(
            `UPDATE system_bootstrap
             SET admin_initialized = 1,
                 first_admin_user_id = ?,
                 initialized_at = ?,
                 updated_at = ?
             WHERE id = 1 AND admin_initialized = 0`
          )
          .run(userId, nowIso, nowIso);

        if (updateBootstrapRes.changes !== 1) {
          throw new Error('Conflit transactionnel sur system_bootstrap : le bootstrap a déjà été initialisé.');
        }
      }

      if (cleanIdempotencyKey) {
        this.sqlite
          .prepare(
            `INSERT INTO registration_idempotency (idempotency_key, email, user_id, role, is_first_user_admin, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(cleanIdempotencyKey, cleanEmail, userId, assignedRole, isFirstUser ? 1 : 0, nowIso);
      }

      if (params._testFailStage === 'before_commit') {
        throw new Error('Échec critique juste avant le COMMIT de la transaction.');
      }

      // 3. COMMIT atomic transaction (releases lock on system_bootstrap)
      this.sqlite.exec('COMMIT');

      const insertedRow = this.sqlite.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
      committedUser = this.mapSqliteRowToUser(insertedRow);
      committedIsFirstAdmin = isFirstUser && assignedRole === 'ADMIN';

      this.syncFromSqliteToMemory();
      this.save();
    } catch (txError: any) {
      // FULL ROLLBACK: undo user creation, role assignment, and system_bootstrap changes
      try {
        this.sqlite.exec('ROLLBACK');
      } catch {
        // transaction already rolled back by SQLite
      }
      this.data.users = snapshotUsers;
      this.data.userCredentials = snapshotCreds;
      if (snapshotBootstrap) {
        this.data.systemBootstrap = snapshotBootstrap;
      }
      this.syncFromSqliteToMemory();
      this.addSystemLog(
        'warn',
        'auth',
        `[Transaction Rollback] Registration aborted and rolled back cleanly (${txError?.message || 'Unknown error'}). admin_initialized=${this.getSystemBootstrapState().admin_initialized}`
      );
      throw txError;
    }

    // 4. POST-COMMIT SECONDARY OPERATIONS (Isolated from critical bootstrap transaction)
    // If a secondary operation fails AFTER commit, we NEVER rollback the committed ADMIN or reset bootstrap;
    // we log the error and record a recoverable secondary task so it can be resumed.
    let secondaryOperationWarning: string | undefined;
    const taskId = 'sectask_' + committedUser.id;
    const nowIso = new Date().toISOString();
    try {
      this.sqlite
        .prepare(
          `INSERT INTO pending_secondary_tasks (id, user_id, task_type, status, attempts, created_at, updated_at)
           VALUES (?, ?, 'welcome_notification_and_audit', 'pending', 1, ?, ?)`
        )
        .run(taskId, committedUser.id, nowIso, nowIso);

      if (params._testFailStage === 'post_commit_secondary') {
        throw new Error('Échec d’une opération secondaire post-commit (notification de bienvenue / audit secondaire).');
      }

      this.addUserNotification({
        userId: committedUser.id,
        title: committedUser.role === 'ADMIN' ? 'Bienvenue Administrateur PlayUp' : 'Bienvenue sur PlayUp',
        message:
          committedUser.role === 'ADMIN'
            ? 'Votre compte Premier Administrateur a été initialisé avec succès.'
            : 'Votre compte PlayUp est actif.',
        type: 'info'
      });

      this.sqlite
        .prepare(`UPDATE pending_secondary_tasks SET status = 'completed', updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), taskId);

      this.addSystemLog(
        'info',
        'auth',
        `User registered: ${committedUser.email} (id=${committedUser.id}, role=${committedUser.role}, admin_initialized=${this.getSystemBootstrapState().admin_initialized})`
      );
    } catch (secErr: any) {
      const errMsgStr = String(secErr?.message || 'Erreur secondaire post-commit enregistrée pour reprise.');
      secondaryOperationWarning = errMsgStr;
      this.sqlite
        .prepare(
          `UPDATE pending_secondary_tasks SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`
        )
        .run(errMsgStr, new Date().toISOString(), taskId);
      this.addSystemLog(
        'error',
        'auth',
        `[Post-Commit Secondary Error] Primary registration committed (${committedUser.email}, role=${committedUser.role}), secondary operation logged for retry: ${secondaryOperationWarning}`
      );
    }

    this.syncFromSqliteToMemory();
    this.save();

    const token = this.generateUserSessionToken(committedUser.id);
    return {
      user: committedUser,
      token,
      isFirstUserAdmin: committedIsFirstAdmin,
      ...(secondaryOperationWarning ? { secondaryOperationWarning } : {})
    };
  }

  public generateUserSessionToken(userId: string): string {
    const nonce = crypto.randomBytes(8).toString('hex');
    const payload = `${userId}.${Date.now()}.${nonce}`;
    const sig = crypto
      .createHmac('sha256', this.data.adminToken || 'playup_secret')
      .update(payload)
      .digest('hex');
    return `plup_usr_${Buffer.from(payload).toString('base64url')}.${sig}`;
  }

  public revokeUserSessionToken(token?: string): boolean {
    if (!token || !token.startsWith('plup_usr_')) return false;
    if (!this.data.revokedSessionTokens) {
      this.data.revokedSessionTokens = [];
    }
    if (!this.data.revokedSessionTokens.includes(token)) {
      this.data.revokedSessionTokens.push(token);
      if (this.data.revokedSessionTokens.length > 500) {
        this.data.revokedSessionTokens = this.data.revokedSessionTokens.slice(-500);
      }
      this.save();
    }
    return true;
  }

  public verifyUserSessionToken(token?: string): AppUser | null {
    if (!token || !token.startsWith('plup_usr_')) return null;
    if (this.data.revokedSessionTokens?.includes(token)) return null;
    try {
      const raw = token.slice('plup_usr_'.length);
      const [b64Payload, sig] = raw.split('.');
      if (!b64Payload || !sig) return null;
      const payload = Buffer.from(b64Payload, 'base64url').toString('utf8');
      const expectedSig = crypto
        .createHmac('sha256', this.data.adminToken || 'playup_secret')
        .update(payload)
        .digest('hex');
      if (sig.length !== expectedSig.length) return null;
      if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
        return null;
      }
      const [userId] = payload.split('.');
      const user = this.getUserById(userId);
      if (!user || user.status === 'suspended') return null;
      if (!user.role) {
        user.role = 'USER';
      }
      return user;
    } catch {
      return null;
    }
  }

  // ==========================================
  // PAYMENT GATEWAYS & TRANSACTIONS
  // ==========================================
  public getPaymentGateways(): PaymentGatewayConfig[] {
    const gateways = this.data.paymentGateways || DEFAULT_PAYMENT_GATEWAYS;
    return gateways.map(gw => {
      const sec = this.data.paymentGatewaySecrets?.[gw.id];
      const hasCreds = gw.slug === 'wallet' ? true : Boolean(sec?.apiKey && sec.apiKey.trim().length > 0);
      return {
        ...gw,
        hasCredentials: hasCreds,
        credentialsMasked:
          gw.slug === 'wallet'
            ? 'Interne PlayUp'
            : hasCreds
            ? this.maskSecretValue(sec?.apiKey)
            : gw.mode === 'sandbox'
            ? 'Mode Sandbox Actif'
            : 'Non configuré'
      };
    });
  }

  public setPaymentGateways(gateways: PaymentGatewayConfig[]) {
    this.data.paymentGateways = gateways;
    this.save();
  }

  public setPaymentGatewaySecret(gatewayId: string, secret: Partial<PaymentGatewaySecretRecord>) {
    if (!this.data.paymentGatewaySecrets) {
      this.data.paymentGatewaySecrets = {};
    }
    const existing = this.data.paymentGatewaySecrets[gatewayId] || {
      apiKey: '',
      clientSecret: '',
      webhookSecret: ''
    };
    this.data.paymentGatewaySecrets[gatewayId] = {
      apiKey: secret.apiKey !== undefined ? secret.apiKey : existing.apiKey,
      clientSecret: secret.clientSecret !== undefined ? secret.clientSecret : existing.clientSecret,
      webhookSecret: secret.webhookSecret !== undefined ? secret.webhookSecret : existing.webhookSecret
    };
    this.save();
  }

  public getPaymentGatewaySecret(gatewayId: string): PaymentGatewaySecretRecord {
    return (
      this.data.paymentGatewaySecrets?.[gatewayId] || {
        apiKey: '',
        clientSecret: '',
        webhookSecret: ''
      }
    );
  }

  public getPaymentTransactions(userId?: string): PaymentTransaction[] {
    const list = this.data.paymentTransactions || [];
    if (userId) {
      return list.filter(t => t.userId === userId);
    }
    return list;
  }

  public addPaymentTransaction(tx: Omit<PaymentTransaction, 'id' | 'createdAt' | 'updatedAt'>): PaymentTransaction {
    if (!this.data.paymentTransactions) {
      this.data.paymentTransactions = [];
    }
    const nowIso = new Date().toISOString();
    const record: PaymentTransaction = {
      ...tx,
      id: 'ptx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      createdAt: nowIso,
      updatedAt: nowIso
    };
    this.data.paymentTransactions.unshift(record);
    if (this.data.paymentTransactions.length > 500) {
      this.data.paymentTransactions = this.data.paymentTransactions.slice(0, 500);
    }

    const gwIdx = (this.data.paymentGateways || []).findIndex(g => g.id === tx.gatewayId || g.slug === tx.paymentMethod);
    if (gwIdx !== -1) {
      this.data.paymentGateways[gwIdx].lastTransactionAt = nowIso;
    }

    this.save();
    return record;
  }

  public findPaymentTransactionByRefOrId(refOrId: string): PaymentTransaction | undefined {
    if (!refOrId) return undefined;
    return (this.data.paymentTransactions || []).find(
      t =>
        t.id === refOrId ||
        t.transactionReference === refOrId ||
        t.externalReference === refOrId ||
        t.orderId === refOrId ||
        t.partnerOrderId === refOrId
    );
  }

  public updatePaymentTransactionStatus(
    refOrId: string,
    newStatus: PaymentTransaction['status'],
    statusMessage?: string,
    orderId?: string,
    partnerOrderId?: string
  ): PaymentTransaction | undefined {
    if (!this.data.paymentTransactions) return undefined;
    const idx = this.data.paymentTransactions.findIndex(
      t =>
        t.id === refOrId ||
        t.transactionReference === refOrId ||
        t.externalReference === refOrId ||
        (orderId && t.orderId === orderId) ||
        (partnerOrderId && t.partnerOrderId === partnerOrderId)
    );
    if (idx === -1) return undefined;

    const current = this.data.paymentTransactions[idx];
    // Idempotency: prevent overwriting terminal payment_refunded
    if (current.status === 'payment_refunded' || current.status === 'refunded') {
      return current;
    }

    const nowIso = new Date().toISOString();
    const mappedLifecycle: PaymentLifecycleStatus =
      newStatus === 'completed' || newStatus === 'payment_succeeded'
        ? 'payment_succeeded'
        : newStatus === 'failed' || newStatus === 'payment_failed'
        ? 'payment_failed'
        : newStatus === 'cancelled' || newStatus === 'payment_cancelled'
        ? 'payment_cancelled'
        : newStatus === 'refunded' || newStatus === 'payment_refunded'
        ? 'payment_refunded'
        : newStatus === 'payment_processing' || newStatus === 'authorized'
        ? 'payment_processing'
        : 'payment_pending';

    this.data.paymentTransactions[idx] = {
      ...current,
      status: newStatus,
      payment_status: mappedLifecycle,
      ...(statusMessage ? { statusMessage } : {}),
      ...(orderId ? { orderId, orderNumber: orderId } : {}),
      ...(partnerOrderId ? { partnerOrderId } : {}),
      updatedAt: nowIso
    };
    this.save();
    return this.data.paymentTransactions[idx];
  }

  public getRefunds(userId?: string): RefundRecord[] {
    const list = this.data.refunds || [];
    if (userId) {
      return list.filter(r => r.userId === userId);
    }
    return list;
  }

  public findRefundByOrderId(orderIdOrBuyerRef: string): RefundRecord | undefined {
    if (!orderIdOrBuyerRef) return undefined;
    try {
      const row = this.sqlite
        ?.prepare('SELECT * FROM order_refunds WHERE order_id = ? OR buyer_ref = ?')
        .get(orderIdOrBuyerRef, orderIdOrBuyerRef) as any;
      if (row) {
        const rawStatus = String(row.status || 'refunded');
        const normalizedRefundStatus: RefundLifecycleStatus =
          rawStatus === 'refunded' || rawStatus === 'completed'
            ? 'refunded'
            : rawStatus === 'refund_pending' || rawStatus === 'pending'
            ? 'refund_pending'
            : 'refund_failed';
        return {
          id: String(row.id),
          refund_id: String(row.id),
          orderId: String(row.order_id),
          buyerRef: String(row.buyer_ref),
          userId: String(row.user_id),
          ...(row.user_email ? { userEmail: String(row.user_email) } : {}),
          amount: Number(row.amount),
          currency: String(row.currency || 'USD'),
          reason: String(row.reason),
          ...(row.admin_id ? { admin_id: String(row.admin_id) } : {}),
          ...(row.refund_method ? { refundMethod: String(row.refund_method) } : {}),
          ruleApplied: row.rule_applied as RefundRecord['ruleApplied'],
          status: (rawStatus === 'completed' ? 'refunded' : rawStatus) as RefundRecord['status'],
          refund_status: normalizedRefundStatus,
          ...(row.payment_transaction_ref ? { paymentTransactionReference: String(row.payment_transaction_ref) } : {}),
          refundTransactionReference: String(row.refund_transaction_ref),
          createdAt: String(row.created_at),
          ...(row.confirmed_at ? { confirmedAt: String(row.confirmed_at) } : {})
        };
      }
    } catch {
      // fallback to memory
    }
    return (this.data.refunds || []).find(
      r => r.orderId === orderIdOrBuyerRef || r.buyerRef === orderIdOrBuyerRef
    );
  }

  /**
   * Checks strict refund eligibility for a PlayUp / RechargeGames order according to official PlayUp rules:
   * - Payment must be received and validated ('payment_succeeded' or 'payment_verified')
   * - Order must NOT already have refund_status === 'refunded'
   * - Order must NOT be in 'payment_pending', 'pending', 'order_pending', or 'sent_to_rechargegames'
   * - Order must NOT have automatic retries remaining unless an admin manually overrides after real status check
   * - Order must NOT be 'delivered' unless RechargeGames explicitly confirmed 'refunded' or authorized admin overrides with verification
   */
  public evaluateRefundEligibility(
    orderIdOrBuyerRef: string,
    options?: {
      isManualAdmin?: boolean;
      providerConfirmedNotDelivered?: boolean;
      providerConfirmedRefunded?: boolean;
    }
  ): {
    eligible: boolean;
    reason: string;
    code:
      | 'ELIGIBLE'
      | 'ORDER_NOT_FOUND'
      | 'ALREADY_REFUNDED'
      | 'REFUND_IN_PROGRESS'
      | 'PAYMENT_NOT_VALIDATED'
      | 'ORDER_STILL_PENDING'
      | 'AUTO_RETRIES_AVAILABLE'
      | 'ORDER_ALREADY_DELIVERED';
    order?: RechargeGamesOrderRecord;
    unifiedOrder?: Order;
    existingRefund?: RefundRecord;
  } {
    const rgOrder =
      this.findRechargeGamesOrderById(orderIdOrBuyerRef) ||
      this.findRechargeGamesOrderByBuyerRef(orderIdOrBuyerRef);
    const unifiedOrder = (this.data.orders || []).find(
      o => o.id === orderIdOrBuyerRef || o.partnerOrderId === orderIdOrBuyerRef
    );

    if (!rgOrder && !unifiedOrder) {
      return {
        eligible: false,
        code: 'ORDER_NOT_FOUND',
        reason: 'Commande introuvable.'
      };
    }

    const existingRefund = this.findRefundByOrderId(
      rgOrder?.id || unifiedOrder?.id || orderIdOrBuyerRef
    );
    if (
      existingRefund &&
      (existingRefund.status === 'refunded' ||
        existingRefund.status === 'completed' ||
        existingRefund.refund_status === 'refunded' ||
        rgOrder?.refund_status === 'refunded')
    ) {
      return {
        eligible: false,
        code: 'ALREADY_REFUNDED',
        reason: `Double remboursement interdit (refund_status == "refunded") : la commande a déjà été remboursée (${existingRefund.refundTransactionReference}).`,
        order: rgOrder,
        unifiedOrder,
        existingRefund
      };
    }

    if (rgOrder?.refund_status === 'refund_pending' || existingRefund?.status === 'refund_pending') {
      return {
        eligible: false,
        code: 'REFUND_IN_PROGRESS',
        reason: 'Un remboursement est déjà en cours de traitement ("refund_pending") pour cette commande.',
        order: rgOrder,
        unifiedOrder,
        existingRefund
      };
    }

    const paymentStatus = rgOrder?.payment_status || unifiedOrder?.payment_status || 'payment_pending';
    const hasValidatedPayment =
      paymentStatus === 'payment_succeeded' ||
      paymentStatus === 'payment_verified' ||
      Boolean(rgOrder?.payment_reference || unifiedOrder?.paymentReference);

    if (!hasValidatedPayment || paymentStatus === 'payment_pending' || paymentStatus === 'payment_failed' || paymentStatus === 'payment_cancelled') {
      return {
        eligible: false,
        code: 'PAYMENT_NOT_VALIDATED',
        reason: `Remboursement interdit : le paiement est en statut "${paymentStatus}" (non reçu ou non validé).`,
        order: rgOrder,
        unifiedOrder
      };
    }

    const ordStatus = String(rgOrder?.status || unifiedOrder?.status || 'pending').toLowerCase();
    const dispatchStatus = String(rgOrder?.dispatch_status || unifiedOrder?.dispatch_status || '').toLowerCase();
    const retryCount = rgOrder?.retry_count ?? unifiedOrder?.retry_count ?? 0;
    const maxRetries = rgOrder?.max_retries ?? unifiedOrder?.max_retries ?? 3;

    if (
      (ordStatus === 'delivered' || ordStatus === 'completed' || rgOrder?.lifecycle_status === 'order_delivered') &&
      !options?.providerConfirmedRefunded
    ) {
      return {
        eligible: false,
        code: 'ORDER_ALREADY_DELIVERED',
        reason: 'Remboursement interdit : une commande "delivered" ne peut jamais être remboursée sans confirmation officielle de remboursement fournisseur.',
        order: rgOrder,
        unifiedOrder
      };
    }

    if (
      (ordStatus === 'pending' ||
        ordStatus === 'order_pending' ||
        ordStatus === 'sent_to_rechargegames' ||
        ordStatus === 'processing') &&
      !options?.providerConfirmedNotDelivered &&
      !options?.providerConfirmedRefunded
    ) {
      return {
        eligible: false,
        code: 'ORDER_STILL_PENDING',
        reason: `Remboursement interdit : la commande est encore en statut "${ordStatus}". Vérifiez d'abord l'état réel auprès de RechargeGames.`,
        order: rgOrder,
        unifiedOrder
      };
    }

    if (
      dispatchStatus === 'pending_retry' &&
      retryCount < maxRetries &&
      !options?.isManualAdmin &&
      !options?.providerConfirmedRefunded
    ) {
      return {
        eligible: false,
        code: 'AUTO_RETRIES_AVAILABLE',
        reason: `Remboursement automatique interdit : une tentative automatique est encore disponible (${retryCount}/${maxRetries} tentatives effectuées).`,
        order: rgOrder,
        unifiedOrder
      };
    }

    return {
      eligible: true,
      code: 'ELIGIBLE',
      reason: 'La commande respecte toutes les règles strictes de remboursement PlayUp.',
      order: rgOrder,
      unifiedOrder
    };
  }

  /**
   * Rule 5 & Request #8: Strict, verifiable, idempotent customer refund engine.
   * - Verifies "refund_status != refunded" and uses atomic SQLite transaction
   * - Transitions through "refund_pending" -> "refunded" (or "refund_failed")
   * - Never declares a refund successful until the refund operation is truly confirmed in DB & wallet/gateway
   * - Records: "refund_id", "amount", "reason", "admin_id", "date/heure", "status"
   */
  public processVerifiableRefund(params: {
    orderId: string;
    buyerRef: string;
    userId: string;
    amount: number;
    currency?: string;
    reason: string;
    adminId?: string;
    adminEmail?: string;
    refundMethod?: PaymentMethodType | string;
    ruleApplied: 'order_definitively_failed' | 'provider_confirmed_refunded' | 'playup_policy_refund' | 'admin_manual_approval';
    currentOrderStatus: string;
    paymentStatus?: string;
    retryCount?: number;
    maxRetries?: number;
    hasRemainingAutoRetries?: boolean;
    paymentMethod?: PaymentMethodType;
    originalPaymentReference?: string;
    simulateRefundFailure?: boolean;
  }): {
    refunded: boolean;
    alreadyRefunded: boolean;
    refundStatus: RefundLifecycleStatus;
    blockedReason?: string;
    refundRecord?: RefundRecord;
    transactionRecord?: PaymentTransaction;
  } {
    const cleanStatus = String(params.currentOrderStatus || '').toLowerCase();
    const rgOrd =
      this.findRechargeGamesOrderById(params.orderId) ||
      this.findRechargeGamesOrderByBuyerRef(params.buyerRef);

    // 1. Check "refund_status != refunded" before any refund operation
    const existingRefund =
      this.findRefundByOrderId(params.orderId) || this.findRefundByOrderId(params.buyerRef);
    if (
      rgOrd?.refund_status === 'refunded' ||
      (existingRefund &&
        (existingRefund.status === 'refunded' ||
          existingRefund.status === 'completed' ||
          existingRefund.refund_status === 'refunded'))
    ) {
      return {
        refunded: false,
        alreadyRefunded: true,
        refundStatus: 'refunded',
        blockedReason: `Protection contre le double remboursement (refund_status == "refunded") : la commande #${params.orderId} (${params.buyerRef}) a déjà un remboursement confirmé (${existingRefund?.refundTransactionReference || rgOrd?.refund_transaction_id}).`,
        refundRecord: existingRefund
      };
    }

    // 2. Block refund if payment is still "payment_pending" or not validated
    const effectivePayStatus = params.paymentStatus || rgOrd?.payment_status || 'payment_succeeded';
    if (
      effectivePayStatus === 'payment_pending' ||
      effectivePayStatus === 'payment_failed' ||
      effectivePayStatus === 'payment_cancelled'
    ) {
      return {
        refunded: false,
        alreadyRefunded: false,
        refundStatus: 'none',
        blockedReason: `Remboursement interdit : le paiement est en statut "${effectivePayStatus}" (non reçu ou non validé).`
      };
    }

    // 3. Strictly block automatic refunds on pending / intermediate orders or when auto-retries are still available
    if (
      cleanStatus === 'pending' ||
      cleanStatus === 'order_pending' ||
      cleanStatus === 'sent_to_rechargegames' ||
      cleanStatus === 'payment_pending' ||
      cleanStatus === 'payment_processing' ||
      cleanStatus === 'processing'
    ) {
      return {
        refunded: false,
        alreadyRefunded: false,
        refundStatus: 'none',
        blockedReason: `Remboursement interdit : la commande est encore en statut "${params.currentOrderStatus}". Vérifiez d'abord l'état réel auprès de RechargeGames.`
      };
    }

    if (
      params.hasRemainingAutoRetries === true &&
      params.ruleApplied !== 'admin_manual_approval' &&
      params.ruleApplied !== 'provider_confirmed_refunded'
    ) {
      return {
        refunded: false,
        alreadyRefunded: false,
        refundStatus: 'none',
        blockedReason: `Remboursement automatique interdit : une tentative automatique de commande est encore disponible.`
      };
    }

    // 4. Block refund if order is already delivered unless provider explicitly confirmed a refund
    if (
      (cleanStatus === 'delivered' || cleanStatus === 'order_delivered' || cleanStatus === 'completed') &&
      params.ruleApplied !== 'provider_confirmed_refunded'
    ) {
      return {
        refunded: false,
        alreadyRefunded: false,
        refundStatus: 'none',
        blockedReason: `Remboursement interdit : une commande "delivered" (#${params.orderId}) ne doit jamais être remboursée automatiquement.`
      };
    }

    const nowIso = new Date().toISOString();
    const refundId = `ref_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const refundTxRef = `REFUND-${params.orderId}-${Date.now().toString().slice(-5)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const amount = Number(Number(params.amount || 0).toFixed(2));
    const currency = params.currency || 'USD';
    const refundMethod = params.refundMethod || params.paymentMethod || 'wallet';
    const adminId = params.adminId || 'system_auto';

    const users = this.getUsers();
    const uIdx = users.findIndex(u => u.id === params.userId || (u.uid && u.uid === params.userId));
    const userEmail = uIdx !== -1 ? users[uIdx].email : undefined;

    // Step A: Transition order to "refund_pending" first (never declare "refunded" before real confirmation!)
    if (rgOrd) {
      rgOrd.refund_status = 'refund_pending';
      rgOrd.updated_at = nowIso;
      this.upsertRechargeGamesOrder(rgOrd);
    }

    // Step B: Atomic / Idempotent insertion in SQLite with initial status 'refund_pending'
    try {
      this.sqlite
        ?.prepare(
          `INSERT INTO order_refunds (
            id, order_id, buyer_ref, user_id, user_email, amount, currency, reason,
            admin_id, refund_method, rule_applied, status, payment_transaction_ref, refund_transaction_ref, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'refund_pending', ?, ?, ?)`
        )
        .run(
          refundId,
          params.orderId,
          params.buyerRef,
          params.userId,
          userEmail || null,
          amount,
          currency,
          params.reason,
          adminId,
          String(refundMethod),
          params.ruleApplied,
          params.originalPaymentReference || null,
          refundTxRef,
          nowIso
        );
    } catch (sqlErr: any) {
      if (String(sqlErr?.message || '').includes('UNIQUE constraint failed')) {
        const currentExisting =
          this.findRefundByOrderId(params.orderId) || this.findRefundByOrderId(params.buyerRef);
        return {
          refunded: false,
          alreadyRefunded: true,
          refundStatus: currentExisting?.refund_status || 'refunded',
          blockedReason: 'Double remboursement simultané bloqué par transaction SQLite idempotente.',
          refundRecord: currentExisting
        };
      }
      throw sqlErr;
    }

    // Step C: Execute the actual refund operation (or fail to 'refund_failed' if execution fails)
    if (params.simulateRefundFailure) {
      try {
        this.sqlite
          ?.prepare(`DELETE FROM order_refunds WHERE id = ?`)
          .run(refundId);
      } catch {
        // ignore
      }
      if (rgOrd) {
        rgOrd.refund_status = 'refund_failed';
        rgOrd.updated_at = new Date().toISOString();
        this.upsertRechargeGamesOrder(rgOrd);
      }
      return {
        refunded: false,
        alreadyRefunded: false,
        refundStatus: 'refund_failed',
        blockedReason: 'L’opération de remboursement a échoué ("refund_failed"). Aucun remboursement n’a été déclaré réussi.'
      };
    }

    // Credit user wallet balance
    if (uIdx !== -1 && amount > 0) {
      users[uIdx].walletBalance = Number((users[uIdx].walletBalance + amount).toFixed(2));
      this.setUsers(users);
    }

    const confirmedIso = new Date().toISOString();

    // Confirm in SQLite: update status from 'refund_pending' -> 'refunded'
    try {
      this.sqlite
        ?.prepare(`UPDATE order_refunds SET status = 'refunded', confirmed_at = ? WHERE id = ?`)
        .run(confirmedIso, refundId);
    } catch {
      // ignore
    }

    // Mark original payment transaction as payment_refunded if present
    if (params.originalPaymentReference) {
      this.updatePaymentTransactionStatus(
        params.originalPaymentReference,
        'payment_refunded',
        `Paiement remboursé (${refundTxRef}) : ${params.reason}`,
        params.orderId,
        params.buyerRef
      );
    }

    // Record refund payment transaction
    const refundTx = this.addPaymentTransaction({
      transactionReference: refundTxRef,
      orderId: params.orderId,
      orderNumber: params.orderId,
      partnerOrderId: params.buyerRef,
      userId: params.userId,
      userEmail,
      gatewayId: 'gw_wallet',
      paymentMethod: params.paymentMethod || 'wallet',
      amount,
      currency,
      feeAmount: 0,
      totalCharged: amount,
      status: 'payment_refunded',
      payment_status: 'payment_refunded',
      externalReference: params.originalPaymentReference,
      statusMessage: `Remboursement confirmé PlayUp (${params.ruleApplied}) : ${params.reason}`
    });

    // Also record in unified ledger transactions
    const ledgerTxs = this.getTransactions();
    ledgerTxs.unshift({
      id: 'tx_ref_' + Date.now(),
      transactionNumber: refundTxRef,
      entityType: 'user',
      entityId: params.userId,
      type: 'refund',
      amount,
      currency,
      orderId: params.orderId,
      note: `Remboursement commande #${params.orderId} (${params.reason})`,
      createdAt: confirmedIso
    });
    this.setTransactions(ledgerTxs);

    const refundRecord: RefundRecord = {
      id: refundId,
      refund_id: refundId,
      orderId: params.orderId,
      buyerRef: params.buyerRef,
      userId: params.userId,
      ...(userEmail ? { userEmail } : {}),
      amount,
      currency,
      reason: params.reason,
      admin_id: adminId,
      ...(params.adminEmail ? { adminEmail: params.adminEmail } : {}),
      refundMethod,
      ruleApplied: params.ruleApplied,
      status: 'refunded',
      refund_status: 'refunded',
      ...(params.originalPaymentReference
        ? { paymentTransactionReference: params.originalPaymentReference }
        : {}),
      refundTransactionReference: refundTxRef,
      createdAt: nowIso,
      confirmedAt: confirmedIso
    };

    if (rgOrd) {
      rgOrd.refund_status = 'refunded';
      rgOrd.payment_status = 'payment_refunded';
      rgOrd.refund_transaction_id = refundTxRef;
      rgOrd.refund_admin_id = adminId;
      rgOrd.refunded_at = confirmedIso;
      rgOrd.refund_reason = params.reason;
      this.upsertRechargeGamesOrder(rgOrd);
    }

    if (!this.data.refunds) {
      this.data.refunds = [];
    }
    this.data.refunds.unshift(refundRecord);
    this.save();

    this.addSystemLog(
      'info',
      'payment',
      `[Verifiable Refund] Commande #${params.orderId} (${params.buyerRef}) remboursée ($${amount.toFixed(2)} ${currency}) — refund_id: ${refundId} — admin_id: ${adminId} — Règle: ${params.ruleApplied} — Raison: ${params.reason}`
    );

    return {
      refunded: true,
      alreadyRefunded: false,
      refundStatus: 'refunded',
      refundRecord,
      transactionRecord: refundTx
    };
  }

  // ==========================================
  // MANUAL PAYMENT VALIDATION & RETRY TRACKING
  // ==========================================
  public recordManualPaymentValidation(record: Omit<ManualPaymentValidationRecord, 'id'>): {
    created: boolean;
    alreadyValidated: boolean;
    record: ManualPaymentValidationRecord;
  } {
    const id = `mpv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const fullRecord: ManualPaymentValidationRecord = {
      id,
      ...record
    };

    try {
      this.sqlite
        ?.prepare(
          `INSERT INTO manual_payment_validations (
            id, order_id, buyer_ref, admin_id, admin_email, amount, currency,
            previous_status, new_status, payment_status, provider_order_id, timestamp, note
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          fullRecord.id,
          fullRecord.order_id,
          fullRecord.buyer_ref,
          fullRecord.admin_id,
          fullRecord.admin_email || null,
          fullRecord.amount,
          fullRecord.currency,
          fullRecord.previous_status,
          fullRecord.new_status,
          fullRecord.payment_status,
          fullRecord.provider_order_id || null,
          fullRecord.timestamp,
          fullRecord.note || null
        );
    } catch (err: any) {
      if (String(err?.message || '').includes('UNIQUE constraint failed')) {
        const existing = this.getManualPaymentValidations(record.order_id)[0] || fullRecord;
        return {
          created: false,
          alreadyValidated: true,
          record: existing
        };
      }
    }

    if (!this.data.manualPaymentValidations) {
      this.data.manualPaymentValidations = [];
    }
    this.data.manualPaymentValidations.unshift(fullRecord);
    this.save();
    return {
      created: true,
      alreadyValidated: false,
      record: fullRecord
    };
  }

  public updateManualPaymentValidationStatus(orderId: string, newStatus: string, providerOrderId?: string) {
    try {
      this.sqlite
        ?.prepare(
          `UPDATE manual_payment_validations SET new_status = ?, provider_order_id = COALESCE(?, provider_order_id) WHERE order_id = ?`
        )
        .run(newStatus, providerOrderId || null, orderId);
    } catch {
      // ignore
    }
    if (this.data.manualPaymentValidations) {
      const idx = this.data.manualPaymentValidations.findIndex(v => v.order_id === orderId);
      if (idx !== -1) {
        this.data.manualPaymentValidations[idx].new_status = newStatus;
        if (providerOrderId) {
          this.data.manualPaymentValidations[idx].provider_order_id = providerOrderId;
        }
        this.save();
      }
    }
  }

  public getManualPaymentValidations(orderIdOrBuyerRef?: string): ManualPaymentValidationRecord[] {
    const list = this.data.manualPaymentValidations || [];
    if (orderIdOrBuyerRef) {
      return list.filter(v => v.order_id === orderIdOrBuyerRef || v.buyer_ref === orderIdOrBuyerRef);
    }
    return list;
  }

  public recordOrderRetryAttempt(attempt: Omit<OrderRetryAttemptRecord, 'id'>): OrderRetryAttemptRecord {
    const id = `rtry_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const fullAttempt: OrderRetryAttemptRecord = {
      id,
      ...attempt
    };
    try {
      this.sqlite
        ?.prepare(
          `INSERT INTO order_retry_attempts (
            id, order_id, buyer_ref, attempt_number, trigger_type, admin_id,
            timestamp, reason, status, result, real_status_checked_before,
            observed_provider_status, next_retry_delay_minutes, next_retry_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          fullAttempt.id,
          fullAttempt.order_id,
          fullAttempt.buyer_ref,
          fullAttempt.attempt_number,
          fullAttempt.trigger_type,
          fullAttempt.admin_id || null,
          fullAttempt.timestamp,
          fullAttempt.reason,
          fullAttempt.status,
          fullAttempt.result,
          fullAttempt.real_status_checked_before ? 1 : 0,
          fullAttempt.observed_provider_status || null,
          fullAttempt.next_retry_delay_minutes ?? null,
          fullAttempt.next_retry_at || null
        );
    } catch {
      // fallback to memory
    }
    if (!this.data.orderRetryAttempts) {
      this.data.orderRetryAttempts = [];
    }
    this.data.orderRetryAttempts.unshift(fullAttempt);
    if (this.data.orderRetryAttempts.length > 500) {
      this.data.orderRetryAttempts = this.data.orderRetryAttempts.slice(0, 500);
    }
    this.save();
    return fullAttempt;
  }

  public getOrderRetryAttempts(orderIdOrBuyerRef?: string): OrderRetryAttemptRecord[] {
    const list = this.data.orderRetryAttempts || [];
    if (orderIdOrBuyerRef) {
      return list.filter(a => a.order_id === orderIdOrBuyerRef || a.buyer_ref === orderIdOrBuyerRef);
    }
    return list;
  }

  // ==========================================
  // RECHARGEGAMES TABLES & MARGIN ENGINE
  // ==========================================
  public getRechargeGamesMode(): RechargeGamesMode {
    return this.data.rechargeGamesMode || 'TEST';
  }

  public setRechargeGamesMode(mode: RechargeGamesMode) {
    this.data.rechargeGamesMode = mode;
    const pIdx = this.data.providers.findIndex(p => p.id === 'prov_rechargegames');
    if (pIdx !== -1) {
      this.data.providers[pIdx].environment = mode === 'PRODUCTION' ? 'production' : 'sandbox';
    }
    this.save();
  }

  public getRechargeGamesBaseUrl(): string {
    if (process.env.RECHARGEGAMES_BASE_URL && process.env.RECHARGEGAMES_BASE_URL.trim().length > 0) {
      return process.env.RECHARGEGAMES_BASE_URL.trim().replace(/\/+$/, '');
    }
    return (this.data.rechargeGamesBaseUrl || 'https://api.rechargegame.games').replace(/\/+$/, '');
  }

  public setRechargeGamesBaseUrl(url: string) {
    const clean = url.trim().replace(/\/+$/, '');
    this.data.rechargeGamesBaseUrl = clean;
    const pIdx = this.data.providers.findIndex(p => p.id === 'prov_rechargegames');
    if (pIdx !== -1) {
      this.data.providers[pIdx].apiUrl = clean;
    }
    this.save();
  }

  public getRechargeGamesMargins(): RechargeGamesMarginConfig {
    return (
      this.data.rechargeGamesMargins || {
        globalMarginPercent: 20,
        gameMargins: {},
        regionMargins: {},
        productMargins: {},
        updatedAt: new Date().toISOString()
      }
    );
  }

  /**
   * Computes final PlayUp customer price from RechargeGames provider_price using server-side margin rules
   * Precedence: productMargins[product_key] > regionMargins[region] > gameMargins[game] > globalMarginPercent
   */
  public computePlayUpMarginAndPrice(
    providerPrice: number,
    game: string,
    region: string,
    productKey: string
  ): { marginPercent: number; playupPrice: number; profit: number } {
    const margins = this.getRechargeGamesMargins();
    let marginPercent = margins.globalMarginPercent ?? 20;

    if (game && typeof margins.gameMargins?.[game] === 'number') {
      marginPercent = margins.gameMargins[game];
    }
    if (region && typeof margins.regionMargins?.[region] === 'number') {
      marginPercent = margins.regionMargins[region];
    }
    if (productKey && typeof margins.productMargins?.[productKey] === 'number') {
      marginPercent = margins.productMargins[productKey];
    }

    const safeProviderPrice = Math.max(0, Number(providerPrice) || 0);
    const playupPrice = Number((safeProviderPrice * (1 + marginPercent / 100)).toFixed(2));
    const profit = Number((playupPrice - safeProviderPrice).toFixed(2));

    return { marginPercent, playupPrice, profit };
  }

  public setRechargeGamesMargins(config: Partial<RechargeGamesMarginConfig>): RechargeGamesMarginConfig {
    const current = this.getRechargeGamesMargins();
    const updated: RechargeGamesMarginConfig = {
      globalMarginPercent:
        typeof config.globalMarginPercent === 'number' ? config.globalMarginPercent : current.globalMarginPercent,
      gameMargins: config.gameMargins !== undefined ? config.gameMargins : current.gameMargins,
      regionMargins: config.regionMargins !== undefined ? config.regionMargins : current.regionMargins,
      productMargins: config.productMargins !== undefined ? config.productMargins : current.productMargins,
      updatedAt: new Date().toISOString()
    };
    this.data.rechargeGamesMargins = updated;

    // Recalculate playup_price for all stored RechargeGames products immediately
    if (this.data.rechargeGamesProducts && this.data.rechargeGamesProducts.length > 0) {
      this.data.rechargeGamesProducts = this.data.rechargeGamesProducts.map(prod => {
        const calc = this.computePlayUpMarginAndPrice(prod.provider_price, prod.game, prod.region, prod.product_key);
        return {
          ...prod,
          margin_percent: calc.marginPercent,
          playup_price: calc.playupPrice,
          profit_estimate: calc.profit
        };
      });
    }

    this.save();
    return updated;
  }

  // Table: products
  public getRechargeGamesProducts(filters?: { game?: string; region?: string; activeOnly?: boolean }): RechargeGamesProduct[] {
    let list = this.data.rechargeGamesProducts || [];
    if (filters?.activeOnly) {
      list = list.filter(p => p.active);
    }
    if (filters?.game && filters.game !== 'all') {
      const gLower = filters.game.toLowerCase();
      list = list.filter(
        p => p.game.toLowerCase() === gLower || (p.game_slug && p.game_slug.toLowerCase() === gLower)
      );
    }
    if (filters?.region && filters.region !== 'all') {
      const rLower = filters.region.toLowerCase();
      list = list.filter(p => p.region.toLowerCase() === rLower);
    }
    return list;
  }

  public getRechargeGamesProductByKey(productKey: string): RechargeGamesProduct | undefined {
    return (this.data.rechargeGamesProducts || []).find(
      p => p.product_key === productKey || p.id === productKey
    );
  }

  public setRechargeGamesProducts(products: RechargeGamesProduct[]) {
    this.data.rechargeGamesProducts = products.map(p => {
      const calc = this.computePlayUpMarginAndPrice(p.provider_price, p.game, p.region, p.product_key);
      return {
        ...p,
        provider: 'rechargegames',
        margin_percent: calc.marginPercent,
        playup_price: calc.playupPrice,
        profit_estimate: calc.profit
      };
    });
    this.save();
  }

  public getRechargeGamesSyncStats(): RechargeGamesSyncStats {
    const prods = this.data.rechargeGamesProducts || [];
    const activeCount = prods.filter(p => p.active).length;
    const unavailableCount = prods.filter(p => !p.active).length;
    const regions = Array.from(new Set(prods.map(p => p.region).filter(Boolean)));
    const games = Array.from(new Set(prods.map(p => p.game).filter(Boolean)));
    const stored = this.data.rechargeGamesSyncStats || {
      lastSyncedAt: null,
      totalProducts: 0,
      activeProducts: 0,
      unavailableProducts: 0,
      regionsAvailable: ['Brazil', 'USA', 'Global'],
      gamesAvailable: [],
      syncErrors: [],
      autoSyncEnabled: true,
      autoSyncIntervalMinutes: 30
    };
    return {
      ...stored,
      totalProducts: prods.length,
      activeProducts: activeCount,
      unavailableProducts: unavailableCount,
      regionsAvailable: regions.length > 0 ? regions : ['Brazil', 'USA', 'Global'],
      gamesAvailable: games
    };
  }

  public updateRechargeGamesSyncStats(partial: Partial<RechargeGamesSyncStats>) {
    const current = this.getRechargeGamesSyncStats();
    this.data.rechargeGamesSyncStats = {
      ...current,
      ...partial
    };
    this.save();
  }

  /**
   * Generates a strictly unique buyer_ref in the official format: PLAYUP-YYYYMMDD-XXXXXX
   * Example: PLAYUP-20261005-000001
   */
  public generateNextBuyerRef(): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const datePart = `${yyyy}${mm}${dd}`;

    if (typeof this.data.rechargeGamesBuyerRefCounter !== 'number') {
      this.data.rechargeGamesBuyerRefCounter = (this.data.rechargeGamesOrders || []).length;
    }

    let candidate = '';
    do {
      this.data.rechargeGamesBuyerRefCounter += 1;
      const seq = String(this.data.rechargeGamesBuyerRefCounter).padStart(6, '0');
      candidate = `PLAYUP-${datePart}-${seq}`;
    } while (this.findRechargeGamesOrderByBuyerRef(candidate));

    this.save();
    return candidate;
  }

  // Table: orders (RechargeGamesOrderRecord)
  public getRechargeGamesOrders(userId?: string): RechargeGamesOrderRecord[] {
    const list = this.data.rechargeGamesOrders || [];
    if (userId) {
      return list.filter(o => o.user_id === userId);
    }
    return list;
  }

  public findRechargeGamesOrderById(idOrProviderOrderId: string): RechargeGamesOrderRecord | undefined {
    return (this.data.rechargeGamesOrders || []).find(
      o =>
        o.id === idOrProviderOrderId ||
        o.provider_order_id === idOrProviderOrderId ||
        o.buyer_ref === idOrProviderOrderId
    );
  }

  public findRechargeGamesOrderByBuyerRef(buyerRef: string): RechargeGamesOrderRecord | undefined {
    return (this.data.rechargeGamesOrders || []).find(o => o.buyer_ref === buyerRef);
  }

  public upsertRechargeGamesOrder(order: RechargeGamesOrderRecord): RechargeGamesOrderRecord {
    if (!this.data.rechargeGamesOrders) {
      this.data.rechargeGamesOrders = [];
    }
    const idx = this.data.rechargeGamesOrders.findIndex(
      o => o.id === order.id || o.buyer_ref === order.buyer_ref
    );
    if (idx !== -1) {
      this.data.rechargeGamesOrders[idx] = {
        ...this.data.rechargeGamesOrders[idx],
        ...order,
        updated_at: new Date().toISOString()
      };
    } else {
      this.data.rechargeGamesOrders.unshift(order);
    }
    this.save();
    return order;
  }

  // Table: webhook_events
  public getRechargeGamesWebhookEvents(): RechargeGamesWebhookEvent[] {
    return this.data.webhookEvents || [];
  }

  public hasProcessedRechargeGamesWebhookEvent(eventId: string): boolean {
    if (!eventId) return false;
    if (this.data.firestoreWebhookIdempotencyLocks?.[eventId]) {
      return true;
    }
    return (this.data.webhookEvents || []).some(
      e => e.event_id === eventId && e.processing_status === 'processed'
    );
  }

  public getFirestoreWebhookLock(eventId: string): FirestoreWebhookIdempotencyRecord | undefined {
    if (!eventId) return undefined;
    return this.data.firestoreWebhookIdempotencyLocks?.[eventId];
  }

  public getAllFirestoreWebhookLocks(): FirestoreWebhookIdempotencyRecord[] {
    return Object.values(this.data.firestoreWebhookIdempotencyLocks || {});
  }

  public saveFirestoreWebhookLock(record: FirestoreWebhookIdempotencyRecord): FirestoreWebhookIdempotencyRecord {
    if (!this.data.firestoreWebhookIdempotencyLocks) {
      this.data.firestoreWebhookIdempotencyLocks = {};
    }
    this.data.firestoreWebhookIdempotencyLocks[record.eventId] = record;
    this.save();
    return record;
  }

  public addRechargeGamesWebhookEvent(event: RechargeGamesWebhookEvent): RechargeGamesWebhookEvent {
    if (!this.data.webhookEvents) {
      this.data.webhookEvents = [];
    }
    const sanitized: RechargeGamesWebhookEvent = {
      ...event,
      payload_preview: event.payload_preview ? String(this.sanitizeForLogs(event.payload_preview)) : undefined,
      error_message: event.error_message ? String(this.sanitizeForLogs(event.error_message)) : undefined
    };
    this.data.webhookEvents.unshift(sanitized);
    if (this.data.webhookEvents.length > 300) {
      this.data.webhookEvents = this.data.webhookEvents.slice(0, 300);
    }
    this.save();
    return sanitized;
  }

  // ==========================================================================
  // PUSH SUBSCRIPTIONS, PUSH NOTIFICATION LOGS & EMAIL DELIVERY LOGS
  // ==========================================================================

  public getPushSubscriptions(userId?: string): PushSubscriptionRecord[] {
    const subs = this.data.pushSubscriptions || [];
    if (userId) {
      return subs.filter(s => s.userId === userId && s.active);
    }
    return subs;
  }

  public upsertPushSubscription(sub: Omit<PushSubscriptionRecord, 'id' | 'createdAt' | 'lastSeenAt'>): PushSubscriptionRecord {
    if (!this.data.pushSubscriptions) {
      this.data.pushSubscriptions = [];
    }
    const now = new Date().toISOString();
    const existingIdx = this.data.pushSubscriptions.findIndex(
      s => s.userId === sub.userId && s.endpoint === sub.endpoint
    );
    if (existingIdx !== -1) {
      this.data.pushSubscriptions[existingIdx] = {
        ...this.data.pushSubscriptions[existingIdx],
        ...sub,
        active: true,
        lastSeenAt: now
      };
      this.save();
      return this.data.pushSubscriptions[existingIdx];
    }
    const created: PushSubscriptionRecord = {
      ...sub,
      id: 'psub_' + crypto.randomUUID().slice(0, 12),
      createdAt: now,
      lastSeenAt: now
    };
    this.data.pushSubscriptions.unshift(created);
    this.save();
    return created;
  }

  public removePushSubscription(userId: string, endpoint?: string): void {
    if (!this.data.pushSubscriptions) return;
    this.data.pushSubscriptions = this.data.pushSubscriptions.filter(
      s => !(s.userId === userId && (!endpoint || s.endpoint === endpoint))
    );
    this.save();
  }

  public hasOrderDeliveryNotificationBeenSent(orderId: string): boolean {
    if (!orderId) return false;
    return (this.data.processedOrderDeliveries || []).includes(orderId);
  }

  public markOrderDeliveryNotificationSent(orderId: string): void {
    if (!orderId) return;
    if (!this.data.processedOrderDeliveries) {
      this.data.processedOrderDeliveries = [];
    }
    if (!this.data.processedOrderDeliveries.includes(orderId)) {
      this.data.processedOrderDeliveries.unshift(orderId);
      if (this.data.processedOrderDeliveries.length > 2000) {
        this.data.processedOrderDeliveries.pop();
      }
      this.save();
    }
  }

  public getPushNotificationLogs(userId?: string): PushNotificationLog[] {
    const logs = this.data.pushNotificationLogs || [];
    if (userId) {
      return logs.filter(l => l.userId === userId);
    }
    return logs;
  }

  public addPushNotificationLog(entry: Omit<PushNotificationLog, 'id' | 'createdAt'>): PushNotificationLog {
    if (!this.data.pushNotificationLogs) {
      this.data.pushNotificationLogs = [];
    }
    const record: PushNotificationLog = {
      ...entry,
      id: 'push_' + crypto.randomUUID().slice(0, 12),
      createdAt: new Date().toISOString()
    };
    this.data.pushNotificationLogs.unshift(record);
    if (this.data.pushNotificationLogs.length > 500) {
      this.data.pushNotificationLogs.pop();
    }
    this.save();
    return record;
  }

  public markPushNotificationsDeliveredForUser(userId: string): PushNotificationLog[] {
    if (!this.data.pushNotificationLogs) return [];
    const now = new Date().toISOString();
    const pending: PushNotificationLog[] = [];
    for (const log of this.data.pushNotificationLogs) {
      if (log.userId === userId && (log.status === 'queued_offline' || log.status === 'sent')) {
        log.status = 'delivered_to_device';
        log.deliveredAt = now;
        pending.push(log);
      }
    }
    if (pending.length > 0) {
      this.save();
    }
    return pending;
  }

  public getEmailDeliveryLogs(userId?: string): EmailDeliveryLog[] {
    const logs = this.data.emailDeliveryLogs || [];
    if (userId) {
      return logs.filter(l => l.userId === userId);
    }
    return logs;
  }

  public addEmailDeliveryLog(entry: Omit<EmailDeliveryLog, 'id' | 'createdAt'>): EmailDeliveryLog {
    if (!this.data.emailDeliveryLogs) {
      this.data.emailDeliveryLogs = [];
    }
    const record: EmailDeliveryLog = {
      ...entry,
      id: 'mail_' + crypto.randomUUID().slice(0, 12),
      createdAt: new Date().toISOString()
    };
    this.data.emailDeliveryLogs.unshift(record);
    if (this.data.emailDeliveryLogs.length > 500) {
      this.data.emailDeliveryLogs.pop();
    }
    this.save();
    return record;
  }

  // ==========================================================================
  // REAL MONCASH / NATCASH PERSISTENT PAYMENT REQUESTS, OCR & ANTI-FRAUD ENGINE
  // ==========================================================================

  public maskTranscode(code?: string | null): string {
    if (!code) return 'Non détecté';
    const clean = String(code).trim();
    if (clean.length <= 6) return '••••••';
    return `${clean.slice(0, 3)}••••••${clean.slice(-3)} (${clean.length} chiffres)`;
  }

  public computeRemainingCountdownSeconds(reqRecord: PaymentRequestRecord): PaymentRequestRecord {
    const copy = { ...reqRecord };
    if (copy.number_copied && copy.countdown_ends_at) {
      const endsMs = new Date(copy.countdown_ends_at).getTime();
      const diffSec = Math.max(0, Math.ceil((endsMs - Date.now()) / 1000));
      copy.countdown_remaining_seconds = diffSec;
      if (diffSec === 0 && !copy.countdown_completed) {
        copy.countdown_completed = true;
        if (copy.stage === 'countdown_active') {
          copy.stage = 'awaiting_proof';
        }
      }
    } else {
      copy.countdown_remaining_seconds = copy.countdown_duration_seconds || 69;
    }
    return copy;
  }

  /**
   * Sanitizes a PaymentRequestRecord before returning to the frontend so the raw OCR-detected
   * transcode is NEVER leaked to the client before verification.
   */
  public sanitizePaymentRequestForClient(reqRecord: PaymentRequestRecord): PaymentRequestRecord {
    const withTimer = this.computeRemainingCountdownSeconds(reqRecord);
    const sanitized: PaymentRequestRecord = {
      ...withTimer,
      ocr_extraction: withTimer.ocr_extraction
        ? {
            ...withTimer.ocr_extraction,
            detectedTranscode: undefined,
            transcodeMasked: withTimer.ocr_extraction.transcodeDetected
              ? `Détecté automatiquement (${withTimer.detected_transcode_length || 0} caractères)`
              : 'Non détecté'
          }
        : undefined
    };
    return sanitized;
  }

  public getPaymentRequests(userId?: string): PaymentRequestRecord[] {
    const list = this.data.paymentRequests || [];
    const filtered = userId ? list.filter(r => r.user_id === userId) : list;
    return filtered.map(r => this.computeRemainingCountdownSeconds(r));
  }

  public getPaymentRequestById(requestId: string): PaymentRequestRecord | undefined {
    const found = (this.data.paymentRequests || []).find(r => r.id === requestId);
    if (!found) return undefined;
    return this.computeRemainingCountdownSeconds(found);
  }

  /**
   * Finds the user's active (pending / non-terminal) payment request so refreshing the page,
   * closing the browser temporarily, or returning from MonCash/NatCash restores the exact session.
   */
  public getActivePaymentRequestForUser(
    userId: string,
    filters?: { packageId?: string; purpose?: 'service_order' | 'wallet_topup' }
  ): PaymentRequestRecord | undefined {
    const list = this.data.paymentRequests || [];
    const active = list.find(r => {
      if (r.user_id !== userId) return false;
      if (r.status !== 'pending') return false;
      if (filters?.purpose && r.purpose !== filters.purpose) return false;
      if (filters?.packageId && r.package_id !== filters.packageId) return false;
      return true;
    });
    return active ? this.computeRemainingCountdownSeconds(active) : undefined;
  }

  public setServerDetectedTranscode(requestId: string, detectedTranscode: string | null) {
    if (!this.data.paymentRequestOcrSecrets) {
      this.data.paymentRequestOcrSecrets = {};
    }
    if (detectedTranscode) {
      this.data.paymentRequestOcrSecrets[requestId] = detectedTranscode;
    } else {
      delete this.data.paymentRequestOcrSecrets[requestId];
    }
    try {
      this.sqlite
        ?.prepare(`UPDATE payment_requests SET ocr_detected_transcode = ?, ocr_detected_length = ? WHERE id = ?`)
        .run(detectedTranscode || null, detectedTranscode ? detectedTranscode.length : null, requestId);
    } catch {
      // ignore
    }
    this.save();
  }

  public getServerDetectedTranscode(requestId: string): string | null {
    try {
      const row = this.sqlite
        ?.prepare(`SELECT ocr_detected_transcode FROM payment_requests WHERE id = ?`)
        .get(requestId) as any;
      if (row && row.ocr_detected_transcode) {
        return String(row.ocr_detected_transcode);
      }
    } catch {
      // fallback to memory
    }
    return this.data.paymentRequestOcrSecrets?.[requestId] || null;
  }

  public upsertPaymentRequest(record: PaymentRequestRecord): PaymentRequestRecord {
    if (!this.data.paymentRequests) {
      this.data.paymentRequests = [];
    }
    const nowIso = new Date().toISOString();
    const updated: PaymentRequestRecord = {
      ...record,
      updated_at: nowIso
    };
    const idx = this.data.paymentRequests.findIndex(r => r.id === updated.id);
    if (idx !== -1) {
      this.data.paymentRequests[idx] = updated;
    } else {
      this.data.paymentRequests.unshift(updated);
    }

    try {
      const secretTranscode = this.data.paymentRequestOcrSecrets?.[updated.id] || null;
      const defaultExpires = updated.expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString();
      this.sqlite
        ?.prepare(
          `INSERT INTO payment_requests (
            id, user_id, user_email, purpose, order_id, partner_order_id,
            game_id, game_name, service_id, service_name, package_id, package_name,
            product_key, region, player_id, player_name, server_id, game_profile_json,
            payment_method, recipient_number, expected_amount, expected_amount_htg, currency,
            stage, status, idempotency_key, request_hash, expires_at,
            number_copied, copied_at, countdown_duration_seconds,
            countdown_ends_at, countdown_completed, proof_uploaded, proof_uploaded_at,
            proof_hash, proof_perceptual_hash, proof_file_path, ocr_detected_transcode,
            ocr_detected_length, ocr_detected_amount, ocr_detected_method, ocr_raw_json,
            forensic_raw_json, entered_transcode, verified_transcode, anti_fraud_score,
            anti_fraud_decision, rejection_reason, credited_transaction_id, credited_at,
            created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?
          )
          ON CONFLICT(id) DO UPDATE SET
            payment_method = excluded.payment_method,
            recipient_number = excluded.recipient_number,
            stage = excluded.stage,
            status = excluded.status,
            idempotency_key = COALESCE(payment_requests.idempotency_key, excluded.idempotency_key),
            request_hash = COALESCE(payment_requests.request_hash, excluded.request_hash),
            expires_at = COALESCE(payment_requests.expires_at, excluded.expires_at),
            number_copied = excluded.number_copied,
            copied_at = excluded.copied_at,
            countdown_ends_at = excluded.countdown_ends_at,
            countdown_completed = excluded.countdown_completed,
            proof_uploaded = excluded.proof_uploaded,
            proof_uploaded_at = excluded.proof_uploaded_at,
            proof_hash = excluded.proof_hash,
            proof_perceptual_hash = excluded.proof_perceptual_hash,
            proof_file_path = excluded.proof_file_path,
            ocr_detected_transcode = COALESCE(excluded.ocr_detected_transcode, payment_requests.ocr_detected_transcode),
            ocr_detected_length = excluded.ocr_detected_length,
            ocr_detected_amount = excluded.ocr_detected_amount,
            ocr_detected_method = excluded.ocr_detected_method,
            ocr_raw_json = excluded.ocr_raw_json,
            forensic_raw_json = excluded.forensic_raw_json,
            entered_transcode = excluded.entered_transcode,
            verified_transcode = excluded.verified_transcode,
            anti_fraud_score = excluded.anti_fraud_score,
            anti_fraud_decision = excluded.anti_fraud_decision,
            rejection_reason = excluded.rejection_reason,
            order_id = COALESCE(excluded.order_id, payment_requests.order_id),
            credited_transaction_id = excluded.credited_transaction_id,
            credited_at = excluded.credited_at,
            updated_at = excluded.updated_at`
        )
        .run(
          updated.id,
          updated.user_id,
          updated.user_email,
          updated.purpose,
          updated.order_id || null,
          updated.partner_order_id || null,
          updated.game_id || null,
          updated.game_name || null,
          updated.service_id || null,
          updated.service_name || null,
          updated.package_id || null,
          updated.package_name || null,
          updated.product_key || null,
          updated.region || null,
          updated.player_id || null,
          updated.player_name || null,
          updated.server_id || null,
          updated.game_profile_data ? JSON.stringify(updated.game_profile_data) : null,
          updated.payment_method,
          updated.recipient_number,
          updated.expected_amount,
          updated.expected_amount_htg,
          updated.currency,
          updated.stage,
          updated.status,
          updated.idempotency_key || null,
          updated.request_hash || null,
          defaultExpires,
          updated.number_copied ? 1 : 0,
          updated.copied_at || null,
          updated.countdown_duration_seconds || 69,
          updated.countdown_ends_at || null,
          updated.countdown_completed ? 1 : 0,
          updated.proof_uploaded ? 1 : 0,
          updated.proof_uploaded_at || null,
          updated.proof_hash || null,
          updated.proof_perceptual_hash || null,
          updated.proof_file_path || null,
          secretTranscode,
          updated.detected_transcode_length ?? null,
          updated.ocr_extraction?.detectedAmount ?? null,
          updated.ocr_extraction?.detectedMethod ?? null,
          updated.ocr_extraction ? JSON.stringify(updated.ocr_extraction) : null,
          updated.forensic_analysis ? JSON.stringify(updated.forensic_analysis) : null,
          updated.entered_transcode || null,
          updated.transcode || null,
          updated.anti_fraud_score ?? 0,
          updated.anti_fraud_decision,
          updated.rejection_reason || null,
          updated.credited_transaction_id || null,
          updated.credited_at || null,
          updated.created_at,
          updated.updated_at
        );
    } catch (sqlErr) {
      console.error('[DB] upsertPaymentRequest SQLite warning:', sqlErr);
    }

    this.save();
    return this.computeRemainingCountdownSeconds(updated);
  }

  /**
   * Checks if a transcode has ALREADY been used in any validated transaction or other request
   */
  public findUsedTranscode(transcode: string): {
    used: boolean;
    payment_request_id?: string;
    transaction_id?: string;
    user_id?: string;
    used_at?: string;
  } {
    const clean = String(transcode || '').trim();
    if (!clean) return { used: false };
    try {
      // 1. Check validated_payments table first (authoritative table of truly validated payments)
      const valRow = this.sqlite
        ?.prepare(
          `SELECT * FROM validated_payments WHERE transcode = ? AND status IN ('validated', 'credited') LIMIT 1`
        )
        .get(clean) as any;
      if (valRow) {
        return {
          used: true,
          payment_request_id: String(valRow.payment_request_id),
          transaction_id: String(valRow.id),
          user_id: String(valRow.user_id),
          used_at: String(valRow.validated_at)
        };
      }

      // 2. Check payment_proofs partial unique index for verified/credited transcodes
      const proofRow = this.sqlite
        ?.prepare(
          `SELECT * FROM payment_proofs WHERE transcode = ? AND verification_status IN ('verified', 'credited') LIMIT 1`
        )
        .get(clean) as any;
      if (proofRow) {
        return {
          used: true,
          payment_request_id: String(proofRow.payment_request_id),
          transaction_id: String(proofRow.id),
          user_id: String(proofRow.user_id),
          used_at: String(proofRow.created_at)
        };
      }

      const row = this.sqlite
        ?.prepare(`SELECT * FROM used_payment_transcodes WHERE transcode = ?`)
        .get(clean) as any;
      if (row) {
        return {
          used: true,
          payment_request_id: String(row.payment_request_id),
          transaction_id: String(row.transaction_id),
          user_id: String(row.user_id),
          used_at: String(row.used_at)
        };
      }
    } catch {
      // fallback
    }
    const mem = this.data.usedPaymentTranscodes?.[clean];
    if (mem) {
      return {
        used: true,
        payment_request_id: mem.payment_request_id,
        transaction_id: mem.transaction_id,
        user_id: mem.user_id,
        used_at: mem.used_at
      };
    }
    return { used: false };
  }

  /**
   * Checks if a screenshot proof hash (exact SHA-256 or perceptual hash) has already been used
   * on another payment request (checks both payment_proofs.file_hash and used_payment_proofs).
   */
  public findDuplicateProofUsage(
    sha256Hash: string,
    perceptualHash: string,
    currentRequestId: string
  ): {
    isDuplicate: boolean;
    duplicateOfRequestId?: string;
    duplicateOfTransactionId?: string;
    duplicateUserId?: string;
  } {
    try {
      const proofRow = this.sqlite
        ?.prepare(`SELECT * FROM payment_proofs WHERE file_hash = ? AND payment_request_id != ? LIMIT 1`)
        .get(sha256Hash, currentRequestId) as any;
      if (proofRow) {
        return {
          isDuplicate: true,
          duplicateOfRequestId: String(proofRow.payment_request_id),
          duplicateUserId: String(proofRow.user_id)
        };
      }

      const row = this.sqlite
        ?.prepare(
          `SELECT * FROM used_payment_proofs WHERE (proof_hash = ? OR perceptual_hash = ?) AND payment_request_id != ? LIMIT 1`
        )
        .get(sha256Hash, perceptualHash, currentRequestId) as any;
      if (row) {
        return {
          isDuplicate: true,
          duplicateOfRequestId: String(row.payment_request_id),
          ...(row.transaction_id ? { duplicateOfTransactionId: String(row.transaction_id) } : {}),
          duplicateUserId: String(row.user_id)
        };
      }
    } catch {
      // fallback
    }

    const existingReq = (this.data.paymentRequests || []).find(
      r =>
        r.id !== currentRequestId &&
        r.proof_uploaded &&
        (r.proof_hash === sha256Hash || (perceptualHash && r.proof_perceptual_hash === perceptualHash))
    );
    if (existingReq) {
      return {
        isDuplicate: true,
        duplicateOfRequestId: existingReq.id,
        duplicateOfTransactionId: existingReq.credited_transaction_id,
        duplicateUserId: existingReq.user_id
      };
    }
    return { isDuplicate: false };
  }

  public registerProofHashUsage(params: {
    proofHash: string;
    perceptualHash: string;
    paymentRequestId: string;
    userId: string;
    status: string;
    transactionId?: string;
    transcode?: string | null;
    detectedAmount?: number | null;
    detectedMethod?: string | null;
    detectedDateTime?: string | null;
    ocrResult?: Record<string, any>;
    fraudScore?: number;
  }): { inserted: boolean; duplicateConflict: boolean; proofRecord?: PaymentProofRecord } {
    const nowIso = new Date().toISOString();
    if (!this.data.usedPaymentProofs) {
      this.data.usedPaymentProofs = {};
    }
    if (!this.data.usedPaymentProofs[params.proofHash]) {
      this.data.usedPaymentProofs[params.proofHash] = {
        proof_hash: params.proofHash,
        perceptual_hash: params.perceptualHash,
        payment_request_id: params.paymentRequestId,
        transaction_id: params.transactionId,
        user_id: params.userId,
        status: params.status,
        recorded_at: nowIso
      };
    }
    try {
      this.sqlite
        ?.prepare(
          `INSERT OR IGNORE INTO used_payment_proofs (proof_hash, perceptual_hash, payment_request_id, transaction_id, user_id, status, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          params.proofHash,
          params.perceptualHash,
          params.paymentRequestId,
          params.transactionId || null,
          params.userId,
          params.status,
          nowIso
        );
    } catch {
      // ignore
    }

    // Record in the dedicated "payment_proofs" table (Received proofs ONLY — never a validated payment!)
    // A newly uploaded proof starts in 'received' status.
    const verStatus: PaymentProofRecord['verification_status'] =
      params.status === 'rejected'
        ? 'rejected'
        : params.status === 'manual_review'
        ? 'manual_review'
        : params.status === 'verifying'
        ? 'verifying'
        : 'received';

    let proofId = crypto.randomUUID();
    const ocrJson = JSON.stringify(params.ocrResult || {});
    try {
      const existingProofByHash = this.sqlite
        ?.prepare(`SELECT * FROM payment_proofs WHERE file_hash = ?`)
        .get(params.proofHash) as any;

      if (existingProofByHash && existingProofByHash.payment_request_id !== params.paymentRequestId) {
        return { inserted: false, duplicateConflict: true };
      }

      if (existingProofByHash) {
        proofId = String(existingProofByHash.id);
        this.sqlite
          ?.prepare(
            `UPDATE payment_proofs
             SET perceptual_hash = COALESCE(?, perceptual_hash),
                 transcode = COALESCE(?, transcode),
                 detected_amount = COALESCE(?, detected_amount),
                 detected_method = COALESCE(?, detected_method),
                 detected_datetime = COALESCE(?, detected_datetime),
                 ocr_result = ?,
                 fraud_score = ?,
                 verification_status = CASE
                   WHEN verification_status IN ('verified', 'credited') THEN verification_status
                   ELSE ?
                 END
             WHERE id = ?`
          )
          .run(
            params.perceptualHash || null,
            params.transcode || null,
            params.detectedAmount ?? null,
            params.detectedMethod || null,
            params.detectedDateTime || null,
            ocrJson,
            params.fraudScore ?? 0,
            verStatus,
            proofId
          );
      } else {
        this.sqlite
          ?.prepare(
            `INSERT INTO payment_proofs (
              id, payment_request_id, user_id, file_hash, perceptual_hash, transcode,
              detected_amount, detected_method, detected_datetime, ocr_result,
              fraud_score, verification_status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            proofId,
            params.paymentRequestId,
            params.userId,
            params.proofHash,
            params.perceptualHash || null,
            params.transcode || null,
            params.detectedAmount ?? null,
            params.detectedMethod || null,
            params.detectedDateTime || null,
            ocrJson,
            params.fraudScore ?? 0,
            verStatus,
            nowIso
          );
      }
    } catch {
      return { inserted: false, duplicateConflict: true };
    }

    this.save();
    return {
      inserted: true,
      duplicateConflict: false,
      proofRecord: {
        id: proofId,
        payment_request_id: params.paymentRequestId,
        user_id: params.userId,
        file_hash: params.proofHash,
        perceptual_hash: params.perceptualHash || null,
        transcode: params.transcode || null,
        detected_amount: params.detectedAmount ?? null,
        detected_method: params.detectedMethod || null,
        detected_datetime: params.detectedDateTime || null,
        ocr_result: ocrJson,
        fraud_score: params.fraudScore ?? 0,
        verification_status: verStatus,
        created_at: nowIso
      }
    };
  }

  /**
   * Records a structured entry into the dedicated "audit_logs" table
   */
  public insertAuditLog(params: {
    user_id: string | null;
    payment_request_id?: string | null;
    action: string;
    resource_type: string;
    resource_id: string;
    idempotency_key?: string | null;
    request_id?: string | null;
    ip?: string | null;
    user_agent?: string | null;
    metadata?: Record<string, any>;
  }): AuditLogRecord {
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const metaJson = JSON.stringify(this.sanitizeForLogs(params.metadata || {}));
    const paymentReqId =
      params.payment_request_id !== undefined
        ? params.payment_request_id
        : params.resource_type === 'payment_request' && params.resource_id && !params.resource_id.startsWith('2fa_') && params.resource_id !== 'global'
        ? params.resource_id
        : null;
    try {
      this.sqlite
        ?.prepare(
          `INSERT INTO audit_logs (
            id, user_id, payment_request_id, action, resource_type, resource_id,
            idempotency_key, request_id, ip, user_agent, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.user_id || null,
          paymentReqId,
          params.action,
          params.resource_type,
          params.resource_id,
          params.idempotency_key || null,
          params.request_id || null,
          params.ip || null,
          params.user_agent || null,
          metaJson,
          nowIso
        );
    } catch {
      // ignore
    }
    return {
      id,
      user_id: params.user_id || null,
      payment_request_id: paymentReqId,
      action: params.action,
      resource_type: params.resource_type,
      resource_id: params.resource_id,
      idempotency_key: params.idempotency_key || null,
      request_id: params.request_id || null,
      ip: params.ip || null,
      user_agent: params.user_agent || null,
      metadata: metaJson,
      created_at: nowIso
    };
  }

  /**
   * Appends an immutable, cryptographically chained audit log entry (`payment_audit_logs` + `audit_logs`)
   */
  public appendPaymentAuditLog(
    entry: Omit<PaymentAuditLogEntry, 'id' | 'immutable_hash' | 'created_at'>
  ): PaymentAuditLogEntry {
    if (!this.data.paymentAuditLogs) {
      this.data.paymentAuditLogs = [];
    }
    const nowIso = new Date().toISOString();
    const id = `paud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const prevHash = this.data.paymentAuditLogs[0]?.immutable_hash || 'GENESIS_PLAYUP_AUDIT_CHAIN';
    const canonicalPayload = JSON.stringify({
      prevHash,
      id,
      payment_request_id: entry.payment_request_id,
      user_id: entry.user_id,
      event_type: entry.event_type,
      expected_amount: entry.expected_amount,
      detected_amount: entry.detected_amount,
      proof_hash: entry.proof_hash,
      anti_fraud_decision: entry.anti_fraud_decision,
      status_after: entry.status_after,
      summary: entry.summary,
      created_at: nowIso
    });
    const immutable_hash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    const fullLog: PaymentAuditLogEntry = {
      ...entry,
      id,
      immutable_hash,
      created_at: nowIso
    };

    this.data.paymentAuditLogs.unshift(fullLog);
    if (this.data.paymentAuditLogs.length > 1000) {
      this.data.paymentAuditLogs = this.data.paymentAuditLogs.slice(0, 1000);
    }

    try {
      this.sqlite
        ?.prepare(
          `INSERT INTO payment_audit_logs (
            id, payment_request_id, user_id, user_email, order_id, event_type,
            payment_method, expected_amount, detected_amount, detected_transcode_masked,
            entered_transcode_masked, proof_hash, anti_fraud_decision, status_after,
            summary, details_json, immutable_hash, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          fullLog.id,
          fullLog.payment_request_id,
          fullLog.user_id,
          fullLog.user_email || null,
          fullLog.order_id || null,
          fullLog.event_type,
          fullLog.payment_method || null,
          fullLog.expected_amount ?? null,
          fullLog.detected_amount ?? null,
          fullLog.detected_transcode_masked || null,
          fullLog.entered_transcode_masked || null,
          fullLog.proof_hash || null,
          fullLog.anti_fraud_decision || null,
          fullLog.status_after || null,
          fullLog.summary,
          fullLog.details ? JSON.stringify(this.sanitizeForLogs(fullLog.details)) : null,
          fullLog.immutable_hash,
          fullLog.created_at
        );
    } catch {
      // ignore
    }

    // Mirror into canonical "audit_logs" table
    this.insertAuditLog({
      user_id: fullLog.user_id,
      action: fullLog.event_type,
      resource_type: 'payment_request',
      resource_id: fullLog.payment_request_id,
      idempotency_key: fullLog.details?.idempotencyKey || null,
      request_id: fullLog.details?.requestId || null,
      ip: fullLog.details?.ipAddress || null,
      user_agent: fullLog.details?.userAgent || null,
      metadata: {
        summary: fullLog.summary,
        payment_method: fullLog.payment_method,
        expected_amount: fullLog.expected_amount,
        detected_amount: fullLog.detected_amount,
        status_after: fullLog.status_after,
        anti_fraud_decision: fullLog.anti_fraud_decision,
        immutable_hash: fullLog.immutable_hash,
        ...(fullLog.details || {})
      }
    });

    this.save();
    return fullLog;
  }

  public getPaymentAuditLogs(filters?: { paymentRequestId?: string; userId?: string }): PaymentAuditLogEntry[] {
    let list = this.data.paymentAuditLogs || [];
    if (filters?.paymentRequestId) {
      list = list.filter(l => l.payment_request_id === filters.paymentRequestId);
    }
    if (filters?.userId) {
      list = list.filter(l => l.user_id === filters.userId);
    }
    return list;
  }

  public recordAntiFraudIncident(
    incident: Omit<AntiFraudIncidentRecord, 'id' | 'created_at'>
  ): AntiFraudIncidentRecord {
    if (!this.data.antiFraudIncidents) {
      this.data.antiFraudIncidents = [];
    }
    const nowIso = new Date().toISOString();
    const full: AntiFraudIncidentRecord = {
      ...incident,
      id: `af_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      created_at: nowIso
    };
    this.data.antiFraudIncidents.unshift(full);
    if (this.data.antiFraudIncidents.length > 500) {
      this.data.antiFraudIncidents = this.data.antiFraudIncidents.slice(0, 500);
    }

    try {
      this.sqlite
        ?.prepare(
          `INSERT INTO payment_antifraud_incidents (
            id, payment_request_id, user_id, user_email, payment_method,
            expected_amount, detected_amount, detected_transcode, entered_transcode,
            proof_hash, duplicate_of_request_id, risk_score, decision,
            reason_code, reason_message, anomalies_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          full.id,
          full.payment_request_id,
          full.user_id,
          full.user_email || null,
          full.payment_method,
          full.expected_amount,
          full.detected_amount ?? null,
          full.detected_transcode || null,
          full.entered_transcode || null,
          full.proof_hash || null,
          full.duplicate_of_request_id || null,
          full.risk_score,
          full.decision,
          full.reason_code,
          full.reason_message,
          JSON.stringify(full.anomalies || []),
          full.created_at
        );
    } catch {
      // ignore
    }

    this.save();
    return full;
  }

  public getAntiFraudIncidents(userId?: string): AntiFraudIncidentRecord[] {
    const list = this.data.antiFraudIncidents || [];
    if (userId) {
      return list.filter(i => i.user_id === userId);
    }
    return list;
  }

  /**
   * ATOMIC WALLET CREDIT & CONTROLLED STATE MACHINE ENFORCEMENT:
   * Executes inside a single atomic database transaction ("BEGIN" -> ... -> "COMMIT" / "ROLLBACK"):
   *   1. Lock payment_request
   *   2. Verify payment is not already "credited"
   *   3. Transition state: pending -> verifying -> verified
   *   4. Verify transcode & proof_hash uniqueness (enforced by uq_payment_proofs_validated_transcode)
   *   5. Verify expected_amount > 0
   *   6. Create "wallet_transactions" row (type = 'deposit', UNIQUE(idempotency_key), UNIQUE(reference))
   *   7. Update user wallet balance atomically
   *   8. Mark "payment_requests" as "credited"
   *   9. Record "audit_logs" entry
   *   10. "COMMIT" (or "ROLLBACK" on any failure so no partial credit can ever remain)
   */
  public async executeAtomicPaymentCredit(params: {
    paymentRequestId: string;
    userId: string;
    verifiedTranscode: string;
    proofHash: string;
    perceptualHash: string;
    riskScore: number;
    idempotencyKey?: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{
    credited: boolean;
    alreadyProcessed: boolean;
    status: PaymentFinalCreditStatus;
    errorReason?: string;
    paymentRequest?: PaymentRequestRecord;
    validatedPayment?: ValidatedPaymentRecord;
    transaction?: PaymentTransaction;
    walletTransaction?: WalletTransactionRecord;
    user?: AppUser;
  }> {
    return this.runWithBootstrapLock(() => {
      const reqRecord = this.getPaymentRequestById(params.paymentRequestId);
      if (!reqRecord) {
        return {
          credited: false,
          alreadyProcessed: false,
          status: 'rejected',
          errorReason: 'Demande de paiement introuvable.'
        };
      }

      // Single final state protection: if already credited, rejected, refunded, or in manual_review, never credit again
      if (!['pending', 'verifying', 'verified'].includes(reqRecord.status)) {
        const existingTx = reqRecord.credited_transaction_id
          ? this.findPaymentTransactionByRefOrId(reqRecord.credited_transaction_id)
          : undefined;
        const existingWalletTx = this.getWalletTransactionByPaymentRequest(reqRecord.id, 'deposit');
        const existingValPayment = this.getValidatedPaymentByRequestId(reqRecord.id);
        return {
          credited: reqRecord.status === 'credited',
          alreadyProcessed: true,
          status: reqRecord.status,
          paymentRequest: reqRecord,
          validatedPayment: existingValPayment || undefined,
          transaction: existingTx,
          walletTransaction: existingWalletTx || undefined,
          user: this.getUserById(reqRecord.user_id)
        };
      }

      const cleanTranscode = String(params.verifiedTranscode || '').trim();
      const nowIso = new Date().toISOString();
      const walletTxUuid = crypto.randomUUID();
      const validatedPaymentUuid = crypto.randomUUID();
      const txId = `ptx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const txRef = `DEP-${reqRecord.id}-${cleanTranscode.slice(-6)}`;
      const creditIdempotencyKey = params.idempotencyKey || `CREDIT-${reqRecord.id}`;
      const amountToCredit = Number(Number(reqRecord.expected_amount).toFixed(2));
      let resolvedProofId = '';

      if (!cleanTranscode || cleanTranscode.length < 6) {
        return {
          credited: false,
          alreadyProcessed: false,
          status: 'rejected',
          errorReason: 'INVALID_TRANSCODE'
        };
      }
      if (Number.isNaN(amountToCredit) || amountToCredit <= 0) {
        return {
          credited: false,
          alreadyProcessed: false,
          status: 'rejected',
          errorReason: 'INVALID_AMOUNT'
        };
      }

      this.sqlite.exec('BEGIN IMMEDIATE TRANSACTION');
      try {
        // 1. Lock & check payment_requests status inside transaction
        const dbRow = this.sqlite
          .prepare(`SELECT status, credited_transaction_id, expected_amount FROM payment_requests WHERE id = ?`)
          .get(reqRecord.id) as any;
        if (dbRow && !['pending', 'verifying', 'verified'].includes(String(dbRow.status))) {
          this.sqlite.exec('ROLLBACK');
          return {
            credited: dbRow.status === 'credited',
            alreadyProcessed: true,
            status: dbRow.status as PaymentFinalCreditStatus,
            paymentRequest: reqRecord,
            validatedPayment: this.getValidatedPaymentByRequestId(reqRecord.id) || undefined,
            walletTransaction: this.getWalletTransactionByPaymentRequest(reqRecord.id, 'deposit') || undefined,
            user: this.getUserById(reqRecord.user_id)
          };
        }

        // 2. Controlled state transitions: pending -> verifying -> verified
        this.sqlite
          .prepare(`UPDATE payment_requests SET stage = 'verifying', status = 'verifying', updated_at = ? WHERE id = ?`)
          .run(nowIso, reqRecord.id);

        // 3. Verify transcode not already used in validated_payments, used_payment_transcodes, or payment_proofs
        const existingValidatedPayment = this.sqlite
          .prepare(`SELECT * FROM validated_payments WHERE transcode = ?`)
          .get(cleanTranscode) as any;
        if (existingValidatedPayment && existingValidatedPayment.payment_request_id !== reqRecord.id) {
          throw new Error(`TRANSCODE_ALREADY_USED:${existingValidatedPayment.payment_request_id}`);
        }

        const existingTranscode = this.sqlite
          .prepare(`SELECT * FROM used_payment_transcodes WHERE transcode = ?`)
          .get(cleanTranscode) as any;
        if (existingTranscode && existingTranscode.payment_request_id !== reqRecord.id) {
          throw new Error(`TRANSCODE_ALREADY_USED:${existingTranscode.payment_request_id}`);
        }

        const existingVerifiedProofTranscode = this.sqlite
          .prepare(
            `SELECT * FROM payment_proofs WHERE transcode = ? AND verification_status IN ('verified', 'credited') AND payment_request_id != ?`
          )
          .get(cleanTranscode, reqRecord.id) as any;
        if (existingVerifiedProofTranscode) {
          throw new Error(`TRANSCODE_ALREADY_USED:${existingVerifiedProofTranscode.payment_request_id}`);
        }

        // 4. Verify proof hash uniqueness against other requests
        const existingProof = this.sqlite
          .prepare(
            `SELECT * FROM used_payment_proofs WHERE (proof_hash = ? OR perceptual_hash = ?) AND payment_request_id != ? AND status = 'credited'`
          )
          .get(params.proofHash, params.perceptualHash, reqRecord.id) as any;
        if (existingProof) {
          throw new Error(`DUPLICATE_PROOF_REUSED:${existingProof.payment_request_id}`);
        }

        const existingProofFileHash = this.sqlite
          .prepare(`SELECT * FROM payment_proofs WHERE file_hash = ? AND payment_request_id != ?`)
          .get(params.proofHash, reqRecord.id) as any;
        if (existingProofFileHash) {
          throw new Error(`DUPLICATE_PROOF_REUSED:${existingProofFileHash.payment_request_id}`);
        }

        // Transition verifying -> verified
        this.sqlite
          .prepare(`UPDATE payment_requests SET stage = 'verified', status = 'verified', updated_at = ? WHERE id = ?`)
          .run(nowIso, reqRecord.id);

        // 5. Upsert/Update payment_proofs with verification_status = 'credited'
        // (Enforces UNIQUE(file_hash), uq_payment_proofs_one_verified_per_request, and uq_payment_proofs_validated_transcode)
        const existingProofForReq = this.sqlite
          .prepare(`SELECT id FROM payment_proofs WHERE payment_request_id = ? LIMIT 1`)
          .get(reqRecord.id) as any;
        if (existingProofForReq) {
          resolvedProofId = String(existingProofForReq.id);
          this.sqlite
            .prepare(
              `UPDATE payment_proofs
               SET transcode = ?,
                   fraud_score = ?,
                   verification_status = 'credited'
               WHERE id = ?`
            )
            .run(cleanTranscode, params.riskScore, resolvedProofId);
        } else {
          resolvedProofId = crypto.randomUUID();
          this.sqlite
            .prepare(
              `INSERT INTO payment_proofs (
                id, payment_request_id, user_id, file_hash, perceptual_hash, transcode,
                detected_amount, detected_method, detected_datetime, ocr_result,
                fraud_score, verification_status, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'credited', ?)`
            )
            .run(
              resolvedProofId,
              reqRecord.id,
              reqRecord.user_id,
              params.proofHash,
              params.perceptualHash || null,
              cleanTranscode,
              amountToCredit,
              reqRecord.payment_method,
              nowIso,
              JSON.stringify(reqRecord.ocr_extraction || {}),
              params.riskScore,
              nowIso
            );
        }

        // 6. Insert into "validated_payments" (STRICT SEPARATION: only truly validated payments enter this table!)
        // Enforces UNIQUE(payment_request_id), UNIQUE(payment_proof_id), UNIQUE(transcode), UNIQUE(payment_method, transcode)
        // AND satisfies the SQL trigger trg_require_validated_payment_before_wallet_deposit before wallet_transactions insert!
        this.sqlite
          .prepare(
            `INSERT INTO validated_payments (
              id, payment_request_id, payment_proof_id, user_id, payment_method,
              transcode, validated_amount, currency, validation_source,
              validated_by_user_id, status, validated_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ocr_antifraud', ?, 'credited', ?, ?)`
          )
          .run(
            validatedPaymentUuid,
            reqRecord.id,
            resolvedProofId,
            reqRecord.user_id,
            reqRecord.payment_method,
            cleanTranscode,
            amountToCredit,
            reqRecord.currency || 'USD',
            reqRecord.user_id,
            nowIso,
            nowIso
          );

        // 7. Acquire exclusive wallet_credit_locks row
        const existingLock = this.sqlite
          .prepare(`SELECT * FROM wallet_credit_locks WHERE payment_request_id = ?`)
          .get(reqRecord.id) as any;
        if (existingLock) {
          this.sqlite.exec('ROLLBACK');
          return {
            credited: true,
            alreadyProcessed: true,
            status: 'credited' as PaymentFinalCreditStatus,
            paymentRequest: reqRecord,
            validatedPayment: this.getValidatedPaymentByRequestId(reqRecord.id) || undefined,
            walletTransaction: this.getWalletTransactionByPaymentRequest(reqRecord.id, 'deposit') || undefined,
            user: this.getUserById(reqRecord.user_id)
          };
        }

        this.sqlite
          .prepare(
            `INSERT INTO wallet_credit_locks (
              payment_request_id, transaction_id, user_id, amount, transcode, proof_hash, locked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(reqRecord.id, walletTxUuid, reqRecord.user_id, amountToCredit, cleanTranscode, params.proofHash, nowIso);

        // 8. Create "wallet_transactions" record linked to BOTH payment_request_id and validated_payment_id
        this.sqlite
          .prepare(
            `INSERT INTO wallet_transactions (
              id, user_id, payment_request_id, validated_payment_id, type, amount, currency,
              status, idempotency_key, reference, created_at
            ) VALUES (?, ?, ?, ?, 'deposit', ?, ?, 'completed', ?, ?, ?)`
          )
          .run(
            walletTxUuid,
            reqRecord.user_id,
            reqRecord.id,
            validatedPaymentUuid,
            amountToCredit,
            reqRecord.currency || 'USD',
            creditIdempotencyKey,
            txRef,
            nowIso
          );

        // 8. Insert into used_payment_transcodes & used_payment_proofs
        this.sqlite
          .prepare(
            `INSERT INTO used_payment_transcodes (
              transcode, payment_request_id, transaction_id, user_id, amount, payment_method, proof_hash, used_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            cleanTranscode,
            reqRecord.id,
            walletTxUuid,
            reqRecord.user_id,
            amountToCredit,
            reqRecord.payment_method,
            params.proofHash,
            nowIso
          );

        this.sqlite
          .prepare(
            `INSERT INTO used_payment_proofs (proof_hash, perceptual_hash, payment_request_id, transaction_id, user_id, status, recorded_at)
             VALUES (?, ?, ?, ?, ?, 'credited', ?)
             ON CONFLICT(proof_hash) DO UPDATE SET
               transaction_id = excluded.transaction_id,
               status = 'credited'`
          )
          .run(params.proofHash, params.perceptualHash, reqRecord.id, walletTxUuid, reqRecord.user_id, nowIso);

        // 9. Atomically credit user wallet_balance in SQLite
        this.sqlite
          .prepare(`UPDATE users SET wallet_balance = ROUND(wallet_balance + ?, 2) WHERE id = ?`)
          .run(amountToCredit, reqRecord.user_id);

        // 10. Mark payment_request as "credited" (verified -> credited)
        this.sqlite
          .prepare(
            `UPDATE payment_requests
             SET stage = 'credited',
                 status = 'credited',
                 entered_transcode = ?,
                 verified_transcode = ?,
                 anti_fraud_score = ?,
                 anti_fraud_decision = 'AUTO_APPROVED',
                 credited_transaction_id = ?,
                 credited_at = ?,
                 updated_at = ?
             WHERE id = ? AND status IN ('pending', 'verifying', 'verified')`
          )
          .run(cleanTranscode, cleanTranscode, params.riskScore, walletTxUuid, nowIso, nowIso, reqRecord.id);

        // 11. Record atomic audit log inside the same transaction
        this.sqlite
          .prepare(
            `INSERT INTO audit_logs (
              id, user_id, payment_request_id, action, resource_type, resource_id,
              idempotency_key, request_id, ip, user_agent, metadata, created_at
            ) VALUES (?, ?, ?, 'WALLET_CREDIT_COMMITTED', 'payment_request', ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            reqRecord.user_id,
            reqRecord.id,
            reqRecord.id,
            creditIdempotencyKey,
            params.requestId || null,
            params.ipAddress || null,
            params.userAgent || null,
            JSON.stringify({
              validated_payment_id: validatedPaymentUuid,
              payment_proof_id: resolvedProofId,
              wallet_transaction_id: walletTxUuid,
              reference: txRef,
              amount: amountToCredit,
              currency: reqRecord.currency || 'USD',
              transcode: this.maskTranscode(cleanTranscode),
              state_transition: 'pending -> verifying -> verified -> credited'
            }),
            nowIso
          );

        this.sqlite.exec('COMMIT');
      } catch (err: any) {
        try {
          this.sqlite.exec('ROLLBACK');
        } catch {}
        return {
          credited: false,
          alreadyProcessed: false,
          status: 'rejected',
          errorReason: String(err?.message || 'Erreur transactionnelle lors du crédit atomique.')
        };
      }

      // Sync SQLite user balance to memory
      this.syncFromSqliteToMemory();
      const updatedUser = this.getUserById(reqRecord.user_id);

      // Update in-memory maps
      if (!this.data.usedPaymentTranscodes) {
        this.data.usedPaymentTranscodes = {};
      }
      this.data.usedPaymentTranscodes[cleanTranscode] = {
        transcode: cleanTranscode,
        payment_request_id: reqRecord.id,
        transaction_id: walletTxUuid,
        user_id: reqRecord.user_id,
        amount: amountToCredit,
        payment_method: reqRecord.payment_method,
        used_at: nowIso
      };

      const validatedPaymentRecord: ValidatedPaymentRecord = {
        id: validatedPaymentUuid,
        payment_request_id: reqRecord.id,
        payment_proof_id: resolvedProofId,
        user_id: reqRecord.user_id,
        payment_method: reqRecord.payment_method,
        transcode: cleanTranscode,
        validated_amount: amountToCredit,
        currency: reqRecord.currency || 'USD',
        validation_source: 'ocr_antifraud',
        validated_by_user_id: reqRecord.user_id,
        status: 'credited',
        validated_at: nowIso,
        created_at: nowIso
      };

      const walletTxRecord: WalletTransactionRecord = {
        id: walletTxUuid,
        user_id: reqRecord.user_id,
        payment_request_id: reqRecord.id,
        validated_payment_id: validatedPaymentUuid,
        type: 'deposit',
        amount: amountToCredit,
        currency: reqRecord.currency || 'USD',
        status: 'completed',
        idempotency_key: creditIdempotencyKey,
        reference: txRef,
        created_at: nowIso
      };

      // Create official PaymentTransaction record with ID, amount, method, transcode, user, date/time, and proof
      const txRecord: PaymentTransaction = {
        id: txId,
        transactionReference: txRef,
        payment_request_id: reqRecord.id,
        orderId: reqRecord.order_id,
        orderNumber: reqRecord.order_id,
        partnerOrderId: reqRecord.partner_order_id,
        userId: reqRecord.user_id,
        userEmail: reqRecord.user_email,
        gatewayId: reqRecord.payment_method === 'moncash' ? 'gw_moncash' : 'gw_natcash',
        paymentMethod: reqRecord.payment_method,
        amount: amountToCredit,
        currency: reqRecord.currency || 'USD',
        feeAmount: 0,
        totalCharged: amountToCredit,
        status: 'credited',
        payment_status: 'payment_verified',
        credit_status: 'credited',
        transcode: cleanTranscode,
        proof_hash: params.proofHash,
        proof_preview_url: reqRecord.proof_preview_data_url,
        anti_fraud_decision: 'AUTO_APPROVED',
        externalReference: cleanTranscode,
        payerIdentifier: `${reqRecord.payment_method.toUpperCase()} (${reqRecord.recipient_number}) · Transcode #${cleanTranscode}`,
        statusMessage: `Paiement vérifié par OCR & Anti-Fraude (${reqRecord.payment_method.toUpperCase()}) — Transcode ${cleanTranscode} — +$${amountToCredit.toFixed(2)} USD crédités sur PlayUp Wallet.`,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      if (!this.data.paymentTransactions) {
        this.data.paymentTransactions = [];
      }
      this.data.paymentTransactions.unshift(txRecord);

      // Record in unified ledger transactions
      const ledger = this.getTransactions();
      ledger.unshift({
        id: walletTxUuid,
        transactionNumber: txRef,
        entityType: 'user',
        entityId: reqRecord.user_id,
        type: 'credit',
        amount: amountToCredit,
        currency: 'USD',
        orderId: reqRecord.order_id,
        note: `Crédit Wallet PlayUp via ${reqRecord.payment_method.toUpperCase()} (Transcode: ${cleanTranscode}, Preuve SHA-256: ${params.proofHash.slice(0, 12)}...)`,
        createdAt: nowIso
      });
      this.setTransactions(ledger);

      reqRecord.stage = 'credited';
      reqRecord.status = 'credited';
      reqRecord.entered_transcode = cleanTranscode;
      reqRecord.transcode = cleanTranscode;
      reqRecord.anti_fraud_score = params.riskScore;
      reqRecord.anti_fraud_decision = 'AUTO_APPROVED';
      reqRecord.credited_transaction_id = walletTxUuid;
      reqRecord.credited_at = nowIso;
      reqRecord.user_message = `Paiement validé avec succès ! +$${amountToCredit.toFixed(2)} USD ont été crédités dans votre PlayUp Wallet.`;
      this.upsertPaymentRequest(reqRecord);

      this.save();

      return {
        credited: true,
        alreadyProcessed: false,
        status: 'credited',
        paymentRequest: reqRecord,
        validatedPayment: validatedPaymentRecord,
        transaction: txRecord,
        walletTransaction: walletTxRecord,
        user: updatedUser
      };
    });
  }

  // ==========================================================================
  // IRREVERSIBLE STATE MACHINE, IDEMPOTENCY, ANTI-REPLAY & CONCURRENCY ENGINE
  // ==========================================================================

  /**
   * Validates whether a payment status transition is permitted.
   * Controlled state machine:
   *   pending -> verifying -> verified -> credited
   *   pending / verifying -> rejected
   *   pending / verifying -> manual_review
   *   credited -> refunded
   * Once a payment is 'credited', 'rejected', 'refunded', or 'manual_review',
   * NO normal request can ever revert it to 'pending' or re-credit it.
   */
  public canTransitionPaymentStatus(
    currentStatus: PaymentFinalCreditStatus,
    targetStatus: PaymentFinalCreditStatus,
    options?: { isAdminAction?: boolean }
  ): { allowed: boolean; reason?: string } {
    if (currentStatus === targetStatus) {
      return { allowed: true };
    }
    if (currentStatus === 'credited') {
      if (targetStatus === 'refunded') {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Transition interdite : un paiement déjà "credited" est irréversible et ne peut jamais repasser à "${targetStatus}".`
      };
    }
    if (currentStatus === 'rejected') {
      return {
        allowed: false,
        reason: `Transition interdite : un paiement "rejected" est définitivement verrouillé et ne peut jamais passer à "${targetStatus}".`
      };
    }
    if (currentStatus === 'refunded') {
      return {
        allowed: false,
        reason: `Transition interdite : un paiement "refunded" est définitivement verrouillé et ne peut jamais passer à "${targetStatus}".`
      };
    }
    if (currentStatus === 'manual_review') {
      if (targetStatus === 'pending' || targetStatus === 'verifying') {
        return {
          allowed: false,
          reason: `Transition interdite : un paiement en "manual_review" ne peut jamais être remis à "${targetStatus}".`
        };
      }
      if (!options?.isAdminAction && ['verified', 'credited', 'rejected'].includes(targetStatus)) {
        return {
          allowed: false,
          reason: `Transition interdite : seul un administrateur habilité peut statuer sur une transaction en "manual_review".`
        };
      }
      return { allowed: true };
    }
    if (currentStatus === 'verified') {
      if (targetStatus === 'credited' || targetStatus === 'rejected') {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Transition interdite depuis "verified" vers "${targetStatus}".`
      };
    }
    if (currentStatus === 'verifying') {
      if (['verified', 'credited', 'rejected', 'manual_review'].includes(targetStatus)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Transition interdite depuis "verifying" vers "${targetStatus}".`
      };
    }
    if (currentStatus === 'pending' && ['verifying', 'verified', 'credited', 'rejected', 'manual_review'].includes(targetStatus)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Transition d'état non autorisée : "${currentStatus}" -> "${targetStatus}".`
    };
  }

  /**
   * Computes a deterministic SHA-256 hash of an operation payload for idempotency verification.
   */
  public computeIdempotencyPayloadHash(
    operationType: PaymentIdempotentOperationType,
    userId: string,
    paymentRequestId: string,
    payload: Record<string, any>
  ): string {
    const cleanPayload: Record<string, any> = {};
    for (const key of Object.keys(payload || {}).sort()) {
      // Exclude volatile transport fields (request_id, nonce, timestamp, idempotency_key) from semantic payload hash
      if (['idempotencyKey', 'idempotency_key', 'requestId', 'request_id', 'nonce', 'timestamp', 'clientTimestamp', 'client_timestamp'].includes(key)) {
        continue;
      }
      const val = payload[key];
      if (typeof val === 'string' && val.length > 512) {
        // Hash large payloads like base64 images deterministically
        cleanPayload[key] = `sha256:${crypto.createHash('sha256').update(val).digest('hex')}`;
      } else {
        cleanPayload[key] = val;
      }
    }
    const canonical = JSON.stringify({
      op: operationType,
      uid: userId,
      prid: paymentRequestId || 'global',
      body: cleanPayload
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Issues a short-lived cryptographic action nonce bound to userId & paymentRequestId
   */
  public issueShortLivedPaymentNonce(params: {
    userId: string;
    paymentRequestId?: string;
    operationType?: PaymentIdempotentOperationType;
    ttlSeconds?: number;
  }): {
    nonce: string;
    requestId: string;
    serverTimestamp: number;
    expiresAt: string;
    ttlSeconds: number;
  } {
    const ttlSeconds = params.ttlSeconds || 300; // 5 minutes short validity
    const serverTimestamp = Date.now();
    const expiresAt = new Date(serverTimestamp + ttlSeconds * 1000).toISOString();
    const randomPart = crypto.randomBytes(12).toString('hex');
    const requestId = `req_${serverTimestamp}_${crypto.randomBytes(6).toString('hex')}`;
    const secret = process.env.PLAYUP_INTERNAL_HMAC_SECRET || 'playup_anti_replay_nonce_secret_v2';
    const rawData = `${params.userId}:${params.paymentRequestId || 'global'}:${serverTimestamp}:${randomPart}`;
    const sig = crypto.createHmac('sha256', secret).update(rawData).digest('hex').slice(0, 24);
    const nonce = `n_${serverTimestamp}_${randomPart}_${sig}`;
    return {
      nonce,
      requestId,
      serverTimestamp,
      expiresAt,
      ttlSeconds
    };
  }

  /**
   * Serializes operations per payment_request_id (or user_id) so double-clicks, multi-tab requests,
   * and 100 simultaneous requests execute strictly sequentially and atomically.
   */
  public async runWithPaymentOperationLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.perPaymentOperationLocks.get(lockKey) || Promise.resolve();
    let release!: () => void;
    const nextLock = new Promise<void>(resolve => {
      release = resolve;
    });
    this.perPaymentOperationLocks.set(lockKey, prev.then(() => nextLock));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.perPaymentOperationLocks.get(lockKey) === nextLock) {
        this.perPaymentOperationLocks.delete(lockKey);
      }
    }
  }

  /**
   * Master Idempotency, Anti-Replay, Nonce & Request Expiration Execution Guard.
   *
   * Enforces:
   * 1. Mandatory idempotency_key per sensitive operation
   * 2. Payload hash binding: frontend cannot reuse an old idempotency_key for a new/different operation
   * 3. Identical request & network retry deduplication: returns the stored result of the first operation
   * 4. Anti-replay protection: binds request_id, payment_request_id, user_id, timestamp, idempotency_key, and nonce
   * 5. Short request expiration window (max 5 minutes / 300 seconds); rejects expired captured requests
   * 6. Concurrent request coalescing: if 10, 50, or 100 identical requests arrive simultaneously, only 1 executes and 99 receive the idempotent result.
   */
  public async executeIdempotentPaymentOperation(params: {
    idempotencyKey: string;
    operationType: PaymentIdempotentOperationType;
    endpoint?: string;
    userId: string;
    userEmail?: string;
    paymentRequestId?: string;
    requestId?: string;
    nonce?: string;
    clientTimestamp?: number | string;
    ipAddress: string;
    payload: Record<string, any>;
    maxAgeSeconds?: number;
    executor: () => Promise<{ httpStatus: number; body: Record<string, any> }>;
  }): Promise<{ httpStatus: number; body: Record<string, any>; replayed: boolean }> {
    const cleanKey = String(params.idempotencyKey || '').trim();
    const prId = String(params.paymentRequestId || 'global').trim();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const maxAgeSec = params.maxAgeSeconds || 300; // 5 minutes expiration window

    // 1. Mandatory Idempotency Key check
    if (!cleanKey || cleanKey.length < 8 || cleanKey.length > 180) {
      this.appendPaymentAuditLog({
        payment_request_id: prId,
        user_id: params.userId,
        user_email: params.userEmail,
        event_type: 'REPLAY_ATTACK_BLOCKED',
        summary: `Requête sensible rejetée (${params.operationType}) : clé d'idempotence (Idempotency-Key) absente ou invalide.`,
        details: { operationType: params.operationType, ipAddress: params.ipAddress }
      });
      return {
        httpStatus: 400,
        replayed: false,
        body: {
          error: 'IDEMPOTENCY_KEY_REQUIRED',
          message: `Une clé d'idempotence unique (Idempotency-Key) est obligatoire pour l'opération "${params.operationType}".`
        }
      };
    }

    // 2. Request Timestamp Expiration check (Anti-Replay of old captured requests)
    let clientTsMs = nowMs;
    if (params.clientTimestamp !== undefined && params.clientTimestamp !== null && params.clientTimestamp !== '') {
      const parsed = Number(params.clientTimestamp);
      if (!Number.isNaN(parsed) && parsed > 0) {
        // Support both seconds and milliseconds
        clientTsMs = parsed < 1e11 ? parsed * 1000 : parsed;
      } else {
        const dateParsed = Date.parse(String(params.clientTimestamp));
        if (!Number.isNaN(dateParsed)) {
          clientTsMs = dateParsed;
        }
      }
      const skewSeconds = Math.abs(nowMs - clientTsMs) / 1000;
      if (skewSeconds > maxAgeSec) {
        this.appendPaymentAuditLog({
          payment_request_id: prId,
          user_id: params.userId,
          user_email: params.userEmail,
          event_type: 'REPLAY_ATTACK_BLOCKED',
          summary: `Attaque Replay / Requête expirée bloquée (${params.operationType}) : décalage horaire ${Math.round(skewSeconds)}s > ${maxAgeSec}s max.`,
          details: {
            operationType: params.operationType,
            idempotencyKey: cleanKey,
            clientTimestamp: clientTsMs,
            serverTimestamp: nowMs,
            skewSeconds: Math.round(skewSeconds),
            ipAddress: params.ipAddress
          }
        });
        return {
          httpStatus: 409,
          replayed: false,
          body: {
            error: 'REQUEST_EXPIRED_ANTI_REPLAY',
            message: `Requête expirée (validité maximale ${maxAgeSec}s dépassée). Protection anti-replay activée.`
          }
        };
      }
    }

    // Check embedded timestamp in signed nonce if provided (`n_<ts>_<rand>_<sig>`)
    const cleanNonce = params.nonce ? String(params.nonce).trim() : '';
    if (cleanNonce.startsWith('n_')) {
      const parts = cleanNonce.split('_');
      if (parts.length >= 4) {
        const nonceTs = Number(parts[1]);
        if (!Number.isNaN(nonceTs) && Math.abs(nowMs - nonceTs) / 1000 > maxAgeSec) {
          this.appendPaymentAuditLog({
            payment_request_id: prId,
            user_id: params.userId,
            user_email: params.userEmail,
            event_type: 'REPLAY_ATTACK_BLOCKED',
            summary: `Nonce expiré bloqué sur ${params.operationType}.`,
            details: { nonce: cleanNonce, idempotencyKey: cleanKey, ipAddress: params.ipAddress }
          });
          return {
            httpStatus: 409,
            replayed: false,
            body: {
              error: 'NONCE_EXPIRED',
              message: 'Le jeton de sécurité à usage unique (nonce) a expiré. Veuillez rafraîchir votre action.'
            }
          };
        }
      }
    }

    const payloadHash = this.computeIdempotencyPayloadHash(
      params.operationType,
      params.userId,
      prId,
      params.payload
    );
    const requestId = String(params.requestId || `req_${nowMs}_${crypto.randomBytes(4).toString('hex')}`).trim();

    // 3. Coalesce simultaneous in-flight identical requests (e.g., 10, 50, or 100 concurrent calls)
    const inFlightKey = `${params.userId}:${cleanKey}`;
    const existingInFlight = this.inFlightIdempotencyPromises.get(inFlightKey);
    if (existingInFlight) {
      const firstResult = await existingInFlight;
      return {
        httpStatus: firstResult.httpStatus,
        body: {
          ...firstResult.body,
          idempotent_replay: true,
          concurrent_coalesced: true,
          idempotency_key: cleanKey
        },
        replayed: true
      };
    }

    const endpointName = params.endpoint || `/api/payments/${params.operationType}`;
    const operationPromise = this.runWithPaymentOperationLock(`${params.userId}:${prId}:${params.operationType}`, async () => {
      // 4A. Check dedicated "idempotency_keys" table (7-step mandatory lifecycle)
      const existingCanonicalKey = this.sqlite
        .prepare(
          `SELECT * FROM idempotency_keys WHERE user_id = ? AND endpoint = ? AND idempotency_key = ?`
        )
        .get(params.userId, endpointName, cleanKey) as any;

      if (existingCanonicalKey) {
        // Step 3: If request_hash is different -> refuse request (409 Conflict)
        if (existingCanonicalKey.request_hash !== payloadHash) {
          this.appendPaymentAuditLog({
            payment_request_id: prId,
            user_id: params.userId,
            user_email: params.userEmail,
            event_type: 'REPLAY_ATTACK_BLOCKED',
            summary: `Conflit d'idempotence (409 Conflict) sur idempotency_keys : request_hash différent pour la clé (${cleanKey}).`,
            details: {
              idempotencyKey: cleanKey,
              endpoint: endpointName,
              expectedHash: existingCanonicalKey.request_hash,
              receivedHash: payloadHash,
              ipAddress: params.ipAddress
            }
          });
          return {
            httpStatus: 409,
            replayed: false,
            body: {
              error: 'IDEMPOTENCY_KEY_REUSE_FORBIDDEN',
              message: 'Conflit 409 : cette clé d’idempotence a déjà été utilisée avec un payload (request_hash) différent.'
            }
          };
        }

        // Step 2: If status = "completed" and request_hash is identical -> immediately return stored response
        if (existingCanonicalKey.status === 'completed' && existingCanonicalKey.response_body) {
          let storedBody: any = {};
          try {
            storedBody = JSON.parse(existingCanonicalKey.response_body);
          } catch {
            storedBody = {};
          }
          this.sqlite
            .prepare(`UPDATE payment_idempotency_keys SET replay_count = replay_count + 1 WHERE idempotency_key = ?`)
            .run(cleanKey);

          this.appendPaymentAuditLog({
            payment_request_id: prId,
            user_id: params.userId,
            user_email: params.userEmail,
            event_type: 'IDEMPOTENT_REPLAY_RETURNED',
            summary: `Clé idempotency_keys trouvée (status="completed", request_hash identique) — retour immédiat de la réponse stockée.`,
            details: { idempotencyKey: cleanKey, endpoint: endpointName, resourceId: existingCanonicalKey.resource_id }
          });

          return {
            httpStatus: Number(existingCanonicalKey.response_status || 200),
            replayed: true,
            body: {
              ...storedBody,
              idempotent_replay: true,
              idempotency_key: cleanKey
            }
          };
        }

        // Step 4: If status = "processing" -> block concurrent duplicate execution
        if (existingCanonicalKey.status === 'processing') {
          return {
            httpStatus: 409,
            replayed: false,
            body: {
              error: 'OPERATION_ALREADY_PROCESSING',
              message: 'Cette opération est déjà en cours de traitement (status = "processing").'
            }
          };
        }
      }

      // 4B. Check existing idempotency record in payment_idempotency_keys across any endpoint/user
      const existingByKey = this.sqlite
        .prepare(`SELECT * FROM payment_idempotency_keys WHERE idempotency_key = ?`)
        .get(cleanKey) as any;

      if (existingByKey) {
        // Verify strict ownership, operation type, and payload hash
        if (
          existingByKey.user_id !== params.userId ||
          existingByKey.operation_type !== params.operationType ||
          existingByKey.payload_hash !== payloadHash ||
          (prId !== 'global' && existingByKey.payment_request_id !== 'global' && existingByKey.payment_request_id !== prId)
        ) {
          this.appendPaymentAuditLog({
            payment_request_id: prId,
            user_id: params.userId,
            user_email: params.userEmail,
            event_type: 'REPLAY_ATTACK_BLOCKED',
            summary: `Tentative illégale de réutilisation d'une ancienne clé d'idempotence (${cleanKey}) pour une opération ou des paramètres différents.`,
            details: {
              idempotencyKey: cleanKey,
              expectedOperation: existingByKey.operation_type,
              attemptedOperation: params.operationType,
              ipAddress: params.ipAddress
            }
          });
          return {
            httpStatus: 409,
            replayed: false,
            body: {
              error: 'IDEMPOTENCY_KEY_REUSE_FORBIDDEN',
              message: 'Cette clé d’idempotence a déjà été utilisée pour une autre opération ou avec des paramètres différents. Réutilisation interdite.'
            }
          };
        }

        // Valid network retry or duplicate click of the EXACT same operation -> increment replay_count and return cached response
        this.sqlite
          .prepare(`UPDATE payment_idempotency_keys SET replay_count = replay_count + 1 WHERE idempotency_key = ?`)
          .run(cleanKey);

        let parsedResponse: any = {};
        try {
          parsedResponse = JSON.parse(existingByKey.response_json || '{}');
        } catch {
          parsedResponse = {};
        }

        this.appendPaymentAuditLog({
          payment_request_id: prId,
          user_id: params.userId,
          user_email: params.userEmail,
          event_type: 'IDEMPOTENT_REPLAY_RETURNED',
          summary: `Requête identique / retry réseau détecté (${params.operationType}) — retour du résultat existant sans double exécution (replay #${Number(existingByKey.replay_count || 0) + 1}).`,
          details: {
            idempotencyKey: cleanKey,
            operationType: params.operationType,
            replayCount: Number(existingByKey.replay_count || 0) + 1
          }
        });

        return {
          httpStatus: Number(existingByKey.http_status || 200),
          replayed: true,
          body: {
            ...parsedResponse,
            idempotent_replay: true,
            idempotency_key: cleanKey,
            replay_count: Number(existingByKey.replay_count || 0) + 1
          }
        };
      }

      // 5. Check if an identical semantic operation (same operation_type + user_id + payment_request_id + payload_hash)
      // was ALREADY completed recently even if the client generated a different idempotency key (rapid duplicate submission)
      if (params.operationType !== 'payment_creation' || prId !== 'global') {
        const existingByPayload = this.sqlite
          .prepare(
            `SELECT * FROM payment_idempotency_keys
             WHERE operation_type = ? AND user_id = ? AND payment_request_id = ? AND payload_hash = ? AND status = 'completed'`
          )
          .get(params.operationType, params.userId, prId, payloadHash) as any;

        if (existingByPayload) {
          this.sqlite
            .prepare(`UPDATE payment_idempotency_keys SET replay_count = replay_count + 1 WHERE idempotency_key = ?`)
            .run(existingByPayload.idempotency_key);

          let parsedResponse: any = {};
          try {
            parsedResponse = JSON.parse(existingByPayload.response_json || '{}');
          } catch {
            parsedResponse = {};
          }

          this.appendPaymentAuditLog({
            payment_request_id: prId,
            user_id: params.userId,
            user_email: params.userEmail,
            event_type: 'IDEMPOTENT_REPLAY_RETURNED',
            summary: `Doublon de requête identique détecté par contrainte UNIQUE (${params.operationType}) — retour du résultat initial sans recréation ni double crédit.`,
            details: {
              originalIdempotencyKey: existingByPayload.idempotency_key,
              newIdempotencyKey: cleanKey,
              payloadHash
            }
          });

          return {
            httpStatus: Number(existingByPayload.http_status || 200),
            replayed: true,
            body: {
              ...parsedResponse,
              idempotent_replay: true,
              duplicate_payload_detected: true,
              idempotency_key: existingByPayload.idempotency_key
            }
          };
        }
      }

      // 6. Anti-Replay Nonce & Request-ID uniqueness check (a nonce or request_id cannot be reused across different operations)
      if (cleanNonce) {
        const existingNonce = this.sqlite
          .prepare(`SELECT * FROM payment_used_nonces WHERE nonce = ?`)
          .get(cleanNonce) as any;
        if (existingNonce && existingNonce.idempotency_key !== cleanKey) {
          this.appendPaymentAuditLog({
            payment_request_id: prId,
            user_id: params.userId,
            user_email: params.userEmail,
            event_type: 'REPLAY_ATTACK_BLOCKED',
            summary: `Attaque Replay bloquée : le nonce à usage unique (${cleanNonce.slice(0, 18)}...) a déjà été consommé.`,
            details: {
              nonce: cleanNonce,
              originalRequestId: existingNonce.request_id,
              attemptedRequestId: requestId,
              ipAddress: params.ipAddress
            }
          });
          return {
            httpStatus: 409,
            replayed: false,
            body: {
              error: 'REPLAY_NONCE_ALREADY_USED',
              message: 'Ce nonce à usage unique a déjà été utilisé. Attaque de type replay bloquée.'
            }
          };
        }
      }

      const existingReqId = this.sqlite
        .prepare(`SELECT * FROM payment_used_nonces WHERE request_id = ?`)
        .get(requestId) as any;
      if (existingReqId && existingReqId.idempotency_key !== cleanKey) {
        this.appendPaymentAuditLog({
          payment_request_id: prId,
          user_id: params.userId,
          user_email: params.userEmail,
          event_type: 'REPLAY_ATTACK_BLOCKED',
          summary: `Attaque Replay bloquée : request_id (${requestId}) déjà traité.`,
          details: { requestId, idempotencyKey: cleanKey, ipAddress: params.ipAddress }
        });
        return {
          httpStatus: 409,
          replayed: false,
          body: {
            error: 'REPLAY_REQUEST_ID_ALREADY_PROCESSED',
            message: 'Cet identifiant de requête (request_id) a déjà été traité. Requête dupliquée refusée.'
          }
        };
      }

      const expiresIso = new Date(nowMs + maxAgeSec * 1000).toISOString();
      const effectiveNonce = cleanNonce || `auto_nonce_${cleanKey}_${requestId}`;

      // Step 5 of idempotency_keys lifecycle: If key does not exist -> insert in "processing" state
      const canonicalIdemId = existingCanonicalKey?.id || crypto.randomUUID();
      try {
        this.sqlite
          .prepare(
            `INSERT INTO idempotency_keys (
              id, user_id, endpoint, idempotency_key, request_hash,
              response_status, response_body, resource_id, status, expires_at, created_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 'processing', ?, ?, NULL)
            ON CONFLICT(user_id, endpoint, idempotency_key) DO UPDATE SET
              status = 'processing'`
          )
          .run(
            canonicalIdemId,
            params.userId,
            endpointName,
            cleanKey,
            payloadHash,
            prId !== 'global' ? prId : null,
            expiresIso,
            nowIso
          );
      } catch {
        // ignore
      }

      // Record nonce consumption in SQLite
      try {
        this.sqlite
          .prepare(
            `INSERT OR IGNORE INTO payment_used_nonces (
              nonce, request_id, user_id, payment_request_id, operation_type,
              idempotency_key, client_timestamp, server_timestamp, ip_address, consumed_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            effectiveNonce,
            requestId,
            params.userId,
            prId,
            params.operationType,
            cleanKey,
            clientTsMs,
            nowMs,
            params.ipAddress,
            nowIso,
            expiresIso
          );
      } catch {
        // ignore if already inserted for same key
      }

      // Step 6: Execute the actual operation once
      let result: { httpStatus: number; body: Record<string, any> };
      try {
        result = await params.executor();
      } catch (execErr: any) {
        const failedAt = new Date().toISOString();
        this.sqlite
          .prepare(
            `UPDATE idempotency_keys
             SET status = 'failed', response_status = 500, response_body = ?, completed_at = ?
             WHERE id = ?`
          )
          .run(JSON.stringify({ error: String(execErr?.message || 'Execution failed') }), failedAt, canonicalIdemId);
        throw execErr;
      }

      // Determine effective payment_request_id after execution (e.g., when payment_creation creates a new request)
      const finalPrId =
        prId !== 'global'
          ? prId
          : String(result.body?.paymentRequest?.id || result.body?.id || `created_${cleanKey}`);

      const completedIso = new Date().toISOString();
      const responseWithMeta = {
        ...result.body,
        idempotent_replay: false,
        idempotency_key: cleanKey,
        request_id: requestId,
        server_timestamp: completedIso
      };

      // Step 7: Save the result and transition idempotency_keys to "completed" or "failed"
      const recordStatus = result.httpStatus >= 200 && result.httpStatus < 300 ? 'completed' : 'failed';
      try {
        this.sqlite
          .prepare(
            `UPDATE idempotency_keys
             SET response_status = ?,
                 response_body = ?,
                 resource_id = ?,
                 status = ?,
                 completed_at = ?
             WHERE id = ?`
          )
          .run(
            result.httpStatus,
            JSON.stringify(responseWithMeta),
            finalPrId,
            recordStatus,
            completedIso,
            canonicalIdemId
          );
      } catch {
        // ignore
      }

      // 8. Persist completed idempotency record in payment_idempotency_keys with UNIQUE constraint protection
      try {
        this.sqlite
          .prepare(
            `INSERT INTO payment_idempotency_keys (
              idempotency_key, operation_type, user_id, payment_request_id, request_id,
              nonce, payload_hash, status, http_status, response_json,
              created_at, completed_at, expires_at, replay_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(idempotency_key) DO UPDATE SET
              status = excluded.status,
              http_status = excluded.http_status,
              response_json = excluded.response_json,
              completed_at = excluded.completed_at`
          )
          .run(
            cleanKey,
            params.operationType,
            params.userId,
            finalPrId,
            requestId,
            effectiveNonce,
            payloadHash,
            recordStatus,
            result.httpStatus,
            JSON.stringify(responseWithMeta),
            nowIso,
            completedIso,
            expiresIso
          );
      } catch (sqlErr: any) {
        // If UNIQUE(operation_type, user_id, payment_request_id, payload_hash) triggered concurrently, fetch and return first record
        const winner = this.sqlite
          .prepare(
            `SELECT * FROM payment_idempotency_keys
             WHERE operation_type = ? AND user_id = ? AND payment_request_id = ? AND payload_hash = ?`
          )
          .get(params.operationType, params.userId, finalPrId, payloadHash) as any;
        if (winner) {
          let winnerBody: any = {};
          try {
            winnerBody = JSON.parse(winner.response_json || '{}');
          } catch {}
          return {
            httpStatus: Number(winner.http_status || 200),
            replayed: true,
            body: {
              ...winnerBody,
              idempotent_replay: true,
              idempotency_key: winner.idempotency_key
            }
          };
        }
      }

      if (!this.data.paymentIdempotencyRecords) {
        this.data.paymentIdempotencyRecords = {};
      }
      this.data.paymentIdempotencyRecords[cleanKey] = {
        idempotency_key: cleanKey,
        operation_type: params.operationType,
        user_id: params.userId,
        payment_request_id: finalPrId,
        request_id: requestId,
        nonce: effectiveNonce,
        payload_hash: payloadHash,
        status: recordStatus,
        http_status: result.httpStatus,
        response_json: JSON.stringify(responseWithMeta),
        created_at: nowIso,
        completed_at: completedIso,
        expires_at: expiresIso,
        replay_count: 0
      };
      this.save();

      return {
        httpStatus: result.httpStatus,
        replayed: false,
        body: responseWithMeta
      };
    });

    this.inFlightIdempotencyPromises.set(inFlightKey, operationPromise);
    try {
      return await operationPromise;
    } finally {
      this.inFlightIdempotencyPromises.delete(inFlightKey);
    }
  }

  /**
   * Atomically refunds a credited payment request once (`credited -> refunded`),
   * creating at most 1 `refund` row in `wallet_transactions` with unique reference `REFUND-{payment_request_id}`,
   * and locking the state permanently as `refunded`.
   */
  public async executeAtomicPaymentRefund(params: {
    paymentRequestId: string;
    adminUserId: string;
    adminEmail?: string;
    reason: string;
    idempotencyKey?: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    deductFromUserWallet?: boolean;
  }): Promise<{
    refunded: boolean;
    alreadyRefunded: boolean;
    status: PaymentFinalCreditStatus;
    errorReason?: string;
    refundReference?: string;
    walletTransaction?: WalletTransactionRecord;
    paymentRequest?: PaymentRequestRecord;
    user?: AppUser;
  }> {
    return this.runWithBootstrapLock(() => {
      const reqRecord = this.getPaymentRequestById(params.paymentRequestId);
      if (!reqRecord) {
        return {
          refunded: false,
          alreadyRefunded: false,
          status: 'rejected',
          errorReason: 'Demande de paiement introuvable.'
        };
      }

      const refundReference = `REFUND-${reqRecord.id}`;
      const refundIdempotencyKey = params.idempotencyKey || `REFUND-KEY-${reqRecord.id}`;

      if (reqRecord.status === 'refunded') {
        const existingRefundTx = this.getWalletTransactionByPaymentRequest(reqRecord.id, 'refund');
        return {
          refunded: true,
          alreadyRefunded: true,
          status: 'refunded',
          refundReference,
          walletTransaction: existingRefundTx || undefined,
          paymentRequest: reqRecord,
          user: this.getUserById(reqRecord.user_id)
        };
      }

      const checkTransition = this.canTransitionPaymentStatus(reqRecord.status, 'refunded', { isAdminAction: true });
      if (!checkTransition.allowed) {
        this.appendPaymentAuditLog({
          payment_request_id: reqRecord.id,
          user_id: reqRecord.user_id,
          user_email: reqRecord.user_email,
          event_type: 'INVALID_STATE_TRANSITION_BLOCKED',
          status_after: reqRecord.status,
          summary: checkTransition.reason || 'Transition vers refunded refusée.'
        });
        return {
          refunded: false,
          alreadyRefunded: false,
          status: reqRecord.status,
          errorReason: checkTransition.reason
        };
      }

      const nowIso = new Date().toISOString();
      const amount = Number(Number(reqRecord.expected_amount).toFixed(2));
      const refundTxUuid = crypto.randomUUID();

      this.sqlite.exec('BEGIN IMMEDIATE TRANSACTION');
      try {
        const dbRow = this.sqlite
          .prepare(`SELECT status FROM payment_requests WHERE id = ?`)
          .get(reqRecord.id) as any;
        if (dbRow && dbRow.status === 'refunded') {
          this.sqlite.exec('ROLLBACK');
          const existingRefundTx = this.getWalletTransactionByPaymentRequest(reqRecord.id, 'refund');
          return {
            refunded: true,
            alreadyRefunded: true,
            status: 'refunded',
            refundReference,
            walletTransaction: existingRefundTx || undefined,
            paymentRequest: reqRecord,
            user: this.getUserById(reqRecord.user_id)
          };
        }
        if (dbRow && dbRow.status !== 'credited') {
          throw new Error(`Seul un paiement "credited" peut être remboursé (état actuel : ${dbRow.status}).`);
        }

        // Check if a refund wallet_transaction with reference REFUND-{payment_request_id} already exists
        const existingRefundRow = this.sqlite
          .prepare(
            `SELECT * FROM wallet_transactions WHERE payment_request_id = ? AND type = 'refund' AND status = 'completed'`
          )
          .get(reqRecord.id) as any;
        if (existingRefundRow) {
          this.sqlite.exec('ROLLBACK');
          return {
            refunded: true,
            alreadyRefunded: true,
            status: 'refunded',
            refundReference,
            walletTransaction: existingRefundRow as WalletTransactionRecord,
            paymentRequest: reqRecord,
            user: this.getUserById(reqRecord.user_id)
          };
        }

        // 1. Insert unique refund row in wallet_transactions (enforced by UNIQUE(idempotency_key), UNIQUE(reference), and uq_wallet_transactions_single_refund_per_payment)
        this.sqlite
          .prepare(
            `INSERT INTO wallet_transactions (
              id, user_id, payment_request_id, type, amount, currency,
              status, idempotency_key, reference, created_at
            ) VALUES (?, ?, ?, 'refund', ?, ?, 'completed', ?, ?, ?)`
          )
          .run(
            refundTxUuid,
            reqRecord.user_id,
            reqRecord.id,
            amount,
            reqRecord.currency || 'USD',
            refundIdempotencyKey,
            refundReference,
            nowIso
          );

        // 2. Optionally reverse user wallet balance inside the same atomic transaction
        if (params.deductFromUserWallet) {
          this.sqlite
            .prepare(`UPDATE users SET wallet_balance = MAX(0, ROUND(wallet_balance - ?, 2)) WHERE id = ?`)
            .run(amount, reqRecord.user_id);
        }

        // 3. Transition payment_requests status: credited -> refunded AND validated_payments status -> refunded
        this.sqlite
          .prepare(`UPDATE payment_requests SET stage = 'refunded', status = 'refunded', updated_at = ? WHERE id = ? AND status = 'credited'`)
          .run(nowIso, reqRecord.id);

        this.sqlite
          .prepare(`UPDATE validated_payments SET status = 'refunded' WHERE payment_request_id = ?`)
          .run(reqRecord.id);

        // 4. Insert audit_logs record inside the transaction
        this.sqlite
          .prepare(
            `INSERT INTO audit_logs (
              id, user_id, payment_request_id, action, resource_type, resource_id,
              idempotency_key, request_id, ip, user_agent, metadata, created_at
            ) VALUES (?, ?, ?, 'PAYMENT_REFUND_COMMITTED', 'payment_request', ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            params.adminUserId,
            reqRecord.id,
            reqRecord.id,
            refundIdempotencyKey,
            params.requestId || null,
            params.ipAddress || null,
            params.userAgent || null,
            JSON.stringify({
              wallet_transaction_id: refundTxUuid,
              reference: refundReference,
              amount,
              currency: reqRecord.currency || 'USD',
              reason: params.reason,
              state_transition: 'credited -> refunded'
            }),
            nowIso
          );

        this.sqlite.exec('COMMIT');
      } catch (err: any) {
        try {
          this.sqlite.exec('ROLLBACK');
        } catch {}
        return {
          refunded: false,
          alreadyRefunded: false,
          status: reqRecord.status,
          errorReason: String(err?.message || 'Erreur lors du remboursement atomique.')
        };
      }

      if (params.deductFromUserWallet) {
        this.syncFromSqliteToMemory();
      }

      const refundWalletTx: WalletTransactionRecord = {
        id: refundTxUuid,
        user_id: reqRecord.user_id,
        payment_request_id: reqRecord.id,
        type: 'refund',
        amount,
        currency: reqRecord.currency || 'USD',
        status: 'completed',
        idempotency_key: refundIdempotencyKey,
        reference: refundReference,
        created_at: nowIso
      };

      reqRecord.stage = 'refunded';
      reqRecord.status = 'refunded';
      reqRecord.user_message = `Paiement remboursé (${params.reason}) — Réf: ${refundReference}. État verrouillé définitivement.`;
      this.upsertPaymentRequest(reqRecord);

      this.appendPaymentAuditLog({
        payment_request_id: reqRecord.id,
        user_id: reqRecord.user_id,
        user_email: reqRecord.user_email,
        payment_method: reqRecord.payment_method,
        expected_amount: amount,
        event_type: 'PAYMENT_REFUNDED',
        status_after: 'refunded',
        summary: `Paiement #${reqRecord.id} passé à l'état irréversible "refunded" (${refundReference}) par ${params.adminEmail || params.adminUserId}. Motif : ${params.reason}`,
        details: {
          reference: refundReference,
          idempotencyKey: refundIdempotencyKey,
          walletTransactionId: refundTxUuid
        }
      });

      return {
        refunded: true,
        alreadyRefunded: false,
        status: 'refunded',
        refundReference,
        walletTransaction: refundWalletTx,
        paymentRequest: reqRecord,
        user: this.getUserById(reqRecord.user_id)
      };
    });
  }

  public recordRateLimitSecurityEvent(
    event: Omit<PaymentSecurityRateLimitLog, 'id' | 'created_at'>
  ): PaymentSecurityRateLimitLog {
    if (!this.data.paymentRateLimitLogs) {
      this.data.paymentRateLimitLogs = [];
    }
    const nowIso = new Date().toISOString();
    const record: PaymentSecurityRateLimitLog = {
      ...event,
      id: `rl_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      created_at: nowIso
    };
    this.data.paymentRateLimitLogs.unshift(record);
    if (this.data.paymentRateLimitLogs.length > 500) {
      this.data.paymentRateLimitLogs = this.data.paymentRateLimitLogs.slice(0, 500);
    }
    try {
      this.sqlite
        ?.prepare(
          `INSERT INTO payment_security_rate_limits (
            id, user_id, ip_address, session_id, api_key_id, endpoint,
            bucket_type, request_count, limit_max, window_ms, blocked, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          record.id,
          record.user_id || null,
          record.ip_address,
          record.session_id || null,
          record.api_key_id || null,
          record.endpoint,
          record.bucket_type,
          record.request_count,
          record.limit_max,
          record.window_ms,
          record.blocked ? 1 : 0,
          record.created_at
        );
    } catch {
      // ignore
    }
    this.save();
    return record;
  }

  public getRateLimitSecurityEvents(limit = 100): PaymentSecurityRateLimitLog[] {
    return (this.data.paymentRateLimitLogs || []).slice(0, limit);
  }

  public getIdempotencyRecords(userId?: string): PaymentIdempotencyRecord[] {
    const all = Object.values(this.data.paymentIdempotencyRecords || {});
    if (userId) {
      return all.filter(r => r.user_id === userId);
    }
    return all;
  }

  public getWalletTransactionByPaymentRequest(
    paymentRequestId: string,
    type: 'deposit' | 'debit' | 'refund' | 'adjustment' = 'deposit'
  ): WalletTransactionRecord | null {
    try {
      const row = this.sqlite
        ?.prepare(
          `SELECT * FROM wallet_transactions WHERE payment_request_id = ? AND type = ? AND status = 'completed' LIMIT 1`
        )
        .get(paymentRequestId, type) as any;
      if (row) {
        return {
          id: String(row.id),
          user_id: String(row.user_id),
          payment_request_id: row.payment_request_id ? String(row.payment_request_id) : null,
          type: row.type,
          amount: Number(row.amount),
          currency: String(row.currency || 'USD'),
          status: row.status,
          idempotency_key: String(row.idempotency_key),
          reference: String(row.reference),
          created_at: String(row.created_at)
        };
      }
    } catch {
      // ignore
    }
    return null;
  }

  public getWalletTransactions(filters?: { userId?: string; paymentRequestId?: string; limit?: number }): WalletTransactionRecord[] {
    try {
      const limit = filters?.limit || 100;
      if (filters?.paymentRequestId) {
        return (this.sqlite
          ?.prepare(`SELECT * FROM wallet_transactions WHERE payment_request_id = ? ORDER BY created_at DESC LIMIT ?`)
          .all(filters.paymentRequestId, limit) || []) as WalletTransactionRecord[];
      }
      if (filters?.userId) {
        return (this.sqlite
          ?.prepare(`SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
          .all(filters.userId, limit) || []) as WalletTransactionRecord[];
      }
      return (this.sqlite
        ?.prepare(`SELECT * FROM wallet_transactions ORDER BY created_at DESC LIMIT ?`)
        .all(limit) || []) as WalletTransactionRecord[];
    } catch {
      return [];
    }
  }

  public getPaymentProofs(filters?: { paymentRequestId?: string; userId?: string; limit?: number }): PaymentProofRecord[] {
    try {
      const limit = filters?.limit || 100;
      if (filters?.paymentRequestId) {
        return (this.sqlite
          ?.prepare(`SELECT * FROM payment_proofs WHERE payment_request_id = ? ORDER BY created_at DESC LIMIT ?`)
          .all(filters.paymentRequestId, limit) || []) as PaymentProofRecord[];
      }
      if (filters?.userId) {
        return (this.sqlite
          ?.prepare(`SELECT * FROM payment_proofs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
          .all(filters.userId, limit) || []) as PaymentProofRecord[];
      }
      return (this.sqlite
        ?.prepare(`SELECT * FROM payment_proofs ORDER BY created_at DESC LIMIT ?`)
        .all(limit) || []) as PaymentProofRecord[];
    } catch {
      return [];
    }
  }

  public getValidatedPaymentByRequestId(paymentRequestId: string): ValidatedPaymentRecord | null {
    try {
      const row = this.sqlite
        ?.prepare(`SELECT * FROM validated_payments WHERE payment_request_id = ? LIMIT 1`)
        .get(paymentRequestId) as any;
      if (!row) return null;
      return {
        id: String(row.id),
        payment_request_id: String(row.payment_request_id),
        payment_proof_id: String(row.payment_proof_id),
        user_id: String(row.user_id),
        payment_method: row.payment_method,
        transcode: String(row.transcode),
        validated_amount: Number(row.validated_amount),
        currency: String(row.currency || 'HTG'),
        validation_source: row.validation_source || 'ocr_antifraud',
        validated_by_user_id: row.validated_by_user_id ? String(row.validated_by_user_id) : null,
        status: row.status,
        validated_at: String(row.validated_at),
        created_at: String(row.created_at)
      };
    } catch {
      return null;
    }
  }

  public getValidatedPayments(filters?: { paymentRequestId?: string; userId?: string; limit?: number }): ValidatedPaymentRecord[] {
    try {
      const limit = filters?.limit || 100;
      if (filters?.paymentRequestId) {
        return (this.sqlite
          ?.prepare(`SELECT * FROM validated_payments WHERE payment_request_id = ? ORDER BY validated_at DESC LIMIT ?`)
          .all(filters.paymentRequestId, limit) || []) as ValidatedPaymentRecord[];
      }
      if (filters?.userId) {
        return (this.sqlite
          ?.prepare(`SELECT * FROM validated_payments WHERE user_id = ? ORDER BY validated_at DESC LIMIT ?`)
          .all(filters.userId, limit) || []) as ValidatedPaymentRecord[];
      }
      return (this.sqlite
        ?.prepare(`SELECT * FROM validated_payments ORDER BY validated_at DESC LIMIT ?`)
        .all(limit) || []) as ValidatedPaymentRecord[];
    } catch {
      return [];
    }
  }

  public getPostgresSchemaSql(): string {
    try {
      const schemaPath = path.resolve(__dirname, './schema.postgres.sql');
      if (fs.existsSync(schemaPath)) {
        return fs.readFileSync(schemaPath, 'utf-8');
      }
    } catch {
      // ignore
    }
    return '';
  }

  public getCanonicalIdempotencyKeys(filters?: { userId?: string; endpoint?: string; limit?: number }): CanonicalIdempotencyKeyRecord[] {
    try {
      const limit = filters?.limit || 100;
      if (filters?.userId && filters?.endpoint) {
        return (this.sqlite
          ?.prepare(`SELECT * FROM idempotency_keys WHERE user_id = ? AND endpoint = ? ORDER BY created_at DESC LIMIT ?`)
          .all(filters.userId, filters.endpoint, limit) || []) as CanonicalIdempotencyKeyRecord[];
      }
      if (filters?.userId) {
        return (this.sqlite
          ?.prepare(`SELECT * FROM idempotency_keys WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
          .all(filters.userId, limit) || []) as CanonicalIdempotencyKeyRecord[];
      }
      return (this.sqlite
        ?.prepare(`SELECT * FROM idempotency_keys ORDER BY created_at DESC LIMIT ?`)
        .all(limit) || []) as CanonicalIdempotencyKeyRecord[];
    } catch {
      return [];
    }
  }

  public getAuditLogs(filters?: { userId?: string; resourceId?: string; limit?: number }): AuditLogRecord[] {
    try {
      const limit = filters?.limit || 100;
      if (filters?.resourceId) {
        return (this.sqlite
          ?.prepare(`SELECT * FROM audit_logs WHERE resource_id = ? ORDER BY created_at DESC LIMIT ?`)
          .all(filters.resourceId, limit) || []) as AuditLogRecord[];
      }
      if (filters?.userId) {
        return (this.sqlite
          ?.prepare(`SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
          .all(filters.userId, limit) || []) as AuditLogRecord[];
      }
      return (this.sqlite
        ?.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`)
        .all(limit) || []) as AuditLogRecord[];
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // MANDATORY 2FA SMS / EMAIL VERIFICATION LAYER FOR WALLET CREDIT & WITHDRAWAL
  // ==========================================================================

  private computeWallet2FACodeHash(challengeId: string, userId: string, code: string): string {
    const secret = process.env.PLAYUP_INTERNAL_HMAC_SECRET || 'playup_wallet_2fa_hmac_secret_v1';
    return crypto
      .createHmac('sha256', secret)
      .update(`${challengeId}:${userId}:${String(code).trim()}`)
      .digest('hex');
  }

  public maskDestination(channel: Wallet2FAChannel, destination: string): string {
    const clean = String(destination || '').trim();
    if (channel === 'email') {
      const [local, domain] = clean.split('@');
      if (!domain) return clean;
      const prefix = local.slice(0, Math.min(2, local.length));
      return `${prefix}***@${domain}`;
    }
    const digits = clean.replace(/\s+/g, '');
    if (digits.length <= 6) return digits;
    return `${digits.slice(0, 4)} **** ${digits.slice(-2)}`;
  }

  /**
   * Generates a 6-digit OTP code for a Wallet Credit or Withdrawal transaction,
   * stores its HMAC-SHA256 hash in `wallet_2fa_challenges`, and audits the challenge.
   */
  public createWallet2FAChallenge(params: {
    userId: string;
    userEmail?: string;
    operationType: Wallet2FAOperationType;
    channel: Wallet2FAChannel;
    destination: string;
    paymentRequestId?: string | null;
    amount: number;
    currency?: string;
    ttlSeconds?: number;
    ipAddress?: string;
    userAgent?: string;
  }): {
    challenge: Wallet2FAChallengeRecord;
    rawCode: string;
    expiresInSeconds: number;
  } {
    const challengeId = crypto.randomUUID();
    const rawCode = String(crypto.randomInt(100000, 999999));
    const ttlSeconds = params.ttlSeconds || 300; // 5 minutes
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresIso = new Date(nowMs + ttlSeconds * 1000).toISOString();
    const amount = Number(Number(params.amount || 0).toFixed(2));
    const currency = params.currency || 'USD';
    const maskedDestination = this.maskDestination(params.channel, params.destination);
    const codeHash = this.computeWallet2FACodeHash(challengeId, params.userId, rawCode);

    const record: Wallet2FAChallengeRecord = {
      id: challengeId,
      user_id: params.userId,
      operation_type: params.operationType,
      channel: params.channel,
      destination: params.destination,
      masked_destination: maskedDestination,
      payment_request_id: params.paymentRequestId || null,
      amount,
      currency,
      code_hash: codeHash,
      status: 'pending',
      attempts: 0,
      max_attempts: 5,
      verification_token: null,
      expires_at: expiresIso,
      verified_at: null,
      consumed_at: null,
      created_at: nowIso
    };

    this.sqlite
      .prepare(
        `INSERT INTO wallet_2fa_challenges (
          id, user_id, operation_type, channel, destination, masked_destination,
          payment_request_id, amount, currency, code_hash, status, attempts,
          max_attempts, verification_token, expires_at, verified_at, consumed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 5, NULL, ?, NULL, NULL, ?)`
      )
      .run(
        record.id,
        record.user_id,
        record.operation_type,
        record.channel,
        record.destination,
        record.masked_destination,
        record.payment_request_id,
        record.amount,
        record.currency,
        record.code_hash,
        record.expires_at,
        record.created_at
      );

    this.appendPaymentAuditLog({
      payment_request_id: record.payment_request_id || `2fa_${record.id}`,
      user_id: record.user_id,
      user_email: params.userEmail,
      expected_amount: record.amount,
      event_type: 'WALLET_2FA_CHALLENGE_ISSUED',
      status_after: 'pending',
      summary: `Code 2FA à 6 chiffres envoyé par ${record.channel.toUpperCase()} (${record.masked_destination}) pour ${record.operation_type} ($${record.amount.toFixed(2)} ${record.currency}).`,
      details: {
        challengeId: record.id,
        channel: record.channel,
        maskedDestination: record.masked_destination,
        operationType: record.operation_type,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent
      }
    });

    return {
      challenge: record,
      rawCode,
      expiresInSeconds: ttlSeconds
    };
  }

  /**
   * Verifies a 6-digit 2FA OTP code using constant-time `crypto.timingSafeEqual`.
   * Issues a single-use `verification_token` when valid, or increments attempts / locks on failure.
   */
  public verifyWallet2FAChallenge(params: {
    challengeId: string;
    userId: string;
    userEmail?: string;
    code: string;
    ipAddress?: string;
    userAgent?: string;
  }): {
    verified: boolean;
    errorCode?: string;
    message: string;
    verificationToken?: string;
    challenge?: Wallet2FAChallengeRecord;
    remainingAttempts?: number;
  } {
    const cleanChallengeId = String(params.challengeId || '').trim();
    const cleanCode = String(params.code || '').replace(/\s+/g, '');

    const row = this.sqlite
      .prepare(`SELECT * FROM wallet_2fa_challenges WHERE id = ?`)
      .get(cleanChallengeId) as Wallet2FAChallengeRecord | undefined;

    if (!row || row.user_id !== params.userId) {
      this.appendPaymentAuditLog({
        payment_request_id: `2fa_${cleanChallengeId || 'missing'}`,
        user_id: params.userId,
        user_email: params.userEmail,
        event_type: 'WALLET_2FA_FAILED',
        summary: `Échec 2FA bloquant : challenge 2FA introuvable ou n'appartient pas à l'utilisateur.`,
        details: { challengeId: cleanChallengeId, ipAddress: params.ipAddress }
      });
      return {
        verified: false,
        errorCode: 'TWO_FACTOR_CHALLENGE_NOT_FOUND',
        message: 'Challenge de vérification 2FA introuvable ou invalide. Opération bloquée.'
      };
    }

    if (row.status === 'consumed') {
      return {
        verified: false,
        errorCode: 'TWO_FACTOR_ALREADY_CONSUMED',
        message: 'Ce code 2FA à usage unique a déjà été consommé. Veuillez demander un nouveau code.'
      };
    }

    if (row.status === 'locked' || row.attempts >= row.max_attempts) {
      return {
        verified: false,
        errorCode: 'TWO_FACTOR_MAX_ATTEMPTS_LOCKED',
        message: 'Ce challenge 2FA est verrouillé suite à trop de tentatives erronées. Opération bloquée.',
        remainingAttempts: 0
      };
    }

    const nowMs = Date.now();
    if (nowMs > Date.parse(row.expires_at)) {
      this.sqlite
        .prepare(`UPDATE wallet_2fa_challenges SET status = 'expired' WHERE id = ?`)
        .run(row.id);
      this.appendPaymentAuditLog({
        payment_request_id: row.payment_request_id || `2fa_${row.id}`,
        user_id: params.userId,
        user_email: params.userEmail,
        event_type: 'WALLET_2FA_FAILED',
        summary: `Échec 2FA bloquant : code 2FA expiré pour ${row.operation_type}.`,
        details: { challengeId: row.id, expiresAt: row.expires_at, ipAddress: params.ipAddress }
      });
      return {
        verified: false,
        errorCode: 'TWO_FACTOR_EXPIRED',
        message: 'Votre code 2FA a expiré (délai de 5 minutes dépassé). Veuillez demander un nouveau code.'
      };
    }

    if (row.status === 'verified' && row.verification_token) {
      // Still verify the code matches if re-submitted
      const expectedBuf = Buffer.from(row.code_hash, 'hex');
      const candidateHash = this.computeWallet2FACodeHash(row.id, params.userId, cleanCode);
      const candidateBuf = Buffer.from(candidateHash, 'hex');
      if (expectedBuf.length === candidateBuf.length && crypto.timingSafeEqual(expectedBuf, candidateBuf)) {
        return {
          verified: true,
          message: 'Code 2FA déjà vérifié et valide.',
          verificationToken: row.verification_token,
          challenge: row
        };
      }
    }

    const expectedBuf = Buffer.from(row.code_hash, 'hex');
    const candidateHash = this.computeWallet2FACodeHash(row.id, params.userId, cleanCode);
    const candidateBuf = Buffer.from(candidateHash, 'hex');

    const isMatch =
      cleanCode.length === 6 &&
      expectedBuf.length === candidateBuf.length &&
      crypto.timingSafeEqual(expectedBuf, candidateBuf);

    if (!isMatch) {
      const newAttempts = Number(row.attempts || 0) + 1;
      const newStatus = newAttempts >= row.max_attempts ? 'locked' : 'pending';
      this.sqlite
        .prepare(`UPDATE wallet_2fa_challenges SET attempts = ?, status = ? WHERE id = ?`)
        .run(newAttempts, newStatus, row.id);

      const remaining = Math.max(0, row.max_attempts - newAttempts);
      this.appendPaymentAuditLog({
        payment_request_id: row.payment_request_id || `2fa_${row.id}`,
        user_id: params.userId,
        user_email: params.userEmail,
        expected_amount: row.amount,
        event_type: 'WALLET_2FA_FAILED',
        status_after: newStatus,
        summary: `Échec 2FA bloquant (${row.operation_type}) : code 2FA incorrect (tentative ${newAttempts}/${row.max_attempts}). Transaction bloquée.`,
        details: {
          challengeId: row.id,
          channel: row.channel,
          attempts: newAttempts,
          remainingAttempts: remaining,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent
        }
      });

      return {
        verified: false,
        errorCode: newStatus === 'locked' ? 'TWO_FACTOR_MAX_ATTEMPTS_LOCKED' : 'TWO_FACTOR_INVALID_CODE',
        message:
          newStatus === 'locked'
            ? 'Code 2FA invalide. Nombre maximal de tentatives atteint — la transaction est bloquée.'
            : `Code 2FA incorrect. La transaction est bloquée (${remaining} tentative(s) restante(s)).`,
        remainingAttempts: remaining
      };
    }

    const nowIso = new Date(nowMs).toISOString();
    const verificationToken = `2fa_tok_${row.id}_${crypto.randomBytes(16).toString('hex')}`;

    this.sqlite
      .prepare(
        `UPDATE wallet_2fa_challenges
         SET status = 'verified', verification_token = ?, verified_at = ?
         WHERE id = ?`
      )
      .run(verificationToken, nowIso, row.id);

    const updatedChallenge: Wallet2FAChallengeRecord = {
      ...row,
      status: 'verified',
      verification_token: verificationToken,
      verified_at: nowIso
    };

    this.appendPaymentAuditLog({
      payment_request_id: row.payment_request_id || `2fa_${row.id}`,
      user_id: params.userId,
      user_email: params.userEmail,
      expected_amount: row.amount,
      event_type: 'WALLET_2FA_VERIFIED',
      status_after: 'verified',
      summary: `Vérification 2FA (${row.channel.toUpperCase()}) validée côté backend pour ${row.operation_type} ($${row.amount.toFixed(2)} ${row.currency}).`,
      details: {
        challengeId: row.id,
        channel: row.channel,
        operationType: row.operation_type,
        ipAddress: params.ipAddress
      }
    });

    return {
      verified: true,
      message: `Vérification 2FA (${row.channel.toUpperCase()}) réussie.`,
      verificationToken,
      challenge: updatedChallenge
    };
  }

  /**
   * Blocking backend gate that verifies & consumes a 2FA challenge (via `verificationToken` OR `challengeId + code`)
   * before allowing any Wallet Credit or Wallet Withdrawal.
   */
  public assertAndConsumeWallet2FA(params: {
    userId: string;
    userEmail?: string;
    operationType: Wallet2FAOperationType;
    paymentRequestId?: string | null;
    expectedAmount: number;
    twoFactorVerificationToken?: string;
    twoFactorChallengeId?: string;
    twoFactorCode?: string;
    ipAddress?: string;
    userAgent?: string;
  }): {
    allowed: boolean;
    errorCode?: string;
    message?: string;
    challenge?: Wallet2FAChallengeRecord;
  } {
    const token = String(params.twoFactorVerificationToken || '').trim();
    const challengeId = String(params.twoFactorChallengeId || '').trim();
    const code = String(params.twoFactorCode || '').replace(/\s+/g, '');

    if (!token && (!challengeId || !code)) {
      this.appendPaymentAuditLog({
        payment_request_id: params.paymentRequestId || `2fa_missing_${Date.now()}`,
        user_id: params.userId,
        user_email: params.userEmail,
        expected_amount: params.expectedAmount,
        event_type: 'WALLET_2FA_FAILED',
        summary: `Étape 2FA bloquante (${params.operationType}) : aucune vérification 2FA SMS/Email fournie. Transaction refusée.`,
        details: {
          operationType: params.operationType,
          paymentRequestId: params.paymentRequestId,
          ipAddress: params.ipAddress
        }
      });
      return {
        allowed: false,
        errorCode: 'TWO_FACTOR_REQUIRED',
        message: `Une vérification 2FA par code SMS ou Email est obligatoire pour valider cette opération (${params.operationType === 'wallet_credit' ? 'crédit wallet' : 'retrait wallet'}).`
      };
    }

    let challengeRow: Wallet2FAChallengeRecord | undefined;

    if (challengeId && code) {
      const verifyRes = this.verifyWallet2FAChallenge({
        challengeId,
        userId: params.userId,
        userEmail: params.userEmail,
        code,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent
      });
      if (!verifyRes.verified || !verifyRes.challenge) {
        return {
          allowed: false,
          errorCode: verifyRes.errorCode || 'TWO_FACTOR_VERIFICATION_FAILED',
          message: verifyRes.message
        };
      }
      challengeRow = verifyRes.challenge;
    } else if (token) {
      challengeRow = this.sqlite
        .prepare(`SELECT * FROM wallet_2fa_challenges WHERE verification_token = ?`)
        .get(token) as Wallet2FAChallengeRecord | undefined;

      if (!challengeRow || challengeRow.user_id !== params.userId) {
        this.appendPaymentAuditLog({
          payment_request_id: params.paymentRequestId || `2fa_invalid_tok`,
          user_id: params.userId,
          user_email: params.userEmail,
          expected_amount: params.expectedAmount,
          event_type: 'WALLET_2FA_FAILED',
          summary: `Étape 2FA bloquante (${params.operationType}) : jeton de vérification 2FA invalide.`,
          details: { ipAddress: params.ipAddress }
        });
        return {
          allowed: false,
          errorCode: 'TWO_FACTOR_TOKEN_INVALID',
          message: 'Jeton de vérification 2FA invalide ou non reconnu. Opération bloquée.'
        };
      }

      if (challengeRow.status === 'consumed') {
        return {
          allowed: false,
          errorCode: 'TWO_FACTOR_ALREADY_CONSUMED',
          message: 'Ce jeton 2FA a déjà été utilisé. Veuillez effectuer une nouvelle vérification 2FA.'
        };
      }

      if (challengeRow.status !== 'verified') {
        return {
          allowed: false,
          errorCode: 'TWO_FACTOR_NOT_VERIFIED',
          message: 'Ce challenge 2FA n’a pas été validé côté backend. Opération bloquée.'
        };
      }

      if (Date.now() > Date.parse(challengeRow.expires_at)) {
        this.sqlite
          .prepare(`UPDATE wallet_2fa_challenges SET status = 'expired' WHERE id = ?`)
          .run(challengeRow.id);
        return {
          allowed: false,
          errorCode: 'TWO_FACTOR_EXPIRED',
          message: 'Votre validation 2FA a expiré. Veuillez redemander un code SMS ou Email.'
        };
      }
    }

    if (!challengeRow) {
      return {
        allowed: false,
        errorCode: 'TWO_FACTOR_VERIFICATION_FAILED',
        message: 'La vérification 2FA a échoué. Opération bloquée.'
      };
    }

    // Verify operation_type, payment_request_id binding, and amount binding
    if (challengeRow.operation_type !== params.operationType) {
      return {
        allowed: false,
        errorCode: 'TWO_FACTOR_OPERATION_MISMATCH',
        message: `Ce code 2FA a été émis pour "${challengeRow.operation_type}" et ne peut pas autoriser "${params.operationType}".`
      };
    }

    if (
      params.paymentRequestId &&
      challengeRow.payment_request_id &&
      challengeRow.payment_request_id !== params.paymentRequestId
    ) {
      return {
        allowed: false,
        errorCode: 'TWO_FACTOR_REQUEST_MISMATCH',
        message: 'Ce code 2FA est lié à une autre demande de paiement. Opération bloquée.'
      };
    }

    if (Math.abs(Number(challengeRow.amount) - Number(params.expectedAmount)) > 0.01) {
      return {
        allowed: false,
        errorCode: 'TWO_FACTOR_AMOUNT_MISMATCH',
        message: `Le montant de la transaction ($${params.expectedAmount.toFixed(2)}) ne correspond pas au montant validé par 2FA ($${Number(challengeRow.amount).toFixed(2)}). Opération bloquée.`
      };
    }

    // Mark 2FA challenge as consumed so it can never be replayed
    const consumedAt = new Date().toISOString();
    this.sqlite
      .prepare(`UPDATE wallet_2fa_challenges SET status = 'consumed', consumed_at = ? WHERE id = ?`)
      .run(consumedAt, challengeRow.id);

    return {
      allowed: true,
      challenge: {
        ...challengeRow,
        status: 'consumed',
        consumed_at: consumedAt
      }
    };
  }

  /**
   * Executes an atomic, idempotent Wallet Withdrawal (MonCash / NatCash) ONLY after 2FA verification passes.
   */
  public async executeAtomicWalletWithdrawal(params: {
    userId: string;
    userEmail: string;
    amount: number;
    currency?: string;
    payoutMethod: 'moncash' | 'natcash';
    destinationPhone: string;
    idempotencyKey: string;
    twoFactorChallengeId: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{
    withdrawn: boolean;
    errorCode?: string;
    message: string;
    walletTransaction?: WalletTransactionRecord;
    paymentTransaction?: PaymentTransaction;
    user?: AppUser;
  }> {
    return this.runWithBootstrapLock(() => {
      const amount = Number(Number(params.amount || 0).toFixed(2));
      const currency = params.currency || 'USD';
      if (Number.isNaN(amount) || amount < 1) {
        return {
          withdrawn: false,
          errorCode: 'INVALID_WITHDRAWAL_AMOUNT',
          message: 'Montant de retrait invalide (minimum $1.00 USD).'
        };
      }

      const nowIso = new Date().toISOString();
      const walletTxUuid = crypto.randomUUID();
      const txId = `wtx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const reference = `WDR-${params.userId.slice(0, 8)}-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

      this.sqlite.exec('BEGIN IMMEDIATE TRANSACTION');
      try {
        const userRow = this.sqlite
          .prepare(`SELECT id, wallet_balance FROM users WHERE id = ?`)
          .get(params.userId) as any;

        if (!userRow) {
          throw new Error('USER_NOT_FOUND:Utilisateur introuvable.');
        }

        const currentBalance = Number(Number(userRow.wallet_balance || 0).toFixed(2));
        if (currentBalance < amount) {
          throw new Error(
            `INSUFFICIENT_WALLET_BALANCE:Solde PlayUp Wallet insuffisant ($${currentBalance.toFixed(2)} USD disponibles pour un retrait de $${amount.toFixed(2)} USD).`
          );
        }

        // 1. Insert debit row into wallet_transactions (UNIQUE(idempotency_key), UNIQUE(reference))
        this.sqlite
          .prepare(
            `INSERT INTO wallet_transactions (
              id, user_id, payment_request_id, type, amount, currency,
              status, idempotency_key, reference, created_at
            ) VALUES (?, ?, NULL, 'debit', ?, ?, 'completed', ?, ?, ?)`
          )
          .run(walletTxUuid, params.userId, amount, currency, params.idempotencyKey, reference, nowIso);

        // 2. Deduct from user's wallet_balance atomically
        this.sqlite
          .prepare(`UPDATE users SET wallet_balance = ROUND(wallet_balance - ?, 2) WHERE id = ?`)
          .run(amount, params.userId);

        // 3. Record in audit_logs inside the transaction
        this.sqlite
          .prepare(
            `INSERT INTO audit_logs (
              id, user_id, action, resource_type, resource_id,
              idempotency_key, request_id, ip, user_agent, metadata, created_at
            ) VALUES (?, ?, 'WALLET_WITHDRAWAL_COMMITTED', 'wallet_transaction', ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            params.userId,
            walletTxUuid,
            params.idempotencyKey,
            params.requestId || null,
            params.ipAddress || null,
            params.userAgent || null,
            JSON.stringify({
              reference,
              amount,
              currency,
              payoutMethod: params.payoutMethod,
              destinationPhone: params.destinationPhone,
              twoFactorChallengeId: params.twoFactorChallengeId
            }),
            nowIso
          );

        this.sqlite.exec('COMMIT');
      } catch (err: any) {
        try {
          this.sqlite.exec('ROLLBACK');
        } catch {}
        const rawMsg = String(err?.message || 'Erreur lors du retrait atomique.');
        const [codePart, textPart] = rawMsg.includes(':') ? rawMsg.split(':', 2) : ['WITHDRAWAL_FAILED', rawMsg];
        return {
          withdrawn: false,
          errorCode: codePart,
          message: textPart || rawMsg
        };
      }

      this.syncFromSqliteToMemory();
      const updatedUser = this.getUserById(params.userId);

      const walletTxRecord: WalletTransactionRecord = {
        id: walletTxUuid,
        user_id: params.userId,
        payment_request_id: null,
        type: 'debit',
        amount,
        currency,
        status: 'completed',
        idempotency_key: params.idempotencyKey,
        reference,
        created_at: nowIso
      };

      const paymentTx: PaymentTransaction = {
        id: txId,
        transactionReference: reference,
        userId: params.userId,
        userEmail: params.userEmail,
        gatewayId: params.payoutMethod === 'moncash' ? 'gw_moncash' : 'gw_natcash',
        paymentMethod: params.payoutMethod,
        amount,
        currency,
        feeAmount: 0,
        totalCharged: amount,
        status: 'completed',
        payment_status: 'payment_verified',
        credit_status: 'credited',
        payerIdentifier: `Retrait vers ${params.payoutMethod.toUpperCase()} (${params.destinationPhone}) · 2FA Vérifié`,
        statusMessage: `Retrait PlayUp Wallet de -$${amount.toFixed(2)} USD vers ${params.payoutMethod.toUpperCase()} (${params.destinationPhone}) validé par 2FA.`,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      if (!this.data.paymentTransactions) {
        this.data.paymentTransactions = [];
      }
      this.data.paymentTransactions.unshift(paymentTx);

      const ledger = this.getTransactions();
      ledger.unshift({
        id: walletTxUuid,
        transactionNumber: reference,
        entityType: 'user',
        entityId: params.userId,
        type: 'debit',
        amount,
        currency: 'USD',
        note: `Retrait Wallet PlayUp vers ${params.payoutMethod.toUpperCase()} (${params.destinationPhone}) — Vérifié par 2FA (#${params.twoFactorChallengeId.slice(0, 8)})`,
        createdAt: nowIso
      });
      this.setTransactions(ledger);

      this.appendPaymentAuditLog({
        payment_request_id: walletTxUuid,
        user_id: params.userId,
        user_email: params.userEmail,
        payment_method: params.payoutMethod,
        expected_amount: amount,
        event_type: 'WALLET_WITHDRAWAL_COMPLETED',
        status_after: 'completed',
        summary: `Retrait atomique de -$${amount.toFixed(2)} USD vers ${params.payoutMethod.toUpperCase()} (${params.destinationPhone}) exécuté après validation 2FA (${reference}).`,
        details: {
          reference,
          walletTransactionId: walletTxUuid,
          twoFactorChallengeId: params.twoFactorChallengeId
        }
      });

      this.save();

      return {
        withdrawn: true,
        message: `Retrait de $${amount.toFixed(2)} USD vers ${params.payoutMethod.toUpperCase()} (${params.destinationPhone}) validé par 2FA et exécuté avec succès.`,
        walletTransaction: walletTxRecord,
        paymentTransaction: paymentTx,
        user: updatedUser
      };
    });
  }

  public getWallet2FAChallenges(filters?: { userId?: string; limit?: number }): Array<Omit<Wallet2FAChallengeRecord, 'code_hash' | 'verification_token'>> {
    try {
      const limit = filters?.limit || 50;
      const rows = (filters?.userId
        ? this.sqlite
            ?.prepare(`SELECT * FROM wallet_2fa_challenges WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
            .all(filters.userId, limit)
        : this.sqlite
            ?.prepare(`SELECT * FROM wallet_2fa_challenges ORDER BY created_at DESC LIMIT ?`)
            .all(limit)) as Wallet2FAChallengeRecord[];
      return (rows || []).map(({ code_hash, verification_token, ...safe }) => safe);
    } catch {
      return [];
    }
  }
}

export const db = new PlayUpDatabase();
