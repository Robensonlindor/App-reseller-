import { 
  Game, Service, Order, Reseller, ApiKey, SupportTicket, 
  AppSettings, SystemLog, Provider, ConnectionTestResult, ProviderApiLog,
  PlayerCheckResult, UserNotification, ProviderOrder, ProviderWebhookLog, WebhookTestResult,
  AppUser, PaymentGatewayConfig, PaymentTransaction, PaymentMethodType,
  PaymentLifecycleStatus, OrderLifecycleStatus, RefundRecord,
  ManualPaymentValidationRecord, OrderRetryAttemptRecord,
  RechargeGamesMode, RechargeGamesProduct, RechargeGamesOrderRecord,
  RechargeGamesWebhookEvent, RechargeGamesMarginConfig, RechargeGamesConfigState,
  RechargeGamesTestStepResult, AppPackageMetadata, PushNotificationLog,
  EmailDeliveryLog, PushSubscriptionRecord,
  PaymentRequestRecord, PaymentAuditLogEntry, PaymentIdempotentOperationType,
  PriceChangeHistoryEntry
} from '../types';
import { INITIAL_GAMES, INITIAL_SERVICES, INITIAL_SETTINGS } from '../data/initialData';
import { safeStorage } from '../lib/safeStorage';

function getAuthHeaders(tokenOverride?: string): Record<string, string> {
  const token = tokenOverride || safeStorage.getItem('playup_user_token') || safeStorage.getItem('playup_admin_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isHtmlPayload(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html') || trimmed.startsWith('<head');
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithWarmupRetry(url: string, options?: RequestInit, maxRetries = 2): Promise<{ res: Response; text: string }> {
  let lastRes: Response | null = null;
  let lastText = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    const text = await res.text();
    lastRes = res;
    lastText = text;

    // If proxy returned an HTML warmup/gateway page while dev server is starting, retry briefly
    if ((isHtmlPayload(text) || res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxRetries) {
      await delay(500 * (attempt + 1));
      continue;
    }
    break;
  }

  return { res: lastRes!, text: lastText };
}

async function safeFetchArray<T>(url: string, options?: RequestInit, fallback: T[] = []): Promise<T[]> {
  try {
    const { res, text } = await fetchWithWarmupRetry(url, options);
    if (!res.ok || !text || isHtmlPayload(text)) return fallback;
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : fallback;
  } catch {
    return fallback;
  }
}

async function fetchJson<T>(
  url: string,
  options?: RequestInit,
  fallbackErrorMsg = 'Service temporairement indisponible. Veuillez réessayer.'
): Promise<T> {
  let res: Response;
  let text: string;
  try {
    const result = await fetchWithWarmupRetry(url, options);
    res = result.res;
    text = result.text;
  } catch {
    throw new Error(fallbackErrorMsg);
  }

  if (isHtmlPayload(text)) {
    throw new Error(fallbackErrorMsg);
  }

  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(fallbackErrorMsg);
  }

  if (!res.ok) {
    throw new Error(parsed?.error || parsed?.message || fallbackErrorMsg);
  }

  return parsed as T;
}

export const apiClient = {
  // Public
  async getSettings(): Promise<AppSettings> {
    try {
      const data = await fetchJson<AppSettings>('/api/settings', undefined, 'Impossible de charger les paramètres');
      if (data && typeof data === 'object' && data.downloadLinks) {
        return data;
      }
      return INITIAL_SETTINGS;
    } catch {
      return INITIAL_SETTINGS;
    }
  },

  async getGames(): Promise<Game[]> {
    return safeFetchArray<Game>('/api/games', undefined, INITIAL_GAMES);
  },

  async getGame(idOrSlug: string): Promise<Game & { services: Service[] }> {
    return fetchJson<Game & { services: Service[] }>(
      `/api/games/${encodeURIComponent(idOrSlug)}`,
      undefined,
      'Impossible de charger les détails du jeu.'
    );
  },

  async getServices(): Promise<Service[]> {
    return safeFetchArray<Service>('/api/services', undefined, INITIAL_SERVICES);
  },

  // User Authentication & Account Management
  async registerUser(data: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    preferredCurrency?: 'USD' | 'HTG' | 'EUR';
  }): Promise<{ user: AppUser; token: string }> {
    return fetchJson<{ user: AppUser; token: string }>(
      '/api/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      'Erreur lors de la création du compte'
    );
  },

  async loginUser(
    email: string,
    password: string,
    totpCode?: string
  ): Promise<{ user?: AppUser; token?: string; requiresTwoFactor?: boolean; message?: string }> {
    return fetchJson<{ user?: AppUser; token?: string; requiresTwoFactor?: boolean; message?: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, ...(totpCode ? { totpCode } : {}) })
      },
      'Email ou mot de passe incorrect'
    );
  },

  async logoutUser(token?: string): Promise<{ success: boolean }> {
    const activeToken = token || safeStorage.getItem('playup_user_token') || safeStorage.getItem('playup_admin_token') || '';
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {})
        }
      });
      return await res.json();
    } catch {
      return { success: true };
    }
  },

  async socialLoginUser(data: {
    provider: 'google' | 'facebook';
    uid?: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }): Promise<{ user: AppUser; token: string }> {
    return fetchJson<{ user: AppUser; token: string }>(
      '/api/auth/social',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      'Erreur de connexion sociale'
    );
  },

  async forgotUserPassword(email: string): Promise<{
    success: boolean;
    email: string;
    resetCode: string;
    expiresAt: string;
    message: string;
  }> {
    return fetchJson(
      '/api/auth/forgot-password',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      },
      'Impossible de générer le code de réinitialisation'
    );
  },

  async resetUserPassword(data: {
    email: string;
    resetCode: string;
    newPassword: string;
  }): Promise<{ success: boolean; message: string; user: AppUser; token: string }> {
    return fetchJson(
      '/api/auth/reset-password',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      'Erreur lors de la réinitialisation du mot de passe'
    );
  },

  async getUserProfile(token: string): Promise<{
    user: AppUser;
    orders: Order[];
    paymentTransactions: PaymentTransaction[];
    pushNotificationLogs?: PushNotificationLog[];
    emailDeliveryLogs?: EmailDeliveryLog[];
  }> {
    return fetchJson(
      '/api/auth/me',
      {
        headers: { Authorization: `Bearer ${token}` }
      },
      'Session expirée'
    );
  },

  async updateUserProfile(
    token: string,
    data: {
      name?: string;
      phone?: string;
      preferredCurrency?: 'USD' | 'HTG' | 'EUR';
      twoFactorEnabled?: boolean;
      emailNotifications?: boolean;
      pushNotificationsEnabled?: boolean;
      currentPassword?: string;
      newPassword?: string;
      totpCode?: string;
    }
  ): Promise<{ user: AppUser; message: string }> {
    return fetchJson(
      '/api/auth/profile',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(data)
      },
      'Erreur lors de la mise à jour du profil'
    );
  },

  // TOTP (Google Authenticator) Endpoints
  async getTotpStatus(token: string): Promise<{
    enabled: boolean;
    hasPendingSetup: boolean;
    issuer: string;
    accountName: string;
  }> {
    return fetchJson(
      '/api/auth/totp/status',
      {
        headers: { Authorization: `Bearer ${token}` }
      },
      'Impossible de récupérer le statut Google Authenticator'
    );
  },

  async setupTotp(token: string): Promise<{
    secret: string;
    otpauthUrl: string;
    issuer: string;
    accountName: string;
    period: number;
    digits: number;
  }> {
    return fetchJson(
      '/api/auth/totp/setup',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      },
      'Erreur lors de la génération de la clé secrète Google Authenticator'
    );
  },

  async verifyTotpSetup(
    token: string,
    totpCode: string
  ): Promise<{ success: boolean; user: AppUser; message: string }> {
    return fetchJson(
      '/api/auth/totp/verify-setup',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ totpCode })
      },
      'Code Google Authenticator invalide'
    );
  },

  async verifyTotpCode(
    token: string,
    totpCode: string
  ): Promise<{ verified: boolean; message: string }> {
    return fetchJson(
      '/api/auth/totp/verify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ totpCode })
      },
      'Code Google Authenticator invalide'
    );
  },

  async disableTotp(
    token: string,
    totpCode: string
  ): Promise<{ success: boolean; user: AppUser; message: string }> {
    return fetchJson(
      '/api/auth/totp/disable',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ totpCode })
      },
      'Impossible de désactiver Google Authenticator'
    );
  },

  // Payment Gateways
  async getPaymentGateways(): Promise<PaymentGatewayConfig[]> {
    return safeFetchArray<PaymentGatewayConfig>('/api/payments/gateways');
  },

  async validateBeforePayment(data: {
    productKey?: string;
    packageId?: string;
    gameId?: string;
    region?: string;
    playerId?: string;
    serverId?: string;
    quantity?: number;
    paymentMethod?: PaymentMethodType;
  }, token?: string): Promise<{
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
    const res = await fetch('/api/payments/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(token)
      },
      body: JSON.stringify(data)
    });
    return await res.json().catch(() => ({
      valid: false,
      httpStatus: res.status,
      message: 'Erreur lors de la validation pré-paiement.'
    }));
  },

  async processPayment(data: {
    userId?: string;
    paymentMethod: PaymentMethodType;
    amount: number;
    currency?: string;
    purpose?: 'order' | 'wallet_topup';
    productKey?: string;
    packageId?: string;
    gameId?: string;
    region?: string;
    playerId?: string;
    serverId?: string;
    quantity?: number;
    requestedPaymentStatus?: PaymentLifecycleStatus;
    cardDetails?: {
      cardNumber: string;
      expiry: string;
      cvc: string;
      holderName: string;
    };
    mobileWalletDetails?: {
      phone: string;
      otp: string;
    };
  }, token?: string): Promise<{
    success: boolean;
    payment_status?: PaymentLifecycleStatus;
    transaction: PaymentTransaction;
    user?: AppUser;
  }> {
    return fetchJson(
      '/api/payments/process',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(token)
        },
        body: JSON.stringify(data)
      },
      'Échec de la transaction de paiement'
    );
  },

  async checkOrUpdatePaymentStatus(
    transactionRef: string,
    payload?: { action?: 'check' | 'confirm_gateway' | 'cancel' | 'fail'; orderId?: string },
    token?: string
  ): Promise<{
    success: boolean;
    payment_status: PaymentLifecycleStatus;
    transaction: PaymentTransaction;
    recovery?: any;
  }> {
    return fetchJson(
      `/api/payments/${encodeURIComponent(transactionRef)}/status`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(token)
        },
        body: JSON.stringify(payload || { action: 'check' })
      },
      'Erreur lors de la vérification du statut de paiement'
    );
  },

  async getUserRefunds(token?: string): Promise<RefundRecord[]> {
    const authHeaders = getAuthHeaders(token);
    if (!authHeaders.Authorization) return [];
    return safeFetchArray<RefundRecord>('/api/app/refunds', { headers: authHeaders });
  },

  // PlayUp Mobile App
  async checkPlayer(gameId: string, gameProfileData: Record<string, string>, region?: string): Promise<PlayerCheckResult> {
    return fetchJson(
      '/api/app/check-player',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, gameProfileData, region })
      },
      'Erreur lors de la vérification du joueur'
    );
  },

  async getNotifications(userId?: string, token?: string): Promise<UserNotification[]> {
    const authHeaders = getAuthHeaders(token);
    if (!authHeaders.Authorization) return [];
    const url = userId ? `/api/app/notifications?userId=${encodeURIComponent(userId)}` : '/api/app/notifications';
    return safeFetchArray<UserNotification>(url, { headers: authHeaders });
  },

  async markNotificationRead(id: string, token?: string): Promise<void> {
    try {
      await fetch(`/api/app/notifications/${encodeURIComponent(id)}/read`, {
        method: 'POST',
        headers: getAuthHeaders(token)
      });
    } catch {
      // Ignore network hiccup when marking notification read
    }
  },

  async createMobileOrder(data: {
    gameId: string;
    serviceId: string;
    packageId: string;
    gameProfileData: Record<string, string>;
    verifiedPlayerName?: string;
    paymentConfirmed?: boolean;
    paymentMethod?: PaymentMethodType;
    paymentTransactionId?: string;
    paymentReference?: string;
    userId?: string;
    partnerOrderId?: string;
  }, token?: string): Promise<Order> {
    return fetchJson<Order>(
      '/api/app/orders',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(token)
        },
        body: JSON.stringify(data)
      },
      'Erreur lors de la création de la commande'
    );
  },

  async getMobileOrder(orderId: string, token?: string): Promise<Order> {
    return fetchJson<Order>(
      `/api/app/orders/${encodeURIComponent(orderId)}`,
      {
        headers: getAuthHeaders(token)
      },
      'Commande non trouvée'
    );
  },

  async getRecentOrders(userId?: string, token?: string): Promise<Order[]> {
    const authHeaders = getAuthHeaders(token);
    if (!authHeaders.Authorization) return [];
    const url = userId ? `/api/app/orders?userId=${encodeURIComponent(userId)}` : '/api/app/orders';
    return safeFetchArray<Order>(url, { headers: authHeaders });
  },

  // Reseller Portal
  async resellerLogin(email: string, apiKey: string) {
    return fetchJson<{ reseller: Reseller; apiKey: ApiKey }>(
      '/api/v1/auth/reseller-login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, apiKey })
      },
      'Connexion échouée'
    );
  },

  async resellerRegister(data: { name: string; email: string; company?: string }) {
    return fetchJson<{ reseller: Reseller; apiKey: ApiKey }>(
      '/api/v1/auth/reseller-register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      'Inscription échouée'
    );
  },

  async getResellerMe(apiKey: string) {
    return fetchJson<{
      reseller: Reseller;
      stats: any;
      apiKeys: ApiKey[];
      recentOrders: Order[];
      transactions: any[];
      webhookLogs: any[];
    }>(
      '/api/v1/reseller/me',
      {
        headers: { 'x-api-key': apiKey }
      },
      'Session revendeur expirée'
    );
  },

  async createApiKey(apiKey: string, name: string, isTest?: boolean) {
    return fetchJson<ApiKey>(
      '/api/v1/reseller/api-keys',
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify({ name, isTest })
      },
      'Erreur lors de la création de la clé API'
    );
  },

  async revokeApiKey(apiKey: string, keyId: string) {
    return fetchJson(
      `/api/v1/reseller/api-keys/${encodeURIComponent(keyId)}`,
      {
        method: 'DELETE',
        headers: { 'x-api-key': apiKey }
      },
      'Erreur lors de la révocation de la clé API'
    );
  },

  async updateWebhook(apiKey: string, webhookUrl: string) {
    return fetchJson(
      '/api/v1/reseller/webhook',
      {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify({ webhookUrl })
      },
      'Erreur lors de la mise à jour du webhook'
    );
  },

  async testWebhookPing(apiKey: string) {
    return fetchJson<any>(
      '/api/v1/reseller/webhook/test-ping',
      {
        method: 'POST',
        headers: { 'x-api-key': apiKey }
      },
      'Erreur lors du test de ping webhook'
    );
  },

  async depositTestBalance(apiKey: string, amount: number) {
    return fetchJson(
      '/api/v1/reseller/deposit-test',
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify({ amount })
      },
      'Erreur lors du rechargement de solde test'
    );
  },

  // Support
  async createTicket(data: {
    name: string;
    email: string;
    subject: string;
    category: string;
    message: string;
    orderId?: string;
  }): Promise<SupportTicket> {
    return fetchJson<SupportTicket>(
      '/api/support/tickets',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      'Erreur lors de l’envoi du ticket'
    );
  },

  async getTicket(ticketNumber: string): Promise<SupportTicket> {
    return fetchJson<SupportTicket>(
      `/api/support/tickets/${encodeURIComponent(ticketNumber)}`,
      undefined,
      'Ticket non trouvé'
    );
  },

  // Admin APIs (requires admin token)
  async adminLogin(email: string, password: string) {
    return fetchJson<{ token: string; admin: any }>(
      '/api/admin/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      },
      'Connexion administrateur refusée'
    );
  },

  async getAdminStats(token: string) {
    return fetchJson<any>(
      '/api/admin/stats',
      {
        headers: { Authorization: `Bearer ${token}` }
      },
      'Non autorisé'
    );
  },

  async getAdminGames(token: string): Promise<Game[]> {
    return safeFetchArray<Game>('/api/admin/games', {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  async saveAdminGame(token: string, game: Partial<Game>, isNew = false): Promise<Game> {
    const url = isNew ? '/api/admin/games' : `/api/admin/games/${encodeURIComponent(String(game.id || ''))}`;
    const method = isNew ? 'POST' : 'PUT';
    return fetchJson<Game>(
      url,
      {
        method,
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(game)
      },
      'Erreur lors de la sauvegarde du jeu'
    );
  },

  async deleteAdminGame(token: string, id: string) {
    return fetchJson(
      `/api/admin/games/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      },
      'Erreur lors de la suppression du jeu'
    );
  },

  async getAdminServices(token: string): Promise<Service[]> {
    return safeFetchArray<Service>('/api/admin/services', {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  async saveAdminService(token: string, service: Partial<Service>, isNew = false): Promise<Service> {
    const url = isNew ? '/api/admin/services' : `/api/admin/services/${encodeURIComponent(String(service.id || ''))}`;
    const method = isNew ? 'POST' : 'PUT';
    return fetchJson<Service>(
      url,
      {
        method,
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(service)
      },
      'Erreur lors de la sauvegarde du service'
    );
  },

  // Providers & GoXtop Configuration
  async getAdminProviders(token: string): Promise<Provider[]> {
    return safeFetchArray<Provider>('/api/admin/providers', {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  async createAdminProvider(token: string, data: Partial<Provider> & { apiKey?: string; webhookSecret?: string }): Promise<Provider> {
    return fetchJson<Provider>(
      '/api/admin/providers',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(data)
      },
      'Erreur création fournisseur'
    );
  },

  async updateAdminProvider(
    token: string,
    providerId: string,
    data: Partial<Provider> & { apiKey?: string; webhookSecret?: string; clearApiKey?: boolean; clearWebhookSecret?: boolean }
  ): Promise<Provider> {
    return fetchJson<Provider>(
      `/api/admin/providers/${encodeURIComponent(providerId)}`,
      {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(data)
      },
      'Erreur mise à jour fournisseur'
    );
  },

  async revealProviderSecret(token: string, providerId: string, field: 'apiKey' | 'webhookSecret'): Promise<{ value: string }> {
    return fetchJson<{ value: string }>(
      `/api/admin/providers/${encodeURIComponent(providerId)}/reveal-secret`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ field })
      },
      'Accès refusé'
    );
  },

  async testProviderConnection(token: string, providerId: string): Promise<{ testResult: ConnectionTestResult; provider: Provider }> {
    return fetchJson<{ testResult: ConnectionTestResult; provider: Provider }>(
      `/api/admin/providers/${encodeURIComponent(providerId)}/test-connection`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      },
      'Échec de l’appel test'
    );
  },

  async testProviderPing(token: string, providerId: string) {
    return fetchJson(
      `/api/admin/providers/${encodeURIComponent(providerId)}/test-ping`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      },
      'Échec du ping fournisseur'
    );
  },

  async syncProviderCatalog(token: string, providerId: string, syncType: 'games' | 'products' | 'prices') {
    return fetchJson<any>(
      `/api/admin/providers/${encodeURIComponent(providerId)}/sync`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ syncType })
      },
      'Erreur lors de la synchronisation du catalogue'
    );
  },

  async getProviderApiLogs(token: string, providerId = 'all'): Promise<ProviderApiLog[]> {
    return safeFetchArray<ProviderApiLog>(`/api/admin/providers/${encodeURIComponent(providerId)}/logs`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  async getProviderWebhookLogs(token: string, providerId = 'all'): Promise<ProviderWebhookLog[]> {
    return safeFetchArray<ProviderWebhookLog>(`/api/admin/providers/${encodeURIComponent(providerId)}/webhook-logs`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  async testProviderWebhook(
    token: string,
    providerId: string,
    options?: { simulateInvalidSignature?: boolean }
  ): Promise<{ result: WebhookTestResult; provider: Provider; webhookLogs: ProviderWebhookLog[] }> {
    return fetchJson(
      `/api/admin/providers/${encodeURIComponent(providerId)}/test-webhook`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(options || {})
      },
      'Échec du test webhook'
    );
  },

  async getAdminOrders(token: string, filters?: { status?: string; search?: string }): Promise<Order[]> {
    let url = '/api/admin/orders';
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.search) params.append('search', filters.search);
    if (params.toString()) url += `?${params.toString()}`;

    return safeFetchArray<Order>(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  async retryAdminOrder(token: string, orderId: string): Promise<Order> {
    return fetchJson<Order>(
      `/api/admin/orders/${encodeURIComponent(orderId)}/retry`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      },
      'Erreur lors de la relance de la commande'
    );
  },

  async getProviderOrders(token: string): Promise<ProviderOrder[]> {
    return safeFetchArray<ProviderOrder>('/api/admin/provider-orders', {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  async checkAdminOrderStatus(token: string, orderId: string): Promise<{ result: any; order: Order }> {
    return fetchJson(
      `/api/admin/orders/${encodeURIComponent(orderId)}/status-check`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      },
      'Erreur lors de la vérification du statut de la commande'
    );
  },

  async trackAdminOrder(token: string, orderId: string): Promise<{ result: any; order: Order }> {
    return fetchJson(
      `/api/admin/orders/${encodeURIComponent(orderId)}/track`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      },
      'Erreur lors du suivi de la commande'
    );
  },

  async updateAdminOrderStatus(token: string, orderId: string, status: string, note?: string): Promise<Order> {
    return fetchJson<Order>(
      `/api/admin/orders/${encodeURIComponent(orderId)}/status`,
      {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ status, note })
      },
      'Erreur lors de la mise à jour du statut'
    );
  },

  async getAdminResellers(token: string): Promise<Reseller[]> {
    return safeFetchArray<Reseller>('/api/admin/resellers', {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  async adjustResellerBalance(token: string, resellerId: string, amount: number, note?: string) {
    return fetchJson(
      `/api/admin/resellers/${encodeURIComponent(resellerId)}/balance`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ amount, note })
      },
      'Erreur lors de l’ajustement du solde revendeur'
    );
  },

  async updateResellerStatus(token: string, resellerId: string, status: string) {
    return fetchJson(
      `/api/admin/resellers/${encodeURIComponent(resellerId)}/status`,
      {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ status })
      },
      'Erreur lors de la mise à jour du statut revendeur'
    );
  },

  async getAdminSupport(token: string): Promise<SupportTicket[]> {
    return safeFetchArray<SupportTicket>('/api/admin/support', {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  async replyAdminSupport(token: string, ticketId: string, replyText: string, newStatus?: string) {
    return fetchJson(
      `/api/admin/support/${encodeURIComponent(ticketId)}/reply`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ replyText, newStatus })
      },
      'Erreur lors de l’envoi de la réponse au ticket'
    );
  },

  async updateAdminSettings(token: string, settings: Partial<AppSettings>): Promise<AppSettings> {
    return fetchJson<AppSettings>(
      '/api/admin/settings',
      {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(settings)
      },
      'Erreur lors de la sauvegarde des paramètres'
    );
  },

  async getAdminLogs(token: string): Promise<SystemLog[]> {
    return safeFetchArray<SystemLog>('/api/admin/logs', {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  // Admin Users
  async getAdminUsers(token: string): Promise<AppUser[]> {
    return safeFetchArray<AppUser>('/api/admin/users', {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  async updateAdminUserStatus(token: string, userId: string, status: 'active' | 'suspended'): Promise<AppUser> {
    return fetchJson<AppUser>(
      `/api/admin/users/${encodeURIComponent(userId)}/status`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      },
      'Erreur lors de la mise à jour du statut utilisateur'
    );
  },

  async adjustAdminUserWallet(token: string, userId: string, amount: number, note?: string): Promise<AppUser> {
    return fetchJson<AppUser>(
      `/api/admin/users/${encodeURIComponent(userId)}/wallet`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ amount, note })
      },
      'Erreur lors de l’ajustement du portefeuille utilisateur'
    );
  },

  async resetAdminUserPassword(token: string, userId: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    return fetchJson<{ success: boolean; message: string }>(
      `/api/admin/users/${encodeURIComponent(userId)}/reset-password`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ newPassword })
      },
      'Erreur réinitialisation mot de passe'
    );
  },

  // Admin API Keys
  async getAdminApiKeys(token: string): Promise<ApiKey[]> {
    return safeFetchArray<ApiKey>('/api/admin/api-keys', {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  async createAdminResellerApiKey(token: string, resellerId: string, name: string): Promise<ApiKey> {
    return fetchJson<ApiKey>(
      `/api/admin/resellers/${encodeURIComponent(resellerId)}/api-keys`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name })
      },
      'Erreur lors de la création de la clé API revendeur'
    );
  },

  async updateAdminApiKeyStatus(token: string, keyId: string, status: 'active' | 'revoked'): Promise<ApiKey> {
    return fetchJson<ApiKey>(
      `/api/admin/api-keys/${encodeURIComponent(keyId)}/status`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      },
      'Erreur lors de la mise à jour du statut de la clé API'
    );
  },

  // Admin Payment Gateways & Transactions
  async getAdminPaymentGateways(token: string): Promise<PaymentGatewayConfig[]> {
    return safeFetchArray<PaymentGatewayConfig>('/api/admin/payment-gateways', {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  async updateAdminPaymentGateway(
    token: string,
    gatewayId: string,
    data: Partial<PaymentGatewayConfig> & { apiKey?: string; clientSecret?: string; webhookSecret?: string }
  ): Promise<PaymentGatewayConfig> {
    return fetchJson<PaymentGatewayConfig>(
      `/api/admin/payment-gateways/${encodeURIComponent(gatewayId)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(data)
      },
      'Erreur lors de la mise à jour de la passerelle de paiement'
    );
  },

  async getAdminPaymentTransactions(token: string): Promise<PaymentTransaction[]> {
    return safeFetchArray<PaymentTransaction>('/api/admin/payment-transactions', {
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  // ==========================================
  // RECHARGEGAMES OFFICIAL INTEGRATION CLIENT
  // ==========================================

  async getRechargeGamesCatalog(params?: { game?: string; region?: string }): Promise<{
    mode: RechargeGamesMode;
    regionsAvailable: string[];
    gamesAvailable: string[];
    lastSyncedAt: string | null;
    products: RechargeGamesProduct[];
  }> {
    const qs = new URLSearchParams();
    if (params?.game) qs.set('game', params.game);
    if (params?.region) qs.set('region', params.region);
    const url = `/api/rechargegames/catalog${qs.toString() ? `?${qs.toString()}` : ''}`;
    return fetchJson(url, undefined, 'Impossible de charger le catalogue RechargeGames.');
  },

  async createRechargeGamesOrder(payload: {
    userId?: string;
    product_key: string;
    region: string;
    player_id: string;
    player_name?: string;
    server_id?: string;
    quantity?: number;
    buyer_ref?: string;
    paymentConfirmed: boolean;
    paymentStatus?: PaymentLifecycleStatus;
    paymentMethod?: string;
    paymentReference?: string;
    paymentTransactionId?: string;
    allowIdempotentRecovery?: boolean;
  }, token?: string): Promise<{
    success: boolean;
    message: string;
    order: RechargeGamesOrderRecord;
    playupOrder?: Order;
    refundRecord?: RefundRecord;
    user?: AppUser;
  }> {
    const body = await fetchJson<{
      success: boolean;
      message: string;
      order: RechargeGamesOrderRecord;
      playupOrder?: Order;
      refundRecord?: RefundRecord;
      user?: AppUser;
    }>(
      '/api/rechargegames/orders',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(token)
        },
        body: JSON.stringify(payload)
      },
      'Impossible de traiter la commande pour le moment. Veuillez réessayer.'
    );
    if (body.success === false) {
      throw new Error(body.message || 'Impossible de traiter la commande pour le moment. Veuillez réessayer.');
    }
    return body;
  },

  async recoverRechargeGamesOrder(
    orderIdOrBuyerRef: string,
    options?: { paymentStatus?: PaymentLifecycleStatus; paymentReference?: string },
    token?: string
  ): Promise<{
    success: boolean;
    httpStatus: number;
    alreadyDelivered?: boolean;
    recoveredAction: string;
    message: string;
    order?: RechargeGamesOrderRecord;
    playupOrder?: Order;
  }> {
    return fetchJson(
      `/api/rechargegames/orders/${encodeURIComponent(orderIdOrBuyerRef)}/recover`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(token)
        },
        body: JSON.stringify(options || {})
      },
      'Erreur lors de la reprise sécurisée de la commande'
    );
  },

  async getRechargeGamesOrders(userId?: string, token?: string): Promise<RechargeGamesOrderRecord[]> {
    const authHeaders = getAuthHeaders(token);
    if (!authHeaders.Authorization) return [];
    const url = userId
      ? `/api/rechargegames/orders?userId=${encodeURIComponent(userId)}`
      : '/api/rechargegames/orders';
    return safeFetchArray<RechargeGamesOrderRecord>(url, { headers: authHeaders });
  },

  async checkRechargeGamesOrderStatus(orderId: string, token?: string): Promise<{
    success: boolean;
    status: RechargeGamesOrderRecord['status'];
    order?: RechargeGamesOrderRecord;
    message: string;
  }> {
    return fetchJson(
      `/api/rechargegames/orders/${encodeURIComponent(orderId)}/status`,
      {
        headers: getAuthHeaders(token)
      },
      'Impossible de vérifier le statut de la commande.'
    );
  },

  // Admin RechargeGames
  async getRechargeGamesAdminDashboard(token: string): Promise<{
    config: RechargeGamesConfigState;
    metrics: {
      totalProducts: number;
      activeProducts: number;
      unavailableProducts: number;
      pendingOrders: number;
      deliveredOrders: number;
      refundedOrders?: number;
      failedOrders: number;
      manualReviewOrders?: number;
      totalProfitUsd: number;
      apiErrorsCount: number;
    };
    products: RechargeGamesProduct[];
    orders: RechargeGamesOrderRecord[];
    refunds?: RefundRecord[];
    manualPaymentValidations?: ManualPaymentValidationRecord[];
    orderRetryAttempts?: OrderRetryAttemptRecord[];
    webhookEvents: RechargeGamesWebhookEvent[];
    apiLogs: ProviderApiLog[];
  }> {
    return fetchJson(
      '/api/admin/rechargegames/dashboard',
      {
        headers: { Authorization: `Bearer ${token}` }
      },
      'Erreur chargement dashboard RechargeGames'
    );
  },

  async validateRechargeGamesPaymentManually(
    token: string,
    orderId: string,
    options?: {
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
    return fetchJson(
      `/api/admin/rechargegames/orders/${encodeURIComponent(orderId)}/validate-payment`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(options || {})
      },
      'Erreur lors de la validation manuelle du paiement'
    );
  },

  async retryRechargeGamesOrder(
    token: string,
    orderId: string,
    options?: {
      triggerType?: 'automatic' | 'manual_admin';
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
    return fetchJson(
      `/api/admin/rechargegames/orders/${encodeURIComponent(orderId)}/retry`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(options || {})
      },
      'Erreur lors de la nouvelle tentative de commande'
    );
  },

  async getRechargeGamesRefundEligibility(
    token: string,
    orderId: string
  ): Promise<{
    eligible: boolean;
    code: string;
    reason: string;
    preview: {
      orderId: string;
      buyerRef: string;
      providerOrderId: string;
      amount: number;
      currency: string;
      userId: string;
      userName: string;
      userEmail: string;
      productName: string;
      defaultReason: string;
      refundMethod: string;
      currentStatus: string;
      paymentStatus: string;
      refundStatus: string;
    };
  }> {
    return fetchJson(
      `/api/admin/rechargegames/orders/${encodeURIComponent(orderId)}/refund-eligibility`,
      {
        headers: { Authorization: `Bearer ${token}` }
      },
      'Impossible de vérifier l’éligibilité au remboursement'
    );
  },

  async executeRechargeGamesManualRefund(
    token: string,
    orderId: string,
    payload: { reason: string; refundMethod?: string }
  ): Promise<{
    success: boolean;
    httpStatus: number;
    errorCode?: string;
    message: string;
    refundRecord?: RefundRecord;
    order?: RechargeGamesOrderRecord;
    playupOrder?: Order;
  }> {
    return fetchJson(
      `/api/admin/rechargegames/orders/${encodeURIComponent(orderId)}/refund`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      },
      'Erreur lors du remboursement manuel'
    );
  },

  async updateRechargeGamesConfig(
    token: string,
    payload: {
      mode?: RechargeGamesMode;
      baseUrl?: string;
      apiKey?: string;
      webhookSecret?: string;
      autoSyncEnabled?: boolean;
      autoSyncIntervalMinutes?: number;
    }
  ): Promise<{ success: boolean; message: string; mode: RechargeGamesMode; baseUrl: string }> {
    return fetchJson(
      '/api/admin/rechargegames/config',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      },
      'Erreur sauvegarde configuration'
    );
  },

  async testRechargeGamesConnection(token: string): Promise<ConnectionTestResult> {
    return fetchJson(
      '/api/admin/rechargegames/test-connection',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      },
      'Erreur lors du test de connexion RechargeGames'
    );
  },

  async syncRechargeGamesCatalog(token: string): Promise<{
    success: boolean;
    message: string;
    products: RechargeGamesProduct[];
    stats: any;
  }> {
    return fetchJson(
      '/api/admin/rechargegames/sync',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      },
      'Erreur synchronisation catalogue RechargeGames'
    );
  },

  async updateRechargeGamesMargins(
    token: string,
    payload: Partial<RechargeGamesMarginConfig>
  ): Promise<{
    success: boolean;
    message: string;
    margins: RechargeGamesMarginConfig;
    products: RechargeGamesProduct[];
    services?: Service[];
    history?: PriceChangeHistoryEntry[];
  }> {
    return fetchJson(
      '/api/admin/rechargegames/margins',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      },
      'Erreur sauvegarde marges RechargeGames'
    );
  },

  async getPricingHistory(
    token: string,
    filters?: {
      serviceId?: string;
      packageId?: string;
      productKey?: string;
      changeType?: string;
      limit?: number;
    }
  ): Promise<{
    referenceCurrency: 'USD';
    sellingCurrency: 'HTG';
    usdToHtgExchangeRate: number;
    history: PriceChangeHistoryEntry[];
  }> {
    const qs = new URLSearchParams();
    if (filters?.serviceId) qs.set('serviceId', filters.serviceId);
    if (filters?.packageId) qs.set('packageId', filters.packageId);
    if (filters?.productKey) qs.set('productKey', filters.productKey);
    if (filters?.changeType) qs.set('changeType', filters.changeType);
    if (filters?.limit) qs.set('limit', String(filters.limit));
    const url = `/api/admin/pricing/history${qs.toString() ? `?${qs.toString()}` : ''}`;
    return fetchJson(
      url,
      {
        headers: { Authorization: `Bearer ${token}` }
      },
      'Erreur chargement de l’historique des prix et du taux de change'
    );
  },

  async updateUsdToHtgExchangeRate(
    token: string,
    payload: {
      usdToHtgExchangeRate: number;
      reason?: string;
      recalculateAutoSellingPrices?: boolean;
    }
  ): Promise<{
    success: boolean;
    message: string;
    previousExchangeRate: number;
    newExchangeRate: number;
    updatedServicesCount: number;
    updatedPackagesCount: number;
    updatedProductsCount: number;
    historyEntry: PriceChangeHistoryEntry;
    services: Service[];
    products: RechargeGamesProduct[];
    settings: AppSettings;
    history: PriceChangeHistoryEntry[];
  }> {
    return fetchJson(
      '/api/admin/pricing/exchange-rate',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      },
      'Erreur lors de la mise à jour du taux de change USD → HTG'
    );
  },

  async updateManualServicePriceHtg(
    token: string,
    payload: {
      serviceId?: string;
      packageId?: string;
      productKey?: string;
      sellingPriceHtg: number;
      resellerPriceHtg?: number;
      reason?: string;
    }
  ): Promise<{
    success: boolean;
    message: string;
    updatedPackage?: any;
    updatedProduct?: RechargeGamesProduct;
    historyEntry: PriceChangeHistoryEntry;
    services: Service[];
    products: RechargeGamesProduct[];
    history: PriceChangeHistoryEntry[];
  }> {
    return fetchJson(
      '/api/admin/pricing/service-price-htg',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      },
      'Erreur lors de la mise à jour manuelle du prix de vente en HTG'
    );
  },

  async testRechargeGamesWebhook(
    token: string,
    payload: {
      eventType?: 'webhook.test' | 'order.delivered' | 'order.refunded' | 'order.failed';
      orderId?: string;
      simulateInvalidSignature?: boolean;
      simulateDuplicateEvent?: boolean;
      simulateInvalidPayload?: boolean;
    }
  ): Promise<{
    httpStatus: number;
    responseBody: any;
    webhookEvent: RechargeGamesWebhookEvent;
  }> {
    return fetchJson(
      '/api/admin/rechargegames/test-webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      },
      'Erreur lors du test webhook RechargeGames'
    );
  },

  async runRechargeGamesTestSuite(token: string): Promise<{
    allPassed: boolean;
    passedCount: number;
    totalCount: number;
    results: RechargeGamesTestStepResult[];
  }> {
    return fetchJson(
      '/api/admin/rechargegames/run-test-suite',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      },
      'Erreur lors de l’exécution de la suite de tests RechargeGames'
    );
  },

  // Real App Download & Push Notifications
  async getDownloadInfo(): Promise<{
    detectedPlatform: 'android' | 'ios' | 'desktop';
    latestVersion: string;
    packages: {
      android: AppPackageMetadata;
      ios: AppPackageMetadata;
    };
  }> {
    return fetchJson(
      '/api/download/info',
      undefined,
      'Impossible de vérifier les packages de téléchargement'
    );
  },

  async verifyPackageExists(platform: 'android' | 'ios'): Promise<boolean> {
    try {
      const res = await fetch(`/api/download/package?platform=${platform}`, { method: 'HEAD' });
      const contentLen = Number(res.headers.get('content-length') || '0');
      return res.ok && contentLen > 0;
    } catch {
      return false;
    }
  },

  async subscribePushNotifications(
    token: string,
    payload: {
      endpoint: string;
      keys?: { p256dh: string; auth: string };
      devicePlatform: 'android' | 'ios' | 'desktop';
    }
  ): Promise<{
    success: boolean;
    subscription: PushSubscriptionRecord;
    queuedOfflineNotifications: PushNotificationLog[];
  }> {
    return fetchJson(
      '/api/notifications/push-subscribe',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      },
      'Erreur lors de l’activation des notifications push'
    );
  },

  async unsubscribePushNotifications(token: string, endpoint?: string): Promise<{ success: boolean }> {
    return fetchJson(
      '/api/notifications/push-subscribe',
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ endpoint })
      },
      'Erreur lors de la désactivation des notifications push'
    );
  },

  async getNotificationHistory(token: string): Promise<{
    pushNotifications: PushNotificationLog[];
    emailDeliveries: EmailDeliveryLog[];
    newlyDeliveredFromOfflineQueue: PushNotificationLog[];
  }> {
    return fetchJson(
      '/api/notifications/history',
      {
        headers: { Authorization: `Bearer ${token}` }
      },
      'Impossible de charger l’historique des notifications'
    );
  },

  // Order Tracker Status Change Notification Preferences
  async updateOrderTrackerNotifications(
    token: string,
    orderId: string,
    payload: {
      pushAlerts?: boolean;
      emailAlerts?: boolean;
      sendTestStatusAlert?: boolean;
    }
  ): Promise<{
    success: boolean;
    orderId: string;
    orderNumber: string;
    orderTrackerPushAlerts: boolean;
    orderTrackerEmailAlerts: boolean;
    notificationResult?: any;
  }> {
    return fetchJson(
      `/api/orders/${encodeURIComponent(orderId)}/tracker-notifications`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(token)
        },
        body: JSON.stringify(payload)
      },
      'Erreur lors de la mise à jour des alertes Order Tracker'
    );
  },

  // ==========================================================================
  // REAL MONCASH (+509 48 03 9151) & NATCASH (+509 55964606) OCR PAYMENT,
  // ANTI-FRAUD, IDEMPOTENCY, ANTI-REPLAY & ATOMIC WALLET CREDIT CLIENT
  // ==========================================================================

  async issuePaymentSecurityNonce(
    token: string,
    payload?: {
      paymentRequestId?: string;
      operationType?: PaymentIdempotentOperationType;
    }
  ): Promise<{
    success: boolean;
    nonce: string;
    requestId: string;
    serverTimestamp: number;
    expiresAt: string;
    ttlSeconds: number;
  }> {
    return fetchJson(
      '/api/payments/security/nonce',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(token)
        },
        body: JSON.stringify(payload || {})
      },
      'Erreur génération jeton anti-replay'
    );
  },

  async getActivePaymentRequest(
    token: string,
    filters?: { packageId?: string; purpose?: 'service_order' | 'wallet_topup' }
  ): Promise<{
    officialNumbers: Record<'moncash' | 'natcash', string>;
    activeRequest: PaymentRequestRecord | null;
    securityToken: {
      nonce: string;
      requestId: string;
      serverTimestamp: number;
      expiresAt: string;
      ttlSeconds: number;
    };
  }> {
    const params = new URLSearchParams();
    if (filters?.packageId) params.set('packageId', filters.packageId);
    if (filters?.purpose) params.set('purpose', filters.purpose);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchJson(
      `/api/payments/requests/active${qs}`,
      {
        headers: getAuthHeaders(token)
      },
      'Erreur lors de la récupération de la demande de paiement active'
    );
  },

  async getMyPaymentRequests(token: string): Promise<{
    officialNumbers: Record<'moncash' | 'natcash', string>;
    requests: PaymentRequestRecord[];
    auditLogs: PaymentAuditLogEntry[];
  }> {
    return fetchJson(
      '/api/payments/requests/my',
      {
        headers: getAuthHeaders(token)
      },
      'Erreur chargement de vos demandes de paiement'
    );
  },

  async getPaymentRequestById(
    token: string,
    requestId: string
  ): Promise<{
    officialNumbers: Record<'moncash' | 'natcash', string>;
    paymentRequest: PaymentRequestRecord;
    auditLogs: PaymentAuditLogEntry[];
    securityToken: {
      nonce: string;
      requestId: string;
      serverTimestamp: number;
      expiresAt: string;
      ttlSeconds: number;
    };
  }> {
    return fetchJson(
      `/api/payments/requests/${encodeURIComponent(requestId)}`,
      {
        headers: getAuthHeaders(token)
      },
      'Demande de paiement introuvable'
    );
  },

  async createOrResumePaymentRequest(
    token: string,
    payload: {
      paymentMethod: 'moncash' | 'natcash';
      purpose: 'service_order' | 'wallet_topup';
      packageId?: string;
      gameId?: string;
      serviceId?: string;
      playerId?: string;
      playerName?: string;
      serverId?: string;
      region?: string;
      gameProfileData?: Record<string, string>;
      amountUsd?: number;
      forceNew?: boolean;
      idempotencyKey: string;
      requestId?: string;
      nonce?: string;
      clientTimestamp?: number;
    }
  ): Promise<{
    resumedExisting: boolean;
    officialNumbers: Record<'moncash' | 'natcash', string>;
    paymentRequest: PaymentRequestRecord;
    idempotent_replay?: boolean;
    idempotency_key?: string;
    securityToken?: {
      nonce: string;
      requestId: string;
      serverTimestamp: number;
      expiresAt: string;
      ttlSeconds: number;
    };
  }> {
    return fetchJson(
      '/api/payments/requests',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': payload.idempotencyKey,
          ...(payload.requestId ? { 'X-Request-Id': payload.requestId } : {}),
          ...(payload.nonce ? { 'X-Payment-Nonce': payload.nonce } : {}),
          'X-Client-Timestamp': String(payload.clientTimestamp || Date.now()),
          ...getAuthHeaders(token)
        },
        body: JSON.stringify(payload)
      },
      'Erreur lors de l’initialisation de la demande de paiement'
    );
  },

  async selectPaymentRequestMethod(
    token: string,
    requestId: string,
    paymentMethod: 'moncash' | 'natcash'
  ): Promise<{
    officialNumbers: Record<'moncash' | 'natcash', string>;
    paymentRequest: PaymentRequestRecord;
    securityToken?: any;
  }> {
    return fetchJson(
      `/api/payments/requests/${encodeURIComponent(requestId)}/select-method`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(token)
        },
        body: JSON.stringify({ paymentMethod })
      },
      'Erreur lors du changement de méthode de paiement'
    );
  },

  async confirmPaymentNumberCopied(
    token: string,
    requestId: string,
    copiedText: string
  ): Promise<{
    officialNumbers: Record<'moncash' | 'natcash', string>;
    paymentRequest: PaymentRequestRecord;
    securityToken?: any;
  }> {
    return fetchJson(
      `/api/payments/requests/${encodeURIComponent(requestId)}/confirm-copy`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(token)
        },
        body: JSON.stringify({ copiedText })
      },
      'Erreur lors de la validation de la copie du numéro'
    );
  },

  async uploadPaymentProofScreenshot(
    token: string,
    requestId: string,
    payload: {
      imageDataUrl: string;
      fileName?: string;
      idempotencyKey: string;
      requestId?: string;
      nonce?: string;
      clientTimestamp?: number;
    }
  ): Promise<{
    success: boolean;
    transcodeDetected: boolean;
    detectedTranscodeLength: number | null;
    paymentRequest: PaymentRequestRecord;
    idempotent_replay?: boolean;
    securityToken?: {
      nonce: string;
      requestId: string;
      serverTimestamp: number;
      expiresAt: string;
      ttlSeconds: number;
    };
  }> {
    return fetchJson(
      `/api/payments/requests/${encodeURIComponent(requestId)}/upload-proof`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': payload.idempotencyKey,
          ...(payload.requestId ? { 'X-Request-Id': payload.requestId } : {}),
          ...(payload.nonce ? { 'X-Payment-Nonce': payload.nonce } : {}),
          'X-Client-Timestamp': String(payload.clientTimestamp || Date.now()),
          ...getAuthHeaders(token)
        },
        body: JSON.stringify(payload)
      },
      'Erreur lors de l’analyse OCR de la preuve de paiement'
    );
  },

  async verifyPaymentTranscodeAndCredit(
    token: string,
    requestId: string,
    payload: {
      enteredTranscode: string;
      idempotencyKey: string;
      requestId?: string;
      nonce?: string;
      clientTimestamp?: number;
      twoFactorVerificationToken?: string;
      twoFactorChallengeId?: string;
      twoFactorCode?: string;
    }
  ): Promise<{
    success: boolean;
    credited: boolean;
    alreadyProcessed?: boolean;
    twoFactorRequired?: boolean;
    twoFactorBlocked?: boolean;
    errorCode?: string;
    decision: 'AUTO_APPROVED' | 'MANUAL_REVIEW' | 'AUTO_REJECTED' | 'PENDING';
    status: 'pending' | 'credited' | 'rejected' | 'refunded' | 'manual_review';
    reasonCode?: string;
    message: string;
    anomalies?: string[];
    redirectToHome: boolean;
    transaction?: PaymentTransaction;
    paymentRequest: PaymentRequestRecord;
    walletBalance: number;
    user?: AppUser;
    idempotent_replay?: boolean;
  }> {
    const { res, text } = await fetchWithWarmupRetry(
      `/api/payments/requests/${encodeURIComponent(requestId)}/verify-transcode`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': payload.idempotencyKey,
          ...(payload.requestId ? { 'X-Request-Id': payload.requestId } : {}),
          ...(payload.nonce ? { 'X-Payment-Nonce': payload.nonce } : {}),
          ...(payload.twoFactorVerificationToken
            ? { 'X-2FA-Verification-Token': payload.twoFactorVerificationToken }
            : {}),
          ...(payload.twoFactorChallengeId
            ? { 'X-2FA-Challenge-Id': payload.twoFactorChallengeId }
            : {}),
          ...(payload.twoFactorCode ? { 'X-2FA-Code': payload.twoFactorCode } : {}),
          'X-Client-Timestamp': String(payload.clientTimestamp || Date.now()),
          ...getAuthHeaders(token)
        },
        body: JSON.stringify(payload)
      }
    );
    const data = text ? JSON.parse(text) : {};
    if (
      !res.ok &&
      res.status !== 422 &&
      res.status !== 202 &&
      res.status !== 409 &&
      res.status !== 403
    ) {
      throw new Error(data.message || data.error || 'Erreur lors de la vérification du Transcode');
    }
    return data;
  },

  async requestWallet2FAChallenge(
    token: string,
    payload: {
      operationType: 'wallet_credit' | 'wallet_withdrawal';
      channel: 'sms' | 'email';
      paymentRequestId?: string;
      amount: number;
      currency?: string;
      destinationOverride?: string;
    }
  ): Promise<{
    success: boolean;
    challengeId: string;
    operationType: 'wallet_credit' | 'wallet_withdrawal';
    channel: 'sms' | 'email';
    maskedDestination: string;
    amount: number;
    currency: string;
    expiresAt: string;
    expiresInSeconds: number;
    maxAttempts: number;
    deliverySummary: string;
    demoCode?: string;
  }> {
    return fetchJson(
      '/api/wallet/2fa/challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(token)
        },
        body: JSON.stringify(payload)
      },
      'Erreur lors de l’envoi du code 2FA SMS/Email'
    );
  },

  async verifyWallet2FAChallenge(
    token: string,
    payload: {
      challengeId: string;
      code: string;
    }
  ): Promise<{
    verified: boolean;
    twoFactorBlocked?: boolean;
    errorCode?: string;
    message: string;
    verificationToken?: string;
    remainingAttempts?: number;
    challenge?: {
      id: string;
      operationType: 'wallet_credit' | 'wallet_withdrawal';
      channel: 'sms' | 'email';
      maskedDestination: string;
      amount: number;
      currency: string;
      status: string;
      verifiedAt?: string;
    };
  }> {
    const { res, text } = await fetchWithWarmupRetry('/api/wallet/2fa/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(token)
      },
      body: JSON.stringify(payload)
    });
    const data = text ? JSON.parse(text) : {};
    if (!res.ok && res.status !== 403) {
      throw new Error(data.message || data.error || 'Erreur lors de la vérification du code 2FA');
    }
    return data;
  },

  async withdrawWalletFunds(
    token: string,
    payload: {
      amount: number;
      currency?: string;
      payoutMethod: 'moncash' | 'natcash';
      destinationPhone: string;
      idempotencyKey: string;
      twoFactorVerificationToken?: string;
      twoFactorChallengeId?: string;
      twoFactorCode?: string;
    }
  ): Promise<{
    success: boolean;
    withdrawn: boolean;
    twoFactorRequired?: boolean;
    twoFactorBlocked?: boolean;
    errorCode?: string;
    message: string;
    walletBalance: number;
    user?: AppUser;
    paymentTransaction?: PaymentTransaction;
  }> {
    const { res, text } = await fetchWithWarmupRetry('/api/wallet/withdraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': payload.idempotencyKey,
        ...(payload.twoFactorVerificationToken
          ? { 'X-2FA-Verification-Token': payload.twoFactorVerificationToken }
          : {}),
        ...(payload.twoFactorChallengeId
          ? { 'X-2FA-Challenge-Id': payload.twoFactorChallengeId }
          : {}),
        ...(payload.twoFactorCode ? { 'X-2FA-Code': payload.twoFactorCode } : {}),
        'X-Client-Timestamp': String(Date.now()),
        ...getAuthHeaders(token)
      },
      body: JSON.stringify(payload)
    });
    const data = text ? JSON.parse(text) : {};
    if (!res.ok && res.status !== 403 && res.status !== 400 && res.status !== 409) {
      throw new Error(data.message || data.error || 'Erreur lors du retrait Wallet');
    }
    return data;
  },

  async generateSamplePaymentReceiptImage(
    token: string,
    requestId: string,
    payload?: {
      scenario?: 'valid' | 'wrong_amount' | 'wrong_method' | 'manipulated_image';
      customTranscode?: string;
    }
  ): Promise<{
    success: boolean;
    scenario: string;
    imageDataUrl: string;
    sampleTranscodeForUserEntry: string;
    transcodeLength: number;
    receiptSummary: {
      method: 'moncash' | 'natcash';
      recipientNumber: string;
      amountUsd: number;
      amountHtg: number;
      dateTime: string;
    };
  }> {
    return fetchJson(
      `/api/payments/requests/${encodeURIComponent(requestId)}/generate-receipt-image`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(token)
        },
        body: JSON.stringify(payload || { scenario: 'valid' })
      },
      'Erreur lors de la génération du reçu de test OCR'
    );
  },

  async runPaymentConcurrencyAndReplaySelfTest(
    token: string,
    concurrentRequests = 25
  ): Promise<{
    allPassed: boolean;
    summary: {
      concurrentRequestsSent: number;
      uniquePaymentRequestsCreated: number;
      timesWalletCredited: number;
      expectedDeltaUsd: number;
      actualDeltaUsdDuringTest: number;
      expiredReplayBlockedStatus: number;
      idempotencyKeyMismatchBlockedStatus: number;
      irreversibleStateProtected: boolean;
      finalRefundedLockState: string;
    };
  }> {
    return fetchJson(
      '/api/payments/security/concurrency-self-test',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PlayUp-Concurrency-Selftest': 'true',
          ...getAuthHeaders(token)
        },
        body: JSON.stringify({ concurrentRequests })
      },
      'Erreur lors du test de concurrence et anti-replay'
    );
  }
};
