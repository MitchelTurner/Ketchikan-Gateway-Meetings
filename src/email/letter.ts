import { esc } from '../util';

function siteHost(siteUrl: string): string {
  try {
    return new URL(siteUrl).host.replace(/^www\./, '');
  } catch {
    return siteUrl.replace(/^https?:\/\//, '');
  }
}

/**
 * The reader letter: teal kicker, large headline, black button, paste-this-link, footer.
 * Headline, lead, button, fine print, and closing are our own sentences, not reader text.
 * Only the link, site, and postal address are escaped.
 */
export function letter(opts: {
  subject: string;
  preheader: string;
  headline: string;
  lead: string;
  button: string;
  url: string;
  fine: string;
  /** Extra rows, already HTML, between the fine print and the paste-this-link line. */
  middle?: string;
  closing: string;
  siteUrl: string;
  mailingAddress: string;
}): { subject: string; html: string; text: string } {
  const href = esc(opts.url);
  const site = esc(opts.siteUrl);
  const host = esc(siteHost(opts.siteUrl));
  const address = esc(opts.mailingAddress);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:#fafbfc">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafbfc"><tr><td align="center" style="padding:40px 0">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0f14">
<tr><td class="px" style="padding:0 32px 10px;font-size:13px;line-height:18px;font-weight:600;color:#0f8f80">Stay up to date on Ketchikan</td></tr>
<tr><td class="px" style="padding:0 32px 14px;font-size:34px;line-height:40px;font-weight:600;letter-spacing:-0.85px;color:#0a0f14">${opts.headline}</td></tr>
<tr><td class="px" style="padding:0 32px 28px;font-size:17px;line-height:27px;color:#3b4652">${opts.lead}</td></tr>
<tr><td class="px" style="padding:0 32px 14px"><a href="${href}" style="display:inline-block;padding:15px 26px;background:#0a0f14;color:#ffffff;text-decoration:none;font-size:15px;line-height:15px;font-weight:600;letter-spacing:-0.15px;border-radius:12px">${opts.button}</a></td></tr>
<tr><td class="px" style="padding:0 32px 32px;font-size:14px;line-height:21px;color:#67717d">${opts.fine}</td></tr>
${opts.middle ?? ''}<tr><td class="px" style="padding:0 32px"><div style="height:1px;line-height:1px;font-size:1px;background:#e7e9ec">&nbsp;</div></td></tr>
<tr><td class="px" style="padding:24px 32px 12px;font-size:14px;line-height:21px;color:#67717d">Button not working? Paste this link into your browser:<br><a href="${href}" style="color:#0f8f80;text-decoration:underline;word-break:break-all">${href}</a></td></tr>
<tr><td class="px" style="padding:0 32px 36px;font-size:14px;line-height:21px;color:#67717d">${opts.closing}</td></tr>
<tr><td class="px" style="padding:0 32px 36px;font-size:13px;line-height:20px;color:#67717d"><strong style="color:#0a0f14">Ketchikan.Vote</strong><br>An independent public service from Ketchikan, Alaska. Not affiliated with the Ketchikan Gateway Borough or City of Ketchikan. Recaps are written with AI and can contain mistakes — the official recording is the record.<br><br><a href="${site}" style="color:#67717d;text-decoration:underline">${host}</a><br>${address}</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [opts.headline, '', opts.lead, '', `${opts.button}: ${opts.url}`, '', opts.fine, '', opts.closing, '', 'Ketchikan.Vote', opts.mailingAddress].join('\n');
  return { subject: opts.subject, html, text };
}

/** One-time sign-in. The link is a nonce, not the permanent unsubscribe token. */
export function loginEmail(opts: { url: string; siteUrl: string; mailingAddress: string }): { subject: string; html: string; text: string } {
  return letter({
    subject: 'Your sign-in link',
    preheader: 'One click to sign in. This link works once.',
    headline: 'Sign in.',
    lead: 'Use this link to sign in on this browser. You can comment on a recap, ask about a meeting, and open invoices or the subscription.',
    button: 'Sign in',
    url: opts.url,
    fine: 'This link expires in 2 hours and works once.',
    closing: "Didn't ask for this? Ignore this email. Nothing on your account changes.",
    siteUrl: opts.siteUrl,
    mailingAddress: opts.mailingAddress,
  });
}
