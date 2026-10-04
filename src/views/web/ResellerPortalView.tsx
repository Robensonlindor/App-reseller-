import React, { useState, useEffect } from 'react';
import { 
  Key, Wallet, TrendingUp, CheckCircle2, Clock, AlertTriangle, 
  Copy, Plus, Trash2, RefreshCw, Send, ShieldCheck, Globe, 
  Terminal, ArrowRight, DollarSign, Bell 
} from 'lucide-react';
import { Reseller, ApiKey, Order, Transaction, WebhookLog, Service } from '../../types';
import { apiClient } from '../../services/apiClient';
import { Language, translations } from '../../i18n';

interface ResellerPortalViewProps {
  onNavigate: (tab: string) => void;
  lang: Language;
}

export const ResellerPortalView: React.FC<ResellerPortalViewProps> = ({ onNavigate, lang }) => {
  const [session, setSession] = useState<{ reseller: Reseller } | null>(null);
  const [loginEmail, setLoginEmail] = useState('leaderlindor@gmail.com');
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerCompany, setRegisterCompany] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authError, setAuthError] = useState<string | null>(null);

  // Dashboard active sub-tab
  const [activeTab, setActiveTab] = useState<'overview' | 'api-keys' | 'orders' | 'transactions' | 'webhook'>('overview');

  // Dashboard data
  const [dashboardData, setDashboardData] = useState<{
    reseller: Reseller;
    stats: any;
    apiKeys: ApiKey[];
    recentOrders: Order[];
    transactions: Transaction[];
    webhookLogs: WebhookLog[];
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyIsTest, setNewKeyIsTest] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [webhookInputUrl, setWebhookInputUrl] = useState('');
  const [webhookMsg, setWebhookMsg] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState('100');

  // Check existing session in localStorage
  useEffect(() => {
    const saved = localStorage.getItem('playup_reseller_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSession(parsed);
        loadDashboard(parsed.reseller.id);
      } catch (e) {
        localStorage.removeItem('playup_reseller_session');
      }
    }
  }, []);

  const loadDashboard = async (resellerId: string) => {
    setLoading(true);
    try {
      const data = await apiClient.getResellerMe(resellerId);
      setDashboardData(data);
      setWebhookInputUrl(data.reseller.webhookUrl || '');
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const res = await apiClient.resellerLogin(loginEmail);
      setSession(res);
      localStorage.setItem('playup_reseller_session', JSON.stringify(res));
      await loadDashboard(res.reseller.id);
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const res = await apiClient.resellerRegister({
        name: registerName,
        email: registerEmail,
        company: registerCompany
      });
      setSession(res);
      localStorage.setItem('playup_reseller_session', JSON.stringify(res));
      await loadDashboard(res.reseller.id);
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('playup_reseller_session');
    setSession(null);
    setDashboardData(null);
  };

  const handleCreateApiKey = async () => {
    if (!session?.reseller.id) return;
    try {
      await apiClient.createApiKey(session.reseller.id, newKeyName || 'Production Key', newKeyIsTest);
      setNewKeyName('');
      await loadDashboard(session.reseller.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!session?.reseller.id) return;
    if (confirm('Voulez-vous révoquer cette clé API ? Toutes les requêtes avec cette clé seront immédiatement bloquées.')) {
      await apiClient.revokeApiKey(session.reseller.id, keyId);
      await loadDashboard(session.reseller.id);
    }
  };

  const handleSaveWebhook = async () => {
    if (!session?.reseller.id) return;
    try {
      await apiClient.updateWebhook(session.reseller.id, webhookInputUrl);
      setWebhookMsg('URL de Webhook enregistrée avec succès.');
      setTimeout(() => setWebhookMsg(null), 3000);
      await loadDashboard(session.reseller.id);
    } catch (err: any) {
      setWebhookMsg('Erreur lors de la mise à jour');
    }
  };

  const handleTestWebhookPing = async () => {
    if (!session?.reseller.id) return;
    try {
      const res = await apiClient.testWebhookPing(session.reseller.id);
      setWebhookMsg('Événement de test expédié au webhook.');
      setTimeout(() => setWebhookMsg(null), 4000);
      await loadDashboard(session.reseller.id);
    } catch (err: any) {
      setWebhookMsg(err.message);
    }
  };

  const handleTestDeposit = async () => {
    if (!session?.reseller.id) return;
    const amount = Number(depositAmount);
    if (!amount || amount <= 0) return;
    try {
      await apiClient.depositTestBalance(session.reseller.id, amount);
      await loadDashboard(session.reseller.id);
    } catch (e) {
      console.error(e);
    }
  };

  const copyKey = (val: string, id: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // IF NOT LOGGED IN: SHOW AUTHENTICATION FORM
  if (!session) {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-lg space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-orange-600 text-white font-black text-2xl flex items-center justify-center mx-auto">
              P
            </div>
            <h2 className="font-display text-2xl font-bold text-slate-900">
              Espace Reseller & API
            </h2>
            <p className="text-xs text-slate-500">
              Connectez-vous à votre portail revendeur pour gérer vos clés d'API et vos intégrations.
            </p>
          </div>

          {/* Toggle Login / Register */}
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setAuthMode('login')}
              className={`flex-1 py-2 rounded-lg transition-colors ${authMode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}
            >
              Connexion
            </button>
            <button
              onClick={() => setAuthMode('register')}
              className={`flex-1 py-2 rounded-lg transition-colors ${authMode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}
            >
              Créer un compte
            </button>
          </div>

          {authError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              {authError}
            </div>
          )}

          {authMode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Email revendeur</label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="ex: leaderlindor@gmail.com"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-white font-semibold rounded-xl text-xs shadow-md transition-colors"
                >
                  Accéder à mon Dashboard
                </button>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[11px] text-slate-500">
                Compte démo pré-enregistré : <strong className="text-slate-800">leaderlindor@gmail.com</strong> (Alpha Games Network).
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Nom complet</label>
                <input
                  type="text"
                  required
                  value={registerName}
                  onChange={(e) => setRegisterName(e.target.value)}
                  placeholder="ex: Robenson Alexis"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Email professionnel</label>
                <input
                  type="email"
                  required
                  value={registerEmail}
                  onChange={(e) => setRegisterEmail(e.target.value)}
                  placeholder="ex: contact@monentreprise.com"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Entreprise / Projet</label>
                <input
                  type="text"
                  value={registerCompany}
                  onChange={(e) => setRegisterCompany(e.target.value)}
                  placeholder="ex: Caribbean Gaming Store"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-white font-semibold rounded-xl text-xs shadow-md transition-colors"
                >
                  Créer mon compte revendeur (+50$ Sandbox)
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // IF LOGGED IN: SHOW DASHBOARD
  const res = dashboardData?.reseller || session.reseller;
  const stats = dashboardData?.stats;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Portail Revendeur</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-orange-600">{res.company}</span>
            <span aria-hidden="true">·</span>
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold uppercase">
              {res.status}
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1">
            Dashboard Partenaire & API
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('api-docs')}
            className="px-3.5 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Terminal className="w-3.5 h-3.5 text-orange-600" />
            <span>Documentation API</span>
          </button>
          <button
            onClick={handleLogout}
            className="px-3.5 py-2 text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors"
          >
            Déconnexion
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Balance Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Solde disponible</span>
            <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="font-mono text-2xl sm:text-3xl font-bold text-slate-900">
              ${(res.balance || 0).toFixed(2)} <span className="text-xs font-sans text-slate-400">USD</span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="w-20 px-2 py-1 border border-slate-200 rounded text-xs font-mono"
                placeholder="Montant"
              />
              <button
                onClick={handleTestDeposit}
                className="px-2.5 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded text-xs font-semibold transition-colors"
              >
                + Recharger
              </button>
            </div>
          </div>
        </div>

        {/* Total Orders Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Commandes API</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="font-mono text-2xl sm:text-3xl font-bold text-slate-900">
              {stats?.totalOrders ?? res.ordersCount ?? 0}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Commandes enregistrées via vos clés d'API
            </p>
          </div>
        </div>

        {/* Completed Rate */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Succès de livraison</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="font-mono text-2xl sm:text-3xl font-bold text-emerald-600">
              {stats?.completedOrders ?? 0}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Livrées directement sur les UID joueurs
            </p>
          </div>
        </div>

        {/* Active API Keys */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Clés API Actives</span>
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Key className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="font-mono text-2xl sm:text-3xl font-bold text-slate-900">
              {dashboardData?.apiKeys.filter(k => k.status === 'active').length ?? 1}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Prêtes pour vos applications et bots
            </p>
          </div>
        </div>
      </div>

      {/* Sub Tabs Navigation */}
      <div className="flex items-center gap-1 border-b border-slate-200 pb-px">
        {[
          { id: 'overview', label: 'Vue d’ensemble' },
          { id: 'api-keys', label: 'Clés d’API' },
          { id: 'orders', label: 'Commandes API' },
          { id: 'transactions', label: 'Transactions & Solde' },
          { id: 'webhook', label: 'Webhooks' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === tab.id
                ? 'border-orange-600 text-orange-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-slate-900">Dernières Commandes traitées</h3>
              <button 
                onClick={() => setActiveTab('orders')}
                className="text-xs text-orange-600 font-semibold hover:underline"
              >
                Voir tout ({dashboardData?.recentOrders.length || 0})
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="py-2.5 px-3">N° Commande</th>
                    <th className="py-2.5 px-3">Jeu & Pack</th>
                    <th className="py-2.5 px-3">Profil Joueur</th>
                    <th className="py-2.5 px-3">Montant débité</th>
                    <th className="py-2.5 px-3">Statut</th>
                    <th className="py-2.5 px-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dashboardData?.recentOrders.slice(0, 5).map(o => (
                    <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-3 font-mono font-medium text-slate-900">{o.orderNumber}</td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900">{o.gameName}</div>
                        <div className="text-[11px] text-slate-500">{o.packageName}</div>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-600">
                        {Object.entries(o.gameProfileData).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-slate-900">
                        ${o.chargedAmount.toFixed(2)}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          o.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                          o.status === 'processing' ? 'bg-amber-100 text-amber-800' :
                          o.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-800'
                        }`}>
                          {o.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-500 text-[11px]">
                        {new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                  {(!dashboardData?.recentOrders || dashboardData.recentOrders.length === 0) && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-400">
                        Aucune commande enregistrée pour l'instant.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: API KEYS */}
      {activeTab === 'api-keys' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-sm text-slate-900">Vos Clés d'API PlayUp</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Utilisez ces clés pour authentifier vos requêtes B2B sur l’API REST.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Nom de la clé (ex: Serveur Discord)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs"
                />
                <button
                  onClick={handleCreateApiKey}
                  className="px-3.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Générer une clé</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="py-2.5 px-3">Nom</th>
                    <th className="py-2.5 px-3">Clé API (Secret)</th>
                    <th className="py-2.5 px-3">Statut</th>
                    <th className="py-2.5 px-3">Permissions</th>
                    <th className="py-2.5 px-3">Dernière utilisation</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dashboardData?.apiKeys.map(k => (
                    <tr key={k.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-3 font-semibold text-slate-900">{k.name}</td>
                      <td className="py-3 px-3 font-mono text-orange-600 flex items-center gap-2">
                        <span>{k.key}</span>
                        <button
                          onClick={() => copyKey(k.key, k.id)}
                          className="p-1 hover:bg-orange-100 rounded text-slate-500 hover:text-orange-600 transition-colors"
                          title="Copier la clé"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        {copiedKey === k.id && (
                          <span className="text-[10px] text-emerald-600 font-sans font-bold">Copié !</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          k.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {k.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-500 text-[11px]">
                        games, services, orders, balance
                      </td>
                      <td className="py-3 px-3 text-slate-500 text-[11px]">
                        {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Jamais'}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {k.status === 'active' && (
                          <button
                            onClick={() => handleRevokeKey(k.id)}
                            className="text-red-600 hover:text-red-700 font-semibold text-[11px]"
                          >
                            Révoquer
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ORDERS */}
      {activeTab === 'orders' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold text-sm text-slate-900">Historique des commandes API</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                  <th className="py-2.5 px-3">ID Commande</th>
                  <th className="py-2.5 px-3">Jeu</th>
                  <th className="py-2.5 px-3">Pack</th>
                  <th className="py-2.5 px-3">Profil Joueur</th>
                  <th className="py-2.5 px-3">Prix</th>
                  <th className="py-2.5 px-3">Statut</th>
                  <th className="py-2.5 px-3">Réf Fournisseur</th>
                  <th className="py-2.5 px-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dashboardData?.recentOrders.map(o => (
                  <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900">{o.orderNumber}</td>
                    <td className="py-3 px-3 font-semibold text-slate-900">{o.gameName}</td>
                    <td className="py-3 px-3 text-slate-600">{o.packageName}</td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                      {Object.entries(o.gameProfileData).map(([k, v]) => `${k}:${v}`).join(' ')}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-slate-900">${o.chargedAmount.toFixed(2)}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        o.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                        o.status === 'processing' ? 'bg-amber-100 text-amber-800' :
                        o.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-800'
                      }`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-500">
                      {o.providerReference || '—'}
                    </td>
                    <td className="py-3 px-3 text-slate-400 text-[11px]">
                      {new Date(o.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: TRANSACTIONS */}
      {activeTab === 'transactions' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold text-sm text-slate-900">Journal des Débits & Crédits</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                  <th className="py-2.5 px-3">Réf Transaction</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Montant</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dashboardData?.transactions.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3 font-mono text-slate-900">{t.transactionNumber}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        t.type === 'credit' ? 'bg-emerald-100 text-emerald-800' :
                        t.type === 'refund' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-800'
                      }`}>
                        {t.type}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono font-bold">
                      <span className={t.type === 'credit' || t.type === 'refund' ? 'text-emerald-600' : 'text-slate-900'}>
                        {t.type === 'debit' ? '-' : '+'}${t.amount.toFixed(2)} USD
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-600">{t.note}</td>
                    <td className="py-3 px-3 text-slate-400">{new Date(t.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: WEBHOOKS */}
      {activeTab === 'webhook' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
            <div className="space-y-1">
              <h3 className="font-semibold text-sm text-slate-900">Configuration de votre URL Webhook</h3>
              <p className="text-xs text-slate-500">
                Recevez automatiquement les événements de changement de statut (<code className="bg-slate-100 text-orange-600 px-1 py-0.5 rounded font-mono">order.completed</code>, <code className="bg-slate-100 text-red-600 px-1 py-0.5 rounded font-mono">order.failed</code>).
              </p>
            </div>

            {webhookMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-medium">
                {webhookMsg}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">URL Endpoint Webhook (POST)</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={webhookInputUrl}
                    onChange={(e) => setWebhookInputUrl(e.target.value)}
                    placeholder="https://votredomaine.com/api/playup-webhook"
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:border-orange-500"
                  />
                  <button
                    onClick={handleSaveWebhook}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-semibold transition-colors"
                  >
                    Enregistrer
                  </button>
                  <button
                    onClick={handleTestWebhookPing}
                    className="px-3.5 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5 text-orange-600" />
                    <span>Test Ping</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Clé secrète de signature (Webhook Secret)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={res.webhookSecret || 'whsec_plup_default'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-600"
                  />
                  <button
                    onClick={() => copyKey(res.webhookSecret || '', 'whsec')}
                    className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Webhook logs */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <h4 className="text-xs font-semibold text-slate-800">Derniers envois de Webhook enregistrés</h4>
              <div className="space-y-2">
                {dashboardData?.webhookLogs.map(log => (
                  <div key={log.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.httpStatus === 200 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                      }`}>
                        HTTP {log.httpStatus}
                      </span>
                      <span className="font-semibold text-slate-800">{log.event}</span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
                {(!dashboardData?.webhookLogs || dashboardData.webhookLogs.length === 0) && (
                  <p className="text-xs text-slate-400">Aucun envoi de webhook enregistré.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
