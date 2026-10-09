import React, { useState, useEffect, useRef } from 'react';
import { 
  Home, Gamepad2, ShoppingBag, HelpCircle, User, ArrowLeft, 
  Check, CheckCircle2, AlertCircle, RefreshCw, Smartphone, 
  CreditCard, ShieldCheck, Zap, Bell, ChevronRight, Search, 
  ExternalLink, Sparkles, Lock, Mail, Key, Wallet, LogOut, Settings,
  Activity, Clock, X
} from 'lucide-react';
import {
  Game, Service, ServicePackage, Order, PlayerCheckResult, UserNotification,
  AppUser, PaymentGatewayConfig, PaymentTransaction, PaymentMethodType,
  RechargeGamesProduct, RechargeGamesOrderRecord
} from '../../types';
import { apiClient } from '../../services/apiClient';
import { signInWithGooglePopup, signOutFirebase } from '../../lib/firebase';
import { safeStorage } from '../../lib/safeStorage';
import { Language, translations } from '../../i18n';
import {
  connectRealTimePushStream,
  requestAndSubscribePushNotifications
} from '../../lib/pushNotifications';
import { ProductPriceHistoryChart } from '../../components/ProductPriceHistoryChart';
import { MonCashNatCashOcrPaymentFlow } from '../../components/MonCashNatCashOcrPaymentFlow';
import { PlayUpSplashLogo } from '../../components/common/PlayUpSplashLogo';
import { PlayUpSiteLogo } from '../../components/common/PlayUpSiteLogo';

interface PlayUpMobileAppProps {
  games: Game[];
  services: Service[];
  onClose: () => void;
  lang: Language;
  onAuthChange?: (user: AppUser | null) => void;
}

export const PlayUpMobileApp: React.FC<PlayUpMobileAppProps> = ({
  games,
  services,
  onClose,
  lang,
  onAuthChange
}) => {
  const t = translations[lang].mobileApp;

  // Active bottom navigation tab
  const [activeTab, setActiveTab] = useState<'home' | 'games' | 'orders' | 'support' | 'profile'>('home');

  // Device frame toggle (Phone Frame vs Expanded View)
  const [deviceFrameMode, setDeviceFrameMode] = useState<boolean>(true);

  // Dedicated Splash Screen state — minimum 2500ms duration to prevent UI race conditions on slow Android hardware
  const [showSplashScreen, setShowSplashScreen] = useState<boolean>(true);

  useEffect(() => {
    if (!showSplashScreen) return;
    const MIN_SPLASH_DURATION_MS = 2500;
    const timer = setTimeout(() => {
      setShowSplashScreen(false);
    }, MIN_SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [showSplashScreen]);

  const getPackagePriceHtg = (pkg?: ServicePackage | null): number => {
    if (!pkg) return 0;
    if (typeof pkg.publicPriceHtg === 'number' && pkg.publicPriceHtg > 0) {
      return Number(pkg.publicPriceHtg.toFixed(2));
    }
    return Number((Number(pkg.publicPrice || 0) * 132).toFixed(2));
  };

  const formatHtg = (val: number): string => {
    const num = Number(val || 0);
    return `${Number.isInteger(num) ? num : num.toFixed(2)} HTG`;
  };

  const getDiamondsLabel = (pkg?: ServicePackage | null): string => {
    if (!pkg) return '';
    if (typeof pkg.amount === 'number' && pkg.amount > 0) {
      const unitStr = (pkg.unit || 'Diamonds').trim();
      const unitFormatted = unitStr.toLowerCase().includes('diam') ? 'Diamonds' : unitStr;
      return `${pkg.amount.toLocaleString('fr-FR')} ${unitFormatted}`;
    }
    const cleanName = String(pkg.name || '')
      .replace(/topup\/[a-z0-9\-_/]+/gi, '')
      .replace(/\s*\[[^\]]*\]\s*/g, '')
      .replace(/\s*\([^)]*\)\s*/g, '')
      .trim();
    const match = cleanName.match(/(\d[\d\s,.]*)\s*(diamonds?|diamants?|uc|cp|vp|robux|genesis\s*crystals?)/i);
    if (match) {
      const qty = Number(match[1].replace(/[^\d]/g, ''));
      const rawUnit = match[2].toLowerCase();
      const unitLabel = rawUnit.startsWith('diam') ? 'Diamonds' : match[2];
      return `${qty.toLocaleString('fr-FR')} ${unitLabel}`;
    }
    return cleanName || '100 Diamonds';
  };

  const getServiceCardImage = (game?: Game | null): string => {
    if (game?.logo) return game.logo;
    const slug = (game?.slug || game?.name || '').toLowerCase();
    if (slug.includes('pubg')) return '/src/assets/images/game_cover_pubg_1790988885654.jpg';
    if (slug.includes('mobile-legends') || slug.includes('mlbb')) return '/src/assets/images/game_cover_mlbb_1790988892334.jpg';
    if (slug.includes('cod') || slug.includes('call-of-duty')) return '/src/assets/images/game_cover_codm_1790988899502.jpg';
    return '/src/assets/images/game_cover_freefire_1790988876938.jpg';
  };

  // Purchase Flow State
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string>('Brazil');
  const [rgCatalog, setRgCatalog] = useState<RechargeGamesProduct[]>([]);
  const [rgOrders, setRgOrders] = useState<RechargeGamesOrderRecord[]>([]);
  const [revealedPlayerIds, setRevealedPlayerIds] = useState<Record<string, boolean>>({});
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<ServicePackage | null>(null);
  const [gameProfileInputs, setGameProfileInputs] = useState<Record<string, string>>({});
  const [savedProfiles, setSavedProfiles] = useState<Array<{
    id: string;
    gameId: string;
    gameName: string;
    label: string;
    data: Record<string, string>;
  }>>([]);

  // Order submission & GoXtop Name Checker + Payment step
  const [isOrdering, setIsOrdering] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [isCheckingPlayer, setIsCheckingPlayer] = useState(false);
  const [playerCheckResult, setPlayerCheckResult] = useState<PlayerCheckResult | null>(null);
  const [backendWalletCheck, setBackendWalletCheck] = useState<{
    sufficient: boolean;
    walletBalanceUsd: number;
    walletBalanceHtg: number;
    requiredAmountUsd: number;
    requiredAmountHtg: number;
    missingAmountUsd: number;
    missingAmountHtg: number;
    exchangeRate: number;
  } | null>(null);
  const [showPaymentStep, setShowPaymentStep] = useState(false);
  const [pendingPartnerOrderId, setPendingPartnerOrderId] = useState<string>('');
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const mobileContentScrollRef = useRef<HTMLDivElement | null>(null);

  // Recent user orders & Order Tracker state
  const [userOrders, setUserOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [trackerSearchQuery, setTrackerSearchQuery] = useState('');
  const [trackerLookupError, setTrackerLookupError] = useState<string | null>(null);
  const [isPollingOrder, setIsPollingOrder] = useState(false);
  const [pollAttempts, setPollAttempts] = useState(0);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Search & Category filter in Games tab
  const [gameSearch, setGameSearch] = useState('');
  const [selectedGameCategory, setSelectedGameCategory] = useState<string>('Tous');

  const gameCategoryFilters = React.useMemo(() => {
    const presetCategories = ['Tous', 'Action', 'Battle Royale', 'MOBA', 'Casual'];
    const dynamicCategories = games
      .map(g => (g.category || '').trim())
      .filter(Boolean)
      .filter(
        cat =>
          !presetCategories.includes(cat) &&
          !['Tactical Shooter', 'FPS Mobile', 'Voucher / Gift Card'].includes(cat)
      );
    return Array.from(new Set([...presetCategories, ...dynamicCategories]));
  }, [games]);

  const matchesGameCategory = (game: Game, categoryFilter: string): boolean => {
    if (!categoryFilter || categoryFilter === 'Tous') return true;
    const cat = (game.category || '').toLowerCase();
    const filterLower = categoryFilter.toLowerCase();

    if (cat === filterLower) return true;
    if (filterLower === 'action') {
      return (
        cat.includes('action') ||
        cat.includes('shooter') ||
        cat.includes('fps') ||
        cat.includes('combat')
      );
    }
    if (filterLower === 'battle royale') {
      return cat.includes('battle royale') || game.slug === 'pubg-mobile';
    }
    if (filterLower === 'moba') {
      return cat.includes('moba');
    }
    if (filterLower === 'casual') {
      return (
        cat.includes('casual') ||
        cat.includes('voucher') ||
        cat.includes('gift') ||
        game.slug === 'roblox'
      );
    }
    return cat.includes(filterLower);
  };

  // Support mini-ticket in app
  const [supportSubmitted, setSupportSubmitted] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');

  // Notifications drawer
  const [showNotifications, setShowNotifications] = useState(false);

  // User Authentication & Account State (strictly empty on new device — no pre-loaded account)
  const [authUser, setAuthUser] = useState<AppUser | null>(null);
  const [userToken, setUserToken] = useState<string>(() => safeStorage.getItem('playup_user_token') || '');
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot' | 'reset'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [resetCodeInput, setResetCodeInput] = useState('');
  const [generatedResetCode, setGeneratedResetCode] = useState<string | null>(null);
  const [newResetPassword, setNewResetPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  // Profile Settings State
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileCurrency, setProfileCurrency] = useState<'USD' | 'HTG' | 'EUR'>('USD');
  const [profileTwoFactor, setProfileTwoFactor] = useState(false);
  const [profileEmailNotifs, setProfileEmailNotifs] = useState(true);
  const [profilePushNotifs, setProfilePushNotifs] = useState(true);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // Payment Gateways & Checkout State
  const [paymentGateways, setPaymentGateways] = useState<PaymentGatewayConfig[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodType>('moncash');
  const [cardHolderName, setCardHolderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [mobileOtp, setMobileOtp] = useState('');
  const [lastPaymentTx, setLastPaymentTx] = useState<PaymentTransaction | null>(null);
  const [userPaymentTransactions, setUserPaymentTransactions] = useState<PaymentTransaction[]>([]);

  // Wallet Top-Up State
  const [showWalletTopUp, setShowWalletTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('20');
  const [topUpMethod, setTopUpMethod] = useState<PaymentMethodType>('moncash');
  const [topUpProcessing, setTopUpProcessing] = useState(false);

  useEffect(() => {
    loadPaymentGateways();
    loadRechargeGamesCatalog();
    if (userToken) {
      loadUserOrders();
      loadNotifications();
      const disconnectPush = connectRealTimePushStream(userToken, (notif) => {
        setAuthSuccess(`${notif.title} — ${notif.body}`);
        loadNotifications();
        loadUserOrders();
      });
      return () => disconnectPush();
    } else {
      setAuthUser(null);
      setUserOrders([]);
      setRgOrders([]);
      setNotifications([]);
    }
  }, [userToken, authUser?.id]);

  const loadRechargeGamesCatalog = async () => {
    try {
      const cat = await apiClient.getRechargeGamesCatalog();
      setRgCatalog(cat.products || []);
    } catch (e) {
      console.error(e);
    }
  };

  // Real-time update listener when admin updates USD->HTG exchange rate or HTG selling prices
  useEffect(() => {
    const handlePricingUpdated = () => {
      loadRechargeGamesCatalog();
    };
    window.addEventListener('playup:pricing-updated', handlePricingUpdated);
    return () => window.removeEventListener('playup:pricing-updated', handlePricingUpdated);
  }, []);

  // Keep selectedService and selectedPackage synchronized when services or rgCatalog update in real time
  useEffect(() => {
    if (selectedGame) {
      const updatedSrv = services.find(s => s.gameId === selectedGame.id && s.isActive);
      if (updatedSrv) {
        setSelectedService(updatedSrv);
        if (selectedPackage) {
          const updatedPkg = updatedSrv.packages.find(
            p => p.id === selectedPackage.id || (p.productKey && p.productKey === selectedPackage.productKey)
          );
          if (updatedPkg) {
            setSelectedPackage(updatedPkg);
          }
        }
      }
    }
  }, [services, rgCatalog]);

  const loadPaymentGateways = async () => {
    try {
      const gws = await apiClient.getPaymentGateways();
      setPaymentGateways(gws);
      if (gws.length > 0 && !gws.some(g => g.slug === selectedPaymentMethod)) {
        setSelectedPaymentMethod(gws[0].slug);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const syncUserState = (user: AppUser, token: string) => {
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

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      if (authMode === 'login') {
        const res = await apiClient.loginUser(authEmail, authPassword);
        if (res.user && res.token) {
          syncUserState(res.user, res.token);
          const prof = await apiClient.getUserProfile(res.token);
          setUserPaymentTransactions(prof.paymentTransactions || []);
          setAuthSuccess(`Bienvenue, ${res.user.name} !`);
        }
      } else if (authMode === 'register') {
        const res = await apiClient.registerUser({
          name: authName,
          email: authEmail,
          password: authPassword,
          phone: authPhone
        });
        syncUserState(res.user, res.token);
        setAuthSuccess(
          res.user.role === 'ADMIN'
            ? 'Compte créé avec succès ! En tant que premier utilisateur, le rôle ADMIN vous a été attribué.'
            : 'Compte créé avec succès ! Bienvenue sur PlayUp.'
        );
      } else if (authMode === 'forgot') {
        const res = await apiClient.forgotUserPassword(authEmail);
        setGeneratedResetCode(res.resetCode);
        setResetCodeInput(res.resetCode);
        setAuthMode('reset');
        setAuthSuccess(`${res.message} Code de sécurité : ${res.resetCode}`);
      } else if (authMode === 'reset') {
        const res = await apiClient.resetUserPassword({
          email: authEmail,
          resetCode: resetCodeInput,
          newPassword: newResetPassword
        });
        syncUserState(res.user, res.token);
        setGeneratedResetCode(null);
        setAuthSuccess(res.message);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Erreur d’authentification');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const fbData = await signInWithGooglePopup();
      const res = await apiClient.socialLoginUser({
        provider: 'google',
        uid: fbData.uid,
        email: fbData.email,
        name: fbData.name,
        avatarUrl: fbData.avatarUrl
      });
      syncUserState(res.user, res.token);
      setAuthSuccess(`Connecté via Google (${res.user.email})`);
    } catch (err: any) {
      setAuthError(err.message || 'Connexion Google annulée ou indisponible dans cette fenêtre.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleUpdateAccountSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToken) return;
    setProfileSaving(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const res = await apiClient.updateUserProfile(userToken, {
        name: profileName,
        phone: profilePhone,
        preferredCurrency: profileCurrency,
        twoFactorEnabled: profileTwoFactor,
        emailNotifications: profileEmailNotifs,
        pushNotificationsEnabled: profilePushNotifs,
        ...(newPasswordInput ? { currentPassword: currentPasswordInput, newPassword: newPasswordInput } : {})
      });
      setAuthUser(res.user);
      if (profilePushNotifs) {
        await requestAndSubscribePushNotifications(userToken).catch(() => {});
      } else {
        await apiClient.unsubscribePushNotifications(userToken).catch(() => {});
      }
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setAuthSuccess(res.message);
    } catch (err: any) {
      setAuthError(err.message || 'Erreur mise à jour profil');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleWalletTopUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) return;
    setTopUpProcessing(true);
    setAuthError(null);
    setAuthSuccess(null);
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
          holderName: cardHolderName
        } : undefined,
        mobileWalletDetails: (topUpMethod === 'moncash' || topUpMethod === 'natcash') ? {
          phone: mobilePhone,
          otp: mobileOtp
        } : undefined
      });
      if (payRes.user) {
        setAuthUser(payRes.user);
      }
      setUserPaymentTransactions(prev => [payRes.transaction, ...prev]);
      setShowWalletTopUp(false);
      setAuthSuccess(`Rechargement réussi ! Réf: ${payRes.transaction.transactionReference} (+$${Number(topUpAmount).toFixed(2)})`);
    } catch (err: any) {
      setAuthError(err.message || 'Échec du rechargement');
    } finally {
      setTopUpProcessing(false);
    }
  };

  const loadNotifications = async () => {
    try {
      const list = await apiClient.getNotifications();
      setNotifications(list);
    } catch (e) {
      console.error(e);
    }
  };

  const loadUserOrders = async () => {
    if (!userToken) {
      setUserOrders([]);
      setRgOrders([]);
      return;
    }
    setOrdersLoading(true);
    try {
      const prof = await apiClient.getUserProfile(userToken);
      setAuthUser(prof.user);
      setProfileName(prof.user.name);
      setProfilePhone(prof.user.phone || '');
      setProfileCurrency(prof.user.preferredCurrency || 'USD');
      setProfileTwoFactor(Boolean(prof.user.twoFactorEnabled));
      setProfileEmailNotifs(prof.user.emailNotifications !== false);
      setProfilePushNotifs(prof.user.pushNotificationsEnabled !== false);
      setUserPaymentTransactions(prof.paymentTransactions || []);
      const [orders, rgList] = await Promise.all([
        apiClient.getRecentOrders(prof.user.id, userToken),
        apiClient.getRechargeGamesOrders(prof.user.id).catch(() => [])
      ]);
      setUserOrders(orders);
      setRgOrders(rgList);
    } catch {
      safeStorage.removeItem('playup_user_token');
      safeStorage.removeItem('playup_user_profile');
      setAuthUser(null);
      setUserToken('');
      setUserOrders([]);
      setRgOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  };

  // Start purchase for a game
  const handleSelectGame = (game: Game) => {
    setSelectedGame(game);
    const gameServices = services.filter(s => s.gameId === game.id && s.isActive);
    setSelectedService(gameServices[0] || null);
    // Determine default region for this game from RechargeGames catalog
    const gameRgProducts = rgCatalog.filter(
      p => (p.game || '').toLowerCase() === (game.name || '').toLowerCase() || p.game_slug === game.slug
    );
    const availableRegs = Array.from(new Set(gameRgProducts.map(p => p.region)));
    if (availableRegs.includes('Brazil')) {
      setSelectedRegion('Brazil');
    } else if (availableRegs.includes('USA')) {
      setSelectedRegion('USA');
    } else if (availableRegs.length > 0) {
      setSelectedRegion(availableRegs[0]);
    } else {
      setSelectedRegion('Global');
    }
    setSelectedPackage(null);
    setPlayerCheckResult(null);
    setBackendWalletCheck(null);
    setShowPaymentStep(false);
    setPendingPartnerOrderId('');
    setOrderError(null);

    // Check if user has saved profile for this game to auto-fill
    const existing = savedProfiles.find(p => p.gameId === game.id);
    if (existing) {
      setGameProfileInputs({ ...existing.data });
    } else {
      const initialFields: Record<string, string> = {};
      game.fields.forEach(f => {
        if (f.type === 'select' && f.options && f.options.length > 0) {
          initialFields[f.name] = f.options[0];
        } else {
          initialFields[f.name] = '';
        }
      });
      setGameProfileInputs(initialFields);
    }

    setTimeout(() => {
      mobileContentScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }, 0);
  };

  // Open dedicated page for a selected service card
  const handleOpenDedicatedServicePage = (pkg: ServicePackage) => {
    if (!pkg.isActive) {
      setOrderError('Ce produit est temporairement indisponible.');
      return;
    }
    setOrderError(null);
    setSelectedPackage(pkg);
    setPlayerCheckResult(null);
    setBackendWalletCheck(null);
    setShowPaymentStep(false);
    setPendingPartnerOrderId(`playup_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);

    // If the service does not require a Player ID, immediately verify wallet balance on backend
    const requiresPlayer = pkg.requiresPlayerId !== false && selectedGame?.requiresPlayerId !== false;
    if (!requiresPlayer && userToken && selectedGame) {
      apiClient
        .validateBeforePayment(
          {
            productKey: pkg.productKey || pkg.externalProductId,
            packageId: pkg.id,
            gameId: selectedGame.id,
            region: pkg.region || selectedRegion,
            playerId: 'VOUCHER_PIN',
            quantity: 1,
            paymentMethod: 'wallet'
          },
          userToken
        )
        .then(preVal => {
          if (preVal.walletCheck) {
            setBackendWalletCheck(preVal.walletCheck);
          }
        })
        .catch(() => {});
    }

    setTimeout(() => {
      mobileContentScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }, 0);
  };

  // Verify Player ID via RechargeGames official /v1/region-check + Backend Pre-Payment & Wallet Balance Check
  const handleVerifyPlayer = async (): Promise<PlayerCheckResult | null> => {
    if (!selectedGame) return null;
    setIsCheckingPlayer(true);
    setOrderError(null);
    setBackendWalletCheck(null);
    try {
      const res = await apiClient.checkPlayer(
        selectedGame.id,
        gameProfileInputs,
        selectedPackage?.region || selectedRegion
      );
      setPlayerCheckResult(res);

      let activePkg = selectedPackage;
      // If RechargeGames confirmed the player and returned their official region (e.g. LATAM for 16777227705),
      // automatically sync the selected region & package to match the player's account region
      const officialRegion = res.detectedRegion || res.region;
      if (res.verified && officialRegion && selectedService) {
        const regionPkgs = selectedService.packages.filter(
          p => p.isActive && (p.region || '').toLowerCase() === officialRegion.toLowerCase()
        );
        if (regionPkgs.length > 0) {
          const canonicalReg = regionPkgs[0].region || officialRegion;
          if (selectedRegion.toLowerCase() !== canonicalReg.toLowerCase()) {
            setSelectedRegion(canonicalReg);
          }
          if (!selectedPackage || (selectedPackage.region || '').toLowerCase() !== canonicalReg.toLowerCase()) {
            const matchingAmountPkg =
              (selectedPackage && regionPkgs.find(p => p.amount === selectedPackage.amount)) || regionPkgs[0];
            setSelectedPackage(matchingAmountPkg);
            activePkg = matchingAmountPkg;
          }
        }
      }

      if (res.supported && !res.verified) {
        setOrderError(res.message || 'Player ID invalide ou introuvable sur RechargeGames.');
        return res;
      }

      // Immediately run backend pre-payment validation to verify server-side price & real user wallet balance
      if (activePkg && userToken) {
        const extractedPlayerId =
          gameProfileInputs.playerId ||
          gameProfileInputs.userId ||
          gameProfileInputs.characterId ||
          Object.values(gameProfileInputs)[0] ||
          '';
        const extractedServerId = gameProfileInputs.serverId || gameProfileInputs.zoneId || undefined;

        const preVal = await apiClient.validateBeforePayment(
          {
            productKey: activePkg.productKey || activePkg.externalProductId,
            packageId: activePkg.id,
            gameId: selectedGame.id,
            region: activePkg.region || officialRegion || selectedRegion,
            playerId: String(extractedPlayerId),
            serverId: extractedServerId ? String(extractedServerId) : undefined,
            quantity: 1,
            paymentMethod: 'wallet'
          },
          userToken
        );

        if (preVal.walletCheck) {
          setBackendWalletCheck(preVal.walletCheck);
        }
        if (!preVal.valid) {
          setOrderError(preVal.message || 'Validation côté serveur refusée.');
        }
      }

      return res;
    } catch (err: any) {
      const fallbackErr: PlayerCheckResult = {
        supported: true,
        verified: false,
        message: err.message || 'Erreur lors de la vérification du joueur'
      };
      setPlayerCheckResult(fallbackErr);
      setOrderError(fallbackErr.message);
      return fallbackErr;
    } finally {
      setIsCheckingPlayer(false);
    }
  };

  // Direct 1-click "Payer et envoyer la demande" after successful Player ID verification & backend wallet balance check
  const handlePayAndSendOrder = async () => {
    if (!selectedGame || !selectedService || !selectedPackage || isOrdering) return;

    if (!authUser || !userToken) {
      setOrderError('Veuillez vous connecter à votre compte PlayUp pour payer et envoyer votre demande.');
      setSelectedPackage(null);
      setSelectedGame(null);
      setActiveTab('profile');
      return;
    }

    const requiresPlayer = selectedPackage.requiresPlayerId !== false && selectedGame.requiresPlayerId !== false;
    const extractedPlayerId =
      gameProfileInputs.playerId ||
      gameProfileInputs.userId ||
      gameProfileInputs.characterId ||
      Object.values(gameProfileInputs)[0] ||
      'VOUCHER_PIN';
    const extractedServerId = gameProfileInputs.serverId || gameProfileInputs.zoneId || undefined;

    if (requiresPlayer) {
      if (!extractedPlayerId || extractedPlayerId === 'VOUCHER_PIN' || !extractedPlayerId.trim()) {
        setOrderError('Veuillez saisir et vérifier votre ID de jeu.');
        return;
      }
      if (!playerCheckResult || (playerCheckResult.supported && !playerCheckResult.verified)) {
        setOrderError('Veuillez d’abord vérifier votre ID de jeu avant de payer.');
        return;
      }
    }

    setIsOrdering(true);
    setOrderError(null);

    try {
      const productKeyToUse = selectedPackage.productKey || selectedPackage.externalProductId || '';
      const buyerRefToUse =
        pendingPartnerOrderId || `playup_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      if (!pendingPartnerOrderId) {
        setPendingPartnerOrderId(buyerRefToUse);
      }

      // 1. Authoritative backend validation (price, Player ID, and real user wallet balance)
      const preVal = await apiClient.validateBeforePayment(
        {
          productKey: productKeyToUse || undefined,
          packageId: selectedPackage.id,
          gameId: selectedGame.id,
          region: selectedPackage.region || selectedRegion,
          playerId: String(extractedPlayerId),
          serverId: extractedServerId ? String(extractedServerId) : undefined,
          quantity: 1,
          paymentMethod: 'wallet'
        },
        userToken
      );

      if (preVal.walletCheck) {
        setBackendWalletCheck(preVal.walletCheck);
      }

      if (!preVal.valid) {
        setOrderError(preVal.message || 'Validation refusée par le serveur PlayUp.');
        return;
      }

      if (preVal.walletCheck && !preVal.walletCheck.sufficient) {
        setOrderError(
          `Solde insuffisant : ${formatHtg(preVal.walletCheck.walletBalanceHtg)} disponible pour ${formatHtg(
            preVal.walletCheck.requiredAmountHtg
          )} requis. Veuillez recharger votre Wallet.`
        );
        return;
      }

      // 2. Backend debits wallet, creates the order, and dispatches to the recharge system
      const isRechargeGamesProduct =
        selectedPackage.providerSlug === 'rechargegames' ||
        rgCatalog.some(p => p.product_key === productKeyToUse);

      let order: Order;
      if (isRechargeGamesProduct && productKeyToUse) {
        const rgRes = await apiClient.createRechargeGamesOrder(
          {
            userId: authUser.id,
            product_key: productKeyToUse,
            region: selectedPackage.region || selectedRegion,
            player_id: String(extractedPlayerId),
            player_name: playerCheckResult?.verified ? playerCheckResult.playerName : gameProfileInputs.playerName,
            server_id: extractedServerId,
            quantity: 1,
            buyer_ref: buyerRefToUse,
            paymentConfirmed: true,
            paymentMethod: 'wallet'
          },
          userToken
        );

        if (rgRes.user) {
          setAuthUser(rgRes.user);
          onAuthChange?.(rgRes.user);
        }

        order = rgRes.playupOrder || {
          id: rgRes.order.id,
          orderNumber: rgRes.order.id,
          partnerOrderId: rgRes.order.buyer_ref,
          externalOrderId: rgRes.order.provider_order_id,
          source: 'mobile_app',
          userId: rgRes.order.user_id,
          gameId: selectedGame.id,
          gameName: rgRes.order.game,
          serviceId: selectedService.id,
          serviceName: `${rgRes.order.game} (${rgRes.order.region})`,
          packageId: selectedPackage.id,
          externalProductId: rgRes.order.product_key,
          packageName: `${getDiamondsLabel(selectedPackage)}`,
          playerId: rgRes.order.player_id,
          gameProfileData: {
            playerId: rgRes.order.player_id,
            region: rgRes.order.region
          },
          publicPrice: rgRes.order.customer_price,
          chargedAmount: rgRes.order.customer_price,
          supplierCost: rgRes.order.provider_price,
          margin: rgRes.order.profit,
          currency: rgRes.order.currency,
          status:
            rgRes.order.status === 'delivered'
              ? 'completed'
              : rgRes.order.status === 'refunded'
              ? 'refunded'
              : rgRes.order.status === 'failed'
              ? 'failed'
              : 'pending',
          payment_status: rgRes.order.payment_status || 'payment_succeeded',
          lifecycle_status: rgRes.order.lifecycle_status || 'order_pending',
          dispatch_status: rgRes.order.dispatch_status || 'sent',
          user_status_message: rgRes.order.user_status_message || rgRes.message,
          paymentMethod: 'wallet',
          paymentReference: rgRes.order.payment_reference,
          providerId: 'prov_rechargegames',
          providerName: 'RechargeGames',
          providerReference: rgRes.order.provider_order_id,
          createdAt: rgRes.order.created_at,
          updatedAt: rgRes.order.updated_at,
          statusHistory: [
            {
              status: rgRes.order.lifecycle_status || 'order_pending',
              timestamp: rgRes.order.created_at,
              note: rgRes.order.user_status_message || `Demande envoyée (${rgRes.order.buyer_ref})`
            }
          ]
        };
      } else {
        order = await apiClient.createMobileOrder(
          {
            gameId: selectedGame.id,
            serviceId: selectedService.id,
            packageId: selectedPackage.id,
            gameProfileData: gameProfileInputs,
            verifiedPlayerName: playerCheckResult?.verified ? playerCheckResult.playerName : undefined,
            paymentConfirmed: true,
            paymentMethod: 'wallet',
            userId: authUser.id,
            partnerOrderId: buyerRefToUse
          },
          userToken
        );
      }

      // Immediately display order status screen without scrolling
      setCurrentOrder(order);
      setShowPaymentStep(false);
      setTimeout(() => {
        mobileContentScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      }, 0);

      // Save player profile for 1-click reuse
      const profKey = `${selectedGame.id}_${Object.values(gameProfileInputs).join('_')}`;
      if (!savedProfiles.some(p => p.id === profKey)) {
        setSavedProfiles(prev => [
          ...prev,
          {
            id: profKey,
            gameId: selectedGame.id,
            gameName: selectedGame.name,
            label:
              playerCheckResult?.playerName ||
              gameProfileInputs.playerName ||
              gameProfileInputs.playerId ||
              'Mon Profil',
            data: { ...gameProfileInputs }
          }
        ]);
      }

      await loadUserOrders();
      await loadNotifications();
      pollOrderStatus(order.id);
    } catch (err: any) {
      setOrderError(err.message || 'Erreur lors du paiement et de l’envoi de la commande.');
    } finally {
      setIsOrdering(false);
    }
  };

  // Proceed to confirmation & payment step (Enforces real provider Player ID check when supported + user auth)
  const handleProceedToPayment = async () => {
    if (!selectedGame || !selectedService || !selectedPackage) return;

    if (!authUser || !userToken) {
      setOrderError('Vous devez vous connecter ou créer un compte PlayUp pour passer une commande.');
      setSelectedGame(null);
      setActiveTab('profile');
      return;
    }

    const requiresPlayer = selectedPackage.requiresPlayerId !== false && selectedGame.requiresPlayerId !== false;
    if (requiresPlayer) {
      for (const field of selectedGame.fields) {
        if (selectedPackage.requiredFields && selectedPackage.requiredFields.length > 0 && !selectedPackage.requiredFields.includes(field.name)) {
          continue;
        }
        if (field.required && !gameProfileInputs[field.name]?.trim()) {
          setOrderError(`Veuillez renseigner "${field.label}"`);
          return;
        }
        if (field.validationRegex && gameProfileInputs[field.name]) {
          const regex = new RegExp(field.validationRegex);
          if (!regex.test(gameProfileInputs[field.name])) {
            setOrderError(`Format invalide pour "${field.label}" (${field.helperText || ''})`);
            return;
          }
        }
      }

      // Perform real RechargeGames Player ID validation if not yet verified for current input
      let checkRes = playerCheckResult;
      if (!checkRes) {
        checkRes = await handleVerifyPlayer();
      }
      if (checkRes && checkRes.supported && !checkRes.verified) {
        setOrderError(checkRes.message || 'Player ID invalide refusé par RechargeGames. Commande bloquée.');
        return;
      }
    }

    // Rule 1: Run backend pre-payment validation (authenticated user, service, product, game/region, Player ID, server-side price)
    const extractedPlayerId =
      gameProfileInputs.playerId ||
      gameProfileInputs.userId ||
      gameProfileInputs.characterId ||
      Object.values(gameProfileInputs)[0] ||
      '';
    const extractedServerId = gameProfileInputs.serverId || gameProfileInputs.zoneId || undefined;

    setIsCheckingPlayer(true);
    try {
      const preVal = await apiClient.validateBeforePayment(
        {
          productKey: selectedPackage.productKey || selectedPackage.externalProductId,
          packageId: selectedPackage.id,
          gameId: selectedGame.id,
          region: selectedPackage.region || selectedRegion,
          playerId: String(extractedPlayerId),
          serverId: extractedServerId ? String(extractedServerId) : undefined,
          quantity: 1,
          paymentMethod: selectedPaymentMethod
        },
        userToken
      );

      if (preVal.walletCheck) {
        setBackendWalletCheck(preVal.walletCheck);
      }

      if (!preVal.valid) {
        setOrderError(preVal.message || 'Validation avant paiement refusée par le serveur PlayUp.');
        return;
      }

      if (preVal.playerVerificationStatus === 'NON SUPPORTÉ') {
        setPlayerCheckResult({
          supported: false,
          verified: false,
          status: 'NON SUPPORTÉ',
          provider: 'RechargeGames',
          message: preVal.message
        });
      }
    } finally {
      setIsCheckingPlayer(false);
    }

    setOrderError(null);
    if (!pendingPartnerOrderId) {
      setPendingPartnerOrderId(`playup_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
    }
    setShowPaymentStep(true);
  };

  // Submit order (First processes payment through selected Payment Gateway, then creates PlayUp & GoXtop order)
  const handleConfirmOrder = async () => {
    if (!selectedGame || !selectedService || !selectedPackage || isOrdering) return;

    setIsOrdering(true);
    setOrderError(null);

    try {
      const productKeyToUse = selectedPackage.productKey || selectedPackage.externalProductId || '';
      const extractedPlayerId =
        gameProfileInputs.playerId ||
        gameProfileInputs.characterId ||
        Object.values(gameProfileInputs)[0] ||
        'VOUCHER_PIN';
      const extractedServerId = gameProfileInputs.serverId || gameProfileInputs.zoneId;

      // 1. Process Payment through selected Payment Gateway (Backend validates & calculates authoritative price, transitions payment_pending -> payment_processing -> payment_succeeded)
      const paymentRes = await apiClient.processPayment({
        userId: authUser?.id,
        paymentMethod: selectedPaymentMethod,
        amount: selectedPackage.publicPrice,
        currency: selectedPackage.currency || 'USD',
        purpose: 'order',
        productKey: productKeyToUse || undefined,
        packageId: selectedPackage.id,
        gameId: selectedGame.id,
        region: selectedPackage.region || selectedRegion,
        playerId: String(extractedPlayerId),
        serverId: extractedServerId,
        quantity: 1,
        cardDetails: selectedPaymentMethod === 'card' ? {
          cardNumber,
          expiry: cardExpiry,
          cvc: cardCvc,
          holderName: cardHolderName
        } : undefined,
        mobileWalletDetails: (selectedPaymentMethod === 'moncash' || selectedPaymentMethod === 'natcash') ? {
          phone: mobilePhone,
          otp: mobileOtp
        } : undefined
      });

      setLastPaymentTx(paymentRes.transaction);
      if (paymentRes.user) {
        setAuthUser(paymentRes.user);
      }

      const confirmedPaymentStatus =
        paymentRes.payment_status || paymentRes.transaction?.payment_status || 'payment_succeeded';
      const isPaymentSucceeded = confirmedPaymentStatus === 'payment_succeeded';

      // 2. Create PlayUp Order & Dispatch to RechargeGames ONLY when payment_succeeded is confirmed on backend
      const isRechargeGamesProduct =
        selectedPackage.providerSlug === 'rechargegames' ||
        rgCatalog.some(p => p.product_key === productKeyToUse);

      let order: Order;
      if (isRechargeGamesProduct && productKeyToUse) {
        const rgRes = await apiClient.createRechargeGamesOrder({
          userId: authUser?.id || 'usr_player_01',
          product_key: productKeyToUse,
          region: selectedPackage.region || selectedRegion,
          player_id: extractedPlayerId,
          player_name: playerCheckResult?.verified ? playerCheckResult.playerName : gameProfileInputs.playerName,
          server_id: extractedServerId,
          quantity: 1,
          buyer_ref: pendingPartnerOrderId || undefined,
          paymentConfirmed: isPaymentSucceeded,
          paymentStatus: confirmedPaymentStatus,
          paymentMethod: selectedPaymentMethod,
          paymentReference: paymentRes.transaction.transactionReference,
          paymentTransactionId: paymentRes.transaction.id
        });
        order = rgRes.playupOrder || {
          id: rgRes.order.id,
          orderNumber: rgRes.order.id,
          partnerOrderId: rgRes.order.buyer_ref,
          externalOrderId: rgRes.order.provider_order_id,
          source: 'mobile_app',
          userId: rgRes.order.user_id,
          gameId: selectedGame.id,
          gameName: rgRes.order.game,
          serviceId: selectedService.id,
          serviceName: `${rgRes.order.game} (${rgRes.order.region})`,
          packageId: selectedPackage.id,
          externalProductId: rgRes.order.product_key,
          packageName: `${rgRes.order.product_name} [${rgRes.order.region}]`,
          playerId: rgRes.order.player_id,
          gameProfileData: {
            playerId: rgRes.order.player_id,
            region: rgRes.order.region,
            product_key: rgRes.order.product_key
          },
          publicPrice: rgRes.order.customer_price,
          chargedAmount: rgRes.order.customer_price,
          supplierCost: rgRes.order.provider_price,
          margin: rgRes.order.profit,
          currency: rgRes.order.currency,
          status:
            rgRes.order.status === 'delivered'
              ? 'completed'
              : rgRes.order.status === 'refunded'
              ? 'refunded'
              : rgRes.order.status === 'failed'
              ? 'failed'
              : 'pending',
          payment_status: rgRes.order.payment_status || confirmedPaymentStatus,
          lifecycle_status: rgRes.order.lifecycle_status || 'order_pending',
          dispatch_status: rgRes.order.dispatch_status || 'sent',
          user_status_message: rgRes.order.user_status_message || rgRes.message,
          paymentMethod: selectedPaymentMethod,
          paymentReference: paymentRes.transaction.transactionReference,
          providerId: 'prov_rechargegames',
          providerName: 'RechargeGames',
          providerReference: rgRes.order.provider_order_id,
          createdAt: rgRes.order.created_at,
          updatedAt: rgRes.order.updated_at,
          statusHistory: [
            {
              status: rgRes.order.lifecycle_status || 'order_pending',
              timestamp: rgRes.order.created_at,
              note: rgRes.order.user_status_message || `En traitement... (${rgRes.order.buyer_ref})`
            }
          ]
        };
      } else {
        order = await apiClient.createMobileOrder({
          gameId: selectedGame.id,
          serviceId: selectedService.id,
          packageId: selectedPackage.id,
          gameProfileData: gameProfileInputs,
          verifiedPlayerName: playerCheckResult?.verified ? playerCheckResult.playerName : undefined,
          paymentConfirmed: true,
          paymentMethod: selectedPaymentMethod,
          paymentTransactionId: paymentRes.transaction.id,
          paymentReference: paymentRes.transaction.transactionReference,
          userId: authUser?.id,
          partnerOrderId: pendingPartnerOrderId || undefined
        });
      }

      setCurrentOrder(order);
      setShowPaymentStep(false);

      // Save to savedProfiles if not already there
      const profKey = `${selectedGame.id}_${Object.values(gameProfileInputs).join('_')}`;
      if (!savedProfiles.some(p => p.id === profKey)) {
        setSavedProfiles(prev => [
          ...prev,
          {
            id: profKey,
            gameId: selectedGame.id,
            gameName: selectedGame.name,
            label: playerCheckResult?.playerName || gameProfileInputs.playerName || gameProfileInputs.playerId || 'Mon Profil',
            data: { ...gameProfileInputs }
          }
        ]);
      }

      await loadUserOrders();
      await loadNotifications();

      // Poll order status until complete
      pollOrderStatus(order.id);
    } catch (err: any) {
      setOrderError(err.message || 'Erreur lors du traitement de la commande');
    } finally {
      setIsOrdering(false);
    }
  };

  const stopOrderPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsPollingOrder(false);
  };

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const pollOrderStatus = (orderId: string) => {
    stopOrderPolling();
    setIsPollingOrder(true);
    setPollAttempts(0);
    setLastPolledAt(new Date().toLocaleTimeString());

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      setPollAttempts(attempts);
      try {
        const refreshed = await apiClient.getMobileOrder(orderId);
        setCurrentOrder(refreshed);
        setLastPolledAt(new Date().toLocaleTimeString());
        if (
          refreshed.status === 'completed' ||
          refreshed.status === 'failed' ||
          refreshed.status === 'cancelled' ||
          refreshed.status === 'refunded' ||
          attempts > 15
        ) {
          clearInterval(interval);
          pollIntervalRef.current = null;
          setIsPollingOrder(false);
          loadUserOrders();
          loadNotifications();
        }
      } catch (e) {
        clearInterval(interval);
        pollIntervalRef.current = null;
        setIsPollingOrder(false);
      }
    }, 1500);

    pollIntervalRef.current = interval;
  };

  const handleOpenOrderTracker = async (orderOrId: Order | string) => {
    setTrackerLookupError(null);
    if (typeof orderOrId !== 'string') {
      setCurrentOrder(orderOrId);
      try {
        const refreshed = await apiClient.getMobileOrder(orderOrId.id);
        setCurrentOrder(refreshed);
        setLastPolledAt(new Date().toLocaleTimeString());
        if (refreshed.status === 'pending' || refreshed.status === 'paid' || refreshed.status === 'processing') {
          pollOrderStatus(refreshed.id);
        } else {
          stopOrderPolling();
        }
      } catch {
        if (orderOrId.status === 'pending' || orderOrId.status === 'paid' || orderOrId.status === 'processing') {
          pollOrderStatus(orderOrId.id);
        }
      }
      return;
    }

    const query = orderOrId.trim();
    if (!query) return;
    try {
      const found = await apiClient.getMobileOrder(query);
      setCurrentOrder(found);
      setLastPolledAt(new Date().toLocaleTimeString());
      if (found.status === 'pending' || found.status === 'paid' || found.status === 'processing') {
        pollOrderStatus(found.id);
      } else {
        stopOrderPolling();
      }
    } catch (err: any) {
      setTrackerLookupError(`Aucune commande trouvée pour "${query}". Vérifiez votre N° PLUP ou Partner ID.`);
    }
  };

  const getOrderProgressInfo = (order: Order) => {
    const hasPaidHistory = order.statusHistory?.some(h => h.status === 'paid');
    const hasProcessingHistory = order.statusHistory?.some(h => h.status === 'processing');

    let progressPercent = 25;
    let stageIndex = 1; // 1 to 4
    let statusLabel = 'Commande initiée';
    let barColorClass = 'from-orange-500 to-amber-500';

    if (order.status === 'pending') {
      progressPercent = 25;
      stageIndex = 1;
      statusLabel = 'En attente de validation paiement';
      barColorClass = 'from-amber-500 to-orange-500';
    } else if (order.status === 'paid') {
      progressPercent = 55;
      stageIndex = 2;
      statusLabel = 'Paiement validé · Envoi vers GoXtop';
      barColorClass = 'from-orange-500 to-amber-500';
    } else if (order.status === 'processing') {
      progressPercent = 82;
      stageIndex = 3;
      statusLabel = 'Traitement GoXtop en cours...';
      barColorClass = 'from-orange-600 via-amber-500 to-emerald-500';
    } else if (order.status === 'completed') {
      progressPercent = 100;
      stageIndex = 4;
      statusLabel = 'Livraison confirmée à 100%';
      barColorClass = 'from-emerald-500 to-teal-500';
    } else if (order.status === 'failed' || order.status === 'cancelled' || order.status === 'refunded') {
      progressPercent = 100;
      stageIndex = 4;
      statusLabel = order.status === 'refunded' ? 'Commande remboursée' : 'Échec de traitement';
      barColorClass = 'from-red-500 to-rose-600';
    }

    const steps = [
      {
        step: 1,
        title: 'Initiée',
        subtitle: 'ID PlayUp créé',
        done: stageIndex >= 1,
        active: stageIndex === 1,
        failed: false
      },
      {
        step: 2,
        title: 'Paiement',
        subtitle: order.paymentMethod ? order.paymentMethod.toUpperCase() : 'Validé',
        done: stageIndex >= 2 || Boolean(hasPaidHistory),
        active: stageIndex === 2,
        failed: false
      },
      {
        step: 3,
        title: 'GoXtop API',
        subtitle: 'Serveur de jeu',
        done: stageIndex >= 3 || Boolean(hasProcessingHistory),
        active: stageIndex === 3,
        failed: false
      },
      {
        step: 4,
        title: order.status === 'failed' ? 'Échec' : 'Livrée',
        subtitle: order.status === 'completed' ? 'Crédits reçus' : order.status === 'failed' ? 'Non livrée' : 'Confirmation',
        done: order.status === 'completed',
        active: stageIndex === 4 && order.status !== 'completed' && order.status !== 'failed',
        failed: order.status === 'failed' || order.status === 'cancelled'
      }
    ];

    return { progressPercent, stageIndex, statusLabel, barColorClass, steps };
  };

  const resetPurchaseFlow = () => {
    stopOrderPolling();
    setSelectedGame(null);
    setSelectedService(null);
    setSelectedPackage(null);
    setCurrentOrder(null);
    setOrderError(null);
    setPlayerCheckResult(null);
    setShowPaymentStep(false);
    setPendingPartnerOrderId('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center p-0 sm:p-4 overflow-y-auto">
      {/* Top Controller Bar */}
      <div className="w-full max-w-md sm:max-w-xl mx-auto flex items-center justify-between px-4 py-2 text-white text-xs mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-semibold">Simulateur Mobile PlayUp v2.4</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDeviceFrameMode(!deviceFrameMode)}
            className="hover:text-orange-400 transition-colors hidden sm:block"
          >
            {deviceFrameMode ? 'Agrandir la vue' : 'Format Téléphone'}
          </button>
          <button
            onClick={onClose}
            aria-label="Fermer l'application"
            title="Fermer l'application"
            className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white font-semibold transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Smartphone Shell Container */}
      <div className={`w-full transition-all duration-300 ${
        deviceFrameMode 
          ? 'h-[calc(100dvh-44px)] sm:max-w-[420px] sm:h-[860px] sm:max-h-[92vh] sm:rounded-[44px] sm:border-[10px] sm:border-slate-900 shadow-2xl relative overflow-hidden bg-white flex flex-col sm:ring-1 sm:ring-slate-700/50' 
          : 'max-w-2xl h-[calc(100dvh-44px)] sm:h-[92vh] sm:rounded-3xl sm:border sm:border-slate-700 shadow-2xl relative bg-white flex flex-col overflow-hidden'
      }`}>
        {/* PlayUp Official Splash Screen — Disappears automatically after 2 seconds without pressing any button */}
        {showSplashScreen && (
          <div className="absolute inset-0 z-50 bg-[#050302] flex items-center justify-center p-8 select-none pointer-events-none transition-opacity duration-300">
            <PlayUpSplashLogo className="w-[78%] max-w-[300px] h-auto" />
          </div>
        )}

        {/* Phone Notch / Dynamic Island (Desktop simulator only) */}
        {deviceFrameMode && (
          <div className="hidden sm:flex w-full bg-slate-900 h-6 justify-center items-center shrink-0">
            <div className="w-24 h-4 bg-slate-950 rounded-full flex items-center justify-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-800" />
              <span className="w-2 h-2 rounded-full bg-slate-700/80" />
            </div>
          </div>
        )}

        {/* Mobile App Header */}
        <div className="bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between shrink-0">
          {(selectedGame || currentOrder) ? (
            <button
              onClick={() => {
                if (selectedPackage && !currentOrder) {
                  setSelectedPackage(null);
                  setPlayerCheckResult(null);
                  setBackendWalletCheck(null);
                  setOrderError(null);
                  setShowPaymentStep(false);
                } else {
                  resetPurchaseFlow();
                }
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-orange-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{selectedPackage && !currentOrder ? 'Retour aux packs' : 'Retour'}</span>
            </button>
          ) : (
            <div className="flex items-center">
              <PlayUpSiteLogo className="w-10 h-10" />
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-1.5 text-slate-600 hover:text-slate-900 rounded-full hover:bg-slate-100"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-orange-600 rounded-full" />
            </button>

            <button
              onClick={() => {
                resetPurchaseFlow();
                setActiveTab('profile');
              }}
              className="px-2.5 py-1 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg text-xs font-bold text-orange-700 flex items-center gap-1.5 transition-colors"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>
                {authUser
                  ? formatHtg(Number((authUser.walletBalance * 132).toFixed(2)))
                  : 'Connexion'}
              </span>
            </button>
          </div>
        </div>

        {/* Notifications Dropdown Modal */}
        {showNotifications && (
          <div className="absolute top-16 left-4 right-4 bg-white rounded-2xl shadow-xl border border-slate-200 p-4 z-40 text-xs space-y-3 max-h-72 overflow-y-auto animate-in fade-in">
            <div className="flex justify-between items-center font-bold text-slate-900">
              <span>Notifications PlayUp ({notifications.length})</span>
              <button onClick={() => setShowNotifications(false)} className="text-slate-400">✕</button>
            </div>
            {notifications.length > 0 ? (
              notifications.slice(0, 6).map(n => (
                <div
                  key={n.id}
                  onClick={() => {
                    apiClient.markNotificationRead(n.id);
                    loadNotifications();
                  }}
                  className={`p-2.5 rounded-xl space-y-1 cursor-pointer border ${
                    n.type === 'error'
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-orange-50/80 border-orange-200 text-slate-900'
                  }`}
                >
                  <div className="font-bold flex items-center justify-between">
                    <span>{n.title}</span>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-orange-600" />}
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-600">{n.message}</p>
                </div>
              ))
            ) : (
              <div className="p-2.5 bg-orange-50 text-orange-950 rounded-xl space-y-1">
                <div className="font-semibold text-orange-800">Passerelle RechargeGames connectée</div>
                <p className="text-[11px] leading-relaxed">
                  Vos notifications de commandes et livraisons en temps réel apparaîtront ici.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Mobile Viewport Content Area */}
        <div ref={mobileContentScrollRef} className="flex-1 overflow-y-auto bg-slate-50/50">
          {/* FLOW: REAL-TIME ORDER TRACKER VIEW */}
          {currentOrder ? (
            (() => {
              const progressInfo = getOrderProgressInfo(currentOrder);
              const isTerminal =
                currentOrder.status === 'completed' ||
                currentOrder.status === 'failed' ||
                currentOrder.status === 'cancelled' ||
                currentOrder.status === 'refunded';

              return (
                <div className="p-4 sm:p-5 space-y-4">
                  {/* Top Order Tracker Live Banner */}
                  <div className="flex items-center justify-between bg-slate-900 text-white px-3.5 py-2.5 rounded-2xl border border-slate-800">
                    <div className="flex items-center gap-2">
                      <Activity className={`w-4 h-4 ${isPollingOrder ? 'text-orange-400 animate-pulse' : 'text-emerald-400'}`} />
                      <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider block">
                          Statut de la Commande en Direct
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          {isPollingOrder
                            ? `Synchronisation active (cycle #${pollAttempts + 1})`
                            : lastPolledAt
                            ? `Mis à jour à ${lastPolledAt}`
                            : 'Suivi en direct RechargeGames'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => pollOrderStatus(currentOrder.id)}
                      className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${isPollingOrder ? 'animate-spin text-orange-400' : ''}`} />
                      <span>{isPollingOrder ? 'Live' : 'Actualiser'}</span>
                    </button>
                  </div>

                  {/* Hero Status Icon & Headline */}
                  <div className="text-center space-y-1.5 pt-1">
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto ${
                      currentOrder.status === 'completed' ? 'bg-emerald-100 text-emerald-600' :
                      currentOrder.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600 animate-pulse'
                    }`}>
                      {currentOrder.status === 'completed' ? (
                        <CheckCircle2 className="w-7 h-7" />
                      ) : currentOrder.status === 'failed' ? (
                        <AlertCircle className="w-7 h-7" />
                      ) : (
                        <RefreshCw className="w-7 h-7 animate-spin" />
                      )}
                    </div>

                    <h3 className="font-display text-lg font-bold text-slate-900">
                      {currentOrder.status === 'completed' ? 'Top-up livré avec succès.' :
                       currentOrder.status === 'refunded' ? 'Commande remboursée' :
                       currentOrder.status === 'failed' ? 'Top-up échoué' :
                       'Demande envoyée • En traitement...'}
                    </h3>

                    <div className="text-xs font-mono font-bold text-orange-600">
                      Commande #{currentOrder.orderNumber}
                    </div>

                    <p className="text-xs text-slate-500 max-w-xs mx-auto">
                      {currentOrder.status === 'completed'
                        ? 'Top-up livré avec succès sur votre compte joueur.'
                        : currentOrder.status === 'refunded'
                        ? currentOrder.errorMessage || 'Votre commande a été remboursée suite à la confirmation RechargeGames.'
                        : currentOrder.status === 'failed'
                        ? currentOrder.errorMessage || 'Recharge échouée. Veuillez vérifier vos informations.'
                        : 'Votre demande a été transmise au système de recharge et est en cours de traitement.'}
                    </p>
                  </div>

                  {/* REAL-TIME PROGRESS BAR & 4-STAGE STEPPER */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-orange-600" />
                        <span>{progressInfo.statusLabel}</span>
                      </span>
                      <span className={`font-mono font-extrabold text-xs px-2 py-0.5 rounded-md ${
                        currentOrder.status === 'completed'
                          ? 'bg-emerald-50 text-emerald-700'
                          : currentOrder.status === 'failed'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-orange-50 text-orange-700'
                      }`}>
                        {progressInfo.progressPercent}%
                      </span>
                    </div>

                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/80">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${progressInfo.barColorClass} transition-all duration-700 ease-out ${
                          !isTerminal ? 'animate-pulse' : ''
                        }`}
                        style={{ width: `${progressInfo.progressPercent}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-4 gap-1.5 pt-1">
                      {progressInfo.steps.map((s) => (
                        <div key={s.step} className="flex flex-col items-center text-center space-y-1">
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border transition-all ${
                              s.failed
                                ? 'bg-red-600 border-red-600 text-white'
                                : s.done
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : s.active
                                ? 'bg-orange-600 border-orange-600 text-white ring-4 ring-orange-100'
                                : 'bg-slate-50 border-slate-300 text-slate-400'
                            }`}
                          >
                            {s.failed ? '✕' : s.done ? <Check className="w-3.5 h-3.5" /> : s.step}
                          </div>
                          <div className="text-[10px] font-bold text-slate-800 leading-tight">{s.title}</div>
                          <div className="text-[9px] text-slate-400 leading-tight truncate max-w-full">{s.subtitle}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Summary Details */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Service :</span>
                      <span className="font-semibold text-slate-900">{currentOrder.gameName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Pack :</span>
                      <span className="font-semibold text-slate-900">{currentOrder.packageName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">ID Joueur :</span>
                      <span className="font-mono font-bold text-slate-800">
                        {currentOrder.playerId || Object.values(currentOrder.gameProfileData)[0]}
                      </span>
                    </div>
                    {currentOrder.externalOrderId && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Réf. Recharge :</span>
                        <span className="font-mono font-bold text-slate-800">{currentOrder.externalOrderId}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-2 border-t border-slate-100">
                      <span className="font-bold text-slate-900">Montant débité (Wallet) :</span>
                      <span className="font-mono font-bold text-orange-600 text-sm">
                        {formatHtg(Number((currentOrder.chargedAmount * 132).toFixed(2)))}
                      </span>
                    </div>
                  </div>

                  {currentOrder.user_status_message && (
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-700">
                      {currentOrder.user_status_message}
                    </div>
                  )}

                  <div className="space-y-2 pt-1">
                    <button
                      onClick={resetPurchaseFlow}
                      className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors"
                    >
                      Effectuer un nouvel achat
                    </button>
                    <button
                      onClick={() => {
                        stopOrderPolling();
                        setCurrentOrder(null);
                        setActiveTab('orders');
                      }}
                      className="w-full py-2 text-xs text-slate-600 hover:text-slate-900 font-medium"
                    >
                      Voir l’historique de mes commandes
                    </button>
                  </div>
                </div>
              );
            })()
          ) : selectedGame && selectedPackage ? (
            /* DEDICATED SERVICE PURCHASE PAGE (Opened directly on clicking a service card, zero unnecessary scroll) */
            (() => {
              const cardImg = getServiceCardImage(selectedGame, selectedService, selectedPackage);
              const diamondsLabel = getDiamondsLabel(selectedPackage);
              const priceHtg =
                backendWalletCheck && backendWalletCheck.requiredAmountHtg > 0
                  ? backendWalletCheck.requiredAmountHtg
                  : getPackagePriceHtg(selectedPackage);
              const requiresPlayer =
                selectedPackage.requiresPlayerId !== false && selectedGame.requiresPlayerId !== false;
              const isIdVerified =
                !requiresPlayer ||
                Boolean(playerCheckResult && (playerCheckResult.verified || !playerCheckResult.supported));

              const userWalletHtg =
                backendWalletCheck !== null
                  ? backendWalletCheck.walletBalanceHtg
                  : authUser
                  ? Number((authUser.walletBalance * 132).toFixed(2))
                  : 0;
              const isWalletSufficient =
                backendWalletCheck !== null
                  ? backendWalletCheck.sufficient
                  : authUser
                  ? userWalletHtg >= priceHtg
                  : false;

              return (
                <div className="p-4 space-y-3.5 animate-in fade-in duration-150">
                  {/* 1. SERVICE SÉLECTIONNÉ (Compact Top Summary Card) */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={cardImg}
                        alt={diamondsLabel}
                        className="w-14 h-14 rounded-xl object-cover shrink-0 bg-slate-100 border border-slate-100"
                        referrerPolicy="no-referrer"
                      />
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600 block truncate">
                          {selectedGame.name}
                        </span>
                        <h3 className="font-display text-base font-extrabold text-slate-900 leading-tight truncate">
                          {diamondsLabel}
                        </h3>
                        <span className="font-mono text-sm font-extrabold text-orange-600 block mt-0.5">
                          {formatHtg(priceHtg)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPackage(null);
                        setPlayerCheckResult(null);
                        setBackendWalletCheck(null);
                        setOrderError(null);
                      }}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[11px] font-semibold shrink-0 transition-colors"
                    >
                      Changer
                    </button>
                  </div>

                  {/* 2. SAISIE ET VÉRIFICATION DE L’ID DU JEU */}
                  {requiresPlayer ? (
                    <div className="bg-white border border-slate-200 rounded-2xl p-3.5 space-y-3 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-900 uppercase tracking-tight">
                          Vérification de l’ID du jeu
                        </label>
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                          Validation instantanée
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {selectedGame.fields
                          .filter(
                            f =>
                              !selectedPackage.requiredFields?.length ||
                              selectedPackage.requiredFields.includes(f.name)
                          )
                          .map(field => (
                            <div key={field.id} className="space-y-1">
                              <label className="text-xs font-semibold text-slate-700 flex justify-between">
                                <span>
                                  {field.label} {field.required && <span className="text-orange-600">*</span>}
                                </span>
                              </label>

                              {field.type === 'select' && field.options ? (
                                <select
                                  value={gameProfileInputs[field.name] || field.options[0]}
                                  onChange={(e) => {
                                    setGameProfileInputs({ ...gameProfileInputs, [field.name]: e.target.value });
                                    setPlayerCheckResult(null);
                                    setBackendWalletCheck(null);
                                    setOrderError(null);
                                  }}
                                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
                                >
                                  {field.options.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type={field.type === 'number' ? 'number' : 'text'}
                                  placeholder={field.placeholder || 'Entrez votre Player ID / UID'}
                                  value={gameProfileInputs[field.name] || ''}
                                  onChange={(e) => {
                                    setGameProfileInputs({ ...gameProfileInputs, [field.name]: e.target.value });
                                    setPlayerCheckResult(null);
                                    setBackendWalletCheck(null);
                                    setOrderError(null);
                                  }}
                                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:border-orange-500"
                                />
                              )}
                            </div>
                          ))}
                      </div>

                      <button
                        type="button"
                        disabled={
                          isCheckingPlayer ||
                          !(
                            gameProfileInputs.playerId ||
                            gameProfileInputs.userId ||
                            gameProfileInputs.characterId ||
                            Object.values(gameProfileInputs)[0]
                          )
                        }
                        onClick={handleVerifyPlayer}
                        className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        {isCheckingPlayer ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-orange-400" />
                            <span>Vérification de l’ID en cours...</span>
                          </>
                        ) : (
                          <>
                            <Search className="w-3.5 h-3.5 text-orange-400" />
                            <span>Vérifier l’ID</span>
                          </>
                        )}
                      </button>

                      {/* 3. RÉSULTAT DE LA VÉRIFICATION DE L’ID */}
                      {playerCheckResult && (
                        <div
                          className={`p-3 rounded-xl border text-xs ${
                            playerCheckResult.verified
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                              : !playerCheckResult.supported
                              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                              : 'bg-rose-50 border-rose-200 text-rose-900'
                          }`}
                        >
                          {playerCheckResult.verified ? (
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                <div>
                                  <span className="font-bold block text-emerald-900">
                                    ID valide — {playerCheckResult.playerName}
                                  </span>
                                  <span className="text-[11px] text-emerald-700">
                                    Compte vérifié avec succès
                                  </span>
                                </div>
                              </div>
                              <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-bold uppercase shrink-0">
                                Valide ✓
                              </span>
                            </div>
                          ) : !playerCheckResult.supported ? (
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span className="font-semibold">
                                ID enregistré ({Object.values(gameProfileInputs)[0]}) — Prêt pour l’envoi
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 font-semibold text-rose-800">
                              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                              <span>{playerCheckResult.message || 'ID de jeu invalide.'}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Aucun ID requis pour ce service. Livraison immédiate après paiement.</span>
                    </div>
                  )}

                  {/* Error Banner */}
                  {orderError && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <span>{orderError}</span>
                    </div>
                  )}

                  {/* 4 & 5. APRÈS VÉRIFICATION RÉUSSIE DE L’ID : RÉCAPITULATIF + VÉRIFICATION DU SOLDE WALLET + PAIEMENT */}
                  {isIdVerified && (
                    <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-3.5 border border-slate-800 shadow-sm animate-in fade-in duration-150">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-orange-400">
                          Récapitulatif de la commande
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-bold">
                          ID Validé ✓
                        </span>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Service sélectionné :</span>
                          <span className="font-bold text-white">{selectedGame.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Diamonds / Pack :</span>
                          <span className="font-bold text-orange-400">{diamondsLabel}</span>
                        </div>
                        {requiresPlayer && (
                          <div className="flex justify-between">
                            <span className="text-slate-400">ID du joueur :</span>
                            <span className="font-mono font-bold text-emerald-400">
                              {gameProfileInputs.playerId ||
                                gameProfileInputs.userId ||
                                Object.values(gameProfileInputs)[0]}
                              {playerCheckResult?.playerName ? ` (${playerCheckResult.playerName})` : ''}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between pt-2 border-t border-slate-800 items-center">
                          <span className="font-bold text-white">Prix à payer :</span>
                          <span className="font-mono text-base font-extrabold text-orange-400">
                            {formatHtg(priceHtg)}
                          </span>
                        </div>
                      </div>

                      {/* WALLET BALANCE CHECK (BACKEND AUTHORITATIVE) */}
                      {!authUser || !userToken ? (
                        <div className="p-3 bg-slate-800 border border-orange-500/40 rounded-xl space-y-2.5 text-xs">
                          <div className="font-bold text-orange-300">
                            Connexion requise pour vérifier votre solde Wallet
                          </div>
                          <p className="text-[11px] text-slate-300">
                            Connectez-vous à votre compte PlayUp pour débiter votre Wallet et envoyer la demande.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              resetPurchaseFlow();
                              setActiveTab('profile');
                            }}
                            className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs transition-colors"
                          >
                            Se connecter / Créer un compte
                          </button>
                        </div>
                      ) : !isWalletSufficient ? (
                        /* SOLDE INSUFFISANT */
                        <div className="p-3.5 bg-rose-950/60 border border-rose-500/50 rounded-xl space-y-2.5 text-xs">
                          <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
                            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            <span>Solde insuffisant</span>
                          </div>

                          <div className="space-y-1 bg-slate-900/90 rounded-lg p-2.5 border border-rose-500/20">
                            <div className="flex justify-between">
                              <span className="text-slate-400">Montant disponible :</span>
                              <span className="font-mono font-bold text-rose-400">
                                {formatHtg(userWalletHtg)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Montant nécessaire :</span>
                              <span className="font-mono font-bold text-white">
                                {formatHtg(priceHtg)}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              resetPurchaseFlow();
                              setActiveTab('profile');
                            }}
                            className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                          >
                            <Wallet className="w-3.5 h-3.5" />
                            <span>Recharger mon Wallet</span>
                          </button>
                        </div>
                      ) : (
                        /* SOLDE SUFFISANT -> BOUTON PAYER ET ENVOYER LA DEMANDE */
                        <div className="space-y-3">
                          <div className="p-2.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl flex items-center justify-between text-xs">
                            <span className="text-emerald-200 flex items-center gap-1.5">
                              <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Solde Wallet disponible :</span>
                            </span>
                            <span className="font-mono font-bold text-emerald-400">
                              {formatHtg(userWalletHtg)}
                            </span>
                          </div>

                          <button
                            type="button"
                            disabled={isOrdering}
                            onClick={handlePayAndSendOrder}
                            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer"
                          >
                            {isOrdering ? (
                              <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>Débit du Wallet &amp; envoi de la demande...</span>
                              </>
                            ) : (
                              <>
                                <ShieldCheck className="w-4 h-4" />
                                <span>Payer et envoyer la demande ({formatHtg(priceHtg)})</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()
          ) : selectedGame ? (
            /* GAME SERVICE CARDS GRID (Clean uniform cards: ONLY real image, Diamonds, and price in HTG) */
            <div className="p-4 space-y-4">
              {/* Compact Game Header */}
              <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl p-3">
                <img 
                  src={selectedGame.logo} 
                  alt={selectedGame.name} 
                  className="w-12 h-12 rounded-xl object-cover shrink-0"
                  referrerPolicy="no-referrer"
                />
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600 block">
                    {selectedGame.category}
                  </span>
                  <h3 className="font-display text-base font-bold text-slate-900 truncate">
                    {selectedGame.name}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Touchez un pack pour ouvrir sa page dédiée
                  </p>
                </div>
              </div>

              {(() => {
                const gameRgProducts = rgCatalog.filter(
                  p =>
                    (p.game || '').toLowerCase() === (selectedGame.name || '').toLowerCase() ||
                    p.game_slug === selectedGame.slug ||
                    (selectedGame.slug === 'roblox' && (p.game || '').toLowerCase().includes('roblox'))
                );
                const regionsForGame = Array.from(
                  new Set(gameRgProducts.map(p => p.region).filter(Boolean))
                );
                const regionList = regionsForGame.length > 0 ? regionsForGame : ['Brazil', 'USA', 'Global'];

                const formatRegionChip = (reg: string) => {
                  const r = (reg || '').toLowerCase();
                  if (r === 'brazil') return 'Brazil 🇧🇷';
                  if (r === 'usa') return 'USA 🇺🇸';
                  if (r === 'global') return 'Global 🌐';
                  return `🌍 ${reg}`;
                };

                const regionalPackages: ServicePackage[] =
                  gameRgProducts.length > 0
                    ? gameRgProducts
                        .filter(p => (p.region || '').toLowerCase() === (selectedRegion || '').toLowerCase())
                        .map((p, idx) => {
                          const priceHtg =
                            typeof p.playup_price_htg === 'number' && p.playup_price_htg > 0
                              ? Number(p.playup_price_htg.toFixed(2))
                              : Number((Number(p.playup_price || 0) * 132).toFixed(2));
                          return {
                            id: `pkg_rg_${p.product_key}`,
                            serviceId: selectedService?.id || `srv_${selectedGame.slug}`,
                            externalProductId: p.product_key,
                            productKey: p.product_key,
                            region: p.region,
                            providerSlug: 'rechargegames',
                            externalGameId: p.game_slug || selectedGame.slug,
                            name: p.name,
                            amount: p.amount || 1,
                            unit: p.unit || 'Diamonds',
                            supplierCost: 0,
                            margin: 0,
                            publicPrice: p.playup_price,
                            publicPriceHtg: priceHtg,
                            resellerPrice: p.playup_price,
                            sellingCurrency: 'HTG',
                            currency: 'HTG',
                            isActive: p.active,
                            requiresPlayerId: p.requires_player_id !== false,
                            requiredFields: selectedGame.fields.map(f => f.name),
                            displayOrder: idx + 1
                          };
                        })
                    : selectedService?.packages || [];

                return (
                  <>
                    {/* Region Filter */}
                    {regionList.length > 1 && (
                      <div className="flex flex-wrap gap-1.5">
                        {regionList.map(reg => {
                          const isRegActive = (selectedRegion || '').toLowerCase() === (reg || '').toLowerCase();
                          return (
                            <button
                              key={reg}
                              type="button"
                              onClick={() => {
                                setSelectedRegion(reg);
                                setSelectedPackage(null);
                                setOrderError(null);
                              }}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                isRegActive
                                  ? 'bg-orange-600 text-white border-orange-600 shadow-2xs'
                                  : 'bg-white text-slate-700 border-slate-200 hover:border-orange-400'
                              }`}
                            >
                              {formatRegionChip(reg)}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Clean Uniform Service Cards: ONLY real image, Diamonds, and price in HTG */}
                    <div className="grid grid-cols-2 gap-3">
                      {regionalPackages.map(pkg => {
                        const cardImg = getServiceCardImage(selectedGame, selectedService, pkg);
                        const diamondsText = getDiamondsLabel(pkg);
                        return (
                          <div
                            key={pkg.id}
                            onClick={() => handleOpenDedicatedServicePage(pkg)}
                            className={`group rounded-2xl overflow-hidden border transition-all flex flex-col justify-between bg-white ${
                              !pkg.isActive
                                ? 'opacity-50 cursor-not-allowed border-slate-200'
                                : 'cursor-pointer border-slate-200 hover:border-orange-500 hover:shadow-md active:scale-[0.99]'
                            }`}
                          >
                            <div className="relative aspect-[16/10] w-full bg-slate-100 overflow-hidden">
                              <img
                                src={cardImg}
                                alt={diamondsText}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/50 via-transparent to-transparent" />
                            </div>

                            <div className="p-3 flex flex-col justify-between flex-1 space-y-1.5">
                              <div className="font-display text-sm font-extrabold text-slate-900 group-hover:text-orange-600 transition-colors leading-tight">
                                {diamondsText}
                              </div>

                              <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between">
                                <span className="font-mono text-xs font-extrabold text-orange-600">
                                  {formatHtg(getPackagePriceHtg(pkg))}
                                </span>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-orange-600 transition-colors" />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          ) : (
            /* TAB ROUTING INSIDE THE MOBILE APP */
            <div className="p-4 space-y-5">
              {/* TAB: ACCUEIL */}
              {activeTab === 'home' && (
                <div className="space-y-5">
                  {/* Hero promotion card */}
                  <div className="bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-2xl p-5 shadow-sm space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-orange-200">
                      Recharges Directes
                    </span>
                    <h3 className="font-display text-lg font-bold">
                      Diamants & UC en 30 secondes
                    </h3>
                    <p className="text-[11px] text-orange-100">
                      Sélectionnez votre jeu, renseignez votre UID et recevez vos monnaies immédiatement.
                    </p>
                  </div>

                  {/* Popular Games Grid */}
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-tight">
                        Jeux Populaires
                      </h4>
                      <button 
                        onClick={() => setActiveTab('games')}
                        className="text-[11px] font-semibold text-orange-600"
                      >
                        Voir tout →
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {games.slice(0, 4).map(game => (
                        <div
                          key={game.id}
                          onClick={() => handleSelectGame(game)}
                          className="bg-white border border-slate-200 hover:border-orange-500 rounded-2xl p-3 cursor-pointer shadow-2xs transition-all flex flex-col justify-between"
                        >
                          <div className="relative aspect-[4/3] rounded-xl overflow-hidden mb-2 bg-slate-100">
                            <img 
                              src={game.logo} 
                              alt={game.name}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                          <div>
                            <span className="font-semibold text-xs text-slate-900 block truncate">
                              {game.name}
                            </span>
                            <span className="text-[10px] text-orange-600 font-medium">
                              Recharge UID
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recent Activity */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-tight">
                        Dernières Recharges (Suivi Direct)
                      </h4>
                      <button
                        onClick={() => setActiveTab('orders')}
                        className="text-[11px] font-semibold text-orange-600"
                      >
                        Order Tracker →
                      </button>
                    </div>
                    <div className="space-y-2 text-xs">
                      {userOrders.slice(0, 3).map(o => (
                        <div
                          key={o.id}
                          onClick={() => handleOpenOrderTracker(o)}
                          className="flex items-center justify-between py-2 px-2.5 rounded-xl hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-all"
                        >
                          <div>
                            <span className="font-semibold text-slate-800">{o.gameName}</span>
                            <span className="text-slate-400 text-[10px] block">
                              {o.packageName} · <span className="font-mono">{o.orderNumber}</span>
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              o.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                              o.status === 'processing' ? 'bg-amber-100 text-amber-800' :
                              o.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {o.status}
                            </span>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                          </div>
                        </div>
                      ))}
                      {userOrders.length === 0 && (
                        <p className="text-xs text-slate-400">Aucune commande pour le moment.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: JEUX */}
              {activeTab === 'games' && (
                <div className="space-y-4">
                  {/* Category Filters Bar */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {gameCategoryFilters.map(category => {
                      const isActive = selectedGameCategory === category;
                      return (
                        <button
                          key={category}
                          type="button"
                          onClick={() => setSelectedGameCategory(category)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all shrink-0 cursor-pointer border ${
                            isActive
                              ? 'bg-orange-600 text-white border-orange-600 shadow-2xs'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-orange-300 hover:text-orange-600'
                          }`}
                        >
                          {category}
                        </button>
                      );
                    })}
                  </div>

                  {/* Search Input */}
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Rechercher un jeu (Free Fire, PUBG...)"
                      value={gameSearch}
                      onChange={(e) => setGameSearch(e.target.value)}
                      className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-orange-500"
                    />
                    {gameSearch && (
                      <button
                        type="button"
                        onClick={() => setGameSearch('')}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                        aria-label="Effacer la recherche"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Filtered Games List */}
                  <div className="space-y-2.5">
                    {(() => {
                      const filteredGames = games.filter(
                        g =>
                          matchesGameCategory(g, selectedGameCategory) &&
                          ((g.name || '').toLowerCase().includes((gameSearch || '').toLowerCase()) ||
                            (g.category || '').toLowerCase().includes((gameSearch || '').toLowerCase()))
                      );

                      if (filteredGames.length === 0) {
                        return (
                          <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-2">
                            <p className="text-xs font-semibold text-slate-700">
                              Aucun jeu trouvé dans la catégorie « {selectedGameCategory} »
                            </p>
                            <p className="text-[11px] text-slate-400">
                              Essayez une autre catégorie ou modifiez votre recherche.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedGameCategory('Tous');
                                setGameSearch('');
                              }}
                              className="mt-1 px-3 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 font-semibold rounded-xl text-xs transition-colors"
                            >
                              Réinitialiser les filtres
                            </button>
                          </div>
                        );
                      }

                      return filteredGames.map(game => (
                        <div
                          key={game.id}
                          onClick={() => handleSelectGame(game)}
                          className="bg-white border border-slate-200 hover:border-orange-500 rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <img 
                              src={game.logo} 
                              alt={game.name} 
                              className="w-12 h-12 rounded-xl object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <div>
                              <h4 className="font-bold text-xs text-slate-900">{game.name}</h4>
                              <span className="inline-block mt-0.5 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[10px] font-medium">
                                {game.category}
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}

              {/* TAB: COMMANDES & ORDER TRACKER */}
              {activeTab === 'orders' && (
                <div className="space-y-4">
                  {/* Live Order Tracker Search Card */}
                  <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-3 border border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-orange-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                          Order Tracker — Suivi en Direct
                        </h3>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 font-semibold">
                        Polling Temps Réel
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Recherchez une commande par N° PlayUp (<span className="font-mono text-slate-300">PLUP-...</span>) ou cliquez sur une commande ci-dessous pour afficher sa barre de progression en direct.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleOpenOrderTracker(trackerSearchQuery);
                      }}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        value={trackerSearchQuery}
                        onChange={(e) => {
                          setTrackerSearchQuery(e.target.value);
                          setTrackerLookupError(null);
                        }}
                        placeholder="Ex: PLUP-2026-84920 ou PTNR-..."
                        className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
                      />
                      <button
                        type="submit"
                        className="px-3.5 py-2 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs transition-colors shrink-0"
                      >
                        Suivre
                      </button>
                    </form>
                    {trackerLookupError && (
                      <div className="p-2.5 bg-red-500/20 border border-red-500/40 rounded-xl text-[11px] text-red-200">
                        {trackerLookupError}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-tight">
                      Mes Commandes ({userOrders.length})
                    </h3>
                    <button
                      onClick={loadUserOrders}
                      className="text-xs text-orange-600 font-semibold flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${ordersLoading ? 'animate-spin' : ''}`} />
                      <span>Actualiser</span>
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {userOrders.map(order => {
                      const info = getOrderProgressInfo(order);
                      const isInProgress = order.status === 'pending' || order.status === 'paid' || order.status === 'processing';
                      return (
                        <div
                          key={order.id}
                          onClick={() => handleOpenOrderTracker(order)}
                          className="bg-white border border-slate-200 hover:border-orange-500 rounded-2xl p-3.5 space-y-2.5 cursor-pointer transition-all shadow-2xs"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-mono font-bold text-slate-900">{order.orderNumber}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              order.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                              order.status === 'processing' ? 'bg-amber-100 text-amber-800' :
                              order.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-800'
                            }`}>
                              {order.status}
                            </span>
                          </div>

                          <div className="text-xs">
                            <span className="font-semibold text-slate-900">{order.gameName}</span> - {order.packageName}
                          </div>

                          <div className="text-[11px] text-slate-500 font-mono">
                            {Object.entries(order.gameProfileData).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                          </div>

                          {/* Real-time mini progress bar */}
                          <div className="space-y-1 pt-0.5">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-slate-500 font-medium">{info.statusLabel}</span>
                              <span className="font-mono font-bold text-slate-700">{info.progressPercent}%</span>
                            </div>
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full bg-gradient-to-r ${info.barColorClass} transition-all duration-500 ${
                                  isInProgress ? 'animate-pulse' : ''
                                }`}
                                style={{ width: `${info.progressPercent}%` }}
                              />
                            </div>
                          </div>

                          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                            <span className="text-slate-400 text-[10px] flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-orange-600">
                                ${order.chargedAmount.toFixed(2)}
                              </span>
                              <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-lg flex items-center gap-0.5">
                                <span>Suivre</span>
                                <ChevronRight className="w-3 h-3" />
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {userOrders.length === 0 && (
                      <div className="text-center py-12 text-slate-400 text-xs">
                        Aucune commande effectuée pour le moment.
                      </div>
                    )}
                  </div>

                  {/* SECTION 17: HISTORIQUE DES TOP-UPS RECHARGEGAMES */}
                  <div className="pt-4 border-t border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-bold text-slate-900 uppercase tracking-tight">
                          Historique des top-ups ({rgOrders.length})
                        </h3>
                        <p className="text-[10px] text-slate-500">
                          Détail complet par région, produit et Player ID sécurisé
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {rgOrders.map(rgOrd => {
                        const isPlayerIdRevealed = Boolean(revealedPlayerIds[rgOrd.id]);
                        const rawPid = rgOrd.player_id || '';
                        const maskedPid =
                          rawPid.length > 5
                            ? `${rawPid.slice(0, 2)}••••${rawPid.slice(-2)}`
                            : rawPid;

                        const statusBadge =
                          rgOrd.status === 'delivered' ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              Delivered • Top-up livré avec succès.
                            </span>
                          ) : rgOrd.status === 'refunded' ? (
                            <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-800 text-[10px] font-bold">
                              Refunded • Commande remboursée
                            </span>
                          ) : rgOrd.status === 'failed' ? (
                            <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                              Failed • Top-up échoué
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                              Pending • En traitement...
                            </span>
                          );

                        return (
                          <div
                            key={rgOrd.id}
                            className="bg-white border border-slate-200 rounded-2xl p-3.5 space-y-2 text-xs shadow-2xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-bold text-slate-900">
                                Commande #{rgOrd.id}
                              </span>
                              {statusBadge}
                            </div>

                            <div className="grid grid-cols-2 gap-1.5 text-[11px] pt-1">
                              <div>
                                <span className="text-slate-400">Jeu : </span>
                                <span className="font-semibold text-slate-800">{rgOrd.game}</span>
                              </div>
                              <div>
                                <span className="text-slate-400">Région : </span>
                                <span className="font-bold text-slate-800">
                                  {rgOrd.region === 'Brazil'
                                    ? 'Brazil 🇧🇷'
                                    : rgOrd.region === 'USA'
                                    ? 'USA 🇺🇸'
                                    : rgOrd.region}
                                </span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-slate-400">Produit : </span>
                                <span className="font-semibold text-slate-800">
                                  {rgOrd.product_name}
                                </span>{' '}
                                <span className="font-mono text-[10px] text-orange-600">
                                  ({rgOrd.product_key})
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-400">Player ID : </span>
                                <span className="font-mono font-bold text-slate-800">
                                  {isPlayerIdRevealed ? rawPid : maskedPid}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRevealedPlayerIds(prev => ({
                                      ...prev,
                                      [rgOrd.id]: !prev[rgOrd.id]
                                    }))
                                  }
                                  className="text-[10px] text-orange-600 underline font-semibold"
                                >
                                  {isPlayerIdRevealed ? 'Masquer' : 'Afficher'}
                                </button>
                              </div>
                              <div className="text-right">
                                <span className="text-slate-400">Montant : </span>
                                <span className="font-mono font-bold text-orange-600">
                                  ${rgOrd.customer_price.toFixed(2)} {rgOrd.currency}
                                </span>
                              </div>
                            </div>

                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                              <span>Réf: {rgOrd.buyer_ref}</span>
                              <span>{new Date(rgOrd.created_at).toLocaleString()}</span>
                            </div>
                          </div>
                        );
                      })}
                      {rgOrders.length === 0 && (
                        <div className="text-center py-6 text-slate-400 text-xs bg-white border border-slate-200 rounded-2xl">
                          Aucun top-up RechargeGames enregistré.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: SUPPORT */}
              {activeTab === 'support' && (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-tight">
                    Support en Jeu PlayUp
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Un souci avec une recharge ? Envoyez-nous un message directement depuis l'application.
                  </p>

                  {supportSubmitted ? (
                    <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl text-xs space-y-2">
                      <div className="font-bold">Message envoyé au support !</div>
                      <p>Notre agent prendra en charge votre demande dans les plus brefs délais.</p>
                      <button
                        onClick={() => setSupportSubmitted(false)}
                        className="text-xs underline text-emerald-900"
                      >
                        Envoyer un autre message
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Votre message</label>
                        <textarea
                          rows={3}
                          value={supportMessage}
                          onChange={(e) => setSupportMessage(e.target.value)}
                          placeholder="Décrivez votre question ou problème..."
                          className="w-full border border-slate-200 rounded-xl p-2.5 text-xs focus:outline-none focus:border-orange-500"
                        />
                      </div>
                      <button
                        onClick={() => {
                          if (supportMessage.trim()) {
                            setSupportSubmitted(true);
                            setSupportMessage('');
                          }
                        }}
                        className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-semibold rounded-xl text-xs transition-colors"
                      >
                        Contacter un agent PlayUp
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: PROFIL & AUTHENTIFICATION COMPLÈTE */}
              {activeTab === 'profile' && (
                <div className="space-y-4">
                  {authError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center justify-between">
                      <span>{authError}</span>
                      <button onClick={() => setAuthError(null)} className="text-red-500 font-bold">✕</button>
                    </div>
                  )}
                  {authSuccess && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between">
                      <span>{authSuccess}</span>
                      <button onClick={() => setAuthSuccess(null)} className="text-emerald-700 font-bold">✕</button>
                    </div>
                  )}

                  {!authUser ? (
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-2xs text-xs">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div>
                          <h3 className="font-display text-base font-bold text-slate-900">
                            {authMode === 'login' && 'Connexion Compte PlayUp'}
                            {authMode === 'register' && 'Créer un Compte PlayUp'}
                            {authMode === 'forgot' && 'Réinitialiser le mot de passe'}
                            {authMode === 'reset' && 'Validation du code de sécurité'}
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            Accédez à votre portefeuille PlayUp, votre historique et vos profils de jeu.
                          </p>
                        </div>
                        <Lock className="w-5 h-5 text-orange-600 shrink-0" />
                      </div>

                      {/* Mode Switcher */}
                      <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() => {
                            setAuthMode('login');
                            setAuthError(null);
                          }}
                          className={`py-2 rounded-lg font-bold transition-colors ${
                            authMode === 'login' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                          }`}
                        >
                          Se connecter
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAuthMode('register');
                            setAuthError(null);
                          }}
                          className={`py-2 rounded-lg font-bold transition-colors ${
                            authMode === 'register' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                          }`}
                        >
                          S’inscrire
                        </button>
                      </div>

                      <form onSubmit={handleEmailAuth} className="space-y-3">
                        {authMode === 'register' && (
                          <div>
                            <label className="font-semibold text-slate-700 block mb-1">Nom complet / Pseudo</label>
                            <input
                              type="text"
                              required
                              value={authName}
                              onChange={(e) => setAuthName(e.target.value)}
                              placeholder="Votre nom complet"
                              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                            />
                          </div>
                        )}

                        <div>
                          <label className="font-semibold text-slate-700 block mb-1">Adresse Email</label>
                          <input
                            type="email"
                            required
                            value={authEmail}
                            onChange={(e) => setAuthEmail(e.target.value)}
                            placeholder="votre@email.com"
                            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                          />
                        </div>

                        {authMode === 'register' && (
                          <div>
                            <label className="font-semibold text-slate-700 block mb-1">Téléphone (MonCash / NatCash)</label>
                            <input
                              type="text"
                              value={authPhone}
                              onChange={(e) => setAuthPhone(e.target.value)}
                              placeholder="+509 37XX-XXXX"
                              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono"
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
                                  className="text-[11px] text-orange-600 font-semibold hover:underline"
                                >
                                  Mot de passe oublié ?
                                </button>
                              )}
                            </div>
                            <input
                              type="password"
                              required
                              value={authPassword}
                              onChange={(e) => setAuthPassword(e.target.value)}
                              placeholder="••••••••"
                              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                            />
                          </div>
                        )}

                        {authMode === 'reset' && (
                          <>
                            <div>
                              <label className="font-semibold text-slate-700 block mb-1">Code de réinitialisation (6 chiffres)</label>
                              <input
                                type="text"
                                required
                                value={resetCodeInput}
                                onChange={(e) => setResetCodeInput(e.target.value)}
                                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold"
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
                                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                              />
                            </div>
                          </>
                        )}

                        <button
                          type="submit"
                          disabled={authLoading}
                          className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-xs transition-colors"
                        >
                          {authLoading
                            ? 'Traitement sécurisé...'
                            : authMode === 'login'
                            ? 'Se connecter'
                            : authMode === 'register'
                            ? 'Créer mon compte'
                            : authMode === 'forgot'
                            ? 'Recevoir le code de réinitialisation'
                            : 'Valider le nouveau mot de passe'}
                        </button>
                      </form>

                      {/* Social Logins */}
                      <div className="pt-3 border-t border-slate-100 space-y-2">
                        <span className="text-[11px] text-slate-400 text-center block">Ou continuer avec</span>
                        <button
                          type="button"
                          disabled={authLoading}
                          onClick={handleGoogleSignIn}
                          className="w-full py-2 px-3 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl font-semibold text-slate-800 flex items-center justify-center gap-1.5"
                        >
                          <span>Continuer avec Google</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Authenticated User Header & Wallet Card */}
                      <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-xl bg-orange-600 flex items-center justify-center text-white font-bold text-base">
                              {authUser.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <h4 className="font-bold text-sm text-white">{authUser.name}</h4>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                    authUser.role === 'ADMIN'
                                      ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                                      : 'bg-slate-800 text-slate-300'
                                  }`}
                                >
                                  {authUser.role || 'USER'}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400">{authUser.email}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (userToken) {
                                apiClient.logoutUser(userToken).catch(() => {});
                              }
                              signOutFirebase().catch(() => {});
                              safeStorage.removeItem('playup_user_token');
                              safeStorage.removeItem('playup_user_profile');
                              safeStorage.removeItem('playup_admin_token');
                              setAuthUser(null);
                              setUserToken('');
                              onAuthChange?.(null);
                            }}
                            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                            title="Déconnexion"
                          >
                            <LogOut className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="p-3 bg-slate-800/90 border border-slate-700 rounded-xl flex items-center justify-between">
                          <div>
                            <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                              Solde PlayUp Wallet
                            </span>
                            <span className="font-mono text-lg font-extrabold text-orange-400">
                              ${authUser.walletBalance.toFixed(2)} {authUser.preferredCurrency || 'USD'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowWalletTopUp(!showWalletTopUp)}
                            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-bold transition-colors"
                          >
                            + Recharger
                          </button>
                        </div>

                        {/* Wallet Top-Up Drawer with Real MonCash (+509 48 03 9151) & NatCash (+509 55964606) OCR + Anti-Fraud */}
                        {showWalletTopUp && (
                          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-orange-400">Recharger mon PlayUp Wallet</span>
                              <span className="text-[10px] text-emerald-400 font-mono">OCR & Anti-Fraude Actif</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[11px] text-slate-400 block mb-1">Montant (USD)</label>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={topUpAmount}
                                  onChange={(e) => setTopUpAmount(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] text-slate-400 block mb-1">Passerelle</label>
                                <select
                                  value={topUpMethod}
                                  onChange={(e) => setTopUpMethod(e.target.value as PaymentMethodType)}
                                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
                                >
                                  <option value="moncash">MonCash (+509 48 03 9151)</option>
                                  <option value="natcash">NatCash (+509 55964606)</option>
                                  <option value="card">Carte Bancaire</option>
                                </select>
                              </div>
                            </div>

                            {topUpMethod === 'moncash' || topUpMethod === 'natcash' ? (
                              <MonCashNatCashOcrPaymentFlow
                                token={userToken}
                                user={authUser}
                                purpose="wallet_topup"
                                initialMethod={topUpMethod}
                                packageName={`Recharge PlayUp Wallet +$${Number(topUpAmount || 10).toFixed(2)} USD`}
                                expectedAmountUsd={Math.max(1, Number(topUpAmount || 10))}
                                onWalletCredited={({ newWalletBalance }) => {
                                  const updated = { ...authUser, walletBalance: newWalletBalance };
                                  setAuthUser(updated);
                                  onAuthChange?.(updated);
                                  setShowWalletTopUp(false);
                                }}
                                onRedirectHome={() => {
                                  setShowWalletTopUp(false);
                                  setActiveTab('home');
                                }}
                                compact
                              />
                            ) : (
                              <form onSubmit={handleWalletTopUpSubmit}>
                                <button
                                  type="submit"
                                  disabled={topUpProcessing}
                                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg"
                                >
                                  {topUpProcessing ? 'Traitement en cours...' : `Créditer $${topUpAmount} via Carte`}
                                </button>
                              </form>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Account & Security Settings Form */}
                      <form onSubmit={handleUpdateAccountSettings} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 text-xs">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <span className="font-bold text-slate-900 uppercase tracking-tight">
                            Paramètres du Compte &amp; Sécurité
                          </span>
                          <Settings className="w-4 h-4 text-slate-400" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div>
                            <label className="font-semibold text-slate-700 block mb-1">Nom d’affichage</label>
                            <input
                              type="text"
                              value={profileName}
                              onChange={(e) => setProfileName(e.target.value)}
                              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5"
                            />
                          </div>
                          <div>
                            <label className="font-semibold text-slate-700 block mb-1">Téléphone MonCash / NatCash</label>
                            <input
                              type="text"
                              value={profilePhone}
                              onChange={(e) => setProfilePhone(e.target.value)}
                              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                          <div>
                            <label className="font-semibold text-slate-700 block mb-1">Devise préférée</label>
                            <select
                              value={profileCurrency}
                              onChange={(e) => setProfileCurrency(e.target.value as 'USD' | 'HTG' | 'EUR')}
                              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5"
                            >
                              <option value="USD">USD ($)</option>
                              <option value="HTG">HTG (Gourdes)</option>
                              <option value="EUR">EUR (€)</option>
                            </select>
                          </div>
                          <div className="flex flex-col justify-end space-y-1">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={profileTwoFactor}
                                onChange={(e) => setProfileTwoFactor(e.target.checked)}
                                className="rounded text-orange-600"
                              />
                              <span className="text-[11px] font-semibold text-slate-700">Double Auth (2FA)</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={profileEmailNotifs}
                                onChange={(e) => setProfileEmailNotifs(e.target.checked)}
                                className="rounded text-orange-600"
                              />
                              <span className="text-[11px] font-semibold text-slate-700">Alertes Email</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={profilePushNotifs}
                                onChange={(e) => setProfilePushNotifs(e.target.checked)}
                                className="rounded text-orange-600"
                              />
                              <span className="text-[11px] font-semibold text-slate-700">Notifications Push</span>
                            </label>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="password"
                            value={currentPasswordInput}
                            onChange={(e) => setCurrentPasswordInput(e.target.value)}
                            placeholder="Mot de passe actuel (si changement)"
                            className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5"
                          />
                          <input
                            type="password"
                            value={newPasswordInput}
                            onChange={(e) => setNewPasswordInput(e.target.value)}
                            placeholder="Nouveau mot de passe"
                            className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={profileSaving}
                          className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-colors"
                        >
                          {profileSaving ? 'Enregistrement...' : 'Enregistrer mes paramètres'}
                        </button>
                      </form>

                      {/* Payment Transactions History */}
                      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2.5 text-xs">
                        <h4 className="font-bold text-slate-900 uppercase tracking-tight">
                          Historique des Transactions de Paiement
                        </h4>
                        <div className="space-y-2">
                          {userPaymentTransactions.slice(0, 5).map(tx => (
                            <div key={tx.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                              <div>
                                <div className="font-mono font-bold text-slate-900 text-[11px]">{tx.transactionReference}</div>
                                <div className="text-[10px] text-slate-500">
                                  {tx.paymentMethod.toUpperCase()} · {tx.payerIdentifier || 'Validé'}
                                </div>
                              </div>
                              <div className="text-right">
                                <span className="font-mono font-bold text-emerald-700 block">
                                  ${tx.totalCharged.toFixed(2)}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {new Date(tx.createdAt).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          ))}
                          {userPaymentTransactions.length === 0 && (
                            <p className="text-[11px] text-slate-400">Aucune transaction enregistrée.</p>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                    <h4 className="font-bold text-xs text-slate-900 uppercase tracking-tight">
                      Mes Profils de Jeu Enregistrés (1-Click Reorder)
                    </h4>
                    <div className="space-y-2">
                      {savedProfiles.map(prof => (
                        <div key={prof.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center justify-between">
                          <div>
                            <div className="font-bold text-slate-900">{prof.gameName}</div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              {Object.entries(prof.data).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                            </div>
                          </div>
                          <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded">
                            Sauvegardé
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile App Bottom Tab Bar */}
        <div className="bg-white border-t border-slate-200 px-3 py-2 flex items-center justify-around shrink-0">
          <button
            onClick={() => {
              resetPurchaseFlow();
              setActiveTab('home');
            }}
            className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
              activeTab === 'home' && !selectedGame ? 'text-orange-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Home className="w-5 h-5" />
            <span>{t.tabHome}</span>
          </button>

          <button
            onClick={() => {
              resetPurchaseFlow();
              setActiveTab('games');
            }}
            className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
              activeTab === 'games' || selectedGame ? 'text-orange-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Gamepad2 className="w-5 h-5" />
            <span>{t.tabGames}</span>
          </button>

          <button
            onClick={() => {
              resetPurchaseFlow();
              setActiveTab('orders');
            }}
            className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
              activeTab === 'orders' ? 'text-orange-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShoppingBag className="w-5 h-5" />
            <span>{t.tabOrders}</span>
          </button>

          <button
            onClick={() => {
              resetPurchaseFlow();
              setActiveTab('support');
            }}
            className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
              activeTab === 'support' ? 'text-orange-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <HelpCircle className="w-5 h-5" />
            <span>{t.tabSupport}</span>
          </button>

          <button
            onClick={() => {
              resetPurchaseFlow();
              setActiveTab('profile');
            }}
            className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
              activeTab === 'profile' ? 'text-orange-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <User className="w-5 h-5" />
            <span>{t.tabProfile}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
