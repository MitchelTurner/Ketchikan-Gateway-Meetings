import { config } from '../config';
import { BODIES, esc } from '../util';

/** Minimal light-only page shell for the public signup/confirm/unsubscribe screens. */
export function page(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(title)}</title>
<style>
:root{--ink:#1b2430;--muted:#5b6675;--rule:#d9dee5;--accent:#0b5d7a;--bg:#f6f7f9;--card:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:520px;margin:48px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:28px 24px}
h1{font-size:24px;line-height:1.25;margin:0 0 10px}p{margin:0 0 14px}.muted{color:var(--muted);font-size:14px}
label{display:block;font-weight:600;margin:18px 0 6px}
input[type=email]{width:100%;padding:11px 12px;font-size:16px;border:1px solid var(--rule);border-radius:6px}
input[type=email]:focus{outline:2px solid var(--accent);outline-offset:1px}
fieldset{border:0;padding:0;margin:18px 0 0}legend{font-weight:600;margin-bottom:6px}
.check{display:flex;gap:8px;align-items:center;font-weight:400;margin:6px 0}
button{margin-top:22px;width:100%;padding:12px;font-size:16px;font-weight:600;color:#fff;background:var(--accent);border:0;border-radius:6px;cursor:pointer}
button:hover{filter:brightness(1.08)}
footer{text-align:center;margin-top:18px}
</style></head><body><main><div class="card">${inner}</div>
<footer class="muted">Not an official Ketchikan Gateway Borough publication.</footer></main></body></html>`;
}

export function bodyCheckboxes(selected: string[] = []): string {
  return `<fieldset><legend>Which meetings?</legend><p class="muted" style="margin:0 0 6px">Leave all unchecked to get every one.</p>
${BODIES.map(
  (b) => `<label class="check"><input type="checkbox" name="bodies" value="${esc(b.name)}"${selected.includes(b.name) ? ' checked' : ''}> ${esc(b.name)}</label>`,
).join('')}</fieldset>`;
}

export const signupPage = () =>
  page(
    config.newsletterName,
    `<h1>${esc(config.newsletterName)}</h1>
<p>A plain-language recap of Ketchikan Gateway Borough meetings in your inbox, usually within a day: what passed, what was discussed, what residents said, and what's coming up — with links to the exact moment in the video.</p>
<form method="post" action="/subscribe">
<label for="email">Email</label><input id="email" type="email" name="email" required autocomplete="email">
${bodyCheckboxes()}
<button type="submit">Subscribe</button></form>
<p class="muted" style="margin-top:16px">Recaps are written by AI from automated transcripts and reviewed before sending. One-click unsubscribe in every email.</p>`,
  );
