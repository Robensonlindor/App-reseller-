import { 
  Game, Service, Order, Reseller, ApiKey, SupportTicket, 
  AppSettings, SystemLog, Provider, ConnectionTestResult, ProviderApiLog,
  PlayerCheckResult, UserNotification, ProviderOrder
} from '../types';

export const apiClient = {
  // Public
  async getSettings(): Promise<AppSettings> {
    const res = await fetch('/api/settings');
    return res.json();
  },

  async getGames(): Promise<Game[]> {
    const res = await fetch('/api/games');
    return res.json();
  },

  async getGame(idOrSlug: string): Promise<Game & { services: Service[] }> {
    const res = await fetch(`/api/games/${idOrSlug}`);
    return res.json();
  },

  async getServices(): Promise<Service[]> {
    const res = await fetch('/api/services');
    return res.json();
  },

  // PlayUp Mobile App
  async checkPlayer(gameId: string, gameProfileData: Record<string, string>): Promise<PlayerCheckResult> {
    const res = await fetch('/api/app/check-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, gameProfileData })
    });
    return res.json();
  },

  async getNotifications(userId?: string): Promise<UserNotification[]> {
    const url = userId ? `/api/app/notifications?userId=${encodeURIComponent(userId)}` : '/api/app/notifications';
    const res = await fetch(url);
    return res.json();
  },

  async markNotificationRead(id: string): Promise<void> {
    await fetch(`/api/app/notifications/${id}/read`, { method: 'POST' });
  },

  async createMobileOrder(data: {
    gameId: string;
    serviceId: string;
    packageId: string;
    gameProfileData: Record<string, string>;
    verifiedPlayerName?: string;
    paymentConfirmed?: boolean;
    userId?: string;
    partnerOrderId?: string;
  }): Promise<Order> {
    const res = await fetch('/api/app/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Erreur lors de la création de la commande');
    }
    return res.json();
  },

  async getMobileOrder(orderId: string): Promise<Order> {
    const res = await fetch(`/api/app/orders/${orderId}`);
    if (!res.ok) throw new Error('Commande non trouvée');
    return res.json();
  },

  async getRecentOrders(userId?: string): Promise<Order[]> {
    const url = userId ? `/api/app/orders?userId=${encodeURIComponent(userId)}` : '/api/app/orders';
    const res = await fetch(url);
    return res.json();
  },

  // Reseller Portal
  async resellerLogin(email: string) {
    const res = await fetch('/api/v1/auth/reseller-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Connexion échouée');
    }
    return res.json();
  },

  async resellerRegister(data: { name: string; email: string; company?: string }) {
    const res = await fetch('/api/v1/auth/reseller-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Inscription échouée');
    }
    return res.json();
  },

  async getResellerMe(resellerId: string) {
    const res = await fetch('/api/v1/reseller/me', {
      headers: { 'x-reseller-id': resellerId }
    });
    if (!res.ok) throw new Error('Session revendeur expirée');
    return res.json();
  },

  async createApiKey(resellerId: string, name: string, isTest?: boolean) {
    const res = await fetch('/api/v1/reseller/api-keys', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-reseller-id': resellerId 
      },
      body: JSON.stringify({ name, isTest })
    });
    return res.json();
  },

  async revokeApiKey(resellerId: string, keyId: string) {
    const res = await fetch(`/api/v1/reseller/api-keys/${keyId}`, {
      method: 'DELETE',
      headers: { 'x-reseller-id': resellerId }
    });
    return res.json();
  },

  async updateWebhook(resellerId: string, webhookUrl: string) {
    const res = await fetch('/api/v1/reseller/webhook', {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'x-reseller-id': resellerId 
      },
      body: JSON.stringify({ webhookUrl })
    });
    return res.json();
  },

  async testWebhookPing(resellerId: string) {
    const res = await fetch('/api/v1/reseller/webhook/test-ping', {
      method: 'POST',
      headers: { 'x-reseller-id': resellerId }
    });
    return res.json();
  },

  async depositTestBalance(resellerId: string, amount: number) {
    const res = await fetch('/api/v1/reseller/deposit-test', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-reseller-id': resellerId 
      },
      body: JSON.stringify({ amount })
    });
    return res.json();
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
    const res = await fetch('/api/support/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur lors de l’envoi du ticket');
    }
    return res.json();
  },

  async getTicket(ticketNumber: string): Promise<SupportTicket> {
    const res = await fetch(`/api/support/tickets/${ticketNumber}`);
    if (!res.ok) throw new Error('Ticket non trouvé');
    return res.json();
  },

  // Admin APIs (requires admin token)
  async adminLogin(email: string, password: string) {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Connexion administrateur refusée');
    }
    return res.json();
  },

  async getAdminStats(token: string) {
    const res = await fetch('/api/admin/stats', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Non autorisé');
    return res.json();
  },

  async getAdminGames(token: string): Promise<Game[]> {
    const res = await fetch('/api/admin/games', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async saveAdminGame(token: string, game: Partial<Game>, isNew = false): Promise<Game> {
    const url = isNew ? '/api/admin/games' : `/api/admin/games/${game.id}`;
    const method = isNew ? 'POST' : 'PUT';
    const res = await fetch(url, {
      method,
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify(game)
    });
    return res.json();
  },

  async deleteAdminGame(token: string, id: string) {
    const res = await fetch(`/api/admin/games/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async getAdminServices(token: string): Promise<Service[]> {
    const res = await fetch('/api/admin/services', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async saveAdminService(token: string, service: Partial<Service>, isNew = false): Promise<Service> {
    const url = isNew ? '/api/admin/services' : `/api/admin/services/${service.id}`;
    const method = isNew ? 'POST' : 'PUT';
    const res = await fetch(url, {
      method,
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify(service)
    });
    return res.json();
  },

  // Providers & GoXtop Configuration
  async getAdminProviders(token: string): Promise<Provider[]> {
    const res = await fetch('/api/admin/providers', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async createAdminProvider(token: string, data: Partial<Provider> & { apiKey?: string; webhookSecret?: string }): Promise<Provider> {
    const res = await fetch('/api/admin/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur création fournisseur');
    }
    return res.json();
  },

  async updateAdminProvider(
    token: string,
    providerId: string,
    data: Partial<Provider> & { apiKey?: string; webhookSecret?: string; clearApiKey?: boolean; clearWebhookSecret?: boolean }
  ): Promise<Provider> {
    const res = await fetch(`/api/admin/providers/${providerId}`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur mise à jour fournisseur');
    }
    return res.json();
  },

  async revealProviderSecret(token: string, providerId: string, field: 'apiKey' | 'webhookSecret'): Promise<{ value: string }> {
    const res = await fetch(`/api/admin/providers/${providerId}/reveal-secret`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ field })
    });
    if (!res.ok) throw new Error('Accès refusé');
    return res.json();
  },

  async testProviderConnection(token: string, providerId: string): Promise<{ testResult: ConnectionTestResult; provider: Provider }> {
    const res = await fetch(`/api/admin/providers/${providerId}/test-connection`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Échec de l’appel test');
    return res.json();
  },

  async testProviderPing(token: string, providerId: string) {
    const res = await fetch(`/api/admin/providers/${providerId}/test-ping`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async syncProviderCatalog(token: string, providerId: string, syncType: 'games' | 'products' | 'prices') {
    const res = await fetch(`/api/admin/providers/${providerId}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ syncType })
    });
    return res.json();
  },

  async getProviderApiLogs(token: string, providerId = 'all'): Promise<ProviderApiLog[]> {
    const res = await fetch(`/api/admin/providers/${providerId}/logs`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async getAdminOrders(token: string, filters?: { status?: string; search?: string }): Promise<Order[]> {
    let url = '/api/admin/orders';
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.search) params.append('search', filters.search);
    if (params.toString()) url += `?${params.toString()}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async retryAdminOrder(token: string, orderId: string): Promise<Order> {
    const res = await fetch(`/api/admin/orders/${orderId}/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async getProviderOrders(token: string): Promise<ProviderOrder[]> {
    const res = await fetch('/api/admin/provider-orders', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async checkAdminOrderStatus(token: string, orderId: string): Promise<{ result: any; order: Order }> {
    const res = await fetch(`/api/admin/orders/${orderId}/status-check`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async trackAdminOrder(token: string, orderId: string): Promise<{ result: any; order: Order }> {
    const res = await fetch(`/api/admin/orders/${orderId}/track`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async updateAdminOrderStatus(token: string, orderId: string, status: string, note?: string): Promise<Order> {
    const res = await fetch(`/api/admin/orders/${orderId}/status`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify({ status, note })
    });
    return res.json();
  },

  async getAdminResellers(token: string): Promise<Reseller[]> {
    const res = await fetch('/api/admin/resellers', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async adjustResellerBalance(token: string, resellerId: string, amount: number, note?: string) {
    const res = await fetch(`/api/admin/resellers/${resellerId}/balance`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify({ amount, note })
    });
    return res.json();
  },

  async updateResellerStatus(token: string, resellerId: string, status: string) {
    const res = await fetch(`/api/admin/resellers/${resellerId}/status`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify({ status })
    });
    return res.json();
  },

  async getAdminSupport(token: string): Promise<SupportTicket[]> {
    const res = await fetch('/api/admin/support', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  },

  async replyAdminSupport(token: string, ticketId: string, replyText: string, newStatus?: string) {
    const res = await fetch(`/api/admin/support/${ticketId}/reply`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify({ replyText, newStatus })
    });
    return res.json();
  },

  async updateAdminSettings(token: string, settings: Partial<AppSettings>): Promise<AppSettings> {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify(settings)
    });
    return res.json();
  },

  async getAdminLogs(token: string): Promise<SystemLog[]> {
    const res = await fetch('/api/admin/logs', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  }
};
