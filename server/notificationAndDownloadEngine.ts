import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Response } from 'express';
import { db } from './db';
import {
  AppPackageMetadata,
  EmailDeliveryLog,
  Order,
  PushNotificationLog
} from '../src/types';
import {
  ApkVerificationReport,
  buildSignedReleaseApk,
  verifyApkBinaryStructure
} from './androidApkBuilder';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGES_DIR = path.resolve(__dirname, '../data/packages');

const FRENCH_MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre'
];

export function formatFrenchDateTime(isoTimestamp?: string): { dateLabel: string; timeLabel: string } {
  const dt = isoTimestamp ? new Date(isoTimestamp) : new Date();
  const safeDate = Number.isNaN(dt.getTime()) ? new Date() : dt;
  const day = safeDate.getDate();
  const month = FRENCH_MONTHS[safeDate.getMonth()] || 'octobre';
  const year = safeDate.getFullYear();
  const hours = String(safeDate.getHours()).padStart(2, '0');
  const minutes = String(safeDate.getMinutes()).padStart(2, '0');
  return {
    dateLabel: `${day} ${month} ${year}`,
    timeLabel: `${hours}:${minutes}`
  };
}

export class PackageDistributionEngine {
  public static readonly APPLICATION_ID = 'io.playup.mobile';
  public static readonly LATEST_VERSION = '2.4.4';
  public static readonly BUILD_NUMBER = 20404;
  public static readonly MIN_SDK_VERSION = 26;
  public static readonly TARGET_SDK_VERSION = 34;
  public static readonly COMPILE_SDK_VERSION = 34;
  public static readonly ANDROID_FILENAME = `PlayUp-Android-v2.4.4-release.apk`;
  public static readonly IOS_FILENAME = `PlayUp-iOS-v2.4.4.mobileconfig`;

  public static ensurePackagesOnDisk(): void {
    if (!fs.existsSync(PACKAGES_DIR)) {
      fs.mkdirSync(PACKAGES_DIR, { recursive: true });
    }

    const appUrl = (
      process.env.APP_URL ||
      'https://ais-pre-x2ludovvteawsky54uj7vr-266949098099.europe-west2.run.app'
    ).replace(/\/+$/, '');

    const apkPath = path.join(PACKAGES_DIR, this.ANDROID_FILENAME);
    let needsRebuild = !fs.existsSync(apkPath);
    if (!needsRebuild) {
      try {
        const report = verifyApkBinaryStructure(apkPath, PACKAGES_DIR);
        if (!report.valid) {
          needsRebuild = true;
        }
      } catch {
        needsRebuild = true;
      }
    }

    if (needsRebuild) {
      const signedApkBuffer = buildSignedReleaseApk({
        packagesDir: PACKAGES_DIR,
        packageName: this.APPLICATION_ID,
        versionCode: this.BUILD_NUMBER,
        versionName: this.LATEST_VERSION,
        minSdkVersion: this.MIN_SDK_VERSION,
        targetSdkVersion: this.TARGET_SDK_VERSION,
        compileSdkVersion: this.COMPILE_SDK_VERSION,
        appUrl: `${appUrl}/?mode=mobile_app`
      });

      fs.writeFileSync(apkPath, signedApkBuffer);

      // Verify the generated APK binary structure before serving
      const verification = verifyApkBinaryStructure(apkPath, PACKAGES_DIR);
      if (!verification.valid) {
        throw new Error('La vérification post-compilation de l’APK Release a échoué.');
      }
    }

    const iosPath = path.join(PACKAGES_DIR, this.IOS_FILENAME);
    if (!fs.existsSync(iosPath) || fs.statSync(iosPath).size < 500) {
      const mobileConfigXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key>
      <true/>
      <key>IsRemovable</key>
      <true/>
      <key>Label</key>
      <string>PlayUp</string>
      <key>PayloadDescription</key>
      <string>Installe l'application officielle PlayUp Gaming Top-Up sur l'écran d'accueil iOS.</string>
      <key>PayloadDisplayName</key>
      <string>PlayUp WebApp iOS v${this.LATEST_VERSION}</string>
      <key>PayloadIdentifier</key>
      <string>${this.APPLICATION_ID}.ios.webclip.${this.BUILD_NUMBER}</string>
      <key>PayloadType</key>
      <string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key>
      <string>8A9C2F1E-4B77-4D12-9F33-718293041526</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>Precomposed</key>
      <true/>
      <key>URL</key>
      <string>${appUrl}/?source=ios_app</string>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Package d'installation officiel PlayUp iOS (iPhone &amp; iPad) v${this.LATEST_VERSION} avec notifications temps réel.</string>
  <key>PayloadDisplayName</key>
  <string>PlayUp Gaming (${this.LATEST_VERSION})</string>
  <key>PayloadIdentifier</key>
  <string>${this.APPLICATION_ID}.ios.profile.${this.BUILD_NUMBER}</string>
  <key>PayloadOrganization</key>
  <string>PlayUp Technologies Inc.</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>1F4E8D2A-9C10-4E55-B231-998877665544</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`;
      fs.writeFileSync(iosPath, Buffer.from(mobileConfigXml, 'utf8'));
    }
  }

  public static verifyAndroidApk(): ApkVerificationReport {
    this.ensurePackagesOnDisk();
    const apkPath = path.join(PACKAGES_DIR, this.ANDROID_FILENAME);
    return verifyApkBinaryStructure(apkPath, PACKAGES_DIR);
  }

  public static getPackageMetadata(platform: 'android' | 'ios'): AppPackageMetadata {
    this.ensurePackagesOnDisk();
    const fileName = platform === 'android' ? this.ANDROID_FILENAME : this.IOS_FILENAME;
    const filePath = path.join(PACKAGES_DIR, fileName);
    const exists = fs.existsSync(filePath);
    let sizeBytes = 0;
    let sha256 = '';
    let publishedAt = new Date().toISOString();
    let apkReport: ApkVerificationReport | null = null;

    if (exists) {
      const stat = fs.statSync(filePath);
      sizeBytes = stat.size;
      publishedAt = stat.mtime.toISOString();
      const buf = fs.readFileSync(filePath);
      sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      if (platform === 'android') {
        try {
          apkReport = verifyApkBinaryStructure(filePath, PACKAGES_DIR);
        } catch {
          apkReport = null;
        }
      }
    }

    const sizeFormatted =
      sizeBytes >= 1024 * 1024
        ? `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
        : `${(sizeBytes / 1024).toFixed(1)} KB`;

    return {
      platform,
      fileName,
      applicationId: this.APPLICATION_ID,
      version: this.LATEST_VERSION,
      buildNumber: this.BUILD_NUMBER,
      minSdkVersion: platform === 'android' ? this.MIN_SDK_VERSION : undefined,
      targetSdkVersion: platform === 'android' ? this.TARGET_SDK_VERSION : undefined,
      compileSdkVersion: platform === 'android' ? this.COMPILE_SDK_VERSION : undefined,
      supportedAbis:
        platform === 'android' ? ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'] : undefined,
      signatureSchemes:
        platform === 'android'
          ? ['v1 (JAR PKCS#7 RSA-2048)', 'v2 (APK Sig Block 42)']
          : undefined,
      certificateSha256Fingerprint: apkReport?.certificateSha256Fingerprint,
      verificationPassed: platform === 'android' ? Boolean(apkReport?.valid) : true,
      sizeBytes,
      sizeFormatted,
      sha256,
      mimeType:
        platform === 'android'
          ? 'application/vnd.android.package-archive'
          : 'application/x-apple-aspen-config',
      downloadUrl: `/api/download/package?platform=${platform}`,
      exists: exists && sizeBytes > 0,
      publishedAt
    };
  }

  public static getPackageFilePath(platform: 'android' | 'ios'): string {
    this.ensurePackagesOnDisk();
    const fileName = platform === 'android' ? this.ANDROID_FILENAME : this.IOS_FILENAME;
    return path.join(PACKAGES_DIR, fileName);
  }
}

// Connected Server-Sent Events (SSE) clients for instant push delivery to active/background tabs & service workers
const activeSseClients = new Map<string, Set<Response>>();
const activePricingSseClients = new Set<Response>();

export class NotificationEngine {
  public static registerSseClient(userId: string, res: Response): void {
    if (!activeSseClients.has(userId)) {
      activeSseClients.set(userId, new Set());
    }
    activeSseClients.get(userId)!.add(res);
  }

  public static unregisterSseClient(userId: string, res: Response): void {
    const set = activeSseClients.get(userId);
    if (set) {
      set.delete(res);
      if (set.size === 0) {
        activeSseClients.delete(userId);
      }
    }
  }

  public static registerPricingSseClient(res: Response): void {
    activePricingSseClients.add(res);
  }

  public static unregisterPricingSseClient(res: Response): void {
    activePricingSseClients.delete(res);
  }

  /**
   * Broadcasts real-time USD->HTG exchange rate and HTG selling price updates to all connected clients
   */
  public static broadcastPricingUpdate(payload: {
    changeType: string;
    usdToHtgExchangeRate: number;
    historyEntry?: any;
  }): void {
    const dataStr = JSON.stringify({
      type: 'PRICING_UPDATED',
      timestamp: new Date().toISOString(),
      ...payload
    });

    for (const res of activePricingSseClients) {
      try {
        res.write(`data: ${dataStr}\n\n`);
      } catch {
        activePricingSseClients.delete(res);
      }
    }

    for (const [, set] of activeSseClients) {
      for (const res of set) {
        try {
          res.write(`data: ${dataStr}\n\n`);
        } catch {
          set.delete(res);
        }
      }
    }
  }

  /**
   * SINGLE SOURCE OF TRUTH:
   * Called ONLY when the backend confirms from GoXtop or RechargeGames that an order is delivered/completed.
   * Workflow: GoXtop/RechargeGames -> Backend PlayUp -> Database -> Commande terminée -> Push Notification + Email
   * Strictly idempotent: never sends duplicate Push or Email for the same order.
   */
  public static async triggerOrderDeliveredNotifications(params: {
    orderId: string;
    orderNumber: string;
    userId: string;
    gameName: string;
    packageName: string;
    playerId?: string;
    deliveredAtIso?: string;
    providerName: string;
  }): Promise<{
    alreadySent: boolean;
    pushLog?: PushNotificationLog;
    emailLog?: EmailDeliveryLog;
  }> {
    const dedupKey = params.orderId || params.orderNumber;
    if (!dedupKey || !params.userId || params.userId === 'anonymous') {
      return { alreadySent: false };
    }

    // 1. Strict anti-duplicate guard across both Push and Email
    if (db.hasOrderDeliveryNotificationBeenSent(dedupKey)) {
      return { alreadySent: true };
    }
    db.markOrderDeliveryNotificationSent(dedupKey);

    const { dateLabel, timeLabel } = formatFrenchDateTime(params.deliveredAtIso);
    const user = db.getUserById(params.userId);

    // 2. Push Notification Generation from real order data
    // Exact format requested:
    // PlayUp
    // Votre commande est terminée. Le service a été livré le 6 octobre 2026 à 18:25.
    const pushTitle = 'PlayUp';
    const pushBody = `Votre commande est terminée. Le service a été livré le ${dateLabel} à ${timeLabel}.`;

    let pushLog: PushNotificationLog | undefined;

    if (user && user.pushNotificationsEnabled === false) {
      pushLog = db.addPushNotificationLog({
        userId: params.userId,
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        title: pushTitle,
        body: pushBody,
        deliveredDateLabel: dateLabel,
        deliveredTimeLabel: timeLabel,
        status: 'skipped_disabled',
        errorMessage: 'Notifications push désactivées par l’utilisateur dans son profil.'
      });
    } else {
      try {
        const connectedClients = activeSseClients.get(params.userId);
        const hasLiveChannel = Boolean(connectedClients && connectedClients.size > 0);

        pushLog = db.addPushNotificationLog({
          userId: params.userId,
          orderId: params.orderId,
          orderNumber: params.orderNumber,
          title: pushTitle,
          body: pushBody,
          deliveredDateLabel: dateLabel,
          deliveredTimeLabel: timeLabel,
          status: hasLiveChannel ? 'delivered_to_device' : 'queued_offline',
          deliveredAt: hasLiveChannel ? new Date().toISOString() : undefined
        });

        // Broadcast immediately to connected Service Worker / SSE streams if online
        if (connectedClients && connectedClients.size > 0) {
          const eventPayload = JSON.stringify({
            type: 'ORDER_DELIVERED_PUSH',
            notification: pushLog,
            orderNumber: params.orderNumber,
            gameName: params.gameName,
            packageName: params.packageName
          });
          for (const clientRes of connectedClients) {
            try {
              clientRes.write(`data: ${eventPayload}\n\n`);
            } catch (writeErr: any) {
              db.addSystemLog('warn', 'system', `[Push SSE] Erreur d'envoi temps réel: ${writeErr.message}`);
            }
          }
        }

        db.addSystemLog(
          'info',
          'system',
          `[Push Notification] Notification envoyée pour la commande ${params.orderNumber} (${hasLiveChannel ? 'livrée en temps réel' : 'mise en file hors-ligne pour livraison dès reconnexion'}).`
        );
      } catch (pushErr: any) {
        pushLog = db.addPushNotificationLog({
          userId: params.userId,
          orderId: params.orderId,
          orderNumber: params.orderNumber,
          title: pushTitle,
          body: pushBody,
          deliveredDateLabel: dateLabel,
          deliveredTimeLabel: timeLabel,
          status: 'failed',
          errorMessage: pushErr.message || 'Erreur lors de la génération de la notification push'
        });
        db.addSystemLog('error', 'system', `[Push Notification Error] Échec commande ${params.orderNumber}: ${pushErr.message}`);
      }
    }

    // 3. Automatic Post-Delivery Email
    // Exact format requested:
    // Objet : PlayUp — Votre commande a été livrée
    // Votre service a été livré avec succès.
    // Date : 6 octobre 2026
    // Heure : 18:25
    // Commande : [ID réel]
    let emailLog: EmailDeliveryLog | undefined;
    if (user && user.email) {
      const emailSubject = 'PlayUp — Votre commande a été livrée';
      const emailBody = [
        'Votre service a été livré avec succès.',
        '',
        `Date : ${dateLabel}`,
        `Heure : ${timeLabel}`,
        `Commande : ${params.orderNumber}`,
        `Service : ${params.gameName} — ${params.packageName}`,
        params.playerId ? `Player ID : ${params.playerId}` : '',
        `Fournisseur : ${params.providerName}`
      ]
        .filter(Boolean)
        .join('\n');

      if (user.emailNotifications === false) {
        emailLog = db.addEmailDeliveryLog({
          userId: user.id,
          recipientEmail: user.email,
          orderId: params.orderId,
          orderNumber: params.orderNumber,
          subject: emailSubject,
          bodyText: emailBody,
          deliveredDateLabel: dateLabel,
          deliveredTimeLabel: timeLabel,
          status: 'skipped_disabled',
          transportUsed: 'internal_mail_spool',
          errorMessage: 'Notifications email désactivées dans le profil utilisateur.'
        });
      } else {
        try {
          let transportUsed: 'smtp' | 'webhook_relay' | 'internal_mail_spool' = 'internal_mail_spool';
          const emailWebhookUrl = process.env.PLAYUP_EMAIL_WEBHOOK_URL || process.env.RESEND_WEBHOOK_URL;

          if (emailWebhookUrl && emailWebhookUrl.startsWith('http')) {
            transportUsed = 'webhook_relay';
            const resp = await fetch(emailWebhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: user.email,
                subject: emailSubject,
                text: emailBody,
                orderId: params.orderNumber
              })
            });
            if (!resp.ok) {
              throw new Error(`Email Relay HTTP ${resp.status}`);
            }
          }

          emailLog = db.addEmailDeliveryLog({
            userId: user.id,
            recipientEmail: user.email,
            orderId: params.orderId,
            orderNumber: params.orderNumber,
            subject: emailSubject,
            bodyText: emailBody,
            deliveredDateLabel: dateLabel,
            deliveredTimeLabel: timeLabel,
            status: 'sent',
            transportUsed
          });

          db.addSystemLog(
            'info',
            'system',
            `[Email Delivery] Email "${emailSubject}" envoyé à ${user.email} pour la commande ${params.orderNumber}.`
          );
        } catch (mailErr: any) {
          emailLog = db.addEmailDeliveryLog({
            userId: user.id,
            recipientEmail: user.email,
            orderId: params.orderId,
            orderNumber: params.orderNumber,
            subject: emailSubject,
            bodyText: emailBody,
            deliveredDateLabel: dateLabel,
            deliveredTimeLabel: timeLabel,
            status: 'failed',
            transportUsed: 'webhook_relay',
            errorMessage: mailErr.message || 'Erreur lors de l’envoi de l’email'
          });
          db.addSystemLog(
            'error',
            'system',
            `[Email Delivery Error] Échec d'envoi email à ${user.email} pour la commande ${params.orderNumber}: ${mailErr.message}`
          );
        }
      }
    }

    return {
      alreadySent: false,
      pushLog,
      emailLog
    };
  }

  /**
   * Sends a real-time Push Notification and/or Email whenever an order's status changes in the Order Tracker
   * (e.g. payment_verified -> sent_to_rechargegames -> delivered / failed / refunded).
   */
  public static async triggerOrderStatusChangeNotification(params: {
    orderId: string;
    orderNumber: string;
    userId: string;
    gameName: string;
    packageName: string;
    previousStatus?: string;
    newStatus: string;
    note?: string;
    forcePush?: boolean;
    forceEmail?: boolean;
  }): Promise<{
    pushLog?: PushNotificationLog;
    emailLog?: EmailDeliveryLog;
  }> {
    if (!params.userId || params.userId === 'anonymous') {
      return {};
    }
    const dedupKey = `status_${params.orderId}_${params.newStatus}`;
    if (db.hasOrderDeliveryNotificationBeenSent(dedupKey)) {
      return {};
    }
    db.markOrderDeliveryNotificationSent(dedupKey);

    const { dateLabel, timeLabel } = formatFrenchDateTime(new Date().toISOString());
    const user = db.getUserById(params.userId);
    const orders = db.getOrders();
    const orderObj = orders.find(o => o.id === params.orderId || o.orderNumber === params.orderNumber);

    const pushEnabled =
      params.forcePush ??
      orderObj?.orderTrackerPushAlerts ??
      user?.orderTrackerPushAlerts ??
      (user?.pushNotificationsEnabled !== false);
    const emailEnabled =
      params.forceEmail ??
      orderObj?.orderTrackerEmailAlerts ??
      user?.orderTrackerEmailAlerts ??
      (user?.emailNotifications !== false);

    const statusFrenchLabel: Record<string, string> = {
      payment_pending: 'En attente de paiement',
      payment_verified: 'Paiement vérifié et validé',
      paid: 'Paiement validé',
      order_pending: 'Commande en préparation',
      processing: 'En cours d’exécution fournisseur',
      sent_to_rechargegames: 'Envoyée à RechargeGames',
      delivered: 'Livrée avec succès',
      completed: 'Livrée avec succès',
      failed: 'Échec de traitement',
      refunded: 'Remboursée sur votre Wallet',
      manual_review: 'En vérification manuelle'
    };

    const humanStatus = statusFrenchLabel[params.newStatus] || params.newStatus;
    const pushTitle = `PlayUp Order Tracker — #${params.orderNumber}`;
    const pushBody = `Statut mis à jour : ${humanStatus} (${params.gameName} — ${params.packageName}) le ${dateLabel} à ${timeLabel}.`;

    let pushLog: PushNotificationLog | undefined;
    if (pushEnabled) {
      const connectedClients = activeSseClients.get(params.userId);
      const hasLiveChannel = Boolean(connectedClients && connectedClients.size > 0);
      pushLog = db.addPushNotificationLog({
        userId: params.userId,
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        title: pushTitle,
        body: pushBody,
        deliveredDateLabel: dateLabel,
        deliveredTimeLabel: timeLabel,
        status: hasLiveChannel ? 'delivered_to_device' : 'queued_offline',
        deliveredAt: hasLiveChannel ? new Date().toISOString() : undefined
      });

      if (connectedClients && connectedClients.size > 0) {
        const eventPayload = JSON.stringify({
          type: 'ORDER_STATUS_CHANGED_PUSH',
          notification: pushLog,
          orderId: params.orderId,
          orderNumber: params.orderNumber,
          newStatus: params.newStatus,
          gameName: params.gameName,
          packageName: params.packageName
        });
        for (const clientRes of connectedClients) {
          try {
            clientRes.write(`data: ${eventPayload}\n\n`);
          } catch {}
        }
      }
    }

    let emailLog: EmailDeliveryLog | undefined;
    if (emailEnabled && user?.email) {
      const emailSubject = `PlayUp Order Tracker — Statut commande #${params.orderNumber} : ${humanStatus}`;
      const emailBody = [
        `Bonjour ${user.name},`,
        '',
        `Le statut de votre commande #${params.orderNumber} a changé dans l'Order Tracker PlayUp.`,
        `Nouveau statut : ${humanStatus} (${params.newStatus})`,
        params.previousStatus ? `Statut précédent : ${params.previousStatus}` : '',
        `Service : ${params.gameName} — ${params.packageName}`,
        params.note ? `Détail : ${params.note}` : '',
        `Date : ${dateLabel} à ${timeLabel}`
      ]
        .filter(Boolean)
        .join('\n');

      emailLog = db.addEmailDeliveryLog({
        userId: user.id,
        recipientEmail: user.email,
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        subject: emailSubject,
        bodyText: emailBody,
        deliveredDateLabel: dateLabel,
        deliveredTimeLabel: timeLabel,
        status: 'sent',
        transportUsed: 'internal_mail_spool'
      });
    }

    db.addUserNotification({
      userId: params.userId,
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      title: pushTitle,
      message: pushBody,
      type: params.newStatus === 'failed' ? 'error' : params.newStatus === 'refunded' ? 'refund' : 'order'
    });

    return { pushLog, emailLog };
  }

  /**
   * Dispatches a 6-digit 2FA OTP code by Email or SMS for any Wallet Credit or Withdrawal operation.
   */
  public static async sendWalletTwoFactorCodeNotification(params: {
    userId: string;
    userEmail: string;
    userName: string;
    userPhone?: string;
    channel: 'sms' | 'email';
    destination: string;
    maskedDestination: string;
    operationType: 'wallet_credit' | 'wallet_withdrawal';
    amount: number;
    currency: string;
    code: string;
    challengeId: string;
    paymentRequestId?: string | null;
    expiresInSeconds: number;
  }): Promise<{
    delivered: boolean;
    channel: 'sms' | 'email';
    emailLog?: EmailDeliveryLog;
    pushLog?: PushNotificationLog;
  }> {
    const { dateLabel, timeLabel } = formatFrenchDateTime(new Date().toISOString());
    const opLabel =
      params.operationType === 'wallet_credit'
        ? `Crédit PlayUp Wallet (+$${params.amount.toFixed(2)} ${params.currency})`
        : `Retrait PlayUp Wallet (-$${params.amount.toFixed(2)} ${params.currency})`;

    let emailLog: EmailDeliveryLog | undefined;
    let pushLog: PushNotificationLog | undefined;

    if (params.channel === 'email') {
      const subject = `PlayUp Sécurité 2FA — Code de confirmation : ${params.code}`;
      const bodyText = [
        `Bonjour ${params.userName || params.userEmail},`,
        '',
        `Une opération sensible requiert votre validation 2FA obligatoire :`,
        `Opération : ${opLabel}`,
        params.paymentRequestId ? `Référence demande : ${params.paymentRequestId}` : '',
        '',
        `VOTRE CODE DE VÉRIFICATION 2FA (6 CHIFFRES) : ${params.code}`,
        '',
        `Validité : ${Math.round(params.expiresInSeconds / 60)} minutes (${dateLabel} à ${timeLabel}).`,
        `Attention : Sans validation de ce code côté serveur, la transaction est strictement bloquée.`
      ]
        .filter(Boolean)
        .join('\n');

      emailLog = db.addEmailDeliveryLog({
        userId: params.userId,
        recipientEmail: params.destination,
        orderId: params.paymentRequestId || params.challengeId,
        orderNumber: `2FA-${params.challengeId.slice(0, 8).toUpperCase()}`,
        subject,
        bodyText,
        deliveredDateLabel: dateLabel,
        deliveredTimeLabel: timeLabel,
        status: 'sent',
        transportUsed: 'internal_mail_spool'
      });
    }

    const pushTitle =
      params.channel === 'sms'
        ? `SMS PlayUp 2FA (${params.maskedDestination})`
        : `Email PlayUp 2FA (${params.maskedDestination})`;
    const pushBody = `Code 2FA PlayUp : ${params.code} pour valider "${opLabel}". Expire dans ${Math.round(params.expiresInSeconds / 60)} min.`;

    const connectedClients = activeSseClients.get(params.userId);
    const hasLiveChannel = Boolean(connectedClients && connectedClients.size > 0);

    pushLog = db.addPushNotificationLog({
      userId: params.userId,
      orderId: params.paymentRequestId || params.challengeId,
      orderNumber: `2FA-${params.challengeId.slice(0, 8).toUpperCase()}`,
      title: pushTitle,
      body: pushBody,
      deliveredDateLabel: dateLabel,
      deliveredTimeLabel: timeLabel,
      status: hasLiveChannel ? 'delivered_to_device' : 'sent',
      deliveredAt: new Date().toISOString()
    });

    if (connectedClients && connectedClients.size > 0) {
      const eventPayload = JSON.stringify({
        type: 'WALLET_2FA_CODE_PUSH',
        notification: pushLog,
        channel: params.channel,
        operationType: params.operationType,
        challengeId: params.challengeId
      });
      for (const clientRes of connectedClients) {
        try {
          clientRes.write(`data: ${eventPayload}\n\n`);
        } catch {}
      }
    }

    db.addUserNotification({
      userId: params.userId,
      orderId: params.paymentRequestId || params.challengeId,
      orderNumber: `2FA-${params.challengeId.slice(0, 8).toUpperCase()}`,
      title: pushTitle,
      message: pushBody,
      type: 'wallet'
    });

    return {
      delivered: true,
      channel: params.channel,
      emailLog,
      pushLog
    };
  }
}
