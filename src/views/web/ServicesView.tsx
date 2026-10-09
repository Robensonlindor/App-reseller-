import React, { useState } from 'react';
import { 
  ArrowLeft, CheckCircle2, AlertCircle, RefreshCw, Search, 
  ShieldCheck, Wallet, ChevronRight, Zap
} from 'lucide-react';
import { Game, Service, ServicePackage, AppUser, PlayerCheckResult, Order } from '../../types';
import { Language, translations } from '../../i18n';
import { apiClient } from '../../services/apiClient';
import { safeStorage } from '../../lib/safeStorage';

interface ServicesViewProps {
  games: Game[];
  services: Service[];
  selectedGame: Game | null;
  onSelectGame: (g: Game | null) => void;
  onNavigate: (tab: string) => void;
  onOpenMobileApp: () => void;
  lang: Language;
  authUser?: AppUser | null;
  onAuthChange?: (user: AppUser | null) => void;
}

export const ServicesView: React.FC<ServicesViewProps> = ({
  games,
  services,
  selectedGame,
  onSelectGame,
  onNavigate,
  lang,
  authUser,
  onAuthChange
}) => {
  const t = translations[lang];

  // Dedicated Service Purchase Page state
  const [activeServicePage, setActiveServicePage] = useState<{
    game: Game;
    service: Service;
    pkg: ServicePackage;
  } | null>(null);

  const [gameProfileInputs, setGameProfileInputs] = useState<Record<string, string>>({});
  const [isCheckingPlayer, setIsCheckingPlayer] = useState(false);
  const [playerCheckResult, setPlayerCheckResult] = useState<PlayerCheckResult | null>(null);
  const [backendWalletCheck, setBackendWalletCheck] = useState<{
    sufficient: boolean;
    walletBalanceUsd: number;
    walletBalanceHtg: number;
    requiredAmountUsd: number;
    requiredAmountHtg: number;
    shortfallUsd: number;
    shortfallHtg: number;
  } | null>(null);
  const [isOrdering, setIsOrdering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [submittedOrder, setSubmittedOrder] = useState<Order | null>(null);

  // Filter services by selected game if any
  const displayedServices = selectedGame
    ? services.filter(s => s.gameId === selectedGame.id)
    : services;

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

  const getDiamondsLabel = (pkg: ServicePackage): string => {
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

  // Open the dedicated service purchase page immediately without scrolling
  const handlePackageClick = (service: Service, pkg: ServicePackage) => {
    const parentGame = games.find(g => g.id === service.gameId);
    if (!parentGame) return;

    const initialFields: Record<string, string> = {};
    parentGame.fields.forEach(f => {
      if (f.type === 'select' && f.options && f.options.length > 0) {
        initialFields[f.name] = f.options[0];
      } else {
        initialFields[f.name] = '';
      }
    });

    setGameProfileInputs(initialFields);
    setPlayerCheckResult(null);
    setBackendWalletCheck(null);
    setOrderError(null);
    setSubmittedOrder(null);
    setActiveServicePage({
      game: parentGame,
      service,
      pkg
    });

    try {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }

    const requiresPlayer = pkg.requiresPlayerId !== false && parentGame.requiresPlayerId !== false;
    const token = safeStorage.getItem('playup_user_token') || undefined;
    if (!requiresPlayer && token) {
      apiClient
        .validateBeforePayment(
          {
            productKey: pkg.productKey || pkg.externalProductId,
            packageId: pkg.id,
            gameId: parentGame.id,
            region: pkg.region || 'Global',
            playerId: 'VOUCHER_PIN',
            quantity: 1,
            paymentMethod: 'wallet'
          },
          token
        )
        .then(preVal => {
          if (preVal.walletCheck) {
            setBackendWalletCheck(preVal.walletCheck);
          }
        })
        .catch(() => {});
    }
  };

  const handleVerifyPlayer = async () => {
    if (!activeServicePage) return;
    const { game, service, pkg } = activeServicePage;
    setIsCheckingPlayer(true);
    setOrderError(null);
    setBackendWalletCheck(null);

    try {
      const res = await apiClient.checkPlayer(
        game.id,
        gameProfileInputs,
        pkg.region || 'Global'
      );
      setPlayerCheckResult(res);

      let activePkg = pkg;
      const officialRegion = res.detectedRegion || res.region;
      if (res.verified && officialRegion) {
        const regionPkgs = service.packages.filter(
          p => p.isActive && (p.region || '').toLowerCase() === officialRegion.toLowerCase()
        );
        if (regionPkgs.length > 0) {
          const matchingPkg = regionPkgs.find(p => p.amount === pkg.amount) || regionPkgs[0];
          activePkg = matchingPkg;
          setActiveServicePage({ game, service, pkg: matchingPkg });
        }
      }

      if (res.supported && !res.verified) {
        setOrderError(res.message || 'ID de jeu invalide ou introuvable.');
        return;
      }

      const token = safeStorage.getItem('playup_user_token') || undefined;
      if (token) {
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
            gameId: game.id,
            region: activePkg.region || officialRegion || 'Global',
            playerId: String(extractedPlayerId),
            serverId: extractedServerId ? String(extractedServerId) : undefined,
            quantity: 1,
            paymentMethod: 'wallet'
          },
          token
        );

        if (preVal.walletCheck) {
          setBackendWalletCheck(preVal.walletCheck);
        }
        if (!preVal.valid) {
          setOrderError(preVal.message || 'Validation refusée par le serveur.');
        }
      }
    } catch (err: any) {
      setOrderError(err.message || 'Erreur lors de la vérification de l’ID.');
    } finally {
      setIsCheckingPlayer(false);
    }
  };

  const handlePayAndSendOrder = async () => {
    if (!activeServicePage || isOrdering) return;
    const { game, service, pkg } = activeServicePage;
    const token = safeStorage.getItem('playup_user_token') || undefined;

    if (!authUser || !token) {
      onNavigate('account');
      return;
    }

    const requiresPlayer = pkg.requiresPlayerId !== false && game.requiresPlayerId !== false;
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
        setOrderError('Veuillez d’abord vérifier votre ID de jeu.');
        return;
      }
    }

    setIsOrdering(true);
    setOrderError(null);

    try {
      const productKeyToUse = pkg.productKey || pkg.externalProductId || '';
      const buyerRefToUse = `playup_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      const preVal = await apiClient.validateBeforePayment(
        {
          productKey: productKeyToUse || undefined,
          packageId: pkg.id,
          gameId: game.id,
          region: pkg.region || 'Global',
          playerId: String(extractedPlayerId),
          serverId: extractedServerId ? String(extractedServerId) : undefined,
          quantity: 1,
          paymentMethod: 'wallet'
        },
        token
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
          )} requis.`
        );
        return;
      }

      let order: Order;
      if (productKeyToUse && (pkg.providerSlug === 'rechargegames' || productKeyToUse.includes('/'))) {
        const rgRes = await apiClient.createRechargeGamesOrder(
          {
            userId: authUser.id,
            product_key: productKeyToUse,
            region: pkg.region || 'Global',
            player_id: String(extractedPlayerId),
            player_name: playerCheckResult?.verified ? playerCheckResult.playerName : undefined,
            server_id: extractedServerId,
            quantity: 1,
            buyer_ref: buyerRefToUse,
            paymentConfirmed: true,
            paymentMethod: 'wallet'
          },
          token
        );

        if (rgRes.user) {
          onAuthChange?.(rgRes.user);
          safeStorage.setItem('playup_user_profile', JSON.stringify(rgRes.user));
        }

        order = rgRes.playupOrder || {
          id: rgRes.order.id,
          orderNumber: rgRes.order.id,
          partnerOrderId: rgRes.order.buyer_ref,
          externalOrderId: rgRes.order.provider_order_id,
          source: 'mobile_app',
          userId: rgRes.order.user_id,
          gameId: game.id,
          gameName: rgRes.order.game,
          serviceId: service.id,
          serviceName: service.name,
          packageId: pkg.id,
          externalProductId: rgRes.order.product_key,
          packageName: getDiamondsLabel(pkg),
          playerId: rgRes.order.player_id,
          gameProfileData: { playerId: rgRes.order.player_id },
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
          statusHistory: []
        };
      } else {
        order = await apiClient.createMobileOrder(
          {
            gameId: game.id,
            serviceId: service.id,
            packageId: pkg.id,
            gameProfileData: gameProfileInputs,
            verifiedPlayerName: playerCheckResult?.verified ? playerCheckResult.playerName : undefined,
            paymentConfirmed: true,
            paymentMethod: 'wallet',
            userId: authUser.id,
            partnerOrderId: buyerRefToUse
          },
          token
        );

        const profileRes = await apiClient.getUserProfile(token).catch(() => null);
        if (profileRes?.user) {
          onAuthChange?.(profileRes.user);
          safeStorage.setItem('playup_user_profile', JSON.stringify(profileRes.user));
        }
      }

      setSubmittedOrder(order);
    } catch (err: any) {
      setOrderError(err.message || 'Erreur lors du paiement et de l’envoi de la demande.');
    } finally {
      setIsOrdering(false);
    }
  };

  // DEDICATED SERVICE PURCHASE PAGE VIEW
  if (activeServicePage) {
    const { game, pkg } = activeServicePage;
    const cardImg = getServiceCardImage(game);
    const diamondsLabel = getDiamondsLabel(pkg);
    const priceHtg =
      backendWalletCheck && backendWalletCheck.requiredAmountHtg > 0
        ? backendWalletCheck.requiredAmountHtg
        : getPackagePriceHtg(pkg);
    const requiresPlayer = pkg.requiresPlayerId !== false && game.requiresPlayerId !== false;
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
      <div className="max-w-lg mx-auto px-4 py-4 sm:py-8 space-y-4">
        {/* Top Back Navigation */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setActiveServicePage(null);
              setPlayerCheckResult(null);
              setBackendWalletCheck(null);
              setOrderError(null);
              setSubmittedOrder(null);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-orange-600 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Retour aux services</span>
          </button>

          {authUser && (
            <div className="px-3 py-1 bg-orange-50 border border-orange-200 rounded-xl text-xs font-bold text-orange-700 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" />
              <span>{formatHtg(userWalletHtg)}</span>
            </div>
          )}
        </div>

        {submittedOrder ? (
          /* IMMEDIATE ORDER STATUS DISPLAY AFTER SUBMISSION */
          <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 space-y-4 shadow-sm animate-in fade-in duration-150">
            <div className="text-center space-y-2">
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto ${
                  submittedOrder.status === 'completed'
                    ? 'bg-emerald-100 text-emerald-600'
                    : submittedOrder.status === 'failed'
                    ? 'bg-rose-100 text-rose-600'
                    : 'bg-orange-100 text-orange-600'
                }`}
              >
                {submittedOrder.status === 'completed' ? (
                  <CheckCircle2 className="w-7 h-7" />
                ) : submittedOrder.status === 'failed' ? (
                  <AlertCircle className="w-7 h-7" />
                ) : (
                  <Zap className="w-7 h-7" />
                )}
              </div>

              <h2 className="font-display text-xl font-extrabold text-slate-900">
                {submittedOrder.status === 'completed'
                  ? 'Top-up livré avec succès'
                  : submittedOrder.status === 'failed'
                  ? 'Échec de la commande'
                  : 'Demande envoyée • En cours de traitement'}
              </h2>
              <p className="text-xs font-mono font-bold text-orange-600">
                Commande #{submittedOrder.orderNumber}
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Service :</span>
                <span className="font-bold text-slate-900">{game.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Diamonds :</span>
                <span className="font-bold text-orange-600">{diamondsLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">ID Joueur :</span>
                <span className="font-mono font-bold text-slate-900">
                  {submittedOrder.playerId || Object.values(gameProfileInputs)[0]}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Statut :</span>
                <span className="font-bold uppercase text-emerald-700">{submittedOrder.status}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200">
                <span className="font-bold text-slate-900">Montant débité :</span>
                <span className="font-mono font-extrabold text-orange-600">{formatHtg(priceHtg)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setActiveServicePage(null);
                setSubmittedOrder(null);
              }}
              className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              Effectuer un nouvel achat
            </button>
          </div>
        ) : (
          <>
            {/* 1. SERVICE SÉLECTIONNÉ (Immediate Compact Card) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5 flex items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-3.5 min-w-0">
                <img
                  src={cardImg}
                  alt={diamondsLabel}
                  className="w-16 h-16 rounded-xl object-cover shrink-0 bg-slate-100 border border-slate-100"
                  referrerPolicy="no-referrer"
                />
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600 block truncate">
                    {game.name}
                  </span>
                  <h2 className="font-display text-lg font-extrabold text-slate-900 leading-tight truncate">
                    {diamondsLabel}
                  </h2>
                  <span className="font-mono text-base font-extrabold text-orange-600 block mt-0.5">
                    {formatHtg(priceHtg)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveServicePage(null)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold shrink-0 transition-colors cursor-pointer"
              >
                Changer
              </button>
            </div>

            {/* 2. SAISIE ET VÉRIFICATION DE L’ID DU JEU */}
            {requiresPlayer ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-tight">
                    Vérification de l’ID du jeu
                  </label>
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                    Étape 1 / 2
                  </span>
                </div>

                <div className="space-y-3">
                  {game.fields
                    .filter(f => !pkg.requiredFields?.length || pkg.requiredFields.includes(f.name))
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
                            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-orange-500"
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
                            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-orange-500"
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
                  className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {isCheckingPlayer ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-orange-400" />
                      <span>Vérification de l’ID en cours...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4 text-orange-400" />
                      <span>Vérifier l’ID</span>
                    </>
                  )}
                </button>

                {/* 3. RÉSULTAT DE LA VÉRIFICATION */}
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
                              Compte joueur confirmé
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
                          ID enregistré ({Object.values(gameProfileInputs)[0]}) — Prêt pour le paiement
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
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Aucun ID requis pour ce service. Livraison immédiate après paiement.</span>
              </div>
            )}

            {orderError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{orderError}</span>
              </div>
            )}

            {/* 4 & 5. RÉCAPITULATIF + VÉRIFICATION DU SOLDE WALLET + BOUTON PAYER ET ENVOYER LA DEMANDE */}
            {isIdVerified && (
              <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 space-y-4 border border-slate-800 shadow-sm animate-in fade-in duration-150">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-orange-400">
                    Paiement &amp; Envoi de la demande
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-bold">
                    ID Validé ✓
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Service sélectionné :</span>
                    <span className="font-bold text-white">{game.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Diamonds :</span>
                    <span className="font-bold text-orange-400">{diamondsLabel}</span>
                  </div>
                  {requiresPlayer && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">ID vérifié :</span>
                      <span className="font-mono font-bold text-emerald-400">
                        {gameProfileInputs.playerId ||
                          gameProfileInputs.userId ||
                          Object.values(gameProfileInputs)[0]}
                        {playerCheckResult?.playerName ? ` (${playerCheckResult.playerName})` : ''}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-slate-800 items-center">
                    <span className="font-bold text-white">Prix :</span>
                    <span className="font-mono text-lg font-extrabold text-orange-400">
                      {formatHtg(priceHtg)}
                    </span>
                  </div>
                </div>

                {!authUser ? (
                  <div className="p-3.5 bg-slate-800 border border-orange-500/40 rounded-xl space-y-2.5 text-xs">
                    <div className="font-bold text-orange-300">
                      Connexion requise pour payer avec votre Wallet
                    </div>
                    <p className="text-[11px] text-slate-300">
                      Connectez-vous à votre espace PlayUp pour vérifier votre solde Wallet et envoyer votre demande.
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigate('account')}
                      className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                    >
                      Se connecter / Créer un compte
                    </button>
                  </div>
                ) : !isWalletSufficient ? (
                  /* SOLDE INSUFFISANT */
                  <div className="p-4 bg-rose-950/60 border border-rose-500/50 rounded-xl space-y-3 text-xs">
                    <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>Solde insuffisant</span>
                    </div>

                    <div className="space-y-1.5 bg-slate-900/90 rounded-lg p-3 border border-rose-500/20">
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
                      onClick={() => onNavigate('account')}
                      className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
                    >
                      <Wallet className="w-4 h-4" />
                      <span>Recharger mon Wallet</span>
                    </button>
                  </div>
                ) : (
                  /* SOLDE SUFFISANT */
                  <div className="space-y-3">
                    <div className="p-2.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl flex items-center justify-between text-xs">
                      <span className="text-emerald-200 flex items-center gap-1.5">
                        <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Solde disponible :</span>
                      </span>
                      <span className="font-mono font-bold text-emerald-400">
                        {formatHtg(userWalletHtg)}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={isOrdering}
                      onClick={handlePayAndSendOrder}
                      className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isOrdering ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Paiement &amp; envoi en cours...</span>
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
          </>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="max-w-3xl">
        <span className="text-xs font-semibold uppercase tracking-wider text-orange-600">
          Services Gaming Officiels
        </span>
        <h1 className="font-display text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900 mt-1">
          {t.services.title}
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 mt-1.5 leading-relaxed">
          Sélectionnez un pack pour vérifier votre ID et recevoir vos Diamonds instantanément.
        </p>
      </div>

      {/* Game Filter Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        <button
          onClick={() => onSelectGame(null)}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
            selectedGame === null
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Tous les jeux ({games.length})
        </button>
        {games.map(game => (
          <button
            key={game.id}
            onClick={() => onSelectGame(game)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              selectedGame?.id === game.id
                ? 'bg-orange-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <span>{game.name}</span>
          </button>
        ))}
      </div>

      {/* Services List */}
      <div className="space-y-8">
        {displayedServices.map(service => {
          const game = games.find(g => g.id === service.gameId);
          const cardImg = getServiceCardImage(game);

          return (
            <div 
              key={service.id}
              className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 space-y-4 shadow-xs"
            >
              {/* Compact Service Header */}
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <img 
                    src={cardImg} 
                    alt={game?.name || service.name} 
                    className="w-12 h-12 rounded-2xl object-cover border border-slate-200 shadow-2xs"
                    referrerPolicy="no-referrer"
                  />
                  <div>
                    <h2 className="font-display text-base sm:text-xl font-bold text-slate-900">
                      {game?.name || service.name}
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Cliquez sur une carte pour ouvrir la page dédiée au service
                    </p>
                  </div>
                </div>
              </div>

              {/* Clean Uniform Service Cards: ONLY real image, Diamonds, and selling price in HTG */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {service.packages.filter(p => p.isActive).map(pkg => {
                  const diamondsText = getDiamondsLabel(pkg);
                  return (
                    <div
                      key={pkg.id}
                      onClick={() => handlePackageClick(service, pkg)}
                      className="group cursor-pointer rounded-2xl overflow-hidden border border-slate-200 hover:border-orange-500 hover:shadow-md bg-white transition-all flex flex-col justify-between active:scale-[0.99]"
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

                      <div className="p-3 sm:p-3.5 flex flex-col justify-between flex-1 space-y-1.5">
                        <div className="font-display text-sm sm:text-base font-extrabold text-slate-900 group-hover:text-orange-600 transition-colors leading-tight">
                          {diamondsText}
                        </div>

                        <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between">
                          <span className="font-mono text-xs sm:text-sm font-extrabold text-orange-600">
                            {formatHtg(getPackagePriceHtg(pkg))}
                          </span>
                          <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-orange-600 group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
