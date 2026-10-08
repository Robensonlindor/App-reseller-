export type PaymentLifecycleStatus =
  | 'payment_pending'
  | 'payment_processing'
  | 'payment_verified'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'payment_cancelled'
  | 'payment_refunded';

export type RefundLifecycleStatus =
  | 'none'
  | 'refund_pending'
  | 'refunded'
  | 'refund_failed';

export type OrderLifecycleStatus =
  | PaymentLifecycleStatus
  | 'order_pending'
  | 'sent_to_rechargegames'
  | 'order_delivered'
  | 'order_failed'
  | 'manual_review';

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'processing'
  | 'sent_to_rechargegames'
  | 'completed'
  | 'delivered'
  | 'failed'
  | 'manual_review'
  | 'cancelled'
  | 'refunded'
  | PaymentLifecycleStatus
  | 'order_pending'
  | 'order_delivered'
  | 'order_failed';

export type PaymentStatus = 'unconfigured' | 'pending' | 'paid' | 'failed' | PaymentLifecycleStatus;
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
  type: 'order' | 'info' | 'error' | 'refund' | 'wallet';
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
  publicPrice: number;        // PlayUp Selling Price in USD equivalent
  publicPriceHtg?: number;    // PlayUp Selling Price in HTG (Authoritative client price)
  resellerPrice: number;      // PlayUp Reseller Price
  resellerPriceHtg?: number;  // PlayUp Reseller Price in HTG
  supplierCost: number;       // Provider Cost in USD (Never modified in Provider)
  supplierCostUsd?: number;   // Explicit Provider Cost in USD (Immutable for RechargeGames)
  supplierCostHtg?: number;   // Automatically computed Provider Cost in HTG (supplierCostUsd * exchangeRateUsdHtg)
  margin: number;             // PlayUp Margin in USD
  profitHtg?: number;         // PlayUp Benefit in HTG (publicPriceHtg - supplierCostHtg)
  marginHtg?: number;         // PlayUp Margin in HTG (= profitHtg)
  marginPercent?: number;     // PlayUp Margin % in HTG
  exchangeRateUsdHtg?: number;// Applied USD -> HTG exchange rate
  exchangeRateApplied?: number; // Applied USD -> HTG exchange rate
  referenceCurrency?: 'USD';  // Reference currency for supplier prices ('USD')
  sellingCurrency?: 'HTG';    // Selling currency for PlayUp prices ('HTG')
  isManualPriceHtg?: boolean; // True if admin manually set the final selling price in HTG
  manualPriceHtgDefined?: boolean; // True if admin manually set the final selling price in HTG
  currency: string;           // USD / HTG
  isActive: boolean;          // Availability
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
  publicPriceHtg?: number;     // Final PlayUp selling price in HTG
  chargedAmount: number;       // PlayUp selling price paid by user
  chargedAmountHtg?: number;   // PlayUp selling price paid by user in HTG
  supplierCost: number;        // Supplier cost in USD
  supplierCostHtg?: number;    // Supplier cost automatically computed in HTG
  margin: number;              // PlayUp margin
  profitHtg?: number;          // PlayUp profit/margin in HTG
  exchangeRateUsdHtg?: number; // Exchange rate USD -> HTG applied
  currency: string;
  status: OrderStatus;         // pending | paid | processing | completed | failed | cancelled | refunded | manual_review
  payment_status?: PaymentLifecycleStatus;
  lifecycle_status?: OrderLifecycleStatus;
  refund_status?: RefundLifecycleStatus;
  user_status_message?: string;
  dispatch_status?: 'awaiting_payment' | 'ready_to_send' | 'sent' | 'sent_to_rechargegames' | 'pending_retry' | 'manual_review' | 'delivered' | 'failed';
  retry_count?: number;
  max_retries?: number;
  next_retry_at?: string | null;
  last_real_status_check_at?: string;
  last_real_status_observed?: string;
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
  orderTrackerPushAlerts?: boolean;
  orderTrackerEmailAlerts?: boolean;
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
  referenceCurrency?: 'USD';
  sellingCurrency?: 'HTG';
  usdToHtgRate?: number;
  usdToHtgExchangeRate?: number;
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
  orderTrackerPushAlerts?: boolean;
  orderTrackerEmailAlerts?: boolean;
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
  status:
    | PaymentLifecycleStatus
    | 'initiated'
    | 'authorized'
    | 'completed'
    | 'credited'
    | 'rejected'
    | 'manual_review'
    | 'failed'
    | 'cancelled'
    | 'refunded';
  payment_status?: PaymentLifecycleStatus;
  credit_status?: PaymentFinalCreditStatus;
  payment_request_id?: string;
  transcode?: string;
  proof_hash?: string;
  proof_preview_url?: string;
  anti_fraud_decision?: PaymentAntiFraudDecision;
  externalReference?: string;
  payerIdentifier?: string; // e.g. masked card last4 or MonCash/NatCash phone number
  statusMessage: string;
  createdAt: string;
  updatedAt: string;
}

export interface RefundRecord {
  id: string;
  refund_id?: string;
  orderId: string;
  buyerRef: string;
  userId: string;
  userEmail?: string;
  amount: number;
  currency: string;
  reason: string;
  admin_id?: string;
  adminEmail?: string;
  refundMethod?: PaymentMethodType | string;
  ruleApplied: 'order_definitively_failed' | 'provider_confirmed_refunded' | 'playup_policy_refund' | 'admin_manual_approval';
  status: 'refund_pending' | 'refunded' | 'refund_failed' | 'completed' | 'pending' | 'failed';
  refund_status?: RefundLifecycleStatus;
  paymentTransactionReference?: string;
  refundTransactionReference: string;
  createdAt: string;
  confirmedAt?: string;
}

export interface ManualPaymentValidationRecord {
  id: string;
  order_id: string;
  buyer_ref: string;
  admin_id: string;
  admin_email?: string;
  amount: number;
  currency: string;
  previous_status: string;
  new_status: string;
  payment_status: 'payment_verified';
  provider_order_id?: string;
  timestamp: string;
  note?: string;
}

export interface OrderRetryAttemptRecord {
  id: string;
  order_id: string;
  buyer_ref: string;
  attempt_number: number;
  trigger_type: 'automatic' | 'manual_admin';
  admin_id?: string;
  timestamp: string;
  reason: string;
  status: 'succeeded' | 'failed' | 'blocked_already_executed' | 'escalated_manual_review';
  result: string;
  real_status_checked_before: boolean;
  observed_provider_status?: string;
  next_retry_delay_minutes?: number | null;
  next_retry_at?: string | null;
}

// ============================================================================
// RECHARGEGAMES OFFICIAL INTEGRATION DATA STRUCTURES
// ============================================================================

export type RechargeGamesMode = 'TEST' | 'PRODUCTION';
export type RechargeGamesOrderStatus =
  | 'pending'
  | 'order_pending'
  | 'sent_to_rechargegames'
  | 'delivered'
  | 'failed'
  | 'refunded'
  | 'manual_review';

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
  provider_price: number;     // Supplier cost from RechargeGames in USD (NEVER modified)
  provider_price_usd?: number;// Explicit Supplier cost from RechargeGames in USD
  reference_currency?: 'USD'; // Reference currency ('USD')
  currency: string;           // 'USD'
  selling_currency?: 'HTG';   // PlayUp selling currency ('HTG')
  exchange_rate?: number;     // Configured USD -> HTG exchange rate
  exchange_rate_usd_htg?: number; // Configured USD -> HTG exchange rate
  provider_cost_htg?: number; // Automatically calculated supplier cost in HTG (provider_price * exchange_rate_usd_htg)
  playup_price: number;       // Final customer price in USD equivalent
  playup_price_htg?: number;  // Final PlayUp selling price in HTG (shown to client)
  manual_price_htg?: number;  // Manual final PlayUp selling price in HTG if set by admin
  is_manual_price_htg?: boolean; // True if admin manually defined the selling price in HTG
  manual_price_htg_defined?: boolean; // True if admin manually defined the selling price in HTG
  margin_percent: number;     // Applied margin %
  profit_estimate: number;    // playup_price - provider_price (USD)
  profit_htg?: number;        // playup_price_htg - provider_cost_htg (Benefit in HTG)
  margin_htg?: number;        // Benefit/Margin in HTG (= profit_htg)
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
  provider_price: number;     // Supplier cost in USD (Never modified)
  provider_cost_htg?: number; // Automatically computed supplier cost in HTG
  customer_price: number;     // Final PlayUp price charged to customer (USD equivalent)
  customer_price_htg?: number;// Final PlayUp selling price charged to customer in HTG
  profit: number;             // customer_price - provider_price (USD)
  profit_htg?: number;        // customer_price_htg - provider_cost_htg (HTG)
  exchange_rate_usd_htg?: number; // Exchange rate USD -> HTG applied at order time
  currency: string;           // 'USD'
  selling_currency?: 'HTG';   // 'HTG'
  status: RechargeGamesOrderStatus; // 'pending' | 'order_pending' | 'sent_to_rechargegames' | 'delivered' | 'failed' | 'refunded' | 'manual_review'
  payment_status?: PaymentLifecycleStatus;
  lifecycle_status?: OrderLifecycleStatus;
  refund_status?: RefundLifecycleStatus;
  user_status_message?: string;
  dispatch_status?: 'awaiting_payment' | 'ready_to_send' | 'sent' | 'sent_to_rechargegames' | 'pending_retry' | 'manual_review' | 'delivered' | 'failed';
  quantity?: number;
  test_mode: boolean;         // true if created in TEST mode
  payment_method?: string;
  payment_reference?: string;
  payment_transaction_id?: string;
  validated_by_admin_id?: string;
  validated_at?: string;
  created_at: string;
  updated_at: string;
  delivered_at?: string;
  refunded_at?: string;
  refund_reason?: string;
  refund_transaction_id?: string;
  refund_admin_id?: string;
  failure_reason?: string;
  poll_attempts?: number;
  last_polled_at?: string;
  retry_count?: number;
  max_retries?: number;
  next_retry_at?: string | null;
  last_retry_at?: string;
  real_status_verified_before_manual_retry_at?: string;
  real_status_verified_value?: string;
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
 * PlayUp Server-Side Margin & USD -> HTG Reference Currency Configuration for RechargeGames
 */
export interface RechargeGamesMarginConfig {
  referenceCurrency?: 'USD';                 // Reference currency for RechargeGames supplier prices ('USD')
  sellingCurrency?: 'HTG';                   // PlayUp selling currency ('HTG')
  usdToHtgRate?: number;                     // Configurable USD -> HTG exchange rate (default: 132)
  usdToHtgExchangeRate?: number;             // Configurable USD -> HTG exchange rate (default: 132)
  globalMarginPercent: number;               // Default e.g. 20 (%)
  gameMargins: Record<string, number>;       // e.g. { 'Free Fire': 20, 'PUBG Mobile': 18 }
  regionMargins: Record<string, number>;     // e.g. { 'Brazil': 15, 'USA': 20, 'Global': 20 }
  productMargins: Record<string, number>;    // e.g. { 'ff_br_100': 25 } (margin % per product_key)
  manualPricesHtg?: Record<string, number>;  // Manual final PlayUp selling price in HTG per product_key or packageId
  manualProductPricesHtg?: Record<string, number>; // Alias for manual prices in HTG
  updatedAt: string;
}

/**
 * Immutable History Log for USD -> HTG Exchange Rate & PlayUp Price (HTG) Modifications
 */
export interface PriceChangeHistoryEntry {
  id: string;
  changeType: 'exchange_rate' | 'manual_price_htg' | 'margin_update' | 'margin_rule' | 'EXCHANGE_RATE_UPDATE' | 'MANUAL_PRICE_HTG_UPDATE' | 'MARGIN_RULE_UPDATE' | 'SERVICE_PACKAGE_PRICE_UPDATE';
  referenceCurrency: 'USD';
  sellingCurrency: 'HTG';
  serviceId?: string;
  serviceName?: string;
  packageId?: string;
  packageName?: string;
  productKey?: string;
  productName?: string;
  supplierCostUsd?: number;         // Immutable RechargeGames supplier price in USD
  providerPriceUsd?: number;        // Alias for supplier price in USD
  previousSupplierCostHtg?: number; // Provider cost in HTG before modification
  newSupplierCostHtg?: number;      // Provider cost in HTG after modification (supplierCostUsd * newExchangeRate)
  supplierCostHtgBefore?: number;
  supplierCostHtgAfter?: number;
  previousSellingPriceHtg?: number; // Final PlayUp selling price in HTG before modification
  newSellingPriceHtg?: number;      // Final PlayUp selling price in HTG after modification
  sellingPriceHtgBefore?: number;
  sellingPriceHtgAfter?: number;
  profitHtg?: number;               // Benefit in HTG (newSellingPriceHtg - newSupplierCostHtg)
  profitHtgAfter?: number;
  marginPercent?: number;           // Margin % in HTG
  marginPercentAfter?: number;
  previousExchangeRate?: number;
  newExchangeRate?: number;
  adminId?: string;
  adminEmail?: string;
  reason: string;
  summary?: string;
  timestamp: string;
  createdAt?: string;
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
  applicationId?: string;
  version: string;
  buildNumber: number;
  minSdkVersion?: number;
  targetSdkVersion?: number;
  compileSdkVersion?: number;
  supportedAbis?: string[];
  signatureSchemes?: string[];
  certificateSha256Fingerprint?: string;
  verificationPassed?: boolean;
  sizeBytes: number;
  sizeFormatted: string;
  sha256: string;
  mimeType: string;
  downloadUrl: string;
  exists: boolean;
  publishedAt: string;
}

// ============================================================================
// REAL MONCASH & NATCASH OCR PAYMENT WORKFLOW & ANTI-FRAUD ENGINE TYPES
// ============================================================================

export const PLAYUP_OFFICIAL_PAYMENT_NUMBERS: Record<'moncash' | 'natcash', string> = {
  moncash: '+509 48 03 9151',
  natcash: '+509 55964606'
};

export type PaymentFinalCreditStatus =
  | 'pending'
  | 'verifying'
  | 'verified'
  | 'credited'
  | 'rejected'
  | 'refunded'
  | 'manual_review';

export type PaymentAntiFraudDecision =
  | 'PENDING'
  | 'AUTO_APPROVED'
  | 'MANUAL_REVIEW'
  | 'AUTO_REJECTED';

export type PaymentRequestStage =
  | 'select_method'
  | 'awaiting_copy'
  | 'countdown_active'
  | 'awaiting_proof'
  | 'proof_analyzed'
  | 'verifying'
  | 'verified'
  | 'credited'
  | 'refunded'
  | 'manual_review'
  | 'rejected';

export interface PaymentProofOcrExtraction {
  success: boolean;
  engineUsed: string;
  rawText: string;
  detectedTranscode: string | null;
  detectedTranscodeLength: number | null;
  detectedAmount: number | null;
  detectedCurrency: 'USD' | 'HTG' | null;
  detectedMethod: 'moncash' | 'natcash' | 'unknown';
  detectedRecipientNumber: string | null;
  detectedDateTime: string | null;
  detectedSenderPhone: string | null;
  detectedReferenceInfo: string | null;
  confidence: number;
}

export interface PaymentProofForensicAnalysis {
  sha256Hash: string;
  perceptualHash: string;
  mimeType: string;
  fileSizeBytes: number;
  width?: number;
  height?: number;
  isManipulatedOrEdited: boolean;
  editingSoftwareDetected?: string;
  missingTransactionElements: string[];
  visualAnomalies: string[];
  isDuplicateProof: boolean;
  duplicateOfRequestId?: string;
  duplicateOfTransactionId?: string;
}

export interface PaymentRequestRecord {
  id: string;
  user_id: string;
  user_email: string;
  purpose: 'service_order' | 'wallet_topup';
  order_id?: string;
  partner_order_id?: string;
  game_id?: string;
  game_name?: string;
  service_id?: string;
  service_name?: string;
  package_id?: string;
  package_name?: string;
  product_key?: string;
  region?: string;
  player_id?: string;
  player_name?: string;
  server_id?: string;
  game_profile_data?: Record<string, string>;
  payment_method: 'moncash' | 'natcash';
  recipient_number: string;
  expected_amount: number;
  expected_amount_htg: number;
  currency: string;
  stage: PaymentRequestStage;
  status: PaymentFinalCreditStatus;
  idempotency_key?: string;
  request_hash?: string;
  expires_at?: string;
  number_copied: boolean;
  copied_at?: string;
  countdown_duration_seconds: number;
  countdown_ends_at?: string;
  countdown_remaining_seconds?: number;
  countdown_completed: boolean;
  proof_uploaded: boolean;
  proof_uploaded_at?: string;
  proof_hash?: string;
  proof_perceptual_hash?: string;
  proof_file_path?: string;
  proof_preview_data_url?: string;
  ocr_extraction?: Omit<PaymentProofOcrExtraction, 'detectedTranscode'> & {
    detectedTranscode?: string;
    transcodeMasked?: string;
    transcodeDetected: boolean;
  };
  forensic_analysis?: PaymentProofForensicAnalysis;
  detected_transcode_length?: number;
  entered_transcode?: string;
  transcode?: string;
  anti_fraud_score?: number;
  anti_fraud_decision: PaymentAntiFraudDecision;
  rejection_reason?: string;
  user_message?: string;
  credited_transaction_id?: string;
  credited_at?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Table 2: "payment_proofs" (Preuves reçues uniquement — jamais un paiement validé)
 * Contraintes: UNIQUE(file_hash), UNIQUE(transcode) WHERE verification_status IN ('verified', 'credited')
 */
export interface PaymentProofRecord {
  id: string;
  payment_request_id: string;
  user_id: string;
  file_hash: string;
  perceptual_hash?: string | null;
  transcode: string | null;
  detected_amount: number | null;
  detected_method: string | null;
  detected_datetime: string | null;
  ocr_result: string;
  fraud_score: number;
  verification_status: 'received' | 'pending' | 'verifying' | 'verified' | 'credited' | 'rejected' | 'manual_review';
  rejection_reason?: string | null;
  created_at: string;
}

/**
 * Table 3: "validated_payments" (Paiements réellement validés — séparés des preuves reçues)
 * Contraintes: UNIQUE(payment_request_id), UNIQUE(payment_proof_id), UNIQUE(transcode), UNIQUE(payment_method, transcode)
 */
export interface ValidatedPaymentRecord {
  id: string;
  payment_request_id: string;
  payment_proof_id: string;
  user_id: string;
  payment_method: 'moncash' | 'natcash';
  transcode: string;
  validated_amount: number;
  currency: string;
  validation_source: 'ocr_antifraud' | 'manual_admin';
  validated_by_user_id: string | null;
  status: 'validated' | 'credited' | 'refunded' | 'revoked';
  validated_at: string;
  created_at: string;
}

/**
 * Table 4: "idempotency_keys"
 * Contrainte: UNIQUE(user_id, endpoint, idempotency_key)
 */
export interface IdempotencyKeyRecord {
  id: string;
  user_id: string;
  endpoint: string;
  idempotency_key: string;
  request_hash: string;
  response_status: number | null;
  response_body: string | null;
  resource_id: string | null;
  status: 'processing' | 'completed' | 'failed';
  expires_at: string;
  created_at: string;
  completed_at: string | null;
}

/**
 * Table 5: "wallet_transactions"
 * Contraintes: UNIQUE(idempotency_key), UNIQUE(reference), partial UNIQUE per payment_request_id & validated_payment_id
 */
export type WalletTransactionType = 'deposit' | 'debit' | 'refund' | 'adjustment';

export interface WalletTransactionRecord {
  id: string;
  user_id: string;
  payment_request_id: string | null;
  validated_payment_id?: string | null;
  type: WalletTransactionType;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'reversed';
  idempotency_key: string;
  reference: string;
  created_at: string;
}

/**
 * Table 6: "audit_logs"
 */
export interface AuditLogRecord {
  id: string;
  user_id: string | null;
  payment_request_id?: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  idempotency_key: string | null;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: string;
  created_at: string;
}

export interface WalletLedgerReconciliation {
  user_id: string;
  current_wallet_balance: number;
  reconciled_ledger_balance: number;
  is_consistent: boolean;
  total_deposits: number;
  total_debits: number;
  total_refunds: number;
  total_adjustments: number;
  transactions_count: number;
  transactions: WalletTransactionRecord[];
}

export type PaymentAuditEventType =
  | 'PAYMENT_CREATED'
  | 'METHOD_SELECTED'
  | 'NUMBER_COPIED'
  | 'PROOF_UPLOADED'
  | 'OCR_COMPLETED'
  | 'TRANSCODE_DETECTED'
  | 'AMOUNT_DETECTED'
  | 'TRANSCODE_COMPARED'
  | 'ANTIFRAUD_RESULT'
  | 'PAYMENT_VALIDATED'
  | 'PAYMENT_REJECTED'
  | 'PAYMENT_MANUAL_REVIEW'
  | 'WALLET_CREDITED'
  | 'PAYMENT_REFUNDED'
  | 'IDEMPOTENT_REPLAY_RETURNED'
  | 'REPLAY_ATTACK_BLOCKED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INVALID_STATE_TRANSITION_BLOCKED'
  | 'CONCURRENT_LOCK_CONTENTION'
  | 'WALLET_2FA_CHALLENGE_ISSUED'
  | 'WALLET_2FA_VERIFIED'
  | 'WALLET_2FA_FAILED'
  | 'WALLET_WITHDRAWAL_COMPLETED';

export type PaymentIdempotentOperationType =
  | 'payment_creation'
  | 'method_selection'
  | 'number_copy'
  | 'proof_upload'
  | 'payment_verification'
  | 'wallet_credit'
  | 'wallet_withdrawal'
  | 'payment_refund';

export type Wallet2FAChannel = 'sms' | 'email';
export type Wallet2FAOperationType = 'wallet_credit' | 'wallet_withdrawal';

export interface Wallet2FAChallengeRecord {
  id: string;
  user_id: string;
  operation_type: Wallet2FAOperationType;
  channel: Wallet2FAChannel;
  destination: string;
  masked_destination: string;
  payment_request_id: string | null;
  amount: number;
  currency: string;
  code_hash: string;
  status: 'pending' | 'verified' | 'consumed' | 'expired' | 'locked';
  attempts: number;
  max_attempts: number;
  verification_token: string | null;
  expires_at: string;
  verified_at: string | null;
  consumed_at: string | null;
  created_at: string;
}

export interface PaymentIdempotencyRecord {
  idempotency_key: string;
  operation_type: PaymentIdempotentOperationType;
  user_id: string;
  payment_request_id?: string;
  request_id: string;
  nonce?: string;
  payload_hash: string;
  status: 'in_progress' | 'completed' | 'failed';
  http_status: number;
  response_json: string;
  created_at: string;
  completed_at?: string;
  expires_at: string;
  replay_count: number;
}

export interface PaymentSecurityNonceRecord {
  nonce: string;
  user_id: string;
  payment_request_id?: string;
  operation_type: PaymentIdempotentOperationType;
  request_id: string;
  idempotency_key: string;
  client_timestamp: number;
  server_timestamp: number;
  ip_address: string;
  consumed_at: string;
  expires_at: string;
}

export interface PaymentSecurityRateLimitLog {
  id: string;
  user_id?: string;
  ip_address: string;
  session_id?: string;
  api_key_id?: string;
  endpoint: string;
  bucket_type: 'user' | 'ip' | 'session' | 'endpoint' | 'api_key';
  request_count: number;
  limit_max: number;
  window_ms: number;
  blocked: boolean;
  created_at: string;
}

export interface PaymentAuditLogEntry {
  id: string;
  payment_request_id: string;
  user_id: string;
  user_email?: string;
  order_id?: string;
  event_type: PaymentAuditEventType;
  payment_method?: 'moncash' | 'natcash';
  expected_amount?: number;
  detected_amount?: number | null;
  detected_transcode_masked?: string;
  entered_transcode_masked?: string;
  proof_hash?: string;
  anti_fraud_decision?: PaymentAntiFraudDecision;
  status_after?: string;
  summary: string;
  details?: Record<string, any>;
  immutable_hash: string;
  created_at: string;
}

export interface AntiFraudIncidentRecord {
  id: string;
  payment_request_id: string;
  user_id: string;
  user_email?: string;
  payment_method: 'moncash' | 'natcash';
  expected_amount: number;
  detected_amount?: number | null;
  detected_transcode?: string | null;
  entered_transcode?: string | null;
  proof_hash?: string;
  duplicate_of_request_id?: string;
  risk_score: number;
  decision: PaymentAntiFraudDecision;
  reason_code: string;
  reason_message: string;
  anomalies: string[];
  created_at: string;
}





