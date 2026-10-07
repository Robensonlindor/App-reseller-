import { db } from './db';
import { Order } from '../src/types';
import { WebhookEngine } from './webhookEngine';
import { ProviderFactory } from './providers/GoXtopProvider';
import { NotificationEngine } from './notificationAndDownloadEngine';

export class ProviderEngine {
  /**
   * Dispatches an order to the designated supplier gateway (e.g. GoXtopProvider).
   * PlayUp App -> PlayUp Backend -> Selected Provider -> GoXtop API -> Supplier Order
   */
  public static async processOrder(orderId: string): Promise<Order | null> {
    const orders = db.getOrders();
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) return null;

    const order = orders[orderIndex];
    const providers = db.getProviders();
    const provider = providers.find(p => p.id === order.providerId) || providers[0];

    if (!provider || !provider.isActive) {
      order.status = 'failed';
      order.errorMessage = `Le fournisseur assigné (${provider?.name || order.providerId}) est inactif.`;
      order.updatedAt = new Date().toISOString();
      order.statusHistory.push({
        status: 'failed',
        timestamp: new Date().toISOString(),
        note: order.errorMessage
      });
      db.setOrders(orders);
      return order;
    }

    // Update status to processing before calling external provider
    order.status = 'processing';
    order.updatedAt = new Date().toISOString();
    order.statusHistory.push({
      status: 'processing',
      timestamp: new Date().toISOString(),
      note: `Transmission de la commande à ${provider.name} (Partner Order ID: ${order.partnerOrderId})`
    });
    db.setOrders(orders);

    WebhookEngine.dispatchOrderEvent(order, 'order.processing').catch(console.error);

    const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const webhookCallbackUrl = `${appUrl}${provider.webhookUrl || `/api/webhooks/${provider.slug}`}`;

    const adapter = ProviderFactory.getProviderInstance(provider.id);
    if (!adapter) {
      order.status = 'failed';
      order.errorMessage = `Adaptateur fournisseur introuvable pour ${provider.name}`;
      order.updatedAt = new Date().toISOString();
      db.setOrders(orders);
      return order;
    }

    // Execute real provider call via interchangeable adapter
    const dispatchResult = await adapter.createOrder(order, webhookCallbackUrl);

    if (dispatchResult.accepted) {
      order.externalOrderId = dispatchResult.externalOrderId;
      order.providerReference = dispatchResult.externalOrderId;
      order.providerResponse = dispatchResult.rawResponse;
      order.status = dispatchResult.status; // 'processing' until webhook confirms, or 'completed' if synchronous confirmation
      order.updatedAt = new Date().toISOString();
      order.statusHistory.push({
        status: dispatchResult.status,
        timestamp: new Date().toISOString(),
        note:
          dispatchResult.status === 'completed'
            ? `Commande confirmée par ${provider.name} (GoXtop Order ID: ${dispatchResult.externalOrderId})`
            : `Commande acceptée par ${provider.name} (GoXtop Order ID: ${dispatchResult.externalOrderId}). En attente de confirmation webhook.`
      });

      db.setOrders(orders);
      db.addUserNotification({
        userId: order.userId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        title:
          dispatchResult.status === 'completed'
            ? `Commande ${order.gameName} livrée !`
            : `Commande ${order.orderNumber} transmise à ${provider.name}`,
        message:
          dispatchResult.status === 'completed'
            ? `Votre pack ${order.packageName} a été livré par ${provider.name} (ID: ${dispatchResult.externalOrderId}).`
            : `Votre commande (${order.partnerOrderId}) a été acceptée par ${provider.name} et est en cours de traitement.`,
        type: 'order'
      });
      if (order.status === 'completed') {
        WebhookEngine.dispatchOrderEvent(order, 'order.completed').catch(console.error);
        if (order.userId) {
          NotificationEngine.triggerOrderDeliveredNotifications({
            orderId: order.id,
            orderNumber: order.orderNumber,
            userId: order.userId,
            gameName: order.gameName,
            packageName: order.packageName,
            playerId: order.gameProfileData?.playerId || order.gameProfileData?.characterId,
            deliveredAtIso: order.updatedAt,
            providerName: provider.name
          }).catch(console.error);
        }
      }
    } else {
      order.status = 'failed';
      order.errorMessage = dispatchResult.errorMessage || 'Refusée par le fournisseur';
      order.providerResponse = dispatchResult.rawResponse;
      order.updatedAt = new Date().toISOString();
      order.statusHistory.push({
        status: 'failed',
        timestamp: new Date().toISOString(),
        note: `Échec fournisseur (${provider.name}) : ${order.errorMessage}`
      });

      db.addUserNotification({
        userId: order.userId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        title: `Échec commande ${order.orderNumber}`,
        message: `Votre commande ${order.packageName} (${order.gameName}) n'a pas pu être traitée par ${provider.name} : ${order.errorMessage}`,
        type: 'error'
      });

      // Automatic refund if reseller balance was debited
      if (order.source === 'reseller_api' && order.resellerId) {
        const resellers = db.getResellers();
        const resIndex = resellers.findIndex(r => r.id === order.resellerId);
        if (resIndex !== -1) {
          resellers[resIndex].balance += order.chargedAmount;
          db.setResellers(resellers);

          const txs = db.getTransactions();
          txs.push({
            id: 'tx_ref_' + Date.now(),
            transactionNumber: 'TXN-REF-' + Date.now().toString().slice(-6),
            entityType: 'reseller',
            entityId: order.resellerId,
            type: 'refund',
            amount: order.chargedAmount,
            currency: order.currency,
            orderId: order.id,
            note: `Remboursement automatique suite à l'échec fournisseur sur ${order.orderNumber}`,
            createdAt: new Date().toISOString()
          });
          db.setTransactions(txs);
        }
      }

      db.setOrders(orders);
      WebhookEngine.dispatchOrderEvent(order, 'order.failed').catch(console.error);
    }

    return order;
  }
}
