import React, { useState, useEffect } from 'react';
import { 
  Shield, Users, ShoppingCart, Cpu, Server, 
  Settings, FileText, CheckCircle2, AlertTriangle, RefreshCw, 
  Plus, Edit, Trash2, Key, DollarSign, Activity, Search, 
  MessageSquare, CreditCard, Lock, Eye, UserCheck
} from 'lucide-react';
import { 
  Game, Service, ServicePackage, Provider, Reseller, Order, SupportTicket, 
  AppSettings, SystemLog, GameField, AppUser, ApiKey, PaymentGatewayConfig, PaymentTransaction,
  PriceChangeHistoryEntry
} from '../../types';
import { apiClient } from '../../services/apiClient';
import { safeStorage } from '../../lib/safeStorage';
import { signInWithGooglePopup, signOutFirebase } from '../../lib/firebase';
import { GoXtopAdminPanel } from './GoXtopAdminPanel';
import { RechargeGamesAdminPanel } from './RechargeGamesAdminPanel';

interface AdminDashboardViewProps {
  onClose: () => void;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({ onClose }) => {
  // Authentication State (using safeStorage for iframe safety — never pre-filled)
  const [token, setToken] = useState<string | null>(
    () => safeStorage.getItem('playup_admin_token') || safeStorage.getItem('playup_user_token')
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginInfo, setLoginInfo] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState<boolean>(false);

  // Admin Navigation Tabs
  const [currentTab, setCurrentTab] = useState<
    'metrics' | 'rechargegames' | 'games' | 'services' | 'orders' | 'users' | 'resellers' | 'payments' | 'providers' | 'support' | 'settings' | 'logs'
  >('metrics');

  // Loaded State
  const [stats, setStats] = useState<any>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [paymentGateways, setPaymentGateways] = useState<PaymentGatewayConfig[]>([]);
  const [paymentTransactions, setPaymentTransactions] = useState<PaymentTransaction[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceChangeHistoryEntry[]>([]);
  const [exchangeRateInput, setExchangeRateInput] = useState<string>('132');
  const [savingExchangeRate, setSavingExchangeRate] = useState<boolean>(false);
  const [inlinePriceInputsHtg, setInlinePriceInputsHtg] = useState<Record<string, string>>({});
  const [savingPkgPriceId, setSavingPkgPriceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Modals & Filters
  const [editingGame, setEditingGame] = useState<Partial<Game> | null>(null);
  const [isNewGame, setIsNewGame] = useState(false);
  const [editingService, setEditingService] = useState<Partial<Service> | null>(null);
  const [isNewService, setIsNewService] = useState(false);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<Order | null>(null);
  const [balanceModal, setBalanceModal] = useState<{ reseller: Reseller; amount: string; note: string } | null>(null);
  const [userWalletModal, setUserWalletModal] = useState<{ user: AppUser; amount: string; note: string } | null>(null);
  const [userPasswordModal, setUserPasswordModal] = useState<{ user: AppUser; newPassword: string } | null>(null);
  const [editingGatewayModal, setEditingGatewayModal] = useState<{
    gateway: PaymentGatewayConfig;
    apiKey: string;
    clientSecret: string;
    webhookSecret: string;
  } | null>(null);
  const [newResellerKeyModal, setNewResellerKeyModal] = useState<{ reseller: Reseller; name: string } | null>(null);
  const [ticketReplyModal, setTicketReplyModal] = useState<{ ticket: SupportTicket; replyText: string; status: string } | null>(null);

  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [adminFeedback, setAdminFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (token) {
      loadAllAdminData();
    }
  }, [token]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginInfo(null);
    setLoginLoading(true);
    try {
      const res = await apiClient.adminLogin(email.trim(), password);
      setToken(res.token);
      safeStorage.setItem('playup_admin_token', res.token);
      safeStorage.setItem('playup_user_token', res.token);
      if (res.admin) {
        safeStorage.setItem('playup_user_profile', JSON.stringify(res.admin));
      }
      window.dispatchEvent(new CustomEvent('playup:auth-updated'));
    } catch (err: any) {
      setLoginError(err.message || 'Identifiants invalides');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleAdminGoogleLogin = async () => {
    setLoginError(null);
    setLoginInfo(null);
    setLoginLoading(true);
    try {
      const fbUser = await signInWithGooglePopup();
      const res = await apiClient.socialLoginUser({
        provider: 'google',
        uid: fbUser.uid,
        email: fbUser.email,
        name: fbUser.name,
        avatarUrl: fbUser.avatarUrl,
        idToken: fbUser.idToken,
        accessToken: fbUser.accessToken
      });
      if (res.user.role !== 'ADMIN') {
        setLoginError(`Accès refusé : le compte ${res.user.email} ne possède pas le rôle ADMIN.`);
        return;
      }
      setToken(res.token);
      safeStorage.setItem('playup_admin_token', res.token);
      safeStorage.setItem('playup_user_token', res.token);
      safeStorage.setItem('playup_user_profile', JSON.stringify(res.user));
      window.dispatchEvent(new CustomEvent('playup:auth-updated'));
    } catch (err: any) {
      setLoginError(err.message || 'Impossible de se connecter avec Google.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleGenerateAdminSecurityCode = async () => {
    if (!email.trim()) {
      setLoginError('Veuillez d’abord saisir votre adresse e-mail administrateur ci-dessous.');
      return;
    }
    setLoginError(null);
    setLoginInfo(null);
    setLoginLoading(true);
    try {
      const res = await apiClient.forgotUserPassword(email.trim());
      setPassword(res.resetCode);
      setLoginInfo(`Code de sécurité temporaire généré pour ${res.email} : ${res.resetCode} (pré-rempli ci-dessous, cliquez sur Connexion sécurisée).`);
    } catch (err: any) {
      setLoginError(err.message || 'Impossible de générer le code de sécurité.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    if (token) {
      apiClient.logoutUser(token).catch(() => {});
    }
    signOutFirebase().catch(() => {});
    safeStorage.removeItem('playup_admin_token');
    safeStorage.removeItem('playup_user_token');
    safeStorage.removeItem('playup_user_profile');
    setToken(null);
    window.dispatchEvent(new CustomEvent('playup:auth-updated'));
    onClose();
  };

  const loadAllAdminData = async () => {
    if (!token) return;
    setLoading(true);
    try {
      // Verify ADMIN role against backend first; reject immediately if not ADMIN
      const statsData = await apiClient.getAdminStats(token);
      const [
        gamesData, servicesData, providersData, 
        ordersData, usersData, resellersData, apiKeysData,
        gatewaysData, txData, ticketsData, settingsData, logsData, pricingHistoryData
      ] = await Promise.all([
        apiClient.getAdminGames(token).catch(() => []),
        apiClient.getAdminServices(token).catch(() => []),
        apiClient.getAdminProviders(token).catch(() => []),
        apiClient.getAdminOrders(token).catch(() => []),
        apiClient.getAdminUsers(token).catch(() => []),
        apiClient.getAdminResellers(token).catch(() => []),
        apiClient.getAdminApiKeys(token).catch(() => []),
        apiClient.getAdminPaymentGateways(token).catch(() => []),
        apiClient.getAdminPaymentTransactions(token).catch(() => []),
        apiClient.getAdminSupport(token).catch(() => []),
        apiClient.getSettings().catch(() => null),
        apiClient.getAdminLogs(token).catch(() => []),
        apiClient.getPricingHistory(token, { limit: 100 }).catch(() => null)
      ]);

      if (statsData?.metrics) setStats(statsData.metrics);
      setGames(gamesData);
      setServices(servicesData);
      setProviders(providersData);
      setOrders(ordersData);
      setUsers(usersData);
      setResellers(resellersData);
      setApiKeys(apiKeysData);
      setPaymentGateways(gatewaysData);
      setPaymentTransactions(txData);
      setTickets(ticketsData);
      if (settingsData) {
        setSettings(settingsData);
        if (settingsData.usdToHtgExchangeRate) {
          setExchangeRateInput(String(settingsData.usdToHtgExchangeRate));
        }
      }
      if (pricingHistoryData) {
        setPriceHistory(pricingHistoryData.history || []);
        if (pricingHistoryData.usdToHtgExchangeRate) {
          setExchangeRateInput(String(pricingHistoryData.usdToHtgExchangeRate));
        }
      }
      const nextInlinePrices: Record<string, string> = {};
      const activeRate = pricingHistoryData?.usdToHtgExchangeRate || settingsData?.usdToHtgExchangeRate || 132;
      for (const srv of servicesData || []) {
        for (const pkg of srv.packages || []) {
          const htgVal =
            typeof pkg.publicPriceHtg === 'number' && pkg.publicPriceHtg > 0
              ? pkg.publicPriceHtg
              : Number((Number(pkg.publicPrice || 0) * activeRate).toFixed(2));
          nextInlinePrices[pkg.id] = String(htgVal);
        }
      }
      setInlinePriceInputsHtg(nextInlinePrices);
      setLogs(logsData);
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        safeStorage.removeItem('playup_admin_token');
        setToken(null);
        setLoginError(err?.message || 'Session administrateur invalide ou rôle ADMIN requis.');
      } else {
        setAdminFeedback({
          type: 'error',
          text: err?.message || 'Erreur réseau temporaire lors du rafraîchissement des données.'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Order actions
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

  const handleUpdateOrderStatus = async (orderId: string, status: string, note?: string) => {
    if (!token) return;
    try {
      const updated = await apiClient.updateAdminOrderStatus(token, orderId, status, note);
      if (selectedOrderDetail?.id === orderId) {
        setSelectedOrderDetail(updated);
      }
      setAdminFeedback({ type: 'success', text: `Statut de la commande mis à jour : ${status}` });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // Game actions
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

  const handleToggleGameActive = async (game: Game) => {
    if (!token) return;
    try {
      await apiClient.saveAdminGame(token, { ...game, isActive: !game.isActive }, false);
      setAdminFeedback({
        type: 'success',
        text: `Jeu ${game.name} ${!game.isActive ? 'activé' : 'désactivé'}.`
      });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  const handleDeleteGame = async (gameId: string, gameName: string) => {
    if (!token) return;
    try {
      await apiClient.deleteAdminGame(token, gameId);
      setAdminFeedback({ type: 'success', text: `Jeu ${gameName} supprimé.` });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // Service & Package actions
  const handleSaveService = async () => {
    if (!token || !editingService) return;
    try {
      await apiClient.saveAdminService(token, editingService, isNewService);
      setEditingService(null);
      setAdminFeedback({
        type: 'success',
        text: 'Service et prix de vente en HTG enregistrés dans l’historique et appliqués en temps réel.'
      });
      window.dispatchEvent(new CustomEvent('playup:pricing-updated'));
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  const handleUpdateExchangeRate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!token) return;
    const numRate = Number(exchangeRateInput);
    if (!Number.isFinite(numRate) || numRate <= 0) {
      setAdminFeedback({
        type: 'error',
        text: 'Veuillez saisir un taux de change USD → HTG valide (supérieur à 0).'
      });
      return;
    }
    setSavingExchangeRate(true);
    try {
      const res = await apiClient.updateUsdToHtgExchangeRate(token, {
        usdToHtgExchangeRate: numRate,
        reason: `Modification manuelle du taux de change USD → HTG depuis l'administration (1 USD = ${numRate} HTG)`
      });
      setServices(res.services || []);
      if (res.settings) setSettings(res.settings);
      if (res.history) setPriceHistory(res.history);
      setExchangeRateInput(String(res.newExchangeRate));
      setAdminFeedback({
        type: 'success',
        text: res.message
      });
      window.dispatchEvent(new CustomEvent('playup:pricing-updated'));
    } catch (err: any) {
      setAdminFeedback({
        type: 'error',
        text: err.message || 'Erreur lors de la mise à jour du taux de change USD → HTG.'
      });
    } finally {
      setSavingExchangeRate(false);
    }
  };

  const handleSaveManualPriceHtg = async (serviceId: string, pkg: ServicePackage) => {
    if (!token) return;
    const rawVal = inlinePriceInputsHtg[pkg.id];
    const numPriceHtg = Number(rawVal);
    if (!Number.isFinite(numPriceHtg) || numPriceHtg <= 0) {
      setAdminFeedback({
        type: 'error',
        text: 'Veuillez saisir un prix de vente final en HTG valide (supérieur à 0).'
      });
      return;
    }
    setSavingPkgPriceId(pkg.id);
    try {
      const res = await apiClient.updateManualServicePriceHtg(token, {
        serviceId,
        packageId: pkg.id,
        productKey: pkg.productKey || pkg.externalProductId,
        sellingPriceHtg: numPriceHtg
      });
      setServices(res.services || []);
      if (res.history) setPriceHistory(res.history);
      setAdminFeedback({
        type: 'success',
        text: res.message
      });
      window.dispatchEvent(new CustomEvent('playup:pricing-updated'));
    } catch (err: any) {
      setAdminFeedback({
        type: 'error',
        text: err.message || 'Erreur lors de la sauvegarde du prix de vente en HTG.'
      });
    } finally {
      setSavingPkgPriceId(null);
    }
  };

  // User management actions
  const handleToggleUserStatus = async (u: AppUser) => {
    if (!token) return;
    try {
      const nextStatus = u.status === 'active' ? 'suspended' : 'active';
      await apiClient.updateAdminUserStatus(token, u.id, nextStatus);
      setAdminFeedback({ type: 'success', text: `Utilisateur ${u.email} → ${nextStatus}` });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  const handleAdjustUserWalletSubmit = async () => {
    if (!token || !userWalletModal) return;
    try {
      await apiClient.adjustAdminUserWallet(
        token,
        userWalletModal.user.id,
        Number(userWalletModal.amount),
        userWalletModal.note
      );
      setUserWalletModal(null);
      setAdminFeedback({ type: 'success', text: 'Portefeuille joueur ajusté avec succès.' });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  const handleResetUserPasswordSubmit = async () => {
    if (!token || !userPasswordModal) return;
    try {
      const res = await apiClient.resetAdminUserPassword(token, userPasswordModal.user.id, userPasswordModal.newPassword);
      setUserPasswordModal(null);
      setAdminFeedback({ type: 'success', text: res.message });
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // Reseller & API Key actions
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

  const handleUpdateResellerStatus = async (resellerId: string, status: string) => {
    if (!token) return;
    try {
      await apiClient.updateResellerStatus(token, resellerId, status);
      setAdminFeedback({ type: 'success', text: `Statut revendeur mis à jour : ${status}` });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  const handleCreateResellerKeySubmit = async () => {
    if (!token || !newResellerKeyModal) return;
    try {
      const created = await apiClient.createAdminResellerApiKey(
        token,
        newResellerKeyModal.reseller.id,
        newResellerKeyModal.name || 'Clé API Production'
      );
      setNewResellerKeyModal(null);
      setAdminFeedback({
        type: 'success',
        text: `Nouvelle clé API générée pour ${newResellerKeyModal.reseller.company} (${created.maskedKey || 'Masquée'})`
      });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  const handleToggleApiKeyStatus = async (key: ApiKey) => {
    if (!token) return;
    try {
      const next = key.status === 'active' ? 'revoked' : 'active';
      await apiClient.updateAdminApiKeyStatus(token, key.id, next);
      setAdminFeedback({ type: 'success', text: `Clé API ${key.name} → ${next}` });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // Payment Gateway actions
  const handleSavePaymentGateway = async () => {
    if (!token || !editingGatewayModal) return;
    try {
      await apiClient.updateAdminPaymentGateway(token, editingGatewayModal.gateway.id, {
        ...editingGatewayModal.gateway,
        ...(editingGatewayModal.apiKey ? { apiKey: editingGatewayModal.apiKey } : {}),
        ...(editingGatewayModal.clientSecret ? { clientSecret: editingGatewayModal.clientSecret } : {}),
        ...(editingGatewayModal.webhookSecret ? { webhookSecret: editingGatewayModal.webhookSecret } : {})
      });
      setEditingGatewayModal(null);
      setAdminFeedback({ type: 'success', text: 'Configuration de la passerelle de paiement enregistrée.' });
      loadAllAdminData();
    } catch (e: any) {
      setAdminFeedback({ type: 'error', text: e.message });
    }
  };

  // Support reply
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

  const navItems = [
    { id: 'metrics', label: 'Vue d’ensemble', icon: Activity },
    { id: 'rechargegames', label: 'RechargeGames', icon: Shield },
    { id: 'games', label: 'Jeux & Champs', icon: GamepadIcon },
    { id: 'services', label: 'Services & Tarifs', icon: ShoppingCart },
    { id: 'orders', label: 'Commandes', icon: FileText },
    { id: 'users', label: 'Utilisateurs', icon: UserCheck },
    { id: 'resellers', label: 'Revendeurs & API', icon: Users },
    { id: 'payments', label: 'Paiements', icon: CreditCard },
    { id: 'providers', label: 'Fournisseurs (GoXtop)', icon: Cpu },
    { id: 'support', label: 'Support', icon: MessageSquare },
    { id: 'settings', label: 'Paramètres', icon: Settings },
    { id: 'logs', label: 'Journaux', icon: Server }
  ];

  // IF NOT AUTHENTICATED
  if (!token) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 space-y-6 shadow-2xl relative">
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

          {loginInfo && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs">
              {loginInfo}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 text-xs">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Email Administrateur</label>
              <input
                type="email"
                required
                placeholder="leaderlindor@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold text-slate-700">Mot de passe ou Code de sécurité</label>
                <button
                  type="button"
                  onClick={handleGenerateAdminSecurityCode}
                  disabled={loginLoading}
                  className="text-[11px] font-semibold text-orange-600 hover:underline"
                >
                  Obtenir un code de sécurité
                </button>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mot de passe ou code à 6 chiffres"
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
              />
            </div>

            <div className="pt-1 space-y-2.5">
              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold rounded-xl text-xs shadow-md transition-colors"
              >
                {loginLoading ? 'Vérification...' : 'Connexion sécurisée'}
              </button>

              <button
                type="button"
                disabled={loginLoading}
                onClick={handleAdminGoogleLogin}
                className="w-full py-2.5 px-4 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <span>Continuer avec Google</span>
              </button>
            </div>

            <p className="text-[11px] text-center text-slate-400">
              Accès strictement réservé aux comptes disposant du rôle ADMIN vérifié côté serveur.
            </p>
          </form>
        </div>
      </div>
    );
  }

  const goxtopProvider = providers.find(p => p.slug === 'goxtop' || p.adapterType === 'goxtop');

  return (
    <div className="fixed inset-0 z-50 bg-slate-100 flex flex-col overflow-hidden">
      {/* Admin Top Bar */}
      <header className="bg-slate-900 text-white px-4 sm:px-6 py-3 flex items-center justify-between shrink-0 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center font-black text-sm">
            P
          </div>
          <div>
            <span className="font-display font-bold text-sm sm:text-base">
              PlayUp <span className="text-orange-500">Admin Core</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={loadAllAdminData}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            title="Rafraîchir les données"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <span className="text-xs text-emerald-400 font-mono hidden sm:inline">
            ROLE: ADMIN
          </span>

          <button
            onClick={handleLogout}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg text-slate-200 transition-colors"
          >
            Déconnexion
          </button>

          <button
            onClick={onClose}
            className="px-2.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-xs font-semibold rounded-lg text-white transition-colors"
          >
            Fermer ✕
          </button>
        </div>
      </header>

      {/* Mobile Horizontal Navigation Bar (< md screens) */}
      <div className="flex md:hidden bg-white border-b border-slate-200 px-3 py-2 gap-1.5 overflow-x-auto shrink-0">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                isActive ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Admin Workspace (Sidebar + Content Viewport) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="w-60 bg-white border-r border-slate-200 p-4 space-y-1 shrink-0 overflow-y-auto hidden md:block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3 block mb-2">
            Gestion Centrale
          </span>

          {navItems.map(item => {
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
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* GoXtop unconfigured non-blocking status notice */}
          {goxtopProvider && !goxtopProvider.hasApiKey && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  <strong>GoXtop — Configuration requise :</strong> Aucune clé API GoXtop n’est enregistrée côté serveur. La plateforme fonctionne normalement avec son catalogue local jusqu’à configuration.
                </span>
              </div>
              {currentTab !== 'providers' && (
                <button
                  onClick={() => setCurrentTab('providers')}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold text-xs shrink-0"
                >
                  Configurer GoXtop →
                </button>
              )}
            </div>
          )}

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
          {currentTab === 'metrics' && (
            <div className="space-y-6">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
                Performance &amp; Revenus de la Plateforme
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                  <span className="text-xs font-semibold text-slate-500">Chiffre d’Affaires Total</span>
                  <div className="font-mono text-2xl font-bold text-slate-900 mt-2">
                    ${(stats?.totalRevenue ?? 0).toFixed(2)} USD
                  </div>
                  <span className="text-[11px] text-emerald-600 font-semibold block mt-1">
                    Marge brute : ${(stats?.grossProfit ?? 0).toFixed(2)} ({(stats?.marginPercent ?? 0).toFixed(1)}%)
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                  <span className="text-xs font-semibold text-slate-500">Commandes Totales</span>
                  <div className="font-mono text-2xl font-bold text-slate-900 mt-2">
                    {stats?.totalOrders ?? orders.length}
                  </div>
                  <span className="text-[11px] text-slate-500 block mt-1">
                    {stats?.completedOrders ?? 0} livrées · {stats?.pendingOrders ?? 0} en cours
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                  <span className="text-xs font-semibold text-slate-500">Joueurs &amp; Revendeurs</span>
                  <div className="font-mono text-2xl font-bold text-slate-900 mt-2">
                    {users.length} joueurs · {resellers.length} B2B
                  </div>
                  <span className="text-[11px] text-slate-500 block mt-1">
                    Solde revendeurs : ${(stats?.totalResellerBalance ?? 0).toFixed(2)}
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                  <span className="text-xs font-semibold text-slate-500">Passerelles &amp; Paiements</span>
                  <div className="font-mono text-2xl font-bold text-emerald-600 mt-2">
                    {paymentGateways.filter(g => g.isEnabled).length} passerelles actives
                  </div>
                  <span className="text-[11px] text-slate-500 block mt-1">
                    {paymentTransactions.length} transactions enregistrées
                  </span>
                </div>
              </div>

              {/* Recent Orders table */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm text-slate-900">Dernières commandes enregistrées</h3>
                  <button
                    onClick={() => setCurrentTab('orders')}
                    className="text-xs font-semibold text-orange-600 hover:underline"
                  >
                    Voir toutes les commandes →
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                        <th className="py-2.5 px-3">N° Commande</th>
                        <th className="py-2.5 px-3">Origine</th>
                        <th className="py-2.5 px-3">Jeu &amp; Pack</th>
                        <th className="py-2.5 px-3">Paiement</th>
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
                            {o.source === 'mobile_app' ? 'PlayUp App' : `${o.resellerName || 'Reseller API'}`}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-semibold">{o.gameName}</span> ({o.packageName})
                          </td>
                          <td className="py-2.5 px-3 uppercase font-mono text-[11px] text-slate-600">
                            {o.paymentMethod || 'wallet'}
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

          {/* TAB 2: GAMES & DYNAMIC FIELDS BUILDER */}
          {currentTab === 'games' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900">Gestion des Jeux</h2>
                  <p className="text-xs text-slate-500">
                    Ajoutez, modifiez ou désactivez les jeux et leurs champs dynamiques (Player ID, Server ID, Zone ID).
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
                      supportsNameCheck: false,
                      logo: '/src/assets/images/game_cover_freefire_1790988876938.jpg',
                      fields: [
                        { id: 'f_' + Date.now(), name: 'playerId', label: 'ID Joueur', placeholder: 'ex: 12345678', type: 'text', required: true }
                      ]
                    });
                  }}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 self-start"
                >
                  <Plus className="w-4 h-4" />
                  <span>Ajouter un jeu</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {games.map(game => (
                  <div key={game.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-xs flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <img 
                          src={game.logo} 
                          alt={game.name} 
                          className="w-12 h-12 rounded-xl object-cover bg-slate-100"
                          referrerPolicy="no-referrer"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-sm text-slate-900">{game.name}</h3>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              game.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {game.isActive ? 'Actif' : 'Désactivé'}
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
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleToggleGameActive(game)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold ${
                          game.isActive
                            ? 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                            : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        }`}
                      >
                        {game.isActive ? 'Désactiver' : 'Activer'}
                      </button>

                      <div className="flex items-center gap-1.5">
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
                        <button
                          onClick={() => handleDeleteGame(game.id, game.name)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                          title="Supprimer ce jeu"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: SERVICES & PACKAGES */}
          {currentTab === 'services' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900">Services &amp; Packages</h2>
                  <p className="text-xs text-slate-500">
                    Définissez les packages, la tarification publique/revendeur et assignez les fournisseurs (GoXtop).
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsNewService(true);
                    setEditingService({
                      gameId: games[0]?.id || 'game_ff',
                      name: 'Nouveau Service Recharge',
                      description: 'Livraison directe par ID Joueur',
                      category: 'diamonds',
                      providerId: providers[0]?.id || 'prov_goxtop',
                      isActive: true,
                      packages: [
                        {
                          id: 'pkg_' + Date.now(),
                          serviceId: '',
                          name: '100 Diamants',
                          amount: 100,
                          unit: 'Diamonds',
                          publicPrice: 1.25,
                          resellerPrice: 1.05,
                          supplierCost: 0.90,
                          margin: 0.35,
                          currency: 'USD',
                          isActive: true,
                          displayOrder: 1
                        }
                      ]
                    });
                  }}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 self-start"
                >
                  <Plus className="w-4 h-4" />
                  <span>Nouveau Service</span>
                </button>
              </div>

              {/* USD Reference Currency -> HTG Selling Price Configurator */}
              <div className="bg-slate-900 text-white border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 text-[10px] font-bold uppercase tracking-wider">
                        Devise de Référence : USD
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
                        Devise de Vente PlayUp : HTG
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-bold uppercase tracking-wider">
                        Temps Réel &amp; Historique Actifs
                      </span>
                    </div>
                    <h3 className="font-display text-base sm:text-lg font-bold text-white">
                      Taux de Change Officiel USD → HTG &amp; Calcul Automatique des Coûts / Marges
                    </h3>
                    <p className="text-xs text-slate-300 max-w-3xl">
                      Les prix fournisseurs RechargeGames sont enregistrés en <strong>USD</strong> et ne sont <strong>jamais modifiés</strong>. Le système calcule automatiquement le coût fournisseur en <strong>HTG</strong>, le bénéfice en <strong>HTG</strong> et la marge. Le client voit uniquement le prix final PlayUp en <strong>HTG</strong>.
                    </p>
                  </div>

                  <form
                    onSubmit={handleUpdateExchangeRate}
                    className="bg-slate-800/90 border border-slate-700 rounded-2xl p-3.5 flex flex-wrap items-center gap-3 shrink-0"
                  >
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                        Taux de change (1 USD → HTG)
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-slate-300">1 USD =</span>
                        <input
                          type="number"
                          step="0.01"
                          min="1"
                          value={exchangeRateInput}
                          onChange={(e) => setExchangeRateInput(e.target.value)}
                          className="w-28 bg-slate-900 border border-slate-600 focus:border-orange-500 rounded-xl px-3 py-1.5 text-sm font-mono font-bold text-orange-400 focus:outline-none"
                        />
                        <span className="text-xs font-mono font-bold text-emerald-400">HTG</span>
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={savingExchangeRate}
                      className="px-4 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
                    >
                      {savingExchangeRate ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      <span>Appliquer en Temps Réel</span>
                    </button>
                  </form>
                </div>
              </div>

              <div className="space-y-6">
                {services.map(service => {
                  const game = games.find(g => g.id === service.gameId);
                  const provider = providers.find(p => p.id === service.providerId);
                  const activeRate = Number(exchangeRateInput) > 0 ? Number(exchangeRateInput) : (settings?.usdToHtgExchangeRate || 132);

                  return (
                    <div key={service.id} className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-orange-600">{game?.name || service.gameId}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              service.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {service.isActive ? 'Actif' : 'Inactif'}
                            </span>
                          </div>
                          <h3 className="font-bold text-base text-slate-900">{service.name}</h3>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-slate-500">Fournisseur assigné :</span>
                          <span className="font-semibold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-lg">
                            {provider?.name || 'RechargeGames'}
                          </span>
                          <button
                            onClick={() => {
                              setIsNewService(false);
                              setEditingService(JSON.parse(JSON.stringify(service)));
                            }}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold flex items-center gap-1"
                          >
                            <Edit className="w-3.5 h-3.5" />
                            <span>Gérer Packages &amp; Prix (HTG)</span>
                          </button>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 text-slate-500 font-semibold">
                              <th className="py-2 px-3">Service / Package</th>
                              <th className="py-2 px-3">Code Produit</th>
                              <th className="py-2 px-3">Prix Fournisseur (USD — Immuable)</th>
                              <th className="py-2 px-3">Coût Fournisseur Auto (HTG)</th>
                              <th className="py-2 px-3">Prix de Vente Final PlayUp (HTG — Manuel)</th>
                              <th className="py-2 px-3">Bénéfice Auto (HTG)</th>
                              <th className="py-2 px-3">Marge Auto (HTG / %)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-mono">
                            {service.packages.map(pkg => {
                              const supplierUsd = Number(
                                (typeof pkg.supplierCostUsd === 'number' && pkg.supplierCostUsd > 0
                                  ? pkg.supplierCostUsd
                                  : pkg.supplierCost || 0
                                ).toFixed(2)
                              );
                              const autoSupplierCostHtg = Number((supplierUsd * activeRate).toFixed(2));
                              const currentInputStr =
                                inlinePriceInputsHtg[pkg.id] !== undefined
                                  ? inlinePriceInputsHtg[pkg.id]
                                  : String(
                                      typeof pkg.publicPriceHtg === 'number' && pkg.publicPriceHtg > 0
                                        ? pkg.publicPriceHtg
                                        : Number((Number(pkg.publicPrice || 0) * activeRate).toFixed(2))
                                    );
                              const effectiveSellingHtg = Number(currentInputStr) > 0 ? Number(currentInputStr) : 0;
                              const autoProfitHtg = Number((effectiveSellingHtg - autoSupplierCostHtg).toFixed(2));
                              const autoMarginPercent =
                                autoSupplierCostHtg > 0
                                  ? Number(((autoProfitHtg / autoSupplierCostHtg) * 100).toFixed(2))
                                  : 0;

                              return (
                                <tr key={pkg.id} className="hover:bg-slate-50/80">
                                  <td className="py-2.5 px-3 font-sans">
                                    <div className="font-semibold text-slate-900">{pkg.name}</div>
                                    <div className="text-[10px] text-slate-400">
                                      {pkg.amount} {pkg.unit} · Client voit uniquement : <strong>{effectiveSellingHtg} HTG</strong>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-[11px] text-slate-500">
                                    {pkg.productKey || pkg.externalProductId || '—'}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold text-xs" title="Prix fournisseur RechargeGames en USD — Ne jamais modifier">
                                      <Lock className="w-3 h-3 text-slate-400" />
                                      ${supplierUsd.toFixed(2)} USD
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 font-bold text-slate-700">
                                    {autoSupplierCostHtg.toFixed(2)} HTG
                                    <span className="block text-[10px] font-sans text-slate-400 font-normal">
                                      (${supplierUsd.toFixed(2)} × {activeRate})
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="number"
                                        step="1"
                                        min="1"
                                        value={currentInputStr}
                                        onChange={(e) =>
                                          setInlinePriceInputsHtg(prev => ({
                                            ...prev,
                                            [pkg.id]: e.target.value
                                          }))
                                        }
                                        className="w-24 border border-orange-300 focus:border-orange-600 rounded-lg px-2 py-1 text-xs font-mono font-bold text-orange-700 bg-orange-50/40"
                                      />
                                      <span className="text-[10px] font-bold text-slate-500">HTG</span>
                                      <button
                                        type="button"
                                        disabled={savingPkgPriceId === pkg.id}
                                        onClick={() => handleSaveManualPriceHtg(service.id, pkg)}
                                        className="px-2.5 py-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-sans font-semibold rounded-lg text-[11px] transition-colors"
                                      >
                                        {savingPkgPriceId === pkg.id ? '...' : 'Enregistrer'}
                                      </button>
                                    </div>
                                  </td>
                                  <td className={`py-2.5 px-3 font-bold ${autoProfitHtg >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {autoProfitHtg >= 0 ? '+' : ''}{autoProfitHtg.toFixed(2)} HTG
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                      autoMarginPercent >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                                    }`}>
                                      {autoProfitHtg >= 0 ? '+' : ''}{autoProfitHtg.toFixed(2)} HTG ({autoMarginPercent >= 0 ? '+' : ''}{autoMarginPercent.toFixed(1)}%)
                                    </span>
                                  </td>
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

              {/* Price & Exchange Rate Modification Audit History */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="font-display text-base font-bold text-slate-900">
                      Historique des Modifications (Taux de Change USD → HTG &amp; Prix de Vente HTG)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Toutes les modifications du taux de change et des prix de vente finaux en HTG sont enregistrées dans cet historique et appliquées en temps réel.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
                    {priceHistory.length} entrée(s)
                  </span>
                </div>

                {priceHistory.length === 0 ? (
                  <p className="text-xs text-slate-400 py-3">
                    Aucune modification enregistrée pour le moment. Modifiez le taux de change USD → HTG ou un prix de vente HTG ci-dessus pour voir l’entrée apparaître instantanément.
                  </p>
                ) : (
                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                          <th className="py-2 px-3">Date &amp; Heure</th>
                          <th className="py-2 px-3">Type</th>
                          <th className="py-2 px-3">Service / Produit</th>
                          <th className="py-2 px-3">Taux USD → HTG</th>
                          <th className="py-2 px-3">Prix Fournisseur (USD)</th>
                          <th className="py-2 px-3">Coût Fournisseur (HTG)</th>
                          <th className="py-2 px-3">Prix Vente PlayUp (HTG)</th>
                          <th className="py-2 px-3">Bénéfice &amp; Marge (HTG)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {priceHistory.map(entry => (
                          <tr key={entry.id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                              {new Date(entry.timestamp).toLocaleString('fr-FR')}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                entry.changeType === 'exchange_rate'
                                  ? 'bg-sky-100 text-sky-800'
                                  : entry.changeType === 'manual_price_htg'
                                  ? 'bg-orange-100 text-orange-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}>
                                {entry.changeType === 'exchange_rate'
                                  ? 'Taux USD → HTG'
                                  : entry.changeType === 'manual_price_htg'
                                  ? 'Prix Manuel HTG'
                                  : 'Marge'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-800">
                              {entry.packageName
                                ? `${entry.serviceName ? `${entry.serviceName} — ` : ''}${entry.packageName}`
                                : entry.reason}
                            </td>
                            <td className="py-2.5 px-3 font-mono">
                              {entry.previousExchangeRate && entry.previousExchangeRate !== entry.newExchangeRate
                                ? `${entry.previousExchangeRate} → ${entry.newExchangeRate} HTG`
                                : `1 USD = ${entry.newExchangeRate || Number(exchangeRateInput) || settings?.usdToHtgExchangeRate || 132} HTG`}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-600">
                              {typeof entry.supplierCostUsd === 'number'
                                ? `$${entry.supplierCostUsd.toFixed(2)} USD`
                                : '—'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-700">
                              {typeof entry.newSupplierCostHtg === 'number'
                                ? `${entry.newSupplierCostHtg.toFixed(2)} HTG`
                                : '—'}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-orange-600">
                              {typeof entry.newSellingPriceHtg === 'number'
                                ? entry.previousSellingPriceHtg && entry.previousSellingPriceHtg !== entry.newSellingPriceHtg
                                  ? `${entry.previousSellingPriceHtg} → ${entry.newSellingPriceHtg} HTG`
                                  : `${entry.newSellingPriceHtg} HTG`
                                : '—'}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-emerald-600">
                              {typeof entry.profitHtg === 'number'
                                ? `+${entry.profitHtg.toFixed(2)} HTG (${entry.marginPercent?.toFixed(1) || 0}%)`
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: ORDERS */}
          {currentTab === 'orders' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900">Gestion des Commandes PlayUp &amp; GoXtop</h2>
                  <p className="text-xs text-slate-500">
                    Recherche, consultation détaillée, suivi paiement et synchronisation avec GoXtop.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Recherche (Order ID, partner_orderid, joueur)..."
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white w-full sm:w-64"
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

              <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 overflow-x-auto shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Commande / Partner ID</th>
                      <th className="py-2.5 px-3">GoXtop ID &amp; Paiement</th>
                      <th className="py-2.5 px-3">Jeu &amp; Produit</th>
                      <th className="py-2.5 px-3">Player ID / Vérification</th>
                      <th className="py-2.5 px-3">Coût / Marge / Prix</th>
                      <th className="py-2.5 px-3">Statut</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders
                      .filter(o => !orderStatusFilter || o.status === orderStatusFilter)
                      .filter(
                        o =>
                          !orderSearch ||
                          (o.orderNumber || '').toLowerCase().includes(orderSearch.toLowerCase()) ||
                          (o.partnerOrderId && o.partnerOrderId.toLowerCase().includes(orderSearch.toLowerCase())) ||
                          (o.externalOrderId && o.externalOrderId.toLowerCase().includes(orderSearch.toLowerCase())) ||
                          (o.playerId && o.playerId.toLowerCase().includes(orderSearch.toLowerCase())) ||
                          (o.gameName || '').toLowerCase().includes(orderSearch.toLowerCase())
                      )
                      .map(o => {
                        const calcMargin = typeof o.margin === 'number' ? o.margin : Number((o.chargedAmount - o.supplierCost).toFixed(2));
                        return (
                          <tr key={o.id} className="hover:bg-slate-50">
                            <td className="py-3 px-3 font-mono">
                              <div className="font-bold text-slate-900">{o.orderNumber}</div>
                              <div className="text-[10px] text-orange-600 font-semibold">{o.partnerOrderId}</div>
                              <div className="text-[10px] text-slate-400">
                                {o.source === 'mobile_app' ? 'PlayUp App' : `API: ${o.resellerName}`}
                              </div>
                            </td>
                            <td className="py-3 px-3 font-mono text-[11px] text-slate-700">
                              <span className="font-bold">{o.externalOrderId || '—'}</span>
                              <span className="block text-[10px] text-slate-500 uppercase">
                                {o.paymentMethod || 'wallet'} {o.paymentReference ? `(${o.paymentReference})` : ''}
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-semibold text-slate-900">{o.gameName}</div>
                              <div className="text-[11px] text-slate-500">{o.packageName}</div>
                            </td>
                            <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                              <div>{o.playerId || Object.entries(o.gameProfileData || {}).map(([k, v]) => `${k}:${v}`).join(' ') || 'Sans Player ID'}</div>
                              {o.verifiedPlayerName && (
                                <span className="inline-block mt-0.5 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-sans font-semibold">
                                  ✓ {o.verifiedPlayerName}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 font-mono text-[11px]">
                              <div className="text-slate-500">Coût: ${o.supplierCost.toFixed(2)}</div>
                              <div className="text-emerald-600 font-semibold">Marge: +${calcMargin.toFixed(2)}</div>
                              <div className="font-bold text-slate-900">Vente: ${o.chargedAmount.toFixed(2)}</div>
                            </td>
                            <td className="py-3 px-3">
                              <select
                                value={o.status}
                                onChange={(e) => handleUpdateOrderStatus(o.id, e.target.value)}
                                className={`px-2 py-1 rounded text-[10px] font-bold uppercase border-0 cursor-pointer ${
                                  o.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                                  o.status === 'processing' || o.status === 'paid' ? 'bg-amber-100 text-amber-800' :
                                  o.status === 'failed' || o.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                                  o.status === 'refunded' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-800'
                                }`}
                              >
                                <option value="pending">pending</option>
                                <option value="paid">paid</option>
                                <option value="processing">processing</option>
                                <option value="completed">completed</option>
                                <option value="failed">failed</option>
                                <option value="cancelled">cancelled</option>
                                <option value="refunded">refunded</option>
                              </select>
                            </td>
                            <td className="py-3 px-3 text-right space-x-1 whitespace-nowrap">
                              <button
                                onClick={() => setSelectedOrderDetail(o)}
                                className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px]"
                              >
                                Détails
                              </button>
                              <button
                                onClick={() => handleCheckRemoteStatus(o.id)}
                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-[11px]"
                                title="GET /api/v.1/:partner_orderid"
                              >
                                Statut
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
                                >
                                  Retry
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: USERS MANAGEMENT */}
          {currentTab === 'users' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
                    Gestion des Utilisateurs PlayUp
                  </h2>
                  <p className="text-xs text-slate-500">
                    Consultez les profils joueurs, activez ou désactivez un compte utilisateur, ajustez leur portefeuille PlayUp Wallet ou modifiez votre propre mot de passe administrateur.
                  </p>
                </div>
                <input
                  type="text"
                  placeholder="Rechercher un joueur (nom, email, téléphone)..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white w-full sm:w-72"
                />
              </div>

              <div className="bg-slate-900 text-slate-200 rounded-2xl p-4 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-orange-500" />
                    <span>Politique de Sécurité — Premier Administrateur Unique</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Seul le premier utilisateur inscrit détient le rôle <strong className="text-orange-400">ADMIN</strong>. Tous les comptes suivants reçoivent automatiquement le rôle <strong className="text-white">USER</strong>. Les mots de passe, tokens privés, clés API et secrets d’environnement ne sont jamais affichés en clair.
                  </p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 overflow-x-auto shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Utilisateur</th>
                      <th className="py-2.5 px-3">Rôle Serveur (Immuable)</th>
                      <th className="py-2.5 px-3">Méthode Auth</th>
                      <th className="py-2.5 px-3">PlayUp Wallet</th>
                      <th className="py-2.5 px-3">Commandes / Dépensé</th>
                      <th className="py-2.5 px-3">Statut</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users
                      .filter(
                        u =>
                          !userSearch ||
                          (u.name || '').toLowerCase().includes(userSearch.toLowerCase()) ||
                          (u.email || '').toLowerCase().includes(userSearch.toLowerCase())
                      )
                      .map(u => (
                        <tr key={u.id} className="hover:bg-slate-50">
                          <td className="py-3 px-3">
                            <div className="font-bold text-slate-900">{u.name}</div>
                            <div className="text-[11px] text-slate-500">{u.email}</div>
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                u.role === 'ADMIN'
                                  ? 'bg-orange-100 text-orange-800 border border-orange-200'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              <Lock className="w-2.5 h-2.5" />
                              <span>{u.role === 'ADMIN' ? 'ADMIN (Unique)' : 'USER'}</span>
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-bold uppercase">
                              {u.authProvider}
                            </span>
                            {u.twoFactorEnabled && (
                              <span className="ml-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-semibold">
                                2FA
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-orange-600">
                            ${u.walletBalance.toFixed(2)} {u.preferredCurrency || 'USD'}
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px]">
                            <span className="font-bold text-slate-900">{u.ordersCount} cmd</span> · ${u.totalSpent.toFixed(2)}
                          </td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              u.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {u.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right space-x-1.5 whitespace-nowrap">
                            <button
                              onClick={() => setUserWalletModal({ user: u, amount: '10', note: 'Bonus / Crédit Admin' })}
                              className="px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded-lg font-semibold text-[11px]"
                            >
                              Wallet +/-
                            </button>
                            {u.role === 'ADMIN' ? (
                              <button
                                onClick={() => setUserPasswordModal({ user: u, newPassword: '' })}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-[11px]"
                                title="Modifier votre propre mot de passe administrateur"
                              >
                                Mon mot de passe
                              </button>
                            ) : (
                              <button
                                onClick={() => handleToggleUserStatus(u)}
                                className={`px-2.5 py-1 rounded-lg font-semibold text-[11px] ${
                                  u.status === 'active'
                                    ? 'bg-red-50 text-red-700 hover:bg-red-100'
                                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                }`}
                              >
                                {u.status === 'active' ? 'Désactiver' : 'Activer'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: RESELLERS & API KEYS */}
          {currentTab === 'resellers' && (
            <div className="space-y-6">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
                Gestion des Revendeurs B2B &amp; Clés API
              </h2>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 overflow-x-auto shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Entreprise / Nom</th>
                      <th className="py-2.5 px-3">Email &amp; Webhook</th>
                      <th className="py-2.5 px-3">Solde B2B</th>
                      <th className="py-2.5 px-3">Activité</th>
                      <th className="py-2.5 px-3">Statut</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {resellers.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="py-3 px-3 font-semibold text-slate-900">
                          {r.company}
                          <span className="block text-[11px] text-slate-500 font-normal">{r.name}</span>
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          <div>{r.email}</div>
                          {r.webhookUrl && (
                            <div className="font-mono text-[10px] text-slate-400 truncate max-w-xs">{r.webhookUrl}</div>
                          )}
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-emerald-600 text-sm">
                          ${r.balance.toFixed(2)} USD
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px]">
                          {r.ordersCount || 0} commandes
                        </td>
                        <td className="py-3 px-3">
                          <select
                            value={r.status}
                            onChange={(e) => handleUpdateResellerStatus(r.id, e.target.value)}
                            className={`px-2 py-1 rounded text-[10px] font-bold uppercase cursor-pointer ${
                              r.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : r.status === 'pending'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            <option value="active">Approuvé (Active)</option>
                            <option value="pending">En attente (Pending)</option>
                            <option value="suspended">Suspendu</option>
                          </select>
                        </td>
                        <td className="py-3 px-3 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => setNewResellerKeyModal({ reseller: r, name: 'Clé API Production' })}
                            className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold"
                          >
                            + Clé API
                          </button>
                          <button
                            onClick={() => setBalanceModal({ reseller: r, amount: '100', note: 'Approvisionnement virement bancaire' })}
                            className="px-2.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold"
                          >
                            Solde (+/-)
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Reseller API Keys Management Table */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xs">
                <h3 className="font-display text-base font-bold text-slate-900">
                  Clés API Revendeurs ({apiKeys.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                        <th className="py-2 px-3">Nom de la Clé</th>
                        <th className="py-2 px-3">Revendeur</th>
                        <th className="py-2 px-3">Clé Masquée</th>
                        <th className="py-2 px-3">Dernière Utilisation</th>
                        <th className="py-2 px-3">Statut</th>
                        <th className="py-2 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {apiKeys.map(k => {
                        const owner = resellers.find(r => r.id === k.resellerId);
                        return (
                          <tr key={k.id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 font-semibold text-slate-900">{k.name}</td>
                            <td className="py-2.5 px-3 text-slate-600">{owner?.company || k.resellerId}</td>
                            <td className="py-2.5 px-3 font-mono text-[11px]">{k.maskedKey}</td>
                            <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                              {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Jamais utilisée'}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                k.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                              }`}>
                                {k.status}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                onClick={() => handleToggleApiKeyStatus(k)}
                                className={`px-2.5 py-1 rounded-lg font-semibold text-[11px] ${
                                  k.status === 'active'
                                    ? 'bg-red-50 text-red-700 hover:bg-red-100'
                                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                }`}
                              >
                                {k.status === 'active' ? 'Révoquer' : 'Réactiver'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: PAYMENT GATEWAYS & TRANSACTIONS */}
          {currentTab === 'payments' && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
                  Passerelles de Paiement &amp; Transactions
                </h2>
                <p className="text-xs text-slate-500">
                  Configurez les méthodes de paiement (MonCash Digicel, NatCash Natcom, Carte Bancaire Stripe, PlayUp Wallet) et suivez chaque transaction.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {paymentGateways.map(gw => (
                  <div key={gw.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-xs flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
                            {gw.providerName}
                          </span>
                          <h3 className="font-display text-base font-bold text-slate-900">{gw.name}</h3>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          gw.isEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {gw.isEnabled ? `Actif (${gw.mode})` : 'Désactivé'}
                        </span>
                      </div>

                      <p className="text-xs text-slate-500">{gw.description}</p>

                      <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                        <div className="p-2.5 bg-slate-50 rounded-xl">
                          <span className="text-[10px] text-slate-400 block">Frais Passerelle</span>
                          <span className="font-mono font-bold text-slate-800">
                            {gw.feePercent}% + ${gw.fixedFee.toFixed(2)}
                          </span>
                        </div>
                        <div className="p-2.5 bg-slate-50 rounded-xl">
                          <span className="text-[10px] text-slate-400 block">Clés Serveur</span>
                          <span className="font-mono font-bold text-slate-800">
                            {gw.credentialsMasked || 'Configuré'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                      <button
                        onClick={async () => {
                          if (!token) return;
                          await apiClient.updateAdminPaymentGateway(token, gw.id, { isEnabled: !gw.isEnabled });
                          loadAllAdminData();
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          gw.isEnabled ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'
                        }`}
                      >
                        {gw.isEnabled ? 'Désactiver' : 'Activer'}
                      </button>

                      <button
                        onClick={() =>
                          setEditingGatewayModal({
                            gateway: { ...gw },
                            apiKey: '',
                            clientSecret: '',
                            webhookSecret: ''
                          })
                        }
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold"
                      >
                        Configurer API &amp; Frais
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Payment Transactions Table */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xs">
                <h3 className="font-display text-base font-bold text-slate-900">
                  Journal des Transactions de Paiement ({paymentTransactions.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                        <th className="py-2 px-3">Référence Transaction</th>
                        <th className="py-2 px-3">Méthode</th>
                        <th className="py-2 px-3">Identifiant Payeur</th>
                        <th className="py-2 px-3">Montant / Frais / Total</th>
                        <th className="py-2 px-3">Statut</th>
                        <th className="py-2 px-3">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paymentTransactions.map(tx => (
                        <tr key={tx.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                            {tx.transactionReference}
                          </td>
                          <td className="py-2.5 px-3 uppercase font-bold text-orange-600">
                            {tx.paymentMethod}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                            {tx.payerIdentifier || tx.userEmail || '—'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            ${tx.amount.toFixed(2)} + ${tx.feeAmount.toFixed(2)} ={' '}
                            <strong className="text-emerald-700">${tx.totalCharged.toFixed(2)}</strong>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">
                              {tx.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                            {new Date(tx.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      {paymentTransactions.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-400">
                            Aucune transaction enregistrée.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB RECHARGEGAMES: DEDICATED RECHARGEGAMES INTEGRATION */}
          {currentTab === 'rechargegames' && token && (
            <RechargeGamesAdminPanel
              token={token}
              onRefreshParent={loadAllAdminData}
            />
          )}

          {/* TAB 8: EXTERNAL PROVIDERS & GOXTOP CONFIGURATION */}
          {currentTab === 'providers' && token && (
            <GoXtopAdminPanel
              token={token}
              providers={providers}
              games={games}
              services={services}
              onRefreshData={loadAllAdminData}
            />
          )}

          {/* TAB 9: SUPPORT TICKETS */}
          {currentTab === 'support' && (
            <div className="space-y-6">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900">Tickets Support Utilisateurs</h2>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 overflow-x-auto shadow-xs">
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

          {/* TAB 10: SETTINGS & DOWNLOAD STORES */}
          {currentTab === 'settings' && settings && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6 max-w-3xl">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
                Paramètres Généraux &amp; Configuration Système
              </h2>

              <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Nom de la Plateforme</label>
                    <input
                      type="text"
                      value={settings.platformName}
                      onChange={(e) => setSettings({ ...settings, platformName: e.target.value })}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Email Support Officiel</label>
                    <input
                      type="email"
                      value={settings.supportEmail}
                      onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Bannière d’annonce système</label>
                    <input
                      type="text"
                      value={settings.announcementNotice || ''}
                      onChange={(e) => setSettings({ ...settings, announcementNotice: e.target.value })}
                      placeholder="Ex: Maintenance programmée ou promotion..."
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-6 pt-5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.maintenanceMode}
                        onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })}
                      />
                      <span className="font-semibold text-slate-800">Mode Maintenance</span>
                    </label>
                  </div>
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

          {/* TAB 11: LOGS */}
          {currentTab === 'logs' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900">Journaux &amp; Monitoring Système</h2>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Description</label>
                <input
                  type="text"
                  value={editingGame.description || ''}
                  onChange={(e) => setEditingGame({ ...editingGame, description: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                />
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingGame.isActive !== false}
                    onChange={(e) => setEditingGame({ ...editingGame, isActive: e.target.checked })}
                  />
                  <span className="font-semibold text-slate-800">Jeu Actif</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingGame.supportsNameCheck)}
                    onChange={(e) => setEditingGame({ ...editingGame, supportsNameCheck: e.target.checked })}
                  />
                  <span className="font-semibold text-slate-800">Supporte Name Checker GoXtop</span>
                </label>
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

      {/* MODAL: EDIT SERVICE & PACKAGES */}
      {editingService && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto shadow-2xl text-xs">
            <h3 className="font-display text-xl font-bold text-slate-900">
              {isNewService ? 'Créer un Service' : `Configurer ${editingService.name}`}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Jeu associé</label>
                <select
                  value={editingService.gameId || ''}
                  onChange={(e) => setEditingService({ ...editingService, gameId: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2"
                >
                  {games.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Nom du Service</label>
                <input
                  type="text"
                  value={editingService.name || ''}
                  onChange={(e) => setEditingService({ ...editingService, name: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Fournisseur assigné</label>
                <select
                  value={editingService.providerId || ''}
                  onChange={(e) => setEditingService({ ...editingService, providerId: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2"
                >
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 uppercase">
                  Packages &amp; Tarifs ({editingService.packages?.length || 0})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const newPkg: ServicePackage = {
                      id: 'pkg_' + Date.now(),
                      serviceId: editingService.id || '',
                      name: 'Nouveau Pack',
                      amount: 500,
                      unit: 'Diamonds',
                      publicPrice: 4.99,
                      resellerPrice: 4.50,
                      supplierCost: 4.10,
                      margin: 0.89,
                      currency: 'USD',
                      isActive: true,
                      displayOrder: (editingService.packages?.length || 0) + 1
                    };
                    setEditingService({
                      ...editingService,
                      packages: [...(editingService.packages || []), newPkg]
                    });
                  }}
                  className="px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg font-bold"
                >
                  + Ajouter un Package
                </button>
              </div>

              <div className="space-y-2">
                {editingService.packages?.map((pkg, idx) => {
                  const activeRate = Number(exchangeRateInput) > 0 ? Number(exchangeRateInput) : (settings?.usdToHtgExchangeRate || 132);
                  const immutableUsd = Number(
                    (typeof pkg.supplierCostUsd === 'number' && pkg.supplierCostUsd > 0
                      ? pkg.supplierCostUsd
                      : pkg.supplierCost || 0
                    ).toFixed(2)
                  );
                  const autoCostHtg = Number((immutableUsd * activeRate).toFixed(2));
                  const currentPriceHtg =
                    typeof pkg.publicPriceHtg === 'number' && pkg.publicPriceHtg > 0
                      ? pkg.publicPriceHtg
                      : Number((Number(pkg.publicPrice || 0) * activeRate).toFixed(2));
                  const autoProfitHtg = Number((currentPriceHtg - autoCostHtg).toFixed(2));
                  const autoMarginPct =
                    autoCostHtg > 0 ? Number(((autoProfitHtg / autoCostHtg) * 100).toFixed(2)) : 0;

                  return (
                    <div key={pkg.id || idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-2 sm:grid-cols-6 gap-2 items-center">
                      <input
                        type="text"
                        value={pkg.name}
                        onChange={(e) => {
                          const list = [...(editingService.packages || [])];
                          list[idx].name = e.target.value;
                          setEditingService({ ...editingService, packages: list });
                        }}
                        placeholder="Nom pack"
                        className="border border-slate-300 rounded-lg px-2 py-1.5 bg-white"
                      />
                      <input
                        type="text"
                        value={pkg.externalProductId || ''}
                        onChange={(e) => {
                          const list = [...(editingService.packages || [])];
                          list[idx].externalProductId = e.target.value;
                          setEditingService({ ...editingService, packages: list });
                        }}
                        placeholder="ID Produit"
                        className="border border-slate-300 rounded-lg px-2 py-1.5 font-mono bg-white"
                      />
                      <div>
                        <span className="text-[10px] text-slate-400 block">Fournisseur USD (Fixe)</span>
                        <div className="w-full border border-slate-200 rounded-lg px-2 py-1 font-mono bg-slate-100 text-slate-600 font-bold flex items-center gap-1">
                          <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>${immutableUsd.toFixed(2)}</span>
                        </div>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">Coût Auto (HTG)</span>
                        <div className="w-full border border-slate-200 rounded-lg px-2 py-1 font-mono bg-slate-100 text-slate-700 font-bold">
                          {autoCostHtg.toFixed(2)} HTG
                        </div>
                      </div>
                      <div>
                        <span className="text-[10px] text-orange-600 font-bold block">Prix Vente Final (HTG)</span>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          value={currentPriceHtg}
                          onChange={(e) => {
                            const newHtg = Number(e.target.value);
                            const list = [...(editingService.packages || [])];
                            list[idx].publicPriceHtg = newHtg;
                            list[idx].publicPrice = activeRate > 0 ? Number((newHtg / activeRate).toFixed(2)) : list[idx].publicPrice;
                            list[idx].manualPriceHtgDefined = true;
                            setEditingService({ ...editingService, packages: list });
                          }}
                          className="w-full border border-orange-400 rounded-lg px-2 py-1 font-mono font-bold text-orange-700 bg-white"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[10px] text-slate-400 block">Bénéfice / Marge HTG</span>
                          <span className={`font-mono font-bold text-[11px] ${autoProfitHtg >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {autoProfitHtg >= 0 ? '+' : ''}{autoProfitHtg.toFixed(1)} HTG ({autoMarginPct.toFixed(0)}%)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const list = (editingService.packages || []).filter((_, i) => i !== idx);
                            setEditingService({ ...editingService, packages: list });
                          }}
                          className="text-red-600 hover:underline text-[10px]"
                        >
                          Suppr.
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => setEditingService(null)}
                className="px-4 py-2 border border-slate-300 rounded-xl font-semibold"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveService}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-semibold"
              >
                Enregistrer le Service
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ORDER DETAILS */}
      {selectedOrderDetail && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Détails Commande {selectedOrderDetail.orderNumber}
                </h3>
                <span className="font-mono text-[11px] text-orange-600">{selectedOrderDetail.partnerOrderId}</span>
              </div>
              <button onClick={() => setSelectedOrderDetail(null)} className="text-slate-400 hover:text-slate-700 font-bold">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-xl">
              <div>
                <span className="text-slate-400 block">Jeu &amp; Pack</span>
                <span className="font-bold text-slate-900">{selectedOrderDetail.gameName} — {selectedOrderDetail.packageName}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Paiement</span>
                <span className="font-mono font-bold uppercase text-emerald-700">
                  {selectedOrderDetail.paymentMethod || 'wallet'} {selectedOrderDetail.paymentReference ? `(${selectedOrderDetail.paymentReference})` : ''}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Player ID / Profil</span>
                <span className="font-mono text-slate-800">
                  {selectedOrderDetail.playerId || Object.entries(selectedOrderDetail.gameProfileData || {}).map(([k, v]) => `${k}:${v}`).join(' ')}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Montant / Marge</span>
                <span className="font-mono font-bold text-slate-900">
                  ${selectedOrderDetail.chargedAmount.toFixed(2)} (Marge: +${selectedOrderDetail.margin.toFixed(2)})
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-bold text-slate-900 uppercase block">Historique des Statuts</span>
              <div className="space-y-1.5 max-h-44 overflow-y-auto border border-slate-100 rounded-xl p-3">
                {selectedOrderDetail.statusHistory.map((h, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 border-b border-slate-50 pb-1.5 last:border-0">
                    <div>
                      <span className="font-bold uppercase text-orange-600">{h.status}</span>
                      <p className="text-[11px] text-slate-600">{h.note}</p>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {new Date(h.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedOrderDetail(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl font-semibold"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: USER WALLET ADJUST */}
      {userWalletModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl text-xs">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Ajuster le PlayUp Wallet de {userWalletModal.user.name}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="font-semibold block mb-1">Montant USD (+ crédit / - débit)</label>
                <input
                  type="number"
                  step="0.5"
                  value={userWalletModal.amount}
                  onChange={(e) => setUserWalletModal({ ...userWalletModal, amount: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Motif</label>
                <input
                  type="text"
                  value={userWalletModal.note}
                  onChange={(e) => setUserWalletModal({ ...userWalletModal, note: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2"
                />
              </div>
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button onClick={() => setUserWalletModal(null)} className="px-4 py-2 border rounded-xl font-semibold">Annuler</button>
              <button onClick={handleAdjustUserWalletSubmit} className="px-4 py-2 bg-orange-600 text-white rounded-xl font-semibold">Valider</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: USER PASSWORD RESET */}
      {userPasswordModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl text-xs">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Réinitialiser le mot de passe ({userPasswordModal.user.email})
            </h3>
            <div>
              <label className="font-semibold block mb-1">Nouveau mot de passe (haché avec scrypt)</label>
              <input
                type="password"
                value={userPasswordModal.newPassword}
                onChange={(e) => setUserPasswordModal({ ...userPasswordModal, newPassword: e.target.value })}
                placeholder="Minimum 6 caractères"
                className="w-full border border-slate-300 rounded-xl px-3 py-2"
              />
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button onClick={() => setUserPasswordModal(null)} className="px-4 py-2 border rounded-xl font-semibold">Annuler</button>
              <button onClick={handleResetUserPasswordSubmit} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-semibold">Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: NEW RESELLER API KEY */}
      {newResellerKeyModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl text-xs">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Générer une Clé API pour {newResellerKeyModal.reseller.company}
            </h3>
            <div>
              <label className="font-semibold block mb-1">Nom de la clé API</label>
              <input
                type="text"
                value={newResellerKeyModal.name}
                onChange={(e) => setNewResellerKeyModal({ ...newResellerKeyModal, name: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2"
              />
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button onClick={() => setNewResellerKeyModal(null)} className="px-4 py-2 border rounded-xl font-semibold">Annuler</button>
              <button onClick={handleCreateResellerKeySubmit} className="px-4 py-2 bg-orange-600 text-white rounded-xl font-semibold">Générer la Clé</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT PAYMENT GATEWAY */}
      {editingGatewayModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl text-xs">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Configurer {editingGatewayModal.gateway.name}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold block mb-1">Environnement</label>
                <select
                  value={editingGatewayModal.gateway.mode}
                  onChange={(e) =>
                    setEditingGatewayModal({
                      ...editingGatewayModal,
                      gateway: { ...editingGatewayModal.gateway, mode: e.target.value as 'sandbox' | 'live' }
                    })
                  }
                  className="w-full border border-slate-300 rounded-xl px-3 py-2"
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="live">Production (Live)</option>
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">Frais (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={editingGatewayModal.gateway.feePercent}
                  onChange={(e) =>
                    setEditingGatewayModal({
                      ...editingGatewayModal,
                      gateway: { ...editingGatewayModal.gateway, feePercent: Number(e.target.value) }
                    })
                  }
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="font-semibold block mb-1">API Key / Client ID (stocké côté serveur uniquement)</label>
              <input
                type="password"
                value={editingGatewayModal.apiKey}
                onChange={(e) => setEditingGatewayModal({ ...editingGatewayModal, apiKey: e.target.value })}
                placeholder="Laisser vide pour conserver la clé actuelle"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Secret Key / Client Secret (stocké côté serveur)</label>
              <input
                type="password"
                value={editingGatewayModal.clientSecret}
                onChange={(e) => setEditingGatewayModal({ ...editingGatewayModal, clientSecret: e.target.value })}
                placeholder="Laisser vide pour conserver le secret actuel"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono"
              />
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button onClick={() => setEditingGatewayModal(null)} className="px-4 py-2 border rounded-xl font-semibold">Annuler</button>
              <button onClick={handleSavePaymentGateway} className="px-4 py-2 bg-orange-600 text-white rounded-xl font-semibold">Enregistrer</button>
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
