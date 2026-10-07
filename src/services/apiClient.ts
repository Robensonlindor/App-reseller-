import { 
  Game, Service, Order, Reseller, ApiKey, SupportTicket, 
  AppSettings, SystemLog, Provider, ConnectionTestResult, ProviderApiLog,
  PlayerCheckResult, UserNotification, ProviderOrder, ProviderWebhookLog, WebhookTestResult,
  AppUser, PaymentGatewayConfig, PaymentTransaction, PaymentMethodType,
  RechargeGamesMode, RechargeGamesProduct, RechargeGamesOrderRecord,
  RechargeGamesWebhookEvent, RechargeGamesMarginConfig, RechargeGamesConfigState,
  RechargeGamesTestStepResult, AppPackageMetadata, PushNotificationLog,
  EmailDeliveryLog, PushSubscriptionRecord
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

  async loginUser(email: string, password: string): Promise<{ user: AppUser; token: string }> {
    return fetchJson<{ user: AppUser; token: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      },
      'Email ou mot de passe incorrect'
    );
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

  // Payment Gateways
  async getPaymentGateways(): Promise<PaymentGatewayConfig[]> {
    return safeFetchArray<PaymentGatewayConfig>('/api/payments/gateways');
  },

  async processPayment(data: {
    userId?: string;
    paymentMethod: PaymentMethodType;
    amount: number;
    currency?: string;
    purpose?: 'order' | 'wallet_topup';
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
  }, token?: string): Promise<{ success: boolean; transaction: PaymentTransaction; user?: AppUser }> {
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
    buyer_ref?: string;
    paymentConfirmed: boolean;
    paymentMethod?: string;
    paymentReference?: string;
  }, token?: string): Promise<{
    success: boolean;
    message: string;
    order: RechargeGamesOrderRecord;
    playupOrder?: Order;
  }> {
    const body = await fetchJson<{
      success: boolean;
      message: string;
      order: RechargeGamesOrderRecord;
      playupOrder?: Order;
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
    status: 'pending' | 'delivered' | 'failed';
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
      totalProfitUsd: number;
      apiErrorsCount: number;
    };
    products: RechargeGamesProduct[];
    orders: RechargeGamesOrderRecord[];
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
  }
};
