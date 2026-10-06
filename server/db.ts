import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { 
  Game, Service, Provider, Reseller, ApiKey, Order, 
  AppSettings, SupportTicket, SystemLog, Transaction, WebhookLog, 
  ProviderApiLog, ProviderOrder, UserNotification, ProviderWebhookLog,
  AppUser, PaymentGatewayConfig, PaymentTransaction
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

export interface ProviderSecretRecord {
  apiKey: string;
  webhookSecret: string;
}

export interface UserCredentialRecord {
  passwordHash: string;
  passwordSalt: string;
  resetToken?: string;
  resetTokenExpiresAt?: string;
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
  paymentGateways: PaymentGatewayConfig[];
  paymentGatewaySecrets: Record<string, PaymentGatewaySecretRecord>; // Server-side only
  paymentTransactions: PaymentTransaction[];
  resellers: Reseller[];
  apiKeys: ApiKey[];
  orders: Order[];
  transactions: Transaction[];
  webhookLogs: WebhookLog[];
  supportTickets: SupportTicket[];
  settings: AppSettings;
  systemLogs: SystemLog[];
  adminToken: string;
}

class PlayUpDatabase {
  private data: DatabaseSchema;

  constructor() {
    this.ensureDataDir();
    this.data = this.load();
    this.ensureMigrations();
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
    const clean = secret.trim();
    if (clean.length <= 8) return '••••••••••••••••';
    return `${clean.slice(0, 3)}••••••••••••${clean.slice(-4)}`;
  }

  /**
   * Sanitizes any object or string to ensure no API Key or Webhook Secret is ever written in plaintext to logs or payloads
   */
  public sanitizeForLogs(raw: any): any {
    if (raw === null || raw === undefined) return raw;
    const isObj = typeof raw === 'object';
    let str = isObj ? JSON.stringify(raw) : String(raw);

    if (this.data?.providerSecrets) {
      for (const sec of Object.values(this.data.providerSecrets)) {
        if (sec.apiKey && sec.apiKey.trim().length >= 4) {
          const k = sec.apiKey.trim();
          const masked = k.length > 8 ? `${k.slice(0, 4)}••••••••${k.slice(-4)}` : '[MASKED_API_KEY]';
          str = str.split(k).join(masked);
        }
        if (sec.webhookSecret && sec.webhookSecret.trim().length >= 4) {
          const s = sec.webhookSecret.trim();
          const masked = s.length > 8 ? `${s.slice(0, 3)}••••••••${s.slice(-4)}` : '[MASKED_WEBHOOK_SECRET]';
          str = str.split(s).join(masked);
        }
      }
    }

    if (process.env.GOXTOP_API_KEY && process.env.GOXTOP_API_KEY.length >= 4) {
      const k = process.env.GOXTOP_API_KEY;
      const masked = k.length > 8 ? `${k.slice(0, 4)}••••••••${k.slice(-4)}` : '[MASKED_ENV_API_KEY]';
      str = str.split(k).join(masked);
    }
    if (process.env.GOXTOP_API_KEY_SECRET && process.env.GOXTOP_API_KEY_SECRET.length >= 4) {
      const s = process.env.GOXTOP_API_KEY_SECRET;
      const masked = s.length > 8 ? `${s.slice(0, 3)}••••••••${s.slice(-4)}` : '[MASKED_ENV_SECRET]';
      str = str.split(s).join(masked);
    }

    str = str.replace(/("x-api-key"\s*:\s*")([^"]+)(")/gi, (_m, p1, val, p3) => {
      const masked = val.length > 8 ? `${val.slice(0, 4)}••••••••${val.slice(-4)}` : '[MASKED]';
      return `${p1}${masked}${p3}`;
    });
    str = str.replace(/("x-api-secret"\s*:\s*")([^"]+)(")/gi, (_m, p1, val, p3) => {
      const masked = val.length > 8 ? `${val.slice(0, 3)}••••••••${val.slice(-4)}` : '[MASKED]';
      return `${p1}${masked}${p3}`;
    });
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

    if (!this.data.providerSecrets) {
      this.data.providerSecrets = {
        prov_goxtop: {
          apiKey: envGoxKey,
          webhookSecret: envGoxSecret
        }
      };
      changed = true;
    } else {
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

    if (!this.data.users || this.data.users.length === 0) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync('PlayUp2026!', salt, 64).toString('hex');
      this.data.users = [
        {
          id: 'usr_player_01',
          name: 'Alex Gamer',
          email: 'alex@playup.gg',
          phone: '+509 3711-2233',
          authProvider: 'email',
          emailVerified: true,
          status: 'active',
          preferredCurrency: 'USD',
          twoFactorEnabled: false,
          emailNotifications: true,
          walletBalance: 45.00,
          ordersCount: 0,
          totalSpent: 0,
          createdAt: '2026-02-15T12:00:00Z',
          lastLoginAt: new Date().toISOString()
        }
      ];
      this.data.userCredentials = {
        usr_player_01: {
          passwordHash: hash,
          passwordSalt: salt
        }
      };
      changed = true;
    }

    if (!this.data.userCredentials) {
      this.data.userCredentials = {};
      changed = true;
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
      adminToken: 'plup_admin_secret_token_2026_secured'
    };

    this.saveDirect(initialSchema);
    return initialSchema;
  }

  private saveDirect(dataToSave: DatabaseSchema) {
    try {
      this.ensureDataDir();
      fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB] Failed to save database file:', err);
    }
  }

  public save() {
    this.saveDirect(this.data);
  }

  public getGames(): Game[] {
    return this.data.games;
  }

  public setGames(games: Game[]) {
    this.data.games = games;
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

  // User Notifications
  public getUserNotifications(userId?: string): UserNotification[] {
    const list = this.data.userNotifications || [];
    if (userId) {
      return list.filter(n => !n.userId || n.userId === userId);
    }
    return list;
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
    return this.data.users || [];
  }

  public setUsers(users: AppUser[]) {
    this.data.users = users;
    this.save();
  }

  public getUserById(userId: string): AppUser | undefined {
    return (this.data.users || []).find(u => u.id === userId || (u.uid && u.uid === userId));
  }

  public getUserByEmail(email: string): AppUser | undefined {
    const clean = email.trim().toLowerCase();
    return (this.data.users || []).find(u => u.email.toLowerCase() === clean);
  }

  public setUserCredential(userId: string, cred: UserCredentialRecord) {
    if (!this.data.userCredentials) {
      this.data.userCredentials = {};
    }
    this.data.userCredentials[userId] = cred;
    this.save();
  }

  public getUserCredential(userId: string): UserCredentialRecord | undefined {
    return this.data.userCredentials?.[userId];
  }

  public generateUserSessionToken(userId: string): string {
    const payload = `${userId}.${Date.now()}`;
    const sig = crypto
      .createHmac('sha256', this.data.adminToken || 'playup_secret')
      .update(payload)
      .digest('hex');
    return `plup_usr_${ Buffer.from(payload).toString('base64url') }.${sig}`;
  }

  public verifyUserSessionToken(token?: string): AppUser | null {
    if (!token || !token.startsWith('plup_usr_')) return null;
    try {
      const raw = token.slice('plup_usr_'.length);
      const [b64Payload, sig] = raw.split('.');
      if (!b64Payload || !sig) return null;
      const payload = Buffer.from(b64Payload, 'base64url').toString('utf8');
      const expectedSig = crypto
        .createHmac('sha256', this.data.adminToken || 'playup_secret')
        .update(payload)
        .digest('hex');
      if (sig !== expectedSig) return null;
      const [userId] = payload.split('.');
      const user = this.getUserById(userId);
      if (!user || user.status === 'suspended') return null;
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
}

export const db = new PlayUpDatabase();
