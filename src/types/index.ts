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
    | 'Erreur réseau'
    | 'Réponse inattendue du fournisseur';
  httpStatus?: number;
  latencyMs: number;
  endpointCalled: string;
  details: string;
  timestamp: string;
  authHeadersUsed?: Record<string, string>;
  gamesCountDetected?: number;
  responseSnippet?: string;
}

export interface ProviderEndpointsConfig {
  getGamesPath: string;         // Documented: GET /api/v.1/games
  getProductsPath: string;      // Documented: GET /api/v.1/products/{game}
  createOrderPath: string;      // Documented: POST /api/v.1/create
  orderStatusPath: string;      // Documented: GET /api/v.1/:partner_orderid
  trackOrderPath: string;       // Documented: POST /api/v.1/:id/track
  checkPlayerPath: string;      // Name Checker endpoint (configurable / REQUIRES GOXTOP DOCUMENTATION if not set)
}

export interface ProviderCustomParam {
  key: string;
  value: string;
  description?: string;
}

export interface Provider {
  id: string;
  slug: string; // e.g., 'goxtop'
  adapterType: 'goxtop' | 'generic_rest';
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
  httpStatus: number;
  latencyMs?: number;
  signatureDetected: boolean; // Oui / Non
  signatureHeaderName?: string;
  signatureValueMasked?: string;
  computedHmacPreview?: string;
  hmacValidation: 'Validée' | 'Valide' | 'Échec' | 'Invalide' | 'Non applicable';
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
  hmacValidation: 'Validée' | 'Valide' | 'Échec' | 'Invalide' | 'Non applicable';
  processingSteps?: string[];
  backendResponse?: any;
  details: string;
  timestamp: string;
}

export interface ProviderOrder {
  id: string;
  playup_order_id: string;
  provider: string;
  provider_order_id: string;
  partner_order_id: string;
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
  requestType:
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
  playerName?: string;
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
  externalProductId?: string; // GoXtop Product ID
  externalGameId?: string;    // GoXtop Game code
  name: string;
  amount: number;
  unit: string;
  publicPrice: number;    // PlayUp Selling Price (= GoXtop cost + PlayUp margin)
  resellerPrice: number;  // PlayUp Reseller Price
  supplierCost: number;   // GoXtop Cost (Never modified in GoXtop)
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

export interface AppUser {
  id: string;
  uid?: string; // Firebase Auth UID if linked
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  authProvider: 'email' | 'google' | 'facebook';
  emailVerified: boolean;
  status: 'active' | 'suspended';
  preferredCurrency: 'USD' | 'HTG' | 'EUR';
  twoFactorEnabled: boolean;
  emailNotifications: boolean;
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

