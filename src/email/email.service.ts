import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { config } from '../config';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Leave it off to send the HTML message alone. */
  text?: string;
  unsubscribeUrl?: string;
}

@Injectable()
export class EmailService {
  private client?: Resend;
  private get resend() {
    return (this.client ??= new Resend(config.resendKey));
  }

  async send(e: OutgoingEmail): Promise<string> {
    const headers: Record<string, string> = {};
    if (e.unsubscribeUrl) {
      // One-click unsubscribe (Gmail/Yahoo bulk-sender requirement); POST hits /unsubscribe/:token.
      headers['List-Unsubscribe'] = `<${e.unsubscribeUrl}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
    const { data, error } = await this.resend.emails.send({
      from: config.emailFrom,
      to: e.to,
      subject: e.subject,
      html: e.html,
      ...(e.text ? { text: e.text } : {}),
      headers,
    });
    if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
    return data?.id ?? '';
  }
}
