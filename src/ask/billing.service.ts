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
  async checkoutUrl(subscriberId: string, back: '/ask' | '/account' = '/ask'): Promise<string> {
    const reader = await this.prisma.subscriber.findUnique({ where: { id: subscriberId } });
    if (!reader) throw new Error('No reader');
    if (reader.askAccess === 'paid' && reader.stripeCustomerId) return this.portalUrl(reader.stripeCustomerId);
    let customerId = reader.stripeCustomerId;
    if (!customerId) customerId = await this.newCustomer(reader.id, reader.email);
    try {
      return await this.openCheckout(customerId, reader.id, back);
    } catch (err) {
      if (!missingCustomer(err)) throw err;
      this.log.warn(`Stripe customer ${customerId} is gone. Creating another.`);
      customerId = await this.newCustomer(reader.id, reader.email);
      return this.openCheckout(customerId, reader.id, back);
    }
  }

  private async newCustomer(subscriberId: string, email: string): Promise<string> {
    const customer = await this.stripe().customers.create({ email });
    await this.prisma.subscriber.update({ where: { id: subscriberId }, data: { stripeCustomerId: customer.id } });
    return customer.id;
  }

  private async openCheckout(customerId: string, subscriberId: string, back: '/ask' | '/account'): Promise<string> {
    const price = await this.priceId();
    const session = await this.stripe().checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'hosted_page',
      customer: customerId,
      client_reference_id: subscriberId,
      line_items: [{ price, quantity: 1 }],
      success_url: `${config.publicBaseUrl}${back}?done=pending`,
      cancel_url: `${config.publicBaseUrl}${back}`,
      integration_identifier: INTEGRATION_ID,
    });
    if (!session.url) throw new Error('Checkout did not return a URL');
    return session.url;
  }

  /** A product id in STRIPE_PRICE_ID still works: use its monthly price. */
  private async priceId(): Promise<string> {
    const raw = config.stripePriceId;
    if (!raw.startsWith('prod_')) return raw;
    const prices = await this.stripe().prices.list({ product: raw, active: true, limit: 20 });
    const monthly = prices.data.find((price) => price.recurring?.interval === 'month');
    if (!monthly) throw new Error(`No monthly price on ${raw}`);
    return monthly.id;
  }

  /** Invoices, the card on file, and canceling. Falls back to the Dashboard portal if a custom configuration cannot be used. */
  async portalUrl(customerId: string): Promise<string> {
    const configuration = await this.portalConfiguration();
    try {
      return await this.openPortal(customerId, configuration);
    } catch (err) {
      if (!configuration) throw err;
      this.log.warn(`Portal with configuration failed, opening the default: ${publicBillingError(err)}`);
      this.portalConfigId = undefined;
      return this.openPortal(customerId);
    }
  }

  private async openPortal(customerId: string, configuration?: string): Promise<string> {
    const session = await this.stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${config.publicBaseUrl}/account`,
      ...(configuration ? { configuration } : {}),
    });
    return session.url;
  }

  private portalConfigId?: string;

  /**
   * Invoice history, card updates, and cancel-at-period-end. A key that cannot
   * write portal configurations still gets the account's saved default portal.
   * Hosted portal login is left off by not turning it on.
   */
  private async portalConfiguration(): Promise<string | undefined> {
    if (this.portalConfigId) return this.portalConfigId;
    try {
      const stripe = this.stripe();
      const listed = await stripe.billingPortal.configurations.list({ limit: 100, active: true });
      const found = listed.data.find((row) => portalReady(row));
      if (found) {
        this.portalConfigId = found.id;
        return found.id;
      }
      const created = await stripe.billingPortal.configurations.create({
        name: 'Ketchikan.Vote',
        metadata: { app: 'kgb-ask' },
        default_return_url: `${config.publicBaseUrl}/account`,
        business_profile: { headline: 'Invoices and your subscription' },
        features: {
          invoice_history: { enabled: true },
          payment_method_update: { enabled: true },
          subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
        },
      });
      this.portalConfigId = created.id;
      return created.id;
    } catch (err) {
      this.log.warn(`Portal configuration unavailable: ${publicBillingError(err)}`);
      return undefined;
    }
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
    const reader = await this.prisma.subscriber.findFirst({ where: { stripeCustomerId: customerId } });
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
    const reader = await this.prisma.subscriber.findFirst({ where: { stripeCustomerId: customerId } });
    if (!reader) return;
    await this.prisma.subscriber.update({ where: { id: reader.id }, data: accessAfterRevoke(gateOf(reader)) });
    this.log.warn(`Ask access revoked for ${reader.id}`);
  }
}

function portalReady(row: Stripe.BillingPortal.Configuration): boolean {
  const features = row.features;
  const cancel = features?.subscription_cancel;
  return Boolean(
    row.metadata?.app === 'kgb-ask' &&
      features?.invoice_history?.enabled &&
      features?.payment_method_update?.enabled &&
      cancel?.enabled &&
      cancel.mode === 'at_period_end' &&
      row.login_page?.enabled !== true,
  );
}

function missingCustomer(err: unknown): boolean {
  const message = err instanceof Error ? err.message : '';
  return /no such customer/i.test(message);
}

/** Stripe's own sentence, with any key material removed, for the account page. */
export function publicBillingError(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  return raw
    .replace(/\b(?:rk|sk)_(?:live|test)_[A-Za-z0-9]+/g, '…')
    .replace(/\bwhsec_[A-Za-z0-9]+/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
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
