import React, { useState, useEffect } from 'react';
import {
  User, Lock, Mail, Phone, Wallet, ShoppingBag, Settings, LogOut,
  CheckCircle2, AlertCircle, CreditCard, ShieldCheck, Key, RefreshCw,
  ArrowRight, Sparkles, Bell
} from 'lucide-react';
import {
  AppUser, Order, PaymentTransaction, PaymentGatewayConfig, PaymentMethodType,
  PushNotificationLog, EmailDeliveryLog
} from '../../types';
import { apiClient } from '../../services/apiClient';
import { safeStorage } from '../../lib/safeStorage';
import { signInWithGooglePopup, signOutFirebase } from '../../lib/firebase';
import {
  connectRealTimePushStream,
  requestAndSubscribePushNotifications
} from '../../lib/pushNotifications';

interface UserAccountViewProps {
  onOpenMobileApp: () => void;
  onNavigate: (tab: string) => void;
  onAuthChange?: (user: AppUser | null) => void;
}

export const UserAccountView: React.FC<UserAccountViewProps> = ({
  onOpenMobileApp,
  onNavigate,
  onAuthChange
}) => {
  const [authUser, setAuthUser] = useState<AppUser | null>(null);
  const [userToken, setUserToken] = useState<string>(() => safeStorage.getItem('playup_user_token') || '');

  // Auth form state (strictly empty on new device — no preloaded account or credentials)
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newResetPassword, setNewResetPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Authenticated sub-navigation
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'orders' | 'wallet' | 'settings'>('overview');
  const [orders, setOrders] = useState<Order[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [pushLogs, setPushLogs] = useState<PushNotificationLog[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailDeliveryLog[]>([]);
  const [gateways, setGateways] = useState<PaymentGatewayConfig[]>([]);

  // Profile Settings State
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileCurrency, setProfileCurrency] = useState<'USD' | 'HTG' | 'EUR'>('USD');
  const [profileTwoFactor, setProfileTwoFactor] = useState(false);
  const [profileEmailNotifs, setProfileEmailNotifs] = useState(true);
  const [profilePushNotifs, setProfilePushNotifs] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  // Wallet Top-Up State
  const [topUpAmount, setTopUpAmount] = useState('25');
  const [topUpMethod, setTopUpMethod] = useState<PaymentMethodType>('moncash');
  const [mobilePhone, setMobilePhone] = useState('');
  const [mobileOtp, setMobileOtp] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [processingTopUp, setProcessingTopUp] = useState(false);

  useEffect(() => {
    apiClient.getPaymentGateways().then(setGateways).catch(console.error);
  }, []);

  useEffect(() => {
    if (userToken) {
      refreshProfileData(userToken);
      const disconnectPush = connectRealTimePushStream(userToken, (notif) => {
        setPushLogs(prev => [notif, ...prev.filter(p => p.id !== notif.id)]);
        setFeedback({
          type: 'success',
          text: `${notif.title} — ${notif.body}`
        });
      });
      return () => disconnectPush();
    } else {
      setAuthUser(null);
      onAuthChange?.(null);
    }
  }, [userToken]);

  const syncSession = (user: AppUser, token: string) => {
    setAuthUser(user);
    setUserToken(token);
    safeStorage.setItem('playup_user_token', token);
    safeStorage.setItem('playup_user_profile', JSON.stringify(user));
    onAuthChange?.(user);
    setProfileName(user.name);
    setProfilePhone(user.phone || '');
    setProfileCurrency(user.preferredCurrency || 'USD');
    setProfileTwoFactor(Boolean(user.twoFactorEnabled));
    setProfileEmailNotifs(user.emailNotifications !== false);
    setProfilePushNotifs(user.pushNotificationsEnabled !== false);
    if (user.phone) setMobilePhone(user.phone);
    if (user.pushNotificationsEnabled !== false) {
      requestAndSubscribePushNotifications(token).catch(() => {});
    }
  };

  const refreshProfileData = async (tokenToUse: string) => {
    try {
      const data = await apiClient.getUserProfile(tokenToUse);
      setAuthUser(data.user);
      safeStorage.setItem('playup_user_profile', JSON.stringify(data.user));
      onAuthChange?.(data.user);
      setOrders(data.orders || []);
      setTransactions(data.paymentTransactions || []);
      setPushLogs(data.pushNotificationLogs || []);
      setEmailLogs(data.emailDeliveryLogs || []);
      setProfileName(data.user.name);
      setProfilePhone(data.user.phone || '');
      setProfileCurrency(data.user.preferredCurrency || 'USD');
      setProfileTwoFactor(Boolean(data.user.twoFactorEnabled));
      setProfileEmailNotifs(data.user.emailNotifications !== false);
      setProfilePushNotifs(data.user.pushNotificationsEnabled !== false);
    } catch {
      // Invalid or expired session: immediately purge local state
      safeStorage.removeItem('playup_user_token');
      safeStorage.removeItem('playup_user_profile');
      setAuthUser(null);
      setUserToken('');
      onAuthChange?.(null);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFeedback(null);
    try {
      if (authMode === 'login') {
        const res = await apiClient.loginUser(email, password);
        syncSession(res.user, res.token);
        await refreshProfileData(res.token);
        setFeedback({ type: 'success', text: `Heureux de vous revoir, ${res.user.name} !` });
      } else if (authMode === 'register') {
        const res = await apiClient.registerUser({ name, email, password, phone });
        syncSession(res.user, res.token);
        await refreshProfileData(res.token);
        setFeedback({
          type: 'success',
          text:
            res.user.role === 'ADMIN'
              ? 'Compte créé avec succès ! En tant que premier utilisateur enregistré, le rôle ADMIN vous a été attribué.'
              : 'Compte créé avec succès ! Bienvenue dans votre espace privé PlayUp.'
        });
      } else if (authMode === 'forgot') {
        const res = await apiClient.forgotUserPassword(email);
        setResetCode(res.resetCode);
        setAuthMode('reset');
        setFeedback({ type: 'success', text: `${res.message} — Code généré : ${res.resetCode}` });
      } else if (authMode === 'reset') {
        const res = await apiClient.resetUserPassword({
          email,
          resetCode,
          newPassword: newResetPassword
        });
        syncSession(res.user, res.token);
        await refreshProfileData(res.token);
        setFeedback({ type: 'success', text: res.message });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erreur lors de l’authentification' });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const fbUser = await signInWithGooglePopup();
      const res = await apiClient.socialLoginUser({
        provider: 'google',
        uid: fbUser.uid,
        email: fbUser.email,
        name: fbUser.name,
        avatarUrl: fbUser.avatarUrl
      });
      syncSession(res.user, res.token);
      await refreshProfileData(res.token);
      setFeedback({ type: 'success', text: `Connecté avec Google (${res.user.email})` });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Authentification Google interrompue' });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    signOutFirebase().catch(() => {});
    safeStorage.removeItem('playup_user_token');
    safeStorage.removeItem('playup_user_profile');
    safeStorage.removeItem('playup_admin_token');
    setAuthUser(null);
    setUserToken('');
    setOrders([]);
    setTransactions([]);
    setPushLogs([]);
    setEmailLogs([]);
    onAuthChange?.(null);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToken) return;
    setSavingSettings(true);
    setFeedback(null);
    try {
      const res = await apiClient.updateUserProfile(userToken, {
        name: profileName,
        phone: profilePhone,
        preferredCurrency: profileCurrency,
        twoFactorEnabled: profileTwoFactor,
        emailNotifications: profileEmailNotifs,
        pushNotificationsEnabled: profilePushNotifs,
        ...(newPassword ? { currentPassword, newPassword } : {})
      });
      setAuthUser(res.user);
      safeStorage.setItem('playup_user_profile', JSON.stringify(res.user));
      onAuthChange?.(res.user);
      if (profilePushNotifs) {
        await requestAndSubscribePushNotifications(userToken).catch(() => {});
      } else {
        await apiClient.unsubscribePushNotifications(userToken).catch(() => {});
      }
      setCurrentPassword('');
      setNewPassword('');
      setFeedback({ type: 'success', text: res.message });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erreur lors de la sauvegarde' });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTopUpWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) return;
    setProcessingTopUp(true);
    setFeedback(null);
    try {
      const payRes = await apiClient.processPayment({
        userId: authUser.id,
        paymentMethod: topUpMethod,
        amount: Number(topUpAmount),
        currency: 'USD',
        purpose: 'wallet_topup',
        cardDetails: topUpMethod === 'card' ? {
          cardNumber,
          expiry: cardExpiry,
          cvc: cardCvc,
          holderName: cardHolder
        } : undefined,
        mobileWalletDetails: (topUpMethod === 'moncash' || topUpMethod === 'natcash') ? {
          phone: mobilePhone,
          otp: mobileOtp
        } : undefined
      });
      if (payRes.user) {
        setAuthUser(payRes.user);
        safeStorage.setItem('playup_user_profile', JSON.stringify(payRes.user));
      }
      setTransactions(prev => [payRes.transaction, ...prev]);
      setFeedback({
        type: 'success',
        text: `Paiement confirmé ! Référence ${payRes.transaction.transactionReference} — +$${Number(topUpAmount).toFixed(2)} ajoutés à votre PlayUp Wallet.`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Échec de la transaction' });
    } finally {
      setProcessingTopUp(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {feedback && (
        <div className={`mb-6 p-4 rounded-2xl border text-xs font-medium flex items-center justify-between ${
          feedback.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-700 font-bold">✕</button>
        </div>
      )}

      {!authUser ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Column: Value Proposition */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Authentification Unifiée PlayUp Web &amp; Mobile</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Gérez vos recharges gaming, votre portefeuille et vos commandes en toute sécurité.
            </h1>
            <p className="text-slate-600 text-sm leading-relaxed">
              Votre compte PlayUp vous permet de payer instantanément par Carte Bancaire, MonCash, NatCash ou PlayUp Wallet, de sauvegarder vos Player IDs (Free Fire, PUBG, Mobile Legends) et de suivre vos livraisons en temps réel.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-orange-600" />
                  <span>Sécurité &amp; Hachage Scrypt</span>
                </div>
                <p className="text-xs text-slate-500">
                  Mots de passe hachés avec sel cryptographique, réinitialisation par code et option 2FA.
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-orange-600" />
                  <span>Multi-Passerelles de Paiement</span>
                </div>
                <p className="text-xs text-slate-500">
                  Compatible Visa/Mastercard, Digicel MonCash, Natcom NatCash et solde PlayUp.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Auth Card */}
          <div className="lg:col-span-6">
            <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-900">
                    {authMode === 'login' && 'Connexion à votre compte'}
                    {authMode === 'register' && 'Créer un compte joueur PlayUp'}
                    {authMode === 'forgot' && 'Mot de passe oublié'}
                    {authMode === 'reset' && 'Définir un nouveau mot de passe'}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {authMode === 'register'
                      ? 'Créez votre compte personnel sécurisé (aucun compte partagé).'
                      : 'Authentifiez-vous avec vos identifiants personnels.'}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-2xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
                  <User className="w-5 h-5" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setAuthMode('login')}
                  className={`py-2.5 rounded-lg transition-all ${
                    authMode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Connexion
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('register')}
                  className={`py-2.5 rounded-lg transition-all ${
                    authMode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Inscription
                </button>
              </div>

              <form onSubmit={handleAuthSubmit} className="space-y-4 text-xs">
                {authMode === 'register' && (
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Nom complet</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Alex Gamer"
                      className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-orange-500"
                    />
                  </div>
                )}

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Adresse Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="votre@email.com"
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-orange-500"
                  />
                </div>

                {authMode === 'register' && (
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Téléphone (MonCash / NatCash)</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+509 3711-2233"
                      className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-mono focus:outline-none focus:border-orange-500"
                    />
                  </div>
                )}

                {(authMode === 'login' || authMode === 'register') && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-semibold text-slate-700">Mot de passe</label>
                      {authMode === 'login' && (
                        <button
                          type="button"
                          onClick={() => setAuthMode('forgot')}
                          className="text-orange-600 hover:underline font-semibold"
                        >
                          Mot de passe oublié ?
                        </button>
                      )}
                    </div>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-orange-500"
                    />
                  </div>
                )}

                {authMode === 'reset' && (
                  <>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Code de sécurité à 6 chiffres</label>
                      <input
                        type="text"
                        required
                        value={resetCode}
                        onChange={(e) => setResetCode(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Nouveau mot de passe</label>
                      <input
                        type="password"
                        required
                        value={newResetPassword}
                        onChange={(e) => setNewResetPassword(e.target.value)}
                        placeholder="Minimum 6 caractères"
                        className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs"
                      />
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm transition-colors"
                >
                  {loading
                    ? 'Vérification en cours...'
                    : authMode === 'login'
                    ? 'Se connecter à PlayUp'
                    : authMode === 'register'
                    ? 'Créer mon compte joueur'
                    : authMode === 'forgot'
                    ? 'Envoyer le code de réinitialisation'
                    : 'Confirmer le nouveau mot de passe'}
                </button>
              </form>

              <div className="pt-4 border-t border-slate-100 space-y-3">
                <span className="text-[11px] text-slate-400 text-center block uppercase tracking-wider font-semibold">
                  Connexion OAuth Sécurisée
                </span>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleGoogleLogin}
                  className="w-full py-2.5 px-4 border border-slate-300 hover:bg-slate-50 rounded-xl font-bold text-slate-800 flex items-center justify-center gap-2 transition-colors text-xs"
                >
                  <span>Continuer avec Google</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* AUTHENTICATED USER DASHBOARD */
        <div className="space-y-8">
          {/* Top Profile Banner */}
          <div className="bg-slate-900 text-white rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-orange-600 flex items-center justify-center text-2xl font-black">
                {authUser.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-2xl font-bold">{authUser.name}</h1>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                      authUser.role === 'ADMIN'
                        ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    }`}
                  >
                    Rôle : {authUser.role || 'USER'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {authUser.email} {authUser.phone ? `· ${authUser.phone}` : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="bg-slate-800/90 border border-slate-700 rounded-2xl px-5 py-3">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 block">Solde PlayUp Wallet</span>
                <span className="font-mono text-2xl font-extrabold text-orange-400">
                  ${authUser.walletBalance.toFixed(2)} {authUser.preferredCurrency || 'USD'}
                </span>
              </div>

              {authUser.role === 'ADMIN' && (
                <button
                  onClick={() => onNavigate('admin')}
                  className="px-4 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Panneau Admin</span>
                </button>
              )}

              <button
                onClick={onOpenMobileApp}
                className="px-4 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold transition-colors"
              >
                Nouvelle Recharge Gaming →
              </button>

              <button
                onClick={handleLogout}
                className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5"
              >
                <LogOut className="w-4 h-4" />
                <span>Déconnexion</span>
              </button>
            </div>
          </div>

          {/* Sub-Navigation Tabs */}
          <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
            {[
              { id: 'overview', label: 'Aperçu du Profil', icon: User },
              { id: 'orders', label: `Historique des Commandes (${orders.length})`, icon: ShoppingBag },
              { id: 'wallet', label: 'Portefeuille & Paiements', icon: Wallet },
              { id: 'settings', label: 'Paramètres & Sécurité', icon: Settings }
            ].map(tab => {
              const Icon = tab.icon;
              const active = activeSubTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveSubTab(tab.id as any)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
                    active ? 'bg-orange-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* SUB-TAB 1: OVERVIEW */}
          {activeSubTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-2">
                  <span className="text-xs font-semibold text-slate-500">Commandes Réalisées</span>
                  <div className="font-mono text-3xl font-extrabold text-slate-900">{orders.length}</div>
                  <p className="text-xs text-slate-500">Livraisons automatiques vérifiées</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-2">
                  <span className="text-xs font-semibold text-slate-500">Total Dépensé</span>
                  <div className="font-mono text-3xl font-extrabold text-orange-600">
                    ${authUser.totalSpent.toFixed(2)} USD
                  </div>
                  <p className="text-xs text-slate-500">Depuis la création du compte</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-2">
                  <span className="text-xs font-semibold text-slate-500">Statut Sécurité &amp; Notifications</span>
                  <div className="font-display text-lg font-bold text-emerald-700 flex items-center gap-1.5 pt-1">
                    <ShieldCheck className="w-5 h-5" />
                    <span>Compte Vérifié ({authUser.role})</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Push : {authUser.pushNotificationsEnabled !== false ? 'Actives' : 'Inactives'} · Email : {authUser.emailNotifications !== false ? 'Actives' : 'Inactives'}
                  </p>
                </div>
              </div>

              {/* Real-Time Push Notifications & Post-Delivery Emails Log */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Bell className="w-4 h-4 text-orange-600" />
                      <span>Notifications Push de Livraison ({pushLogs.length})</span>
                    </h4>
                    <button
                      type="button"
                      onClick={() => requestAndSubscribePushNotifications(userToken)}
                      className="text-[11px] font-semibold text-orange-600 hover:underline"
                    >
                      Synchroniser cet appareil
                    </button>
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {pushLogs.map(log => (
                      <div key={log.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">{log.title}</span>
                          <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                            {log.orderNumber}
                          </span>
                        </div>
                        <p className="text-slate-700">{log.body}</p>
                      </div>
                    ))}
                    {pushLogs.length === 0 && (
                      <p className="text-xs text-slate-400">
                        Aucune notification push de livraison reçue pour le moment.
                      </p>
                    )}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Mail className="w-4 h-4 text-orange-600" />
                      <span>Emails de Confirmation Après Livraison ({emailLogs.length})</span>
                    </h4>
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {emailLogs.map(mail => (
                      <div key={mail.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">{mail.subject}</span>
                          <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                            {mail.status}
                          </span>
                        </div>
                        <pre className="text-[11px] text-slate-600 font-sans whitespace-pre-wrap">{mail.bodyText}</pre>
                      </div>
                    ))}
                    {emailLogs.length === 0 && (
                      <p className="text-xs text-slate-400">
                        Aucun email de livraison envoyé pour le moment.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SUB-TAB 2: ORDER HISTORY */}
          {activeSubTab === 'orders' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold text-slate-900">Historique de vos Commandes</h3>
                <button
                  onClick={() => refreshProfileData(userToken)}
                  className="text-xs font-semibold text-orange-600 flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Actualiser</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">N° Commande</th>
                      <th className="py-2.5 px-3">Jeu &amp; Package</th>
                      <th className="py-2.5 px-3">Identifiant Joueur</th>
                      <th className="py-2.5 px-3">Paiement</th>
                      <th className="py-2.5 px-3">Montant</th>
                      <th className="py-2.5 px-3">Statut</th>
                      <th className="py-2.5 px-3">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map(o => (
                      <tr key={o.id} className="hover:bg-slate-50">
                        <td className="py-3 px-3 font-mono font-bold text-slate-900">
                          {o.orderNumber}
                          <span className="block text-[10px] text-orange-600 font-normal">{o.partnerOrderId}</span>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-semibold text-slate-900">{o.gameName}</span>
                          <span className="block text-[11px] text-slate-500">{o.packageName}</span>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px]">
                          {o.playerId || Object.entries(o.gameProfileData || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                          {o.verifiedPlayerName && (
                            <span className="block text-[10px] text-emerald-700 font-sans font-semibold">
                              ✓ {o.verifiedPlayerName}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-[11px]">
                          <span className="font-semibold uppercase">{o.paymentMethod || 'wallet'}</span>
                          {o.paymentReference && (
                            <span className="block font-mono text-[10px] text-slate-400">{o.paymentReference}</span>
                          )}
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-slate-900">
                          ${o.chargedAmount.toFixed(2)}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            o.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                            o.status === 'processing' || o.status === 'paid' ? 'bg-amber-100 text-amber-800' :
                            o.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-800'
                          }`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-400 text-[11px]">
                          {new Date(o.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    {orders.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          Aucune commande trouvée pour ce compte.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SUB-TAB 3: WALLET & PAYMENT GATEWAYS */}
          {activeSubTab === 'wallet' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Approvisionner mon PlayUp Wallet
                </h3>
                <form onSubmit={handleTopUpWallet} className="space-y-4 text-xs">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Montant à recharger (USD)</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={topUpAmount}
                      onChange={(e) => setTopUpAmount(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 font-mono text-sm font-bold"
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Méthode de paiement sécurisée</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['moncash', 'natcash', 'card'] as PaymentMethodType[]).map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setTopUpMethod(m)}
                          className={`py-2.5 px-3 rounded-xl border font-bold text-center transition-all ${
                            topUpMethod === m
                              ? 'border-orange-600 bg-orange-50 text-orange-700'
                              : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {m === 'moncash' ? 'MonCash' : m === 'natcash' ? 'NatCash' : 'Carte Visa/MC'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(topUpMethod === 'moncash' || topUpMethod === 'natcash') ? (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">
                          Numéro {topUpMethod === 'moncash' ? 'Digicel MonCash' : 'Natcom NatCash'}
                        </label>
                        <input
                          type="text"
                          required
                          value={mobilePhone}
                          onChange={(e) => setMobilePhone(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 font-mono bg-white"
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Code PIN / OTP</label>
                        <input
                          type="password"
                          required
                          value={mobileOtp}
                          onChange={(e) => setMobileOtp(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 font-mono bg-white"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Titulaire de la carte</label>
                        <input
                          type="text"
                          required
                          value={cardHolder}
                          onChange={(e) => setCardHolder(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white"
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Numéro de carte</label>
                        <input
                          type="text"
                          required
                          value={cardNumber}
                          onChange={(e) => setCardNumber(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 font-mono bg-white"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="font-semibold text-slate-700 block mb-1">Expiration</label>
                          <input
                            type="text"
                            required
                            value={cardExpiry}
                            onChange={(e) => setCardExpiry(e.target.value)}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 font-mono bg-white"
                          />
                        </div>
                        <div>
                          <label className="font-semibold text-slate-700 block mb-1">CVC</label>
                          <input
                            type="password"
                            required
                            value={cardCvc}
                            onChange={(e) => setCardCvc(e.target.value)}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 font-mono bg-white"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={processingTopUp}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-xs transition-colors"
                  >
                    {processingTopUp
                      ? 'Traitement sécurisé en cours...'
                      : `Payer & Créditer $${Number(topUpAmount || 0).toFixed(2)} USD`}
                  </button>
                </form>
              </div>

              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Journal des Transactions de Paiement
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                        <th className="py-2 px-3">Référence</th>
                        <th className="py-2 px-3">Passerelle</th>
                        <th className="py-2 px-3">Source / Compte</th>
                        <th className="py-2 px-3">Montant Total</th>
                        <th className="py-2 px-3">Statut</th>
                        <th className="py-2 px-3">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactions.map(tx => (
                        <tr key={tx.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                            {tx.transactionReference}
                          </td>
                          <td className="py-2.5 px-3 uppercase font-semibold text-orange-600">
                            {tx.paymentMethod}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                            {tx.payerIdentifier || '—'}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-emerald-700">
                            ${tx.totalCharged.toFixed(2)}
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
                      {transactions.length === 0 && (
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

          {/* SUB-TAB 4: ACCOUNT SETTINGS */}
          {activeSubTab === 'settings' && (
            <form onSubmit={handleSaveSettings} className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 max-w-3xl space-y-6 text-xs">
              <h3 className="font-display text-lg font-bold text-slate-900">
                Paramètres du Profil &amp; Sécurité du Compte
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Nom complet</label>
                  <input
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Numéro de téléphone</label>
                  <input
                    type="text"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Devise d’affichage</label>
                  <select
                    value={profileCurrency}
                    onChange={(e) => setProfileCurrency(e.target.value as 'USD' | 'HTG' | 'EUR')}
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 bg-white"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="HTG">HTG (Gourdes)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>

                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={profileTwoFactor}
                      onChange={(e) => setProfileTwoFactor(e.target.checked)}
                    />
                    <span className="font-semibold text-slate-800">Authentification 2FA</span>
                  </label>
                </div>

                <div className="flex flex-col justify-center gap-2 pt-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={profileEmailNotifs}
                      onChange={(e) => setProfileEmailNotifs(e.target.checked)}
                    />
                    <span className="font-semibold text-slate-800">Notifications Email après livraison</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={profilePushNotifs}
                      onChange={(e) => setProfilePushNotifs(e.target.checked)}
                    />
                    <span className="font-semibold text-slate-800">Notifications Push Temps Réel</span>
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 space-y-3">
                <h4 className="font-bold text-slate-900 uppercase tracking-tight">
                  Modifier le mot de passe
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Mot de passe actuel</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Requis si compte email"
                      className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Nouveau mot de passe</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimum 6 caractères"
                      className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5"
                    />
                  </div>
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl shadow-xs transition-colors"
                >
                  {savingSettings ? 'Enregistrement...' : 'Sauvegarder mes paramètres'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
