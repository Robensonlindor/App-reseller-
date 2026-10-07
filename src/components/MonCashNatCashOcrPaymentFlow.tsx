import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Copy,
  CheckCircle2,
  Clock,
  Upload,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Loader2,
  FileCheck,
  Lock,
  Sparkles,
  RefreshCw,
  ArrowRight,
  Eye,
  ShieldAlert,
  Wallet
} from 'lucide-react';
import { apiClient } from '../services/apiClient';
import {
  PLAYUP_OFFICIAL_PAYMENT_NUMBERS,
  PaymentRequestRecord,
  PaymentAuditLogEntry,
  AppUser
} from '../types';

interface MonCashNatCashOcrPaymentFlowProps {
  token: string;
  user: AppUser;
  purpose: 'service_order' | 'wallet_topup';
  initialMethod?: 'moncash' | 'natcash';
  packageId?: string;
  packageName?: string;
  gameId?: string;
  gameName?: string;
  serviceId?: string;
  serviceName?: string;
  playerId?: string;
  playerName?: string;
  serverId?: string;
  region?: string;
  gameProfileData?: Record<string, string>;
  expectedAmountUsd: number;
  onWalletCredited: (params: {
    newWalletBalance: number;
    paymentRequest: PaymentRequestRecord;
    verifiedTranscode: string;
  }) => void;
  onRedirectHome: (reason: string) => void;
  onCancel?: () => void;
  compact?: boolean;
}

export const MonCashNatCashOcrPaymentFlow: React.FC<MonCashNatCashOcrPaymentFlowProps> = ({
  token,
  user,
  purpose,
  initialMethod = 'moncash',
  packageId,
  packageName,
  gameId,
  gameName,
  serviceId,
  serviceName,
  playerId,
  playerName,
  serverId,
  region,
  gameProfileData,
  expectedAmountUsd,
  onWalletCredited,
  onRedirectHome,
  onCancel,
  compact = false
}) => {
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequestRecord | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<'moncash' | 'natcash'>(initialMethod);
  const [securityNonce, setSecurityNonce] = useState<{
    nonce: string;
    requestId: string;
    serverTimestamp: number;
  } | null>(null);

  const [loadingInit, setLoadingInit] = useState<boolean>(true);
  const [copyDetected, setCopyDetected] = useState<boolean>(false);
  const [copyingNow, setCopyingNow] = useState<boolean>(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(69);
  const [uploadingProof, setUploadingProof] = useState<boolean>(false);
  const [verifyingTranscode, setVerifyingTranscode] = useState<boolean>(false);
  const [generatingSampleReceipt, setGeneratingSampleReceipt] = useState<boolean>(false);

  const [enteredTranscode, setEnteredTranscode] = useState<string>('');
  const [sampleHelperHint, setSampleHelperHint] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [rejectionRedirectCountdown, setRejectionRedirectCountdown] = useState<number | null>(null);
  const [auditLogs, setAuditLogs] = useState<PaymentAuditLogEntry[]>([]);
  const [showSecurityAudit, setShowSecurityAudit] = useState<boolean>(false);
  const [runningSelfTest, setRunningSelfTest] = useState<boolean>(false);
  const [selfTestResult, setSelfTestResult] = useState<any | null>(null);

  // 2FA SMS / Email Blocking Verification State for Wallet Credit
  const [twoFactorChannel, setTwoFactorChannel] = useState<'sms' | 'email'>('email');
  const [twoFactorChallengeId, setTwoFactorChallengeId] = useState<string>('');
  const [twoFactorMaskedDest, setTwoFactorMaskedDest] = useState<string>('');
  const [twoFactorCodeInput, setTwoFactorCodeInput] = useState<string>('');
  const [twoFactorDemoCode, setTwoFactorDemoCode] = useState<string | null>(null);
  const [twoFactorVerificationToken, setTwoFactorVerificationToken] = useState<string>('');
  const [twoFactorVerified, setTwoFactorVerified] = useState<boolean>(false);
  const [sendingTwoFactor, setSendingTwoFactor] = useState<boolean>(false);
  const [verifyingTwoFactor, setVerifyingTwoFactor] = useState<boolean>(false);
  const [twoFactorStatusMsg, setTwoFactorStatusMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createIdempotencyKeyRef = useRef<string>(
    `idem_req_${user.id}_${purpose}_${packageId || expectedAmountUsd}`
  );
  const verifyIdempotencyKeyRef = useRef<string>('');

  const officialNumber = PLAYUP_OFFICIAL_PAYMENT_NUMBERS[selectedMethod];

  const refreshAuditLogs = useCallback(
    async (reqId: string) => {
      try {
        const res = await apiClient.getPaymentRequestById(token, reqId);
        if (res.auditLogs) {
          setAuditLogs(res.auditLogs);
        }
        if (res.securityToken) {
          setSecurityNonce(res.securityToken);
        }
      } catch {
        // ignore
      }
    },
    [token]
  );

  // Initialize or restore active persistent payment request on mount & when returning to tab
  const initOrRestoreRequest = useCallback(
    async (forceCreateNew = false) => {
      setLoadingInit(true);
      setErrorBanner(null);
      try {
        if (!forceCreateNew) {
          const activeRes = await apiClient.getActivePaymentRequest(token, {
            packageId,
            purpose
          });
          if (activeRes.activeRequest && activeRes.activeRequest.status === 'pending') {
            const req = activeRes.activeRequest;
            setPaymentRequest(req);
            setSelectedMethod(req.payment_method);
            setCopyDetected(Boolean(req.number_copied));
            setRemainingSeconds(
              typeof req.countdown_remaining_seconds === 'number'
                ? req.countdown_remaining_seconds
                : 69
            );
            if (activeRes.securityToken) {
              setSecurityNonce(activeRes.securityToken);
            }
            await refreshAuditLogs(req.id);
            setLoadingInit(false);
            return;
          }
        }

        const createKey = forceCreateNew
          ? `idem_new_${user.id}_${Date.now()}`
          : createIdempotencyKeyRef.current;

        const created = await apiClient.createOrResumePaymentRequest(token, {
          paymentMethod: selectedMethod,
          purpose,
          packageId,
          gameId,
          serviceId,
          playerId,
          playerName,
          serverId,
          region,
          gameProfileData,
          amountUsd: expectedAmountUsd,
          forceNew: forceCreateNew,
          idempotencyKey: createKey,
          clientTimestamp: Date.now()
        });

        const req = created.paymentRequest;
        setPaymentRequest(req);
        setSelectedMethod(req.payment_method);
        setCopyDetected(Boolean(req.number_copied));
        setRemainingSeconds(
          typeof req.countdown_remaining_seconds === 'number'
            ? req.countdown_remaining_seconds
            : 69
        );
        if (created.securityToken) {
          setSecurityNonce(created.securityToken);
        }
        await refreshAuditLogs(req.id);
      } catch (err: any) {
        setErrorBanner(err?.message || 'Erreur lors de la restauration de la session de paiement.');
      } finally {
        setLoadingInit(false);
      }
    },
    [
      token,
      user.id,
      purpose,
      packageId,
      gameId,
      serviceId,
      playerId,
      playerName,
      serverId,
      region,
      gameProfileData,
      expectedAmountUsd,
      selectedMethod,
      refreshAuditLogs
    ]
  );

  useEffect(() => {
    initOrRestoreRequest(false);
  }, [initOrRestoreRequest]);

  // Restore exact state when user leaves temporarily to pay on MonCash/NatCash and returns to browser
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && paymentRequest?.id) {
        try {
          const fresh = await apiClient.getPaymentRequestById(token, paymentRequest.id);
          if (fresh.paymentRequest) {
            setPaymentRequest(fresh.paymentRequest);
            setCopyDetected(Boolean(fresh.paymentRequest.number_copied));
            if (typeof fresh.paymentRequest.countdown_remaining_seconds === 'number') {
              setRemainingSeconds(fresh.paymentRequest.countdown_remaining_seconds);
            }
            if (fresh.securityToken) {
              setSecurityNonce(fresh.securityToken);
            }
            if (fresh.auditLogs) {
              setAuditLogs(fresh.auditLogs);
            }
          }
        } catch {
          // ignore transient offline error on return
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [token, paymentRequest?.id]);

  // Smooth 69-second -> 00 countdown without any page refresh
  useEffect(() => {
    if (!paymentRequest?.number_copied || !paymentRequest?.countdown_ends_at) {
      return;
    }
    const updateTimer = () => {
      const endsMs = new Date(paymentRequest.countdown_ends_at!).getTime();
      const diff = Math.max(0, Math.ceil((endsMs - Date.now()) / 1000));
      setRemainingSeconds(diff);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 250);
    return () => clearInterval(interval);
  }, [paymentRequest?.number_copied, paymentRequest?.countdown_ends_at]);

  // Automatic redirect to home page when a transaction is rejected by Anti-Fraud
  useEffect(() => {
    if (rejectionRedirectCountdown === null) return;
    if (rejectionRedirectCountdown <= 0) {
      onRedirectHome(
        errorBanner ||
          paymentRequest?.rejection_reason ||
          'Transaction rejetée par le système anti-fraude PlayUp.'
      );
      return;
    }
    const timer = setTimeout(() => {
      setRejectionRedirectCountdown(prev => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [rejectionRedirectCountdown, onRedirectHome, errorBanner, paymentRequest?.rejection_reason]);

  const handleSelectMethod = async (method: 'moncash' | 'natcash') => {
    if (!paymentRequest || paymentRequest.status !== 'pending') return;
    setSelectedMethod(method);
    setErrorBanner(null);
    try {
      const res = await apiClient.selectPaymentRequestMethod(token, paymentRequest.id, method);
      setPaymentRequest(res.paymentRequest);
      setCopyDetected(Boolean(res.paymentRequest.number_copied));
      setRemainingSeconds(res.paymentRequest.countdown_remaining_seconds ?? 69);
      if (res.securityToken) {
        setSecurityNonce(res.securityToken);
      }
      await refreshAuditLogs(res.paymentRequest.id);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Impossible de changer de méthode.');
    }
  };

  const handleCopyOfficialNumber = async () => {
    if (!paymentRequest || copyingNow) return;
    setCopyingNow(true);
    setErrorBanner(null);
    const numToCopy = PLAYUP_OFFICIAL_PAYMENT_NUMBERS[selectedMethod];

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(numToCopy);
      } else {
        const tempInput = document.createElement('input');
        tempInput.value = numToCopy;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
      }

      const res = await apiClient.confirmPaymentNumberCopied(token, paymentRequest.id, numToCopy);
      setPaymentRequest(res.paymentRequest);
      setCopyDetected(true);
      if (typeof res.paymentRequest.countdown_remaining_seconds === 'number') {
        setRemainingSeconds(res.paymentRequest.countdown_remaining_seconds);
      }
      if (res.securityToken) {
        setSecurityNonce(res.securityToken);
      }
      await refreshAuditLogs(res.paymentRequest.id);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Erreur lors de la copie du numéro officiel.');
    } finally {
      setCopyingNow(false);
    }
  };

  const processProofDataUrl = async (dataUrl: string, fileName: string) => {
    if (!paymentRequest || uploadingProof) return;
    setUploadingProof(true);
    setErrorBanner(null);
    try {
      // Compute deterministic idempotency key for this upload
      const uploadIdemKey = `idem_proof_${paymentRequest.id}_${fileName.replace(/\W+/g, '_')}_${dataUrl.length}`;
      const res = await apiClient.uploadPaymentProofScreenshot(token, paymentRequest.id, {
        imageDataUrl: dataUrl,
        fileName,
        idempotencyKey: uploadIdemKey,
        requestId: securityNonce?.requestId,
        nonce: securityNonce?.nonce,
        clientTimestamp: Date.now()
      });

      setPaymentRequest(res.paymentRequest);
      setEnteredTranscode('');
      verifyIdempotencyKeyRef.current = '';
      if (res.securityToken) {
        setSecurityNonce(res.securityToken);
      }
      await refreshAuditLogs(res.paymentRequest.id);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Erreur lors de l’analyse OCR de la preuve de paiement.');
    } finally {
      setUploadingProof(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        processProofDataUrl(reader.result, file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateAndAnalyzeRealReceipt = async (
    scenario: 'valid' | 'wrong_amount' | 'wrong_method' = 'valid'
  ) => {
    if (!paymentRequest || generatingSampleReceipt || uploadingProof) return;
    setGeneratingSampleReceipt(true);
    setErrorBanner(null);
    setSampleHelperHint(null);
    try {
      const sample = await apiClient.generateSamplePaymentReceiptImage(token, paymentRequest.id, {
        scenario
      });
      setSampleHelperHint(
        `Reçu ${selectedMethod.toUpperCase()} généré — Transcode figurant sur l'image : ${sample.sampleTranscodeForUserEntry} (${sample.transcodeLength} chiffres)`
      );
      await processProofDataUrl(sample.imageDataUrl, `recu_${selectedMethod}_${Date.now()}.png`);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Erreur lors de la génération de la capture.');
    } finally {
      setGeneratingSampleReceipt(false);
    }
  };

  const detectedLength = paymentRequest?.detected_transcode_length || 14;
  const transcodeDetectedByOcr = Boolean(paymentRequest?.ocr_extraction?.transcodeDetected);
  const isExactLengthEntered =
    transcodeDetectedByOcr && enteredTranscode.trim().length === detectedLength;

  const handleRequest2FAChallenge = async (channelOverride?: 'sms' | 'email') => {
    if (!paymentRequest || sendingTwoFactor) return;
    const targetChannel = channelOverride || twoFactorChannel;
    setSendingTwoFactor(true);
    setErrorBanner(null);
    setTwoFactorStatusMsg(null);
    try {
      const res = await apiClient.requestWallet2FAChallenge(token, {
        operationType: 'wallet_credit',
        channel: targetChannel,
        paymentRequestId: paymentRequest.id,
        amount: paymentRequest.expected_amount,
        currency: paymentRequest.currency || 'USD'
      });
      setTwoFactorChallengeId(res.challengeId);
      setTwoFactorMaskedDest(res.maskedDestination);
      setTwoFactorDemoCode(res.demoCode || null);
      setTwoFactorVerificationToken('');
      setTwoFactorVerified(false);
      setTwoFactorCodeInput('');
      setTwoFactorStatusMsg(
        `Code 2FA à 6 chiffres envoyé par ${targetChannel.toUpperCase()} à ${res.maskedDestination}.`
      );
      await refreshAuditLogs(paymentRequest.id);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Impossible d’envoyer le code 2FA SMS/Email.');
    } finally {
      setSendingTwoFactor(false);
    }
  };

  const handleVerify2FACode = async () => {
    if (!paymentRequest || !twoFactorChallengeId || twoFactorCodeInput.trim().length !== 6 || verifyingTwoFactor) {
      return;
    }
    setVerifyingTwoFactor(true);
    setErrorBanner(null);
    try {
      const res = await apiClient.verifyWallet2FAChallenge(token, {
        challengeId: twoFactorChallengeId,
        code: twoFactorCodeInput.trim()
      });
      await refreshAuditLogs(paymentRequest.id);
      if (!res.verified || !res.verificationToken) {
        setTwoFactorVerified(false);
        setTwoFactorVerificationToken('');
        setErrorBanner(res.message || 'Étape bloquante : code 2FA invalide.');
        return;
      }
      setTwoFactorVerified(true);
      setTwoFactorVerificationToken(res.verificationToken);
      setTwoFactorStatusMsg(res.message);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Erreur lors de la vérification du code 2FA.');
    } finally {
      setVerifyingTwoFactor(false);
    }
  };

  const handleVerifyTransaction = async () => {
    if (!paymentRequest || !isExactLengthEntered || verifyingTranscode) return;
    setVerifyingTranscode(true);
    setErrorBanner(null);

    try {
      const cleanCode = enteredTranscode.trim();
      // Bind idempotency key to (requestId + cleanCode) so network retries or double-clicks send the SAME key
      if (!verifyIdempotencyKeyRef.current) {
        verifyIdempotencyKeyRef.current = `idem_verify_${paymentRequest.id}_${cleanCode}`;
      }

      const res = await apiClient.verifyPaymentTranscodeAndCredit(token, paymentRequest.id, {
        enteredTranscode: cleanCode,
        idempotencyKey: verifyIdempotencyKeyRef.current,
        requestId: securityNonce?.requestId,
        nonce: securityNonce?.nonce,
        clientTimestamp: Date.now(),
        twoFactorVerificationToken: twoFactorVerificationToken || undefined,
        twoFactorChallengeId: twoFactorChallengeId || undefined,
        twoFactorCode: twoFactorCodeInput.trim() || undefined
      });

      if (res.paymentRequest) {
        setPaymentRequest(res.paymentRequest);
      }
      await refreshAuditLogs(paymentRequest.id);

      if (res.twoFactorBlocked || res.twoFactorRequired) {
        setErrorBanner(
          res.message ||
            'Étape 2FA bloquante : veuillez valider le code 2FA reçu par SMS ou Email avant de créditer le PlayUp Wallet.'
        );
        return;
      }

      if (res.status === 'credited' && res.credited) {
        onWalletCredited({
          newWalletBalance: res.walletBalance,
          paymentRequest: res.paymentRequest,
          verifiedTranscode: cleanCode
        });
      } else if (res.status === 'rejected' || res.redirectToHome) {
        setErrorBanner(
          res.message ||
            'Le Transcode ou la preuve envoyée est invalide ou déjà utilisé. Redirection vers l’accueil...'
        );
        setRejectionRedirectCountdown(4);
      } else if (res.status === 'manual_review') {
        setErrorBanner(res.message);
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Erreur lors de la vérification du paiement.');
    } finally {
      setVerifyingTranscode(false);
    }
  };

  const handleRunConcurrencyTest = async () => {
    if (runningSelfTest) return;
    setRunningSelfTest(true);
    try {
      const res = await apiClient.runPaymentConcurrencyAndReplaySelfTest(token, 25);
      setSelfTestResult(res);
      if (paymentRequest?.id) {
        await refreshAuditLogs(paymentRequest.id);
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Erreur lors du test de concurrence.');
    } finally {
      setRunningSelfTest(false);
    }
  };

  if (loadingInit) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 text-center">
        <Loader2 className="w-7 h-7 text-indigo-400 animate-spin mx-auto mb-2" />
        <p className="text-xs font-semibold text-slate-300">
          Synchronisation sécurisée de votre demande de paiement PlayUp...
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/95 p-4 sm:p-5 space-y-4 text-left shadow-2xl">
      {/* Header Banner */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Paiement Sécurisé OCR & Anti-Fraude
            </span>
          </div>
          <h4 className="text-sm sm:text-base font-bold text-white mt-0.5">
            {packageName || 'Recharge PlayUp Wallet'} — $
            {Number(paymentRequest?.expected_amount || expectedAmountUsd).toFixed(2)} USD (
            {paymentRequest?.expected_amount_htg || Math.round(expectedAmountUsd * 135)} HTG)
          </h4>
        </div>
        {paymentRequest && (
          <span
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase border ${
              paymentRequest.status === 'credited'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                : paymentRequest.status === 'rejected'
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                : paymentRequest.status === 'manual_review'
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
            }`}
          >
            {paymentRequest.status}
          </span>
        )}
      </div>

      {/* Persistent Session Notice */}
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 px-3 py-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <span>
          Demande persistante <strong className="text-slate-200">#{paymentRequest?.id.slice(0, 14)}</strong> — Vous pouvez quitter temporairement le site pour payer sur MonCash/NatCash et revenir sans rien perdre.
        </span>
        <Lock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
      </div>

      {/* Step 1: Select MonCash or NatCash & Copy Official Number */}
      {paymentRequest?.status === 'pending' && (
        <div className="space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
            1. Choisissez votre méthode de paiement officielle
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => handleSelectMethod('moncash')}
              className={`p-3 rounded-xl border text-left transition-all ${
                selectedMethod === 'moncash'
                  ? 'border-rose-500 bg-rose-500/15 text-white shadow-lg shadow-rose-500/10'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-rose-400">
                  MonCash (Digicel)
                </span>
                {selectedMethod === 'moncash' && <CheckCircle2 className="w-4 h-4 text-rose-400" />}
              </div>
              <div className="text-sm font-mono font-bold text-white mt-1">
                {PLAYUP_OFFICIAL_PAYMENT_NUMBERS.moncash}
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleSelectMethod('natcash')}
              className={`p-3 rounded-xl border text-left transition-all ${
                selectedMethod === 'natcash'
                  ? 'border-sky-500 bg-sky-500/15 text-white shadow-lg shadow-sky-500/10'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-sky-400">
                  NatCash (Natcom)
                </span>
                {selectedMethod === 'natcash' && <CheckCircle2 className="w-4 h-4 text-sky-400" />}
              </div>
              <div className="text-sm font-mono font-bold text-white mt-1">
                {PLAYUP_OFFICIAL_PAYMENT_NUMBERS.natcash}
              </div>
            </button>
          </div>

          {/* Official Number Box + Mandatory Copy Detection */}
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold text-indigo-300">
                Numéro officiel {selectedMethod === 'moncash' ? 'MonCash' : 'NatCash'} PlayUp à payer :
              </div>
              <div className="text-lg font-mono font-extrabold text-white tracking-wide mt-0.5">
                {officialNumber}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Montant exact attendu :{' '}
                <strong className="text-emerald-400">
                  ${Number(paymentRequest.expected_amount).toFixed(2)} USD ({paymentRequest.expected_amount_htg} HTG)
                </strong>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCopyOfficialNumber}
              disabled={copyingNow}
              className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shrink-0 ${
                copyDetected
                  ? 'bg-emerald-600/20 border border-emerald-500/50 text-emerald-300'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30'
              }`}
            >
              {copyingNow ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : copyDetected ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              <span>{copyDetected ? 'Numéro copié ✓' : 'Copier le numéro'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 2: 69-Second Visible Countdown (Only unlocked after number is copied) */}
      {paymentRequest?.status === 'pending' && !copyDetected && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            Cliquez sur <strong>« Copier le numéro »</strong> ci-dessus pour détecter automatiquement la copie et déverrouiller la suite du paiement.
          </span>
        </div>
      )}

      {paymentRequest?.status === 'pending' && copyDetected && (
        <div className="space-y-4">
          {/* 69s -> 00 Countdown Banner */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
                <Clock className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">
                  2. Effectuez votre transfert {selectedMethod === 'moncash' ? 'MonCash' : 'NatCash'} vers{' '}
                  <span className="font-mono text-indigo-300">{officialNumber}</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Compte à rebours de vérification sans rafraîchissement de page (persistant côté serveur)
                </div>
              </div>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-slate-950 border border-indigo-500/40 text-center min-w-[76px]">
              <div className="text-lg font-mono font-extrabold text-indigo-400">
                {String(remainingSeconds).padStart(2, '0')}s
              </div>
              <div className="text-[9px] uppercase tracking-wider text-slate-500">sur 69s</div>
            </div>
          </div>

          {/* Step 3 & 4: Upload Screenshot Proof for Automatic Backend OCR */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <Upload className="w-4 h-4 text-indigo-400" />
                3. Envoyer la preuve de paiement (Capture d’écran)
              </label>
              {paymentRequest.proof_uploaded && (
                <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                  <FileCheck className="w-3.5 h-3.5" /> Preuve analysée par OCR
                </span>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingProof}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 transition-all"
              >
                {uploadingProof ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                <span>
                  {uploadingProof
                    ? 'Analyse OCR & Forensique en cours...'
                    : paymentRequest.proof_uploaded
                    ? 'Remplacer la capture d’écran'
                    : 'Importer ma capture d’écran'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleGenerateAndAnalyzeRealReceipt('valid')}
                disabled={uploadingProof || generatingSampleReceipt}
                className="px-3 py-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 text-emerald-300 font-semibold text-xs flex items-center gap-1.5 transition-all"
              >
                {generatingSampleReceipt ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>Générer & tester un reçu {selectedMethod.toUpperCase()} réel (OCR)</span>
              </button>
            </div>

            {sampleHelperHint && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2.5 text-xs text-emerald-300 font-mono">
                {sampleHelperHint}
              </div>
            )}

            {/* OCR Extraction Results Summary */}
            {paymentRequest.proof_uploaded && paymentRequest.ocr_extraction && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300">
                    Résultat de l’extraction OCR Backend ({paymentRequest.ocr_extraction.engineUsed})
                  </span>
                  <span className="text-[11px] font-mono text-indigo-400">
                    Confiance : {paymentRequest.ocr_extraction.confidence}%
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-slate-500">Transcode détecté</div>
                    <div className="font-bold text-white mt-0.5">
                      {paymentRequest.ocr_extraction.transcodeDetected
                        ? `Oui (${detectedLength} chiffres)`
                        : 'Non détecté'}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-slate-500">Montant lu</div>
                    <div className="font-bold text-white mt-0.5">
                      {paymentRequest.ocr_extraction.detectedAmount !== null
                        ? `${paymentRequest.ocr_extraction.detectedAmount} ${paymentRequest.ocr_extraction.detectedCurrency || 'USD'}`
                        : 'Illisible'}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-slate-500">Méthode détectée</div>
                    <div className="font-bold uppercase text-white mt-0.5">
                      {paymentRequest.ocr_extraction.detectedMethod}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-slate-500">Empreinte SHA-256</div>
                    <div className="font-mono text-slate-300 mt-0.5">
                      {paymentRequest.proof_hash?.slice(0, 10)}...
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Step 5 & 6: Enter Transcode (strictly limited to detected length) & Verify Transaction */}
          {paymentRequest.proof_uploaded && (
            <div className="rounded-xl border border-indigo-500/30 bg-slate-900/90 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-white">
                  4. Mettre le transcode
                </label>
                <span className="text-xs font-mono font-bold text-indigo-400">
                  {enteredTranscode.trim().length} / {detectedLength} caractères requis
                </span>
              </div>

              <input
                type="text"
                value={enteredTranscode}
                maxLength={detectedLength}
                onChange={e => {
                  const val = e.target.value.replace(/\s+/g, '').slice(0, detectedLength);
                  setEnteredTranscode(val);
                  // Reset verify idempotency key when transcode input changes
                  verifyIdempotencyKeyRef.current = `idem_verify_${paymentRequest.id}_${val}`;
                }}
                placeholder={`Saisissez les ${detectedLength} caractères du Transcode (ex: 26100413555244)`}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-indigo-500 text-white font-mono text-sm outline-none"
              />

              <p className="text-[11px] text-slate-400">
                Le système compare cryptographiquement le Transcode saisi avec celui extrait par OCR dans votre capture, vérifie son unicité et contrôle le montant avant de créditer votre PlayUp Wallet.
              </p>

              {/* Step 5: Mandatory Blocking 2FA Verification (SMS or Email) */}
              <div className="rounded-xl border border-indigo-500/40 bg-slate-950/90 p-3.5 space-y-3 mt-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-white">
                      5. Vérification 2FA Bloquante (SMS ou Email)
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                      twoFactorVerified
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                        : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    {twoFactorVerified ? '2FA Vérifié Côté Backend' : 'Étape Bloquante Requise'}
                  </span>
                </div>

                <p className="text-[11px] text-slate-400">
                  Tout crédit PlayUp Wallet exige une validation 2FA à 6 chiffres par SMS ou Email. Si la vérification 2FA échoue côté backend, la transaction est immédiatement bloquée.
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTwoFactorChannel('email')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      twoFactorChannel === 'email'
                        ? 'border-indigo-500 bg-indigo-600/25 text-white'
                        : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Par Email ({user.email})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTwoFactorChannel('sms')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      twoFactorChannel === 'sms'
                        ? 'border-indigo-500 bg-indigo-600/25 text-white'
                        : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Par SMS ({user.phone || '+509 37 00 0000'})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRequest2FAChallenge(twoFactorChannel)}
                    disabled={sendingTwoFactor}
                    className="ml-auto px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    {sendingTwoFactor ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Envoi 2FA...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>
                          {twoFactorChallengeId ? 'Renvoyer le code 2FA' : 'Envoyer le code 2FA'}
                        </span>
                      </>
                    )}
                  </button>
                </div>

                {twoFactorStatusMsg && (
                  <div className="text-[11px] text-indigo-200 bg-indigo-500/10 border border-indigo-500/30 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <span>{twoFactorStatusMsg}</span>
                    {twoFactorDemoCode && (
                      <button
                        type="button"
                        onClick={() => setTwoFactorCodeInput(twoFactorDemoCode)}
                        className="font-mono font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded hover:bg-emerald-500/25"
                      >
                        Code reçu : {twoFactorDemoCode} (Cliquer pour remplir)
                      </button>
                    )}
                  </div>
                )}

                {twoFactorChallengeId && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      maxLength={6}
                      value={twoFactorCodeInput}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setTwoFactorCodeInput(val);
                        setTwoFactorVerified(false);
                        setTwoFactorVerificationToken('');
                      }}
                      placeholder={`Code 2FA à 6 chiffres (${twoFactorMaskedDest})`}
                      className="flex-1 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 focus:border-indigo-500 text-white font-mono text-sm tracking-widest outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleVerify2FACode}
                      disabled={twoFactorCodeInput.trim().length !== 6 || verifyingTwoFactor || twoFactorVerified}
                      className={`px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                        twoFactorVerified
                          ? 'bg-emerald-600/25 border border-emerald-500/40 text-emerald-300'
                          : twoFactorCodeInput.trim().length === 6 && !verifyingTwoFactor
                          ? 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer'
                          : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      {verifyingTwoFactor ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      <span>{twoFactorVerified ? 'Code 2FA Validé' : 'Vérifier 2FA'}</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={!isExactLengthEntered || verifyingTranscode}
                onClick={handleVerifyTransaction}
                className={`w-full py-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                  isExactLengthEntered && !verifyingTranscode
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 cursor-pointer'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                {verifyingTranscode ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Vérification 2FA, Anti-Fraude & Verrouillage Atomique...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Vérifier la transaction & Créditer (2FA requis)</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Terminal State: CREDITED */}
      {paymentRequest?.status === 'credited' && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <CheckCircle2 className="w-5 h-5" />
            <span>
              Paiement validé & PlayUp Wallet crédité (+$
              {Number(paymentRequest.expected_amount).toFixed(2)} USD) !
            </span>
          </div>
          <p className="text-xs text-slate-300">
            Transcode vérifié : <strong className="font-mono text-white">{paymentRequest.transcode}</strong> ·
            Transaction verrouillée dans l’état irréversible <strong className="text-emerald-300">credited</strong>.
          </p>
        </div>
      )}

      {/* Terminal State: MANUAL_REVIEW */}
      {paymentRequest?.status === 'manual_review' && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>Transaction placée en révision manuelle (« manual_review »)</span>
          </div>
          <p className="text-xs text-slate-300">
            {paymentRequest.rejection_reason ||
              'Votre preuve présente une incertitude OCR ou une anomalie visuelle. Aucun crédit automatique n’a été effectué ; un administrateur PlayUp vérifiera votre preuve.'}
          </p>
        </div>
      )}

      {/* Terminal State: REJECTED */}
      {(paymentRequest?.status === 'rejected' || errorBanner) && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
            <XCircle className="w-5 h-5 shrink-0" />
            <span>
              {paymentRequest?.status === 'rejected'
                ? 'Preuve rejetée par le système Anti-Fraude (Aucun crédit effectué)'
                : 'Alerte de vérification'}
            </span>
          </div>
          <p className="text-xs text-rose-200">
            {errorBanner || paymentRequest?.rejection_reason}
          </p>
          {rejectionRedirectCountdown !== null && (
            <div className="text-xs font-bold text-rose-300 flex items-center gap-2 pt-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>
                Redirection automatique vers la page d’accueil dans {rejectionRedirectCountdown}s...
              </span>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Backend Anti-Replay, Idempotency & Audit Log Inspector */}
      <div className="pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowSecurityAudit(prev => !prev)}
            className="text-[11px] font-semibold text-slate-400 hover:text-indigo-300 flex items-center gap-1.5"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>
              {showSecurityAudit
                ? 'Masquer le journal d’audit immuable & test de concurrence'
                : `Afficher l’audit de sécurité (${auditLogs.length} événements) & test 25x requêtes simultanées`}
            </span>
          </button>

          {onCancel && paymentRequest?.status === 'pending' && (
            <button
              type="button"
              onClick={onCancel}
              className="text-[11px] text-slate-500 hover:text-slate-300"
            >
              Fermer
            </button>
          )}
        </div>

        {showSecurityAudit && (
          <div className="mt-3 space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-indigo-400" />
                <span>Protection Anti-Replay, Idempotence & Verrou Atomique</span>
              </div>
              <button
                type="button"
                onClick={handleRunConcurrencyTest}
                disabled={runningSelfTest}
                className="px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 hover:bg-indigo-600/30 text-indigo-300 text-[11px] font-bold flex items-center gap-1.5"
              >
                {runningSelfTest ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>Tester 25 requêtes identiques simultanées + Anti-Replay</span>
              </button>
            </div>

            {selfTestResult && (
              <div
                className={`p-2.5 rounded-lg border text-[11px] space-y-1 ${
                  selfTestResult.allPassed
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                }`}
              >
                <div className="font-bold">
                  {selfTestResult.allPassed
                    ? '✓ Test de Concurrence (25 appels simultanés) & Anti-Replay : 100% RÉUSSI'
                    : 'Anomalie détectée'}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[10px] text-slate-300">
                  <div>
                    Requêtes simultanées : <strong>{selfTestResult.summary.concurrentRequestsSent}</strong>
                  </div>
                  <div>
                    Demandes créées : <strong>{selfTestResult.summary.uniquePaymentRequestsCreated}</strong>
                  </div>
                  <div>
                    Crédits Wallet exécutés : <strong>{selfTestResult.summary.timesWalletCredited} (1 max)</strong>
                  </div>
                  <div>
                    Replay expiré bloqué : <strong>HTTP {selfTestResult.summary.expiredReplayBlockedStatus}</strong>
                  </div>
                  <div>
                    Réutilisation clé bloquée : <strong>HTTP {selfTestResult.summary.idempotencyKeyMismatchBlockedStatus}</strong>
                  </div>
                  <div>
                    État irréversible verrouillé :{' '}
                    <strong>{selfTestResult.summary.irreversibleStateProtected ? 'OUI' : 'NON'}</strong>
                  </div>
                </div>
              </div>
            )}

            <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
              {auditLogs.map(log => (
                <div
                  key={log.id}
                  className="p-2 rounded-lg bg-slate-950 border border-slate-800/80 text-[10px] flex items-start justify-between gap-2"
                >
                  <div>
                    <span className="font-mono font-bold text-indigo-400">[{log.event_type}]</span>{' '}
                    <span className="text-slate-300">{log.summary}</span>
                  </div>
                  <span className="font-mono text-slate-500 shrink-0">
                    #{log.immutable_hash.slice(0, 8)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
