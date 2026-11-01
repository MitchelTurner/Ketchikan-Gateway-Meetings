import { letter } from './letter';

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

/**
 * The first email a new subscriber gets. `url` is their own confirm link.
 * The postal address stays in the footer because commercial email has to carry one.
 */
export function confirmEmail(opts: { url: string; siteUrl: string; mailingAddress: string }): { subject: string; html: string } {
  const hours = String(CONFIRM_HOURS);
  const chips = ['Assembly', 'Planning Commission', 'School Board']
    .map(
      (name) =>
        `<span style="display:inline-block;margin:0 8px 8px 0;padding:7px 14px;border:1px solid #d3d7dc;border-radius:999px;font-size:14px;line-height:18px;font-weight:600;color:#0a0f14">${name}</span>`,
    )
    .join('\n');
  const message = letter({
    subject: 'Confirm your subscription',
    preheader: "One click to confirm, then you'll get a plain-language recap after each meeting.",
    headline: 'Confirm your subscription.',
    lead: "You're one click away from a plain-language recap after each meeting you picked — what passed, what was debated, what residents said, and what comes next.",
    button: 'Confirm subscription',
    url: opts.url,
    fine: `This link expires in ${hours} hours.`,
    middle: `<tr><td class="px" style="padding:0 32px"><div style="height:1px;line-height:1px;font-size:1px;background:#e7e9ec">&nbsp;</div></td></tr>
<tr><td class="px" style="padding:28px 32px 14px;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-0.4px;color:#0a0f14">What to expect</td></tr>
<tr><td class="px" style="padding:0 32px 18px;font-size:16px;line-height:25px;color:#3b4652">One email after each meeting, usually the next day. Each recap is written from the official recording, checked against the agenda, and linked to the exact moment in the video.</td></tr>
<tr><td class="px" style="padding:0 32px 28px">
${chips}
</td></tr>
`,
    closing: "Didn't sign up? Ignore this email and you won't be added.",
    siteUrl: opts.siteUrl,
    mailingAddress: opts.mailingAddress,
  });
  return { subject: message.subject, html: message.html };
}
