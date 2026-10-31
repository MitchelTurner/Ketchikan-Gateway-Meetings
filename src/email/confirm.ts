import { esc } from '../util';

/** How long a fresh confirmation link works. The email states this number. */
export const CONFIRM_HOURS = 48;

export function confirmExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + CONFIRM_HOURS * 60 * 60 * 1000);
}

/** Older rows have no expiry and still confirm. A set time in the past does not. */
export function confirmStillOpen(expiresAt: Date | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() > now.getTime();
}

function siteHost(siteUrl: string): string {
  try {
    return new URL(siteUrl).host.replace(/^www\./, '');
  } catch {
    return siteUrl.replace(/^https?:\/\//, '');
  }
}

/**
 * The first email a new subscriber gets. `url` is their own confirm link.
 * The postal address stays in the footer because commercial email has to carry one.
 */
export function confirmEmail(opts: { url: string; siteUrl: string; mailingAddress: string }): { subject: string; html: string; text: string } {
  const href = esc(opts.url);
  const site = esc(opts.siteUrl);
  const host = esc(siteHost(opts.siteUrl));
  const address = esc(opts.mailingAddress);
  const hours = String(CONFIRM_HOURS);
  const subject = 'Confirm your subscription';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#fafbfc">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">One click to confirm, then you'll get a plain-language recap after each meeting.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafbfc"><tr><td align="center" style="padding:40px 0">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0f14">
<tr><td class="px" style="padding:0 32px 10px;font-size:13px;line-height:18px;font-weight:600;color:#0f8f80">Stay up to date on Ketchikan</td></tr>
<tr><td class="px" style="padding:0 32px 14px;font-size:34px;line-height:40px;font-weight:600;letter-spacing:-0.85px;color:#0a0f14">Confirm your subscription.</td></tr>
<tr><td class="px" style="padding:0 32px 28px;font-size:17px;line-height:27px;color:#3b4652">You're one click away from a plain-language recap after each meeting you picked — what passed, what was debated, what residents said, and what comes next.</td></tr>
<tr><td class="px" style="padding:0 32px 14px"><a href="${href}" style="display:inline-block;padding:15px 26px;background:#0a0f14;color:#ffffff;text-decoration:none;font-size:15px;line-height:15px;font-weight:600;letter-spacing:-0.15px;border-radius:12px">Confirm subscription</a></td></tr>
<tr><td class="px" style="padding:0 32px 32px;font-size:14px;line-height:21px;color:#67717d">This link expires in ${hours} hours.</td></tr>
<tr><td class="px" style="padding:0 32px"><div style="height:1px;line-height:1px;font-size:1px;background:#e7e9ec">&nbsp;</div></td></tr>
<tr><td class="px" style="padding:28px 32px 14px;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-0.4px;color:#0a0f14">What to expect</td></tr>
<tr><td class="px" style="padding:0 32px 18px;font-size:16px;line-height:25px;color:#3b4652">One email after each meeting, usually the next day. Each recap is written from the official recording, checked against the agenda, and linked to the exact moment in the video.</td></tr>
<tr><td class="px" style="padding:0 32px 28px">
<span style="display:inline-block;margin:0 8px 8px 0;padding:7px 14px;border:1px solid #d3d7dc;border-radius:999px;font-size:14px;line-height:18px;font-weight:600;color:#0a0f14">Assembly</span>
<span style="display:inline-block;margin:0 8px 8px 0;padding:7px 14px;border:1px solid #d3d7dc;border-radius:999px;font-size:14px;line-height:18px;font-weight:600;color:#0a0f14">Planning Commission</span>
<span style="display:inline-block;margin:0 8px 8px 0;padding:7px 14px;border:1px solid #d3d7dc;border-radius:999px;font-size:14px;line-height:18px;font-weight:600;color:#0a0f14">School Board</span>
</td></tr>
<tr><td class="px" style="padding:0 32px"><div style="height:1px;line-height:1px;font-size:1px;background:#e7e9ec">&nbsp;</div></td></tr>
<tr><td class="px" style="padding:24px 32px 12px;font-size:14px;line-height:21px;color:#67717d">Button not working? Paste this link into your browser:<br><a href="${href}" style="color:#0f8f80;text-decoration:underline;word-break:break-all">${href}</a></td></tr>
<tr><td class="px" style="padding:0 32px 36px;font-size:14px;line-height:21px;color:#67717d">Didn't sign up? Ignore this email and you won't be added.</td></tr>
<tr><td class="px" style="padding:0 32px 36px;font-size:13px;line-height:20px;color:#67717d"><strong style="color:#0a0f14">Ketchikan.Vote</strong><br>An independent public service from Ketchikan, Alaska. Not affiliated with the Ketchikan Gateway Borough or City of Ketchikan. Recaps are AI-written and reviewed by a person, but can contain mistakes — the official recording is the record.<br><br><a href="${site}" style="color:#67717d;text-decoration:underline">${host}</a><br>${address}</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [
    'Stay up to date on Ketchikan',
    '',
    'Confirm your subscription.',
    '',
    "You're one click away from a plain-language recap after each meeting you picked — what passed, what was debated, what residents said, and what comes next.",
    '',
    `Confirm: ${opts.url}`,
    '',
    `This link expires in ${hours} hours.`,
    '',
    'What to expect',
    'One email after each meeting, usually the next day. Each recap is written from the official recording, checked against the agenda, and linked to the exact moment in the video.',
    '',
    'Assembly, Planning Commission, School Board',
    '',
    "Didn't sign up? Ignore this email and you won't be added.",
    '',
    'Ketchikan.Vote',
    'An independent public service from Ketchikan, Alaska. Not affiliated with the Ketchikan Gateway Borough or City of Ketchikan. Recaps are AI-written and reviewed by a person, but can contain mistakes — the official recording is the record.',
    opts.siteUrl,
    opts.mailingAddress,
  ].join('\n');
  return { subject, html, text };
}
