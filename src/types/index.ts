export type OrderStatus = 'pending' | 'paid' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'refunded';
export type PaymentStatus = 'unconfigured' | 'pending' | 'paid' | 'failed';
export type ServiceCategory = 'diamonds' | 'uc' | 'points' | 'robux' | 'coins' | 'pass' | 'voucher';

export type ProviderEnvironment = 'production' | 'sandbox';

export type ConnectionDiagnosticCode =
  | 'SUCCESS'
  | 'CONNECTION_FAILED'
  | 'INVALID_API_KEY'
  | 'INVALID_URL'
  | 'AUTH_ERROR'
  | 'API_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'UNEXPECTED_RESPONSE';

export interface ConnectionTestResult {
  success: boolean;
  code: ConnectionDiagnosticCode;
  label:
    | 'Connexion réussie'
    | 'Échec de connexion'
    | 'API Key invalide'
    | 'URL incorrecte'
    | 'Erreur d\'authentification'
    | 'API indisponible'
    | 'Erreur réseau'
    | 'Réponse inattendue du fournisseur';
  httpStatus?: number;
  latencyMs: number;
  endpointCalled: string;
  details: string;
  timestamp: string;
  authHeadersUsed?: Record<string, string>;
  gamesCountDetected?: number;
  productsCountDetected?: number;
  walletBalance?: number;
  walletCurrency?: string;
  responseSnippet?: string;
}

export interface ProviderEndpointsConfig {
  getGamesPath: string;         // Documented: GET /api/v.1/games
  getProductsPath: string;      // Documented: GET /api/v.1/products/{game}
  createOrderPath: string;      // Documented: POST /api/v.1/create
  orderStatusPath: string;      // Documented: GET /api/v.1/:partner_orderid
  trackOrderPath: string;       // Documented: POST /api/v.1/:partner_orderid/track
  checkPlayerPath: string;      // Documented: GET /api/check/game-check
}

export interface ProviderCustomParam {
  key: string;
  value: string;
  description?: string;
}

export interface Provider {
  id: string;
  slug: string; // e.g., 'goxtop' | 'rechargegames'
  adapterType: 'goxtop' | 'rechargegames' | 'generic_rest';
  name: string;
  apiUrl: string; // API Base URL e.g. https://goxtop.com
  environment: ProviderEnvironment;
  authHeaderName: string; // 'x-api-key'
  hasApiKey: boolean;
  apiKeyMasked: string; // Always masked (e.g. "••••••••••••••••" or "gox_••••9812")
  hasWebhookSecret: boolean;
  webhookSecretMasked: string;
  webhookSignatureHeaderName?: string; // Optional header name if specified by official GoXtop docs
  memberId?: string;
  partnerId?: string;
  merchantId?: string;
  webhookUrl: string; // Auto-generated PlayUp webhook URL: /api/webhooks/goxtop
  isActive: boolean;
  serviceType: string;
  priority: number;
  endpoints: ProviderEndpointsConfig;
  customParams: ProviderCustomParam[];
  latencyMs: number;
  lastPingStatus?: 'online' | 'degraded' | 'offline' | 'untested';
  lastPingLabel?: string;
  lastPingAt?: string;
  lastPingHttpStatus?: number | null;
  lastPingError?: string;
  lastSyncAt?: string;
  lastGamesSyncedCount?: number;
  lastProductsSyncedCount?: number;
  lastProductsAddedCount?: number;
  lastProductsUpdatedCount?: number;
  lastProductsDeactivatedCount?: number;
  webhookLastReceivedAt?: string;
  webhookLastEvent?: string;
  webhookLastHttpStatus?: number;
  webhookLastHmacStatus?: 'Validée' | 'Valide' | 'Échec' | 'Invalide' | 'Non applicable' | string;
  lastWebhookReceivedAt?: string;
  lastWebhookEvent?: string;
  lastWebhookHttpStatus?: number;
  lastWebhookHmacStatus?: 'Validée' | 'Valide' | 'Échec' | 'Invalide' | 'Non applicable' | string;
  lastSyncSummary?: {
    timestamp: string;
    syncType?: string;
    success?: boolean;
    gamesRetrieved?: number;
    productsRetrieved?: number;
    productsAdded?: number;
    productsUpdated?: number;
    productsDeactivated?: number;
    httpStatus?: number | null;
    providerErrorMessage?: string;
    gamesSynced?: number;
    servicesSynced?: number;
    packagesSynced?: number;
    addedCount?: number;
    updatedCount?: number;
    disabledCount?: number;
    status?: 'success' | 'error';
    message?: string;
  };
}

export interface ProviderWebhookLog {
  id: string;
  providerId: string;
  providerName: string;
  timestamp: string;
  eventType: string; // e.g. 'TEST_WEBHOOK' | 'ORDER_STATUS_UPDATE' | 'UNRECOGNIZED_EVENT'
  partnerOrderId?: string;
  goxtopOrderId?: string;
  receivedStatus?: string;
  statusReceived?: string;
  processingResult?: string;
  httpStatus: number;
  latencyMs?: number;
  signatureDetected: boolean; // Oui / Non
  signatureHeader?: string;
  signatureHeaderName?: string;
  signatureValueMasked?: string;
  computedHmacPreview?: string;
  hmacValidation: 'Validée' | 'Valide' | 'Échec' | 'Échouée' | 'Invalide' | 'Non applicable';
  rawPayload?: string;
  headersReceived?: Record<string, string>;
  processingSteps?: string[];
  backendResponse: string;
  errorMessage?: string;
  isInternalTest?: boolean;
}

export interface WebhookTestResult {
  success?: boolean;
  message?: string;
  urlCalled: string;
  httpMethod: 'POST';
  eventType: string;
  resultLabel: string;
  httpStatus: number;
  latencyMs: number;
  signatureDetected: boolean;
  signatureHeaderName?: string;
  signatureValueMasked?: string;
  computedHmacPreview?: string;
  hmacValidation: 'Validée' | 'Valide' | 'Échec' | 'Échouée' | 'Invalide' | 'Non applicable';
  processingSteps?: string[];
  backendResponse?: any;
  details: string;
  timestamp: string;
}

export interface ProviderOrder {
  id: string;
  playup_order_id: string;
  provider?: string;
  provider_name?: string;
  provider_order_id: string;
  partner_order_id: string;
  game_code?: string;
  product_id?: string;
  player_data?: any;
  cost_price?: number;
  selling_price?: number;
  profit?: number;
  request_payload: any;   // Secured / sanitized payload
  response_payload: any;  // Secured / sanitized payload
  status: OrderStatus;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderApiLog {
  id: string;
  providerId: string;
  providerName: string;
  timestamp: string;
  actionType?: string;
  requestType?:
    | 'TEST_CONNECTION'
    | 'GET_GAMES'
    | 'GET_PRODUCTS'
    | 'CHECK_PLAYER'
    | 'CREATE_ORDER'
    | 'GET_ORDER_STATUS'
    | 'TRACK_ORDER'
    | 'WEBHOOK_EVENT';
  httpMethod: 'GET' | 'POST' | 'PUT';
  endpoint: string;
  orderId?: string;
  partnerOrderId?: string;
  httpStatus: number | null;
  latencyMs: number;
  resultLabel: string;
  success: boolean;
  errorMessage?: string;
  requestHeadersMasked?: Record<string, string>;
  requestPreview?: string;
  responsePreview?: string;
}

export interface PlayerCheckResult {
  supported: boolean;
  verified: boolean;
  status?: string;
  playerName?: string;
  playerId?: string;
  region?: string;
  detectedRegion?: string;
  provider?: string;
  game?: string;
  code?: string;
  httpStatus?: number | null;
  endpointCalled?: string;
  ipDetected?: string;
  rawResponse?: any;
  requiresDocumentation?: boolean;
  message: string;
}

export interface UserNotification {
  id: string;
  userId?: string;
  orderId?: string;
  orderNumber?: string;
  title: string;
  message: string;
  type: 'order' | 'info' | 'error' | 'refund';
  read: boolean;
  createdAt: string;
}

export interface GameField {
  id: string;
  name: string; // 'playerId' | 'serverId' | 'zoneId' | 'username' | 'characterId' | 'playerName'
  label: string;
  placeholder: string;
  type: 'text' | 'number' | 'select';
  required: boolean;
  helperText?: string;
  options?: string[];
  validationRegex?: string;
}

export interface Game {
  id: string;
  slug: string;
  name: string;
  externalGameId?: string; // GoXtop {game} identifier
  providerId?: string;
  supportsNameCheck?: boolean; // True if Name Checker is supported (e.g. Free Fire)
  requiresPlayerId?: boolean;  // False for voucher/PIN games that don't need Player ID
  category: string;
  description: string;
  logo: string;
  banner?: string;
  isActive: boolean;
  displayOrder: number;
  fields: GameField[];
  createdAt: string;
  updatedAt: string;
}

export interface ServicePackage {
  id: string;
  serviceId: string;
  externalProductId?: string; // GoXtop Product ID or RechargeGames product_key
  productKey?: string;        // RechargeGames exact product_key
  region?: string;            // Region/Country (e.g. 'Brazil', 'USA', 'Global')
  providerSlug?: string;      // 'rechargegames' | 'goxtop'
  externalGameId?: string;    // Game code
  name: string;
  amount: number;
  unit: string;
  publicPrice: number;    // PlayUp Selling Price (= Supplier cost + PlayUp margin)
  resellerPrice: number;  // PlayUp Reseller Price
  supplierCost: number;   // Provider Cost (Never modified in Provider)
  margin: number;         // PlayUp Margin (publicPrice - supplierCost)
  currency: string;       // USD
  isActive: boolean;      // Availability
  requiresPlayerId?: boolean; // Some products (like gift cards/vouchers) don't need Player ID
  requiredFields?: string[];  // Only fields required by this specific product
  displayOrder: number;
}

export interface Service {
  id: string;
  gameId: string;
  externalGameId?: string;
  name: string;
  description: string;
  category: ServiceCategory;
  providerId: string;
  isActive: boolean;
  displayOrder: number;
  packages: ServicePackage[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  resellerId: string;
  name: string;
  key: string;
  maskedKey: string;
  permissions: string[];
  status: 'active' | 'revoked';
  createdAt: string;
  lastUsedAt?: string;
}

export interface Reseller {
  id: string;
  name: string;
  email: string;
  company: string;
  balance: number;
  currency: string;
  status: 'active' | 'suspended' | 'pending';
  webhookUrl?: string;
  webhookSecret?: string;
  createdAt: string;
  lastActiveAt?: string;
  ordersCount?: number;
  totalSpent?: number;
}

export interface OrderStatusHistoryItem {
  status: OrderStatus;
  timestamp: string;
  note?: string;
}

export interface Order {
  id: string;                  // PlayUp Order ID
  orderNumber: string;         // e.g. PLUP-2026-9812
  partnerOrderId: string;      // Unique server-side partner_orderid (idempotency key)
  externalOrderId?: string;    // GoXtop Order ID (provider_order_id)
  source: 'mobile_app' | 'reseller_api';
  userId?: string;
  resellerId?: string;
  resellerName?: string;
  gameId: string;
  externalGameId?: string;
  gameName: string;
  serviceId: string;
  serviceName: string;
  packageId: string;
  externalProductId?: string;
  packageName: string;
  playerId?: string;
  verifiedPlayerName?: string; // Confirmed player name via GoXtop Name Checker
  serverId?: string;
  gameProfileData: Record<string, string>;
  publicPrice: number;
  chargedAmount: number;       // PlayUp selling price paid by user
  supplierCost: number;        // GoXtop cost
  margin: number;              // PlayUp margin
  currency: string;
  status: OrderStatus;         // pending | paid | processing | completed | failed | cancelled | refunded
  paymentMethod?: PaymentMethodType;
  paymentTransactionId?: string;
  paymentReference?: string;
  providerId: string;
  providerName: string;
  providerReference?: string;
  providerResponse?: any;
  errorMessage?: string;
  refundInfo?: string;
  createdAt: string;
  updatedAt: string;
  statusHistory: OrderStatusHistoryItem[];
}

export interface Transaction {
  id: string;
  transactionNumber: string;
  entityType: 'reseller' | 'user';
  entityId: string;
  type: 'credit' | 'debit' | 'refund';
  amount: number;
  currency: string;
  orderId?: string;
  note: string;
  createdAt: string;
}

export interface WebhookLog {
  id: string;
  resellerId: string;
  orderId: string;
  event: string;
  url: string;
  httpStatus: number;
  attempts: number;
  payload: any;
  response: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  userId?: string;
  resellerId?: string;
  email: string;
  name: string;
  subject: string;
  category: 'order' | 'api' | 'payment' | 'account' | 'other';
  orderId?: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  message: string;
  messages: {
    id: string;
    sender: 'user' | 'agent' | 'system';
    senderName: string;
    text: string;
    createdAt: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  platformName: string;
  primaryColor: string;
  supportEmail: string;
  contactTelegram?: string;
  contactWhatsApp?: string;
  downloadLinks: {
    androidApkUrl: string;
    googlePlayUrl: string;
    iosAppStoreUrl: string;
    appVersion: string;
    apkFileSize: string;
  };
  maintenanceMode: boolean;
  announcementNotice?: string;
  paymentGatewayConfigured: boolean;
  apiRateLimitPerMinute: number;
  defaultProviderId?: string;
}

export interface SystemLog {
  id: string;
  level: 'info' | 'warn' | 'error';
  module: 'api' | 'order' | 'provider' | 'webhook' | 'auth' | 'system' | 'payment';
  message: string;
  meta?: any;
  timestamp: string;
}

export type UserRole = 'USER' | 'ADMIN';

export interface AppUser {
  id: string;
  uid?: string; // Firebase Auth UID if linked
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  role: UserRole;
  authProvider: 'email' | 'google' | 'facebook';
  emailVerified: boolean;
  status: 'active' | 'suspended';
  preferredCurrency: 'USD' | 'HTG' | 'EUR';
  twoFactorEnabled: boolean;
  emailNotifications: boolean;
  pushNotificationsEnabled?: boolean;
  walletBalance: number;
  ordersCount: number;
  totalSpent: number;
  createdAt: string;
  lastLoginAt: string;
}

export type PaymentMethodType = 'card' | 'moncash' | 'natcash' | 'wallet';

export interface PaymentGatewayConfig {
  id: string;
  slug: PaymentMethodType;
  name: string;
  providerName: string; // e.g. 'Stripe / Visa & Mastercard', 'Digicel MonCash API', 'Natcom NatCash API', 'PlayUp Wallet'
  description: string;
  isEnabled: boolean;
  mode: 'sandbox' | 'live';
  supportedCurrencies: string[];
  feePercent: number;
  fixedFee: number;
  hasCredentials: boolean;
  credentialsMasked: string;
  webhookUrl: string;
  instructions?: string;
  lastTransactionAt?: string;
}

export interface PaymentTransaction {
  id: string;
  transactionReference: string;
  orderId?: string;
  orderNumber?: string;
  partnerOrderId?: string;
  userId: string;
  userEmail?: string;
  gatewayId: string;
  paymentMethod: PaymentMethodType;
  amount: number;
  currency: string;
  feeAmount: number;
  totalCharged: number;
  status: 'initiated' | 'authorized' | 'completed' | 'failed' | 'refunded';
  externalReference?: string;
  payerIdentifier?: string; // e.g. masked card last4 or MonCash/NatCash phone number
  statusMessage: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// RECHARGEGAMES OFFICIAL INTEGRATION DATA STRUCTURES
// ============================================================================

export type RechargeGamesMode = 'TEST' | 'PRODUCTION';
export type RechargeGamesOrderStatus = 'pending' | 'delivered' | 'failed' | 'refunded';

/**
 * Table: products (RechargeGames synchronized catalog)
 */
export interface RechargeGamesProduct {
  id: string;
  provider: 'rechargegames';
  product_key: string;        // Exact product_key provided by RechargeGames
  game: string;               // e.g. 'Free Fire', 'PUBG Mobile', 'Mobile Legends', 'Call of Duty: Mobile', 'Roblox'
  game_slug?: string;         // e.g. 'free-fire', 'pubg-mobile'
  region: string;             // e.g. 'Brazil', 'USA', 'Global', 'Europe', 'LATAM'
  name: string;               // Product display name
  topup_value: string;        // e.g. '100 Diamonds', '60 UC'
  amount?: number;            // Numeric value e.g. 100
  unit?: string;              // e.g. 'Diamonds', 'UC', 'CP', 'Robux'
  provider_price: number;     // Supplier cost from RechargeGames
  currency: string;           // e.g. 'USD'
  playup_price: number;       // Final customer price computed server-side with PlayUp margin
  margin_percent: number;     // Applied margin %
  profit_estimate: number;    // playup_price - provider_price
  active: boolean;            // Availability from RechargeGames
  requires_player_id?: boolean;
  last_synced_at: string;     // ISO timestamp
  raw_metadata?: Record<string, any>;
}

/**
 * Table: orders (RechargeGames orders with buyer_ref and status lifecycle)
 */
export interface RechargeGamesOrderRecord {
  id: string;                 // PlayUp Order ID e.g. 'PU-10235'
  user_id: string;            // User ID
  provider: 'rechargegames';
  provider_order_id: string;  // RechargeGames Order ID (used in GET /v1/orders/{order_id})
  buyer_ref: string;          // Unique idempotency key e.g. 'PLAYUP-20261005-000001'
  product_key: string;        // Exact RechargeGames product_key
  product_name: string;       // Display name of the product
  game: string;               // Game name
  region: string;             // Product region ('Brazil', 'USA', 'Global', etc.)
  player_id: string;          // Player ID
  player_name?: string;       // Verified or provided player name
  server_id?: string;         // Optional zone/server ID
  provider_price: number;     // Supplier cost
  customer_price: number;     // Final PlayUp price charged to customer
  profit: number;             // customer_price - provider_price
  currency: string;           // 'USD'
  status: RechargeGamesOrderStatus; // 'pending' | 'delivered' | 'failed' | 'refunded'
  test_mode: boolean;         // true if created in TEST mode
  payment_method?: string;
  payment_reference?: string;
  created_at: string;
  updated_at: string;
  delivered_at?: string;
  refunded_at?: string;
  refund_reason?: string;
  refund_transaction_id?: string;
  failure_reason?: string;
  poll_attempts?: number;
  last_polled_at?: string;
}

/**
 * Table: webhook_events (RechargeGames webhook deduplication & audit log)
 */
export interface RechargeGamesWebhookEvent {
  event_id: string;           // Unique webhook-id or event_id
  event_type: string;         // 'webhook.test' | 'order.delivered' | 'order.refunded' | 'order.failed'
  provider: 'rechargegames';
  order_id?: string;          // RechargeGames order_id or PlayUp order id
  provider_order_id?: string; // RechargeGames order_id
  playup_order_id?: string;   // PlayUp order ID (PU-...)
  buyer_ref?: string;         // buyer_ref if included
  received_at: string;
  processed_at?: string;
  processing_status:
    | 'processed'
    | 'rejected_signature'
    | 'duplicate_ignored'
    | 'order_not_found'
    | 'invalid_payload'
    | 'error';
  signature_valid: boolean;
  webhook_timestamp?: string;
  signature_header?: string;
  signature_masked?: string;
  computed_hmac_preview?: string;
  payload_preview?: string;
  error_message?: string;
  processing_steps?: string[];
  firestore_doc_path?: string;
  firestore_idempotency_status?: 'stored' | 'duplicate_blocked' | 'skipped_unverified';
  firestore_synced_at?: string;
}

/**
 * Firestore /webhook_events/{eventId} immutable idempotency document
 */
export interface FirestoreWebhookIdempotencyRecord {
  eventId: string;
  provider: 'rechargegames';
  eventType: 'webhook.test' | 'order.delivered' | 'order.refunded' | 'order.failed';
  providerOrderId?: string;
  playupOrderId?: string;
  buyerRef?: string;
  status: 'processed';
  signatureHash: string;
  processedAt: string;
  firestoreDocPath: string;
}

/**
 * PlayUp Server-Side Margin Configuration for RechargeGames
 */
export interface RechargeGamesMarginConfig {
  globalMarginPercent: number;            // Default e.g. 20 (%)
  gameMargins: Record<string, number>;    // e.g. { 'Free Fire': 20, 'PUBG Mobile': 18 }
  regionMargins: Record<string, number>;  // e.g. { 'Brazil': 15, 'USA': 20, 'Global': 20 }
  productMargins: Record<string, number>; // e.g. { 'ff_br_100': 25 } (margin % per product_key)
  updatedAt: string;
}

export interface RechargeGamesSyncStats {
  lastSyncedAt: string | null;
  totalProducts: number;
  activeProducts: number;
  unavailableProducts: number;
  regionsAvailable: string[];
  gamesAvailable: string[];
  syncErrors: string[];
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
}

export interface RechargeGamesConfigState {
  mode: RechargeGamesMode;                // 'TEST' | 'PRODUCTION'
  baseUrl: string;                        // RECHARGEGAMES_BASE_URL
  hasApiKey: boolean;
  apiKeyMasked: string;
  hasWebhookSecret: boolean;
  webhookSecretMasked: string;
  webhookEndpoint: string;                // '/api/webhooks/rechargegames'
  connectionStatus: 'connected' | 'error' | 'untested';
  lastConnectionLabel: string;
  lastConnectionTestedAt?: string;
  syncStats: RechargeGamesSyncStats;
  margins: RechargeGamesMarginConfig;
}

export interface RechargeGamesTestStepResult {
  testNumber: number;
  name: string;
  passed: boolean;
  durationMs: number;
  details: string;
  evidence?: Record<string, any>;
}

// ============================================================================
// REAL-TIME PUSH NOTIFICATIONS, EMAIL DELIVERY & PACKAGE DOWNLOAD TYPES
// ============================================================================

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  userEmail?: string;
  endpoint: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
  devicePlatform: 'android' | 'ios' | 'desktop';
  userAgent: string;
  active: boolean;
  createdAt: string;
  lastSeenAt: string;
}

export interface PushNotificationLog {
  id: string;
  userId: string;
  orderId: string;
  orderNumber: string;
  title: string;
  body: string;
  deliveredDateLabel: string;
  deliveredTimeLabel: string;
  status: 'sent' | 'queued_offline' | 'delivered_to_device' | 'failed' | 'skipped_disabled';
  errorMessage?: string;
  createdAt: string;
  deliveredAt?: string;
}

export interface EmailDeliveryLog {
  id: string;
  userId: string;
  recipientEmail: string;
  orderId: string;
  orderNumber: string;
  subject: string;
  bodyText: string;
  deliveredDateLabel: string;
  deliveredTimeLabel: string;
  status: 'sent' | 'failed' | 'skipped_disabled';
  transportUsed: 'smtp' | 'webhook_relay' | 'internal_mail_spool';
  errorMessage?: string;
  createdAt: string;
}

export interface AppPackageMetadata {
  platform: 'android' | 'ios';
  fileName: string;
  version: string;
  buildNumber: number;
  sizeBytes: number;
  sizeFormatted: string;
  sha256: string;
  mimeType: string;
  downloadUrl: string;
  exists: boolean;
  publishedAt: string;
}



