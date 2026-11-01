import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { accessAfterRevoke, accessAfterSubscription, AskGate, invoiceSubscriptionId } from './ask-logic';

/** Groups every Ask checkout in the Stripe dashboard. The last 8 characters are fixed. */
const INTEGRATION_ID = 'kgb_ask_mxtkplwq';

@Injectable()
export class BillingService {
  private log = new Logger(BillingService.name);
  private client?: Stripe;
  constructor(private prisma: PrismaService) {}

  private stripe(): Stripe {
    return (this.client ??= new Stripe(config.stripeSecretKey, { apiVersion: '2026-09-30.endive' }));
  }

  /** Stripe Checkout for the $5 monthly price. An active subscriber goes to the portal instead. */
  async checkoutUrl(subscriberId: string): Promise<string> {
    const reader = await this.prisma.subscriber.findUnique({ where: { id: subscriberId } });
    if (!reader) throw new Error('No reader');
    if (reader.askAccess === 'paid' && reader.stripeCustomerId) return this.portalUrl(reader.stripeCustomerId);
    const stripe = this.stripe();
    let customerId = reader.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: reader.email });
      customerId = customer.id;
      await this.prisma.subscriber.update({ where: { id: reader.id }, data: { stripeCustomerId: customerId } });
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: reader.id,
      line_items: [{ price: config.stripePriceId, quantity: 1 }],
      success_url: `${config.publicBaseUrl}/ask?done=pending`,
      cancel_url: `${config.publicBaseUrl}/ask`,
      integration_identifier: INTEGRATION_ID,
    });
    if (!session.url) throw new Error('Checkout did not return a URL');
    return session.url;
  }

  async portalUrl(customerId: string): Promise<string> {
    const session = await this.stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${config.publicBaseUrl}/ask`,
    });
    return session.url;
  }

  /** Verifies the signature, then updates who can ask. The success page does not grant access. */
  async handleWebhook(raw: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;
    try {
      event = this.stripe().webhooks.constructEvent(raw, signature, config.stripeWebhookSecret);
    } catch (err) {
      this.log.warn(`Ask webhook rejected: ${(err as Error).message}`);
      throw err;
    }
    this.log.log(`Ask webhook ${event.type} ${event.id}`);
    const object = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await this.onCheckout(object as Stripe.Checkout.Session);
        break;
      case 'checkout.session.async_payment_failed':
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.applySubscription(object as Stripe.Subscription);
        break;
      case 'invoice.paid':
      case 'invoice.payment_failed':
        await this.onInvoice(object as Stripe.Invoice);
        break;
      case 'charge.refunded':
        await this.onRefund(object as Stripe.Charge);
        break;
      case 'charge.dispute.created':
        await this.revokeCharge((object as Stripe.Dispute).charge);
        break;
      case 'radar.early_fraud_warning.created':
        await this.revokeCharge((object as Stripe.Radar.EarlyFraudWarning).charge);
        break;
      default:
        break;
    }
  }

  private async onCheckout(session: Stripe.Checkout.Session): Promise<void> {
    if (session.mode !== 'subscription' || session.payment_status === 'unpaid') return;
    const subscriptionId = stripeId(session.subscription);
    if (!subscriptionId) return;
    const subscription = await this.stripe().subscriptions.retrieve(subscriptionId);
    await this.applySubscription(subscription);
  }

  private async onInvoice(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) return;
    const subscription = await this.stripe().subscriptions.retrieve(subscriptionId);
    await this.applySubscription(subscription);
  }

  private async onRefund(charge: Stripe.Charge): Promise<void> {
    if (!charge.refunded) return;
    await this.revokeCustomer(stripeId(charge.customer));
  }

  private async revokeCharge(charge: string | Stripe.Charge): Promise<void> {
    const full = typeof charge === 'string' ? await this.stripe().charges.retrieve(charge) : charge;
    await this.revokeCustomer(stripeId(full.customer));
  }

  private async applySubscription(subscription: Stripe.Subscription): Promise<void> {
    const customerId = stripeId(subscription.customer);
    if (!customerId) return;
    const reader = await this.prisma.subscriber.findUnique({ where: { stripeCustomerId: customerId } });
    if (!reader) return;
    const next = accessAfterSubscription(gateOf(reader), {
      id: subscription.id,
      active: subscription.status === 'active' || subscription.status === 'trialing',
    });
    if (!next) return;
    await this.prisma.subscriber.update({ where: { id: reader.id }, data: next });
  }

  private async revokeCustomer(customerId: string | null): Promise<void> {
    if (!customerId) return;
    const reader = await this.prisma.subscriber.findUnique({ where: { stripeCustomerId: customerId } });
    if (!reader) return;
    await this.prisma.subscriber.update({ where: { id: reader.id }, data: accessAfterRevoke(gateOf(reader)) });
    this.log.warn(`Ask access revoked for ${reader.id}`);
  }
}

function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

function gateOf(reader: { askAccess: string; stripeSubscriptionId: string | null; askBlockedSubId: string | null }): AskGate {
  return {
    askAccess: reader.askAccess === 'paid' ? 'paid' : 'free',
    stripeSubscriptionId: reader.stripeSubscriptionId,
    askBlockedSubId: reader.askBlockedSubId,
  };
}
