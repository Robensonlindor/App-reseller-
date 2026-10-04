import React, { useState, useEffect } from 'react';
import { 
  Shield, Users, TrendingUp, ShoppingCart, Cpu, Server, 
  Settings, FileText, CheckCircle2, AlertTriangle, RefreshCw, 
  Plus, Edit, Trash2, Key, DollarSign, Activity, Search, 
  ExternalLink, ChevronRight, MessageSquare 
} from 'lucide-react';
import { 
  Game, Service, Provider, Reseller, Order, SupportTicket, 
  AppSettings, SystemLog, GameField 
} from '../../types';
import { apiClient } from '../../services/apiClient';
import { GoXtopAdminPanel } from './GoXtopAdminPanel';

interface AdminDashboardViewProps {
  onClose: () => void;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({ onClose }) => {
  // Authentication State
  const [token, setToken] = useState<string | null>(localStorage.getItem('playup_admin_token'));
  const [email, setEmail] = useState('admin@playup.io');
  const [password, setPassword] = useState('PlayUpAdmin2026!');
  const [loginError, setLoginError] = useState<string | null>(null);

  // Admin Navigation Tabs
  const [currentTab, setCurrentTab] = useState<'metrics' | 'games' | 'services' | 'orders' | 'resellers' | 'providers' | 'support' | 'settings' | 'logs'>('metrics');

  // Loaded State
  const [stats, setStats] = useState<any>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(false);

  // Modals & Editors
  const [editingGame, setEditingGame] = useState<Partial<Game> | null>(null);
  const [isNewGame, setIsNewGame] = useState(false);
  const [editingService, setEditingService] = useState<Partial<Service> | null>(null);
  const [isNewService, setIsNewService] = useState(false);
  const [balanceModal, setBalanceModal] = useState<{ reseller: Reseller; amount: string; note: string } | null>(null);
  const [ticketReplyModal, setTicketReplyModal] = useState<{ ticket: SupportTicket; replyText: string; status: string } | null>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [adminFeedback, setAdminFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (token) {
      loadAllAdminData();
    }
  }, [token]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      const res = await apiClient.adminLogin(email, password);
      setToken(res.token);
      localStorage.setItem('playup_admin_token', res.token);
    } catch (err: any) {
      setLoginError(err.message || 'Identifiants invalides');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('playup_admin_token');
    setToken(null);
  };

  const loadAllAdminData = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [
        statsData, gamesData, servicesData, providersData, 
        ordersData, resellersData, ticketsData, settingsData, logsData
      ] = await Promise.all([
        apiClient.getAdminStats(token),
        apiClient.getAdminGames(token),
        apiClient.getAdminServices(token),
        apiClient.getAdminProviders(token),
        apiClient.getAdminOrders(token),
        apiClient.getAdminResellers(token),
        apiClient.getAdminSupport(token),
        apiClient.getSettings(),
        apiClient.getAdminLogs(token)
      ]);

      setStats(statsData.metrics);
      setGames(gamesData);
      setServices(servicesData);
      setProviders(providersData);
      setOrders(ordersData);
      setResellers(resellersData);
      setTickets(ticketsData);
      setSettings(settingsData);
      setLogs(logsData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Provider Ping test
  const handlePingProvider = async (providerId: string) => {
    if (!token) return;
    try {
      const res = await apiClient.testProviderPing(token, providerId);
      setAdminFeedback({
        type: res.testResult?.success ? 'success' : 'error',
        text: `${res.testResult?.label || res.status} (${res.latencyMs}ms) — ${res.testResult?.details || ''}`
      });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: `Échec du test : ${e.message}` });
    }
  };

  // Order retry
  const handleRetryOrder = async (orderId: string) => {
    if (!token) return;
    try {
      const updated = await apiClient.retryAdminOrder(token, orderId);
      setAdminFeedback({
        type: updated.status === 'failed' ? 'error' : 'success',
        text: `Commande ${updated.orderNumber} relancée (${updated.partnerOrderId}) → Statut: ${updated.status}`
      });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // Check GoXtop Order Status (GET /api/v.1/:partner_orderid)
  const handleCheckRemoteStatus = async (orderId: string) => {
    if (!token) return;
    try {
      const res = await apiClient.checkAdminOrderStatus(token, orderId);
      setAdminFeedback({
        type: res.result?.success ? 'success' : 'error',
        text: res.result?.success
          ? `Statut GoXtop vérifié via GET /api/v.1/${res.order.partnerOrderId} → ${res.result.status}`
          : `Vérification GoXtop GET /api/v.1/${res.order?.partnerOrderId || orderId} : ${res.result?.message || 'Erreur'}`
      });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // Track GoXtop Order (POST /api/v.1/:id/track)
  const handleTrackRemoteOrder = async (orderId: string) => {
    if (!token) return;
    try {
      const res = await apiClient.trackAdminOrder(token, orderId);
      setAdminFeedback({
        type: res.result?.success ? 'success' : 'error',
        text: res.result?.success
          ? `Suivi GoXtop POST /api/v.1/${res.order.externalOrderId || res.order.partnerOrderId}/track → ${res.result.status}`
          : `Suivi GoXtop Track : ${res.result?.message || 'Erreur'}`
      });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // Order manual status change
  const handleUpdateOrderStatus = async (orderId: string, status: string) => {
    if (!token) return;
    try {
      await apiClient.updateAdminOrderStatus(token, orderId, status);
      setAdminFeedback({ type: 'success', text: `Statut de la commande mis à jour : ${status}` });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // Adjust Reseller Balance
  const handleAdjustBalanceSubmit = async () => {
    if (!token || !balanceModal) return;
    try {
      await apiClient.adjustResellerBalance(token, balanceModal.reseller.id, Number(balanceModal.amount), balanceModal.note);
      setBalanceModal(null);
      setAdminFeedback({ type: 'success', text: 'Solde revendeur ajusté avec succès.' });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // Reply to ticket
  const handleReplyTicketSubmit = async () => {
    if (!token || !ticketReplyModal) return;
    try {
      await apiClient.replyAdminSupport(token, ticketReplyModal.ticket.id, ticketReplyModal.replyText, ticketReplyModal.status);
      setTicketReplyModal(null);
      setAdminFeedback({ type: 'success', text: 'Réponse envoyée au client.' });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // Save Game with Dynamic Fields
  const handleSaveGame = async () => {
    if (!token || !editingGame) return;
    try {
      await apiClient.saveAdminGame(token, editingGame, isNewGame);
      setEditingGame(null);
      setAdminFeedback({ type: 'success', text: 'Configuration du jeu enregistrée.' });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !settings) return;
    try {
      await apiClient.updateAdminSettings(token, settings);
      setAdminFeedback({ type: 'success', text: 'Paramètres généraux enregistrés avec succès.' });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // IF NOT AUTHENTICATED
  if (!token) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl max-w-md w-full p-8 space-y-6 shadow-2xl relative">
          <button 
            onClick={onClose} 
            className="absolute top-5 right-5 text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>

          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-orange-600 text-white font-bold flex items-center justify-center mx-auto">
              <Shield className="w-6 h-6" />
            </div>
            <h2 className="font-display text-2xl font-bold text-slate-900">
              Administration PlayUp
            </h2>
            <p className="text-xs text-slate-500">
              Espace hautement sécurisé réservé aux administrateurs de la plateforme.
            </p>
          </div>

          {loginError && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs">
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 text-xs">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Email Administrateur</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Mot de passe</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs shadow-md transition-colors"
              >
                Connexion sécurisée
              </button>
            </div>

            <p className="text-[11px] text-center text-slate-400">
              Identifiants démo : admin@playup.io / PlayUpAdmin2026!
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-100 flex flex-col overflow-hidden">
      {/* Admin Top Bar */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shrink-0 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center font-black text-sm">
            P
          </div>
          <div>
            <span className="font-display font-bold text-base">
              PlayUp <span className="text-orange-500">Admin Core</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadAllAdminData}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            title="Rafraîchir les données"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <span className="text-xs text-slate-400 font-mono hidden sm:inline">
            admin@playup.io
          </span>

          <button
            onClick={handleLogout}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg text-slate-200 transition-colors"
          >
            Déconnexion
          </button>

          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-xs font-semibold rounded-lg text-white transition-colors"
          >
            Fermer l'Admin ✕
          </button>
        </div>
      </header>

      {/* Main Admin Workspace (Sidebar + Content Viewport) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 bg-white border-r border-slate-200 p-4 space-y-1 shrink-0 overflow-y-auto hidden md:block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3 block mb-2">
            Gestion Centrale
          </span>

          {[
            { id: 'metrics', label: 'Vue d’ensemble', icon: Activity },
            { id: 'games', label: 'Jeux & Champs Profils', icon: GamepadIcon },
            { id: 'services', label: 'Services & Tarifs', icon: ShoppingCart },
            { id: 'orders', label: 'Toutes les Commandes', icon: FileText },
            { id: 'resellers', label: 'Revendeurs & Solde', icon: Users },
            { id: 'providers', label: 'Paramètres → Fournisseurs (GoXtop)', icon: Cpu },
            { id: 'support', label: 'Tickets Support', icon: MessageSquare },
            { id: 'settings', label: 'Paramètres & Stores', icon: Settings },
            { id: 'logs', label: 'Journaux Système', icon: Server }
          ].map(item => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id as any)}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors ${
                  isActive ? 'bg-orange-50 text-orange-600' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {adminFeedback && (
            <div className={`p-3.5 rounded-2xl border text-xs font-medium flex items-center justify-between ${
              adminFeedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              <span>{adminFeedback.text}</span>
              <button onClick={() => setAdminFeedback(null)} className="text-slate-400 hover:text-slate-700 font-bold ml-4">✕</button>
            </div>
          )}

          {/* TAB 1: METRICS */}
          {currentTab === 'metrics' && stats && (
            <div className="space-y-6">
              <h2 className="font-display text-2xl font-bold text-slate-900">
                Performance & Revenus de la Plateforme
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                  <span className="text-xs font-semibold text-slate-500">Chiffre d’Affaires Total</span>
                  <div className="font-mono text-2xl font-bold text-slate-900 mt-2">
                    ${stats.totalRevenue.toFixed(2)} USD
                  </div>
                  <span className="text-[11px] text-emerald-600 font-semibold block mt-1">
                    Marge brute : ${stats.grossProfit.toFixed(2)} ({stats.marginPercent.toFixed(1)}%)
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                  <span className="text-xs font-semibold text-slate-500">Commandes Totales</span>
                  <div className="font-mono text-2xl font-bold text-slate-900 mt-2">
                    {stats.totalOrders}
                  </div>
                  <span className="text-[11px] text-slate-500 block mt-1">
                    {stats.completedOrders} livrées · {stats.pendingOrders} en cours
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                  <span className="text-xs font-semibold text-slate-500">Revendeurs B2B</span>
                  <div className="font-mono text-2xl font-bold text-slate-900 mt-2">
                    {stats.activeResellers}
                  </div>
                  <span className="text-[11px] text-slate-500 block mt-1">
                    Solde total en réserve : ${stats.totalResellerBalance.toFixed(2)}
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                  <span className="text-xs font-semibold text-slate-500">Passerelles Opérationnelles</span>
                  <div className="font-mono text-2xl font-bold text-emerald-600 mt-2">
                    {stats.activeProviders} actives
                  </div>
                  <span className="text-[11px] text-slate-500 block mt-1">
                    {stats.activeServices} services connectés
                  </span>
                </div>
              </div>

              {/* Recent Orders table */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <h3 className="font-semibold text-sm text-slate-900">Dernières transactions enregistrées</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                        <th className="py-2.5 px-3">N° Commande</th>
                        <th className="py-2.5 px-3">Origine</th>
                        <th className="py-2.5 px-3">Jeu & Pack</th>
                        <th className="py-2.5 px-3">Prix</th>
                        <th className="py-2.5 px-3">Statut</th>
                        <th className="py-2.5 px-3">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {orders.slice(0, 8).map(o => (
                        <tr key={o.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-mono font-medium">{o.orderNumber}</td>
                          <td className="py-2.5 px-3 font-medium text-slate-600">
                            {o.source === 'mobile_app' ? '📱 PlayUp App' : `💼 ${o.resellerName || 'Reseller API'}`}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-semibold">{o.gameName}</span> ({o.packageName})
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold">${o.chargedAmount.toFixed(2)}</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              o.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                              o.status === 'processing' ? 'bg-amber-100 text-amber-800' :
                              o.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-800'
                            }`}>
                              {o.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                            {new Date(o.createdAt).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: GAMES & DYNAMIC FIELDS BUILDER (Section 8 & 21) */}
          {currentTab === 'games' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="font-display text-2xl font-bold text-slate-900">Gestion des Jeux</h2>
                  <p className="text-xs text-slate-500">
                    Configurez les jeux et les formulaires dynamiques de profil (Player ID, Server ID, etc.).
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsNewGame(true);
                    setEditingGame({
                      name: '',
                      category: 'Mobile Game',
                      description: '',
                      isActive: true,
                      logo: '/src/assets/images/game_cover_freefire_1790988876938.jpg',
                      fields: [
                        { id: 'f_' + Date.now(), name: 'playerId', label: 'ID Joueur', placeholder: 'ex: 12345678', type: 'text', required: true }
                      ]
                    });
                  }}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Ajouter un jeu</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {games.map(game => (
                  <div key={game.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-xs">
                    <div className="flex items-center gap-3">
                      <img 
                        src={game.logo} 
                        alt={game.name} 
                        className="w-12 h-12 rounded-xl object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-slate-900">{game.name}</h3>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            game.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {game.isActive ? 'Actif' : 'Inactif'}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-500">{game.category}</span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-2">
                      {game.description}
                    </p>

                    <div className="p-3 bg-slate-50 rounded-xl space-y-1.5 text-xs">
                      <span className="font-bold text-slate-700 text-[11px] block">
                        Champs requis ({game.fields.length}) :
                      </span>
                      {game.fields.map(f => (
                        <div key={f.id} className="flex justify-between text-[11px] text-slate-600">
                          <span>{f.label}</span>
                          <span className="font-mono text-slate-400">({f.name})</span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setIsNewGame(false);
                          setEditingGame({ ...game });
                        }}
                        className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        <span>Modifier</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: SERVICES & PACKAGES */}
          {currentTab === 'services' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="font-display text-2xl font-bold text-slate-900">Services & Packages</h2>
                  <p className="text-xs text-slate-500">
                    Définissez les packages, les prix de vente publics, prix revendeurs et coûts d'achat fournisseurs.
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                {services.map(service => {
                  const game = games.find(g => g.id === service.gameId);
                  const provider = providers.find(p => p.id === service.providerId);

                  return (
                    <div key={service.id} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
                        <div>
                          <span className="text-xs font-semibold text-orange-600">{game?.name}</span>
                          <h3 className="font-bold text-base text-slate-900">{service.name}</h3>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-slate-500">Fournisseur routé :</span>
                          <span className="font-semibold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-lg">
                            {provider?.name || 'Automatique'}
                          </span>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                              <th className="py-2 px-3">Package</th>
                              <th className="py-2 px-3">Quantité</th>
                              <th className="py-2 px-3">Prix Public</th>
                              <th className="py-2 px-3">Prix Reseller</th>
                              <th className="py-2 px-3">Coût Fournisseur</th>
                              <th className="py-2 px-3">Marge B2B</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-mono">
                            {service.packages.map(pkg => {
                              const margin = pkg.resellerPrice - pkg.supplierCost;
                              return (
                                <tr key={pkg.id}>
                                  <td className="py-2.5 px-3 font-sans font-semibold text-slate-900">{pkg.name}</td>
                                  <td className="py-2.5 px-3">{pkg.amount} {pkg.unit}</td>
                                  <td className="py-2.5 px-3 font-bold">${pkg.publicPrice.toFixed(2)}</td>
                                  <td className="py-2.5 px-3 text-orange-600 font-bold">${pkg.resellerPrice.toFixed(2)}</td>
                                  <td className="py-2.5 px-3 text-slate-500">${pkg.supplierCost.toFixed(2)}</td>
                                  <td className="py-2.5 px-3 text-emerald-600 font-bold">+${margin.toFixed(2)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: ORDERS */}
          {currentTab === 'orders' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl font-bold text-slate-900">Gestion des Commandes PlayUp & GoXtop</h2>
                  <p className="text-xs text-slate-500">
                    Suivi complet : <code className="font-mono">playup_order_id</code>, <code className="font-mono">partner_orderid</code>, <code className="font-mono">goxtop_order_id</code>, Coût GoXtop, Marge PlayUp et Prix de Vente.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Recherche (Order ID, partner_orderid, GoXtop ID)..."
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white w-64"
                  />
                  <select
                    value={orderStatusFilter}
                    onChange={(e) => setOrderStatusFilter(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white"
                  >
                    <option value="">Tous statuts</option>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="processing">Processing</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="refunded">Refunded</option>
                  </select>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-6 overflow-x-auto shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">playup_order_id / partner_orderid</th>
                      <th className="py-2.5 px-3">goxtop_order_id</th>
                      <th className="py-2.5 px-3">Jeu &amp; Produit</th>
                      <th className="py-2.5 px-3">Player ID / Nom vérifié</th>
                      <th className="py-2.5 px-3">Coût / Marge / Prix</th>
                      <th className="py-2.5 px-3">Statut &amp; Détails</th>
                      <th className="py-2.5 px-3 text-right">Actions GoXtop</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders
                      .filter(o => !orderStatusFilter || o.status === orderStatusFilter)
                      .filter(
                        o =>
                          !orderSearch ||
                          o.orderNumber.toLowerCase().includes(orderSearch.toLowerCase()) ||
                          (o.partnerOrderId && o.partnerOrderId.toLowerCase().includes(orderSearch.toLowerCase())) ||
                          (o.externalOrderId && o.externalOrderId.toLowerCase().includes(orderSearch.toLowerCase())) ||
                          o.gameName.toLowerCase().includes(orderSearch.toLowerCase())
                      )
                      .map(o => {
                        const calcMargin = typeof o.margin === 'number' ? o.margin : Number((o.chargedAmount - o.supplierCost).toFixed(2));
                        return (
                          <tr key={o.id} className="hover:bg-slate-50">
                            <td className="py-3 px-3 font-mono">
                              <div className="font-bold text-slate-900">{o.orderNumber}</div>
                              <div className="text-[10px] text-orange-600 font-semibold">{o.partnerOrderId}</div>
                              <div className="text-[10px] text-slate-400">
                                {o.source === 'mobile_app' ? 'PlayUp Mobile' : `API: ${o.resellerName}`}
                              </div>
                            </td>
                            <td className="py-3 px-3 font-mono text-[11px] text-slate-700">
                              <span className="font-bold">{o.externalOrderId || '—'}</span>
                              <span className="block text-[10px] text-slate-400">{o.providerName}</span>
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-semibold text-slate-900">{o.gameName}</div>
                              <div className="text-[11px] text-slate-500">{o.packageName}</div>
                            </td>
                            <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                              <div>{o.playerId || Object.entries(o.gameProfileData).map(([k, v]) => `${k}:${v}`).join(' ') || 'Sans Player ID'}</div>
                              {o.verifiedPlayerName && (
                                <span className="inline-block mt-0.5 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-sans font-semibold">
                                  ✓ {o.verifiedPlayerName}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 font-mono text-[11px]">
                              <div className="text-slate-500">Coût GoXtop: ${o.supplierCost.toFixed(2)}</div>
                              <div className="text-emerald-600 font-semibold">Marge PlayUp: +${calcMargin.toFixed(2)}</div>
                              <div className="font-bold text-slate-900">Vente: ${o.chargedAmount.toFixed(2)}</div>
                            </td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                o.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                                o.status === 'processing' || o.status === 'paid' ? 'bg-amber-100 text-amber-800' :
                                o.status === 'failed' || o.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                                o.status === 'refunded' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-800'
                              }`}>
                                {o.status}
                              </span>
                              {o.errorMessage && (
                                <div className="text-[10px] text-red-600 mt-1 max-w-xs truncate" title={o.errorMessage}>
                                  {o.errorMessage}
                                </div>
                              )}
                              {o.refundInfo && (
                                <div className="text-[10px] text-purple-700 mt-0.5">
                                  Remboursement : {o.refundInfo}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right space-x-1 whitespace-nowrap">
                              <button
                                onClick={() => handleCheckRemoteStatus(o.id)}
                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-[11px]"
                                title="GET /api/v.1/:partner_orderid"
                              >
                                Statut GoXtop
                              </button>
                              <button
                                onClick={() => handleTrackRemoteOrder(o.id)}
                                className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded font-semibold text-[11px]"
                                title="POST /api/v.1/:id/track"
                              >
                                Track
                              </button>
                              {o.status === 'failed' && (
                                <button
                                  onClick={() => handleRetryOrder(o.id)}
                                  className="px-2 py-1 bg-orange-100 hover:bg-orange-200 text-orange-800 rounded font-semibold text-[11px]"
                                  title="Relancer de manière idempotente"
                                >
                                  Retry
                                </button>
                              )}
                              <button
                                onClick={() => handleUpdateOrderStatus(o.id, 'completed')}
                                className="px-2 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded font-semibold text-[11px]"
                                title="Marquer comme complété"
                              >
                                ✓
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: RESELLERS & BALANCE (Section 24) */}
          {currentTab === 'resellers' && (
            <div className="space-y-6">
              <h2 className="font-display text-2xl font-bold text-slate-900">Gestion des Revendeurs B2B</h2>

              <div className="bg-white border border-slate-200 rounded-2xl p-6 overflow-x-auto shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Entreprise / Nom</th>
                      <th className="py-2.5 px-3">Email</th>
                      <th className="py-2.5 px-3">Solde Actuel</th>
                      <th className="py-2.5 px-3">Commandes</th>
                      <th className="py-2.5 px-3">Statut</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {resellers.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="py-3 px-3 font-semibold text-slate-900">
                          {r.company} ({r.name})
                        </td>
                        <td className="py-3 px-3 text-slate-600">{r.email}</td>
                        <td className="py-3 px-3 font-mono font-bold text-emerald-600 text-sm">
                          ${r.balance.toFixed(2)} USD
                        </td>
                        <td className="py-3 px-3 font-mono">{r.ordersCount || 0}</td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            r.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => setBalanceModal({ reseller: r, amount: '100', note: 'Approvisionnement virement bancaire' })}
                            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold"
                          >
                            Ajuster Solde (+/-)
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: EXTERNAL PROVIDERS & GOXTOP CONFIGURATION (Paramètres → Fournisseurs → GoXtop → Configuration API) */}
          {currentTab === 'providers' && token && (
            <GoXtopAdminPanel
              token={token}
              providers={providers}
              games={games}
              services={services}
              onRefreshData={loadAllAdminData}
            />
          )}

          {/* TAB 7: SUPPORT TICKETS (Section 29) */}
          {currentTab === 'support' && (
            <div className="space-y-6">
              <h2 className="font-display text-2xl font-bold text-slate-900">Tickets Support Utilisateurs</h2>

              <div className="bg-white border border-slate-200 rounded-2xl p-6 overflow-x-auto shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">N° Ticket</th>
                      <th className="py-2.5 px-3">Client</th>
                      <th className="py-2.5 px-3">Sujet</th>
                      <th className="py-2.5 px-3">Commande Liée</th>
                      <th className="py-2.5 px-3">Statut</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tickets.map(t => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="py-3 px-3 font-mono font-bold text-slate-900">{t.ticketNumber}</td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900">{t.name}</div>
                          <div className="text-[11px] text-slate-500">{t.email}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-800 max-w-xs truncate">{t.subject}</td>
                        <td className="py-3 px-3 font-mono">{t.orderId || '—'}</td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            t.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => setTicketReplyModal({ ticket: t, replyText: '', status: 'resolved' })}
                            className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
                          >
                            Répondre
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 8: SETTINGS & DOWNLOAD STORES (Section 7 & 30) */}
          {currentTab === 'settings' && settings && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6 max-w-3xl">
              <h2 className="font-display text-2xl font-bold text-slate-900">Paramètres Généraux & Liens Téléchargement</h2>
              <p className="text-xs text-slate-500">
                Ces liens alimentent dynamiquement la page de téléchargement et l'application mobile.
              </p>

              <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Nom de la Plateforme</label>
                  <input
                    type="text"
                    value={settings.platformName}
                    onChange={(e) => setSettings({ ...settings, platformName: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                  />
                </div>

                <div className="pt-2 border-t border-slate-100 space-y-3">
                  <h4 className="font-bold text-slate-900 text-xs uppercase tracking-tight">Liens de Téléchargement PlayUp Mobile</h4>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Lien APK Android Direct</label>
                    <input
                      type="url"
                      value={settings.downloadLinks.androidApkUrl}
                      onChange={(e) => setSettings({
                        ...settings,
                        downloadLinks: { ...settings.downloadLinks, androidApkUrl: e.target.value }
                      })}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Lien Google Play Store</label>
                    <input
                      type="url"
                      value={settings.downloadLinks.googlePlayUrl}
                      onChange={(e) => setSettings({
                        ...settings,
                        downloadLinks: { ...settings.downloadLinks, googlePlayUrl: e.target.value }
                      })}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Lien Apple App Store</label>
                    <input
                      type="url"
                      value={settings.downloadLinks.iosAppStoreUrl}
                      onChange={(e) => setSettings({
                        ...settings,
                        downloadLinks: { ...settings.downloadLinks, iosAppStoreUrl: e.target.value }
                      })}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono"
                    />
                  </div>
                </div>

                <div>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-semibold shadow-xs"
                  >
                    Enregistrer les paramètres
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 9: LOGS (Section 36) */}
          {currentTab === 'logs' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <h2 className="font-display text-2xl font-bold text-slate-900">Journaux & Monitoring Système</h2>
              <div className="space-y-2 font-mono text-xs">
                {logs.map(log => (
                  <div key={log.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          log.level === 'error' ? 'bg-red-100 text-red-700' :
                          log.level === 'warn' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-700'
                        }`}>
                          {log.level}
                        </span>
                        <span className="font-bold text-slate-800">[{log.module}]</span>
                      </div>
                      <p className="text-slate-700">{log.message}</p>
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MODAL: EDIT GAME & DYNAMIC FIELDS */}
      {editingGame && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto shadow-2xl">
            <h3 className="font-display text-xl font-bold text-slate-900">
              {isNewGame ? 'Ajouter un nouveau jeu' : `Modifier ${editingGame.name}`}
            </h3>

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Nom du jeu</label>
                <input
                  type="text"
                  value={editingGame.name || ''}
                  onChange={(e) => setEditingGame({ ...editingGame, name: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Catégorie</label>
                <input
                  type="text"
                  value={editingGame.category || ''}
                  onChange={(e) => setEditingGame({ ...editingGame, category: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                />
              </div>

              {/* Dynamic Game Profile Fields Configurator */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-slate-900 uppercase text-[11px]">
                    Champs Dynamiques du Profil ({editingGame.fields?.length || 0})
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const newF: GameField = {
                        id: 'f_' + Date.now(),
                        name: 'newField',
                        label: 'Nouveau champ',
                        placeholder: '',
                        type: 'text',
                        required: true
                      };
                      setEditingGame({
                        ...editingGame,
                        fields: [...(editingGame.fields || []), newF]
                      });
                    }}
                    className="px-2.5 py-1 bg-orange-50 text-orange-700 font-semibold rounded-lg text-xs"
                  >
                    + Ajouter un champ
                  </button>
                </div>

                <div className="space-y-3">
                  {editingGame.fields?.map((f, idx) => (
                    <div key={f.id || idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Nom technique (ex: serverId)"
                          value={f.name}
                          onChange={(e) => {
                            const updated = [...(editingGame.fields || [])];
                            updated[idx].name = e.target.value;
                            setEditingGame({ ...editingGame, fields: updated });
                          }}
                          className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono"
                        />
                        <input
                          type="text"
                          placeholder="Label affiché (ex: Serveur)"
                          value={f.label}
                          onChange={(e) => {
                            const updated = [...(editingGame.fields || [])];
                            updated[idx].label = e.target.value;
                            setEditingGame({ ...editingGame, fields: updated });
                          }}
                          className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs"
                        />
                      </div>
                      <div className="flex justify-between items-center pt-1 text-[11px]">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={f.required}
                            onChange={(e) => {
                              const updated = [...(editingGame.fields || [])];
                              updated[idx].required = e.target.checked;
                              setEditingGame({ ...editingGame, fields: updated });
                            }}
                          />
                          <span>Obligatoire</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = (editingGame.fields || []).filter((_, i) => i !== idx);
                            setEditingGame({ ...editingGame, fields: updated });
                          }}
                          className="text-red-600 hover:underline"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => setEditingGame(null)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveGame}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-semibold"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: BALANCE ADJUST */}
      {balanceModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Ajuster le solde de {balanceModal.reseller.company}
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold block mb-1">Montant à créditer (+) ou débiter (-)</label>
                <input
                  type="number"
                  value={balanceModal.amount}
                  onChange={(e) => setBalanceModal({ ...balanceModal, amount: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Motif de l'ajustement</label>
                <input
                  type="text"
                  value={balanceModal.note}
                  onChange={(e) => setBalanceModal({ ...balanceModal, note: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2"
                />
              </div>
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setBalanceModal(null)}
                className="px-4 py-2 border rounded-xl text-xs font-semibold"
              >
                Annuler
              </button>
              <button
                onClick={handleAdjustBalanceSubmit}
                className="px-4 py-2 bg-orange-600 text-white rounded-xl text-xs font-semibold"
              >
                Valider l'ajustement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TICKET REPLY */}
      {ticketReplyModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Répondre au Ticket #{ticketReplyModal.ticket.ticketNumber}
            </h3>
            <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl">
              <strong>Question client :</strong> {ticketReplyModal.ticket.message}
            </p>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold block mb-1">Réponse de l'administrateur</label>
                <textarea
                  rows={4}
                  value={ticketReplyModal.replyText}
                  onChange={(e) => setTicketReplyModal({ ...ticketReplyModal, replyText: e.target.value })}
                  placeholder="Tapez votre réponse ici..."
                  className="w-full border border-slate-300 rounded-xl p-3 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Statut après réponse</label>
                <select
                  value={ticketReplyModal.status}
                  onChange={(e) => setTicketReplyModal({ ...ticketReplyModal, status: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                >
                  <option value="resolved">Résolu</option>
                  <option value="in_progress">En cours de traitement</option>
                  <option value="open">Ouvert</option>
                </select>
              </div>
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setTicketReplyModal(null)}
                className="px-4 py-2 border rounded-xl text-xs font-semibold"
              >
                Annuler
              </button>
              <button
                onClick={handleReplyTicketSubmit}
                className="px-4 py-2 bg-orange-600 text-white rounded-xl text-xs font-semibold"
              >
                Envoyer la réponse
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper icon
const GamepadIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="6" width="20" height="12" rx="4" />
    <path d="M6 12h4m-2-2v4m9-2h.01m3 0h.01" />
  </svg>
);
