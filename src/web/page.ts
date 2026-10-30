import { config } from '../config';
import { sourceLabel, timestampUrl } from '../email/render';
import { MeetingDigest } from '../analysis/analysis.service';
import type { DeepDiveArticle } from '../topics/deep-dive.service';
import { BOROUGH_POPULATION, FOUNDING_READERS } from '../referrals';
import { BODIES, esc, formatDate, hms, meetingParts, shortDate, slugify } from '../util';

export { slugify };

const FONTS =
  'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap';

// Night over the Tongass Narrows: near-black, glass panels, and an aurora gradient
// for accents. Readers whose device is set to light get the same layout on white.
const CSS = `
@font-face{font-family:'Mislarey';src:url('/fonts/mislarey.woff') format('woff');font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:'Mislarey Sans';src:url('/fonts/mislarey-sans.woff') format('woff');font-weight:400;font-style:normal;font-display:swap}
:root{--bg:#06080b;--card:#0c1117;--surface:rgba(255,255,255,.035);--surface-2:rgba(255,255,255,.065);--line:rgba(255,255,255,.09);--line-2:rgba(255,255,255,.17);
--text:#eef2f6;--text-2:#b3bcc7;--muted:#7c8693;--teal:#5eead4;--green:#86efac;--indigo:#a5b4fc;--violet:#c4b5fd;--rose:#fb7185;
--aurora:linear-gradient(100deg,#5eead4 0%,#86efac 30%,#a5b4fc 66%,#c4b5fd 100%);--glow-a:rgba(94,234,212,.26);--glow-b:rgba(165,180,252,.26);--glow-c:rgba(196,181,253,.2);
--btn-bg:#eef2f6;--btn-text:#06080b;--shadow:0 30px 80px -30px rgba(0,0,0,.7);--radius:18px;
--sans:'Geist',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;--mono:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--script:'Mislarey',Georgia,serif;--caps:'Mislarey Sans','Geist',sans-serif;--serif:var(--script);
--paper:var(--bg);--ink:var(--text);--ink-2:var(--text-2);--rule:var(--line);--rule-strong:var(--line-2);--accent:var(--teal);--spruce:var(--green);--tide:var(--indigo);--wash:var(--surface-2);--danger:var(--rose);--display:var(--sans);--head:var(--sans);
color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#fafbfc;--card:#fff;--surface:rgba(12,20,32,.025);--surface-2:rgba(12,20,32,.055);--line:rgba(12,20,32,.09);--line-2:rgba(12,20,32,.18);
--text:#0a0f14;--text-2:#3b4652;--muted:#67717d;--teal:#0f8f80;--green:#15803d;--indigo:#4f46e5;--violet:#7c3aed;--rose:#e11d48;
--aurora:linear-gradient(100deg,#0f8f80 0%,#16a34a 30%,#4f46e5 66%,#7c3aed 100%);--glow-a:rgba(20,184,166,.16);--glow-b:rgba(99,102,241,.14);--glow-c:rgba(139,92,246,.12);
--btn-bg:#0a0f14;--btn-text:#fff;--shadow:0 24px 60px -28px rgba(15,23,42,.25);color-scheme:light}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:radial-gradient(1100px 480px at 50% -220px,var(--glow-a),transparent 70%) no-repeat,var(--bg);color:var(--text);font:400 16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
a{color:inherit;text-decoration-color:var(--line-2);text-underline-offset:3px}
a:hover{color:var(--teal);text-decoration-color:currentColor}
::selection{background:var(--teal);color:var(--bg)}
.wrap{max-width:1180px;margin:0 auto;padding:0 28px}
.narrow{max-width:680px}

/* Navigation */
.nav{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 74%,transparent);-webkit-backdrop-filter:saturate(1.5) blur(16px);backdrop-filter:saturate(1.5) blur(16px);border-bottom:1px solid var(--line)}
.nav-in{display:flex;align-items:center;gap:26px;min-height:64px}
.brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;font:400 24px/1 var(--script);letter-spacing:0;color:var(--text);white-space:nowrap}
.brand:hover{color:var(--text)}
.mark{flex:0 0 28px;width:28px;height:28px;border-radius:8px;background:var(--aurora);display:grid;place-items:center;box-shadow:0 0 24px -4px var(--glow-a)}
.mark svg{width:18px;height:18px}
.links{display:flex;gap:2px;font:500 14px/1 var(--sans)}
.links a{padding:9px 12px;border-radius:999px;color:var(--text-2);text-decoration:none}
.links a:hover{color:var(--text);background:var(--surface-2)}
.cta{margin-left:auto;display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:999px;background:var(--btn-bg);color:var(--btn-text);font:600 14px/1 var(--sans);text-decoration:none;white-space:nowrap}
.cta:hover{color:var(--btn-text);opacity:.88}

/* Type */
h1,h2,h3{font-family:var(--sans);font-weight:600;letter-spacing:-.035em;margin:0;color:var(--text)}
h1{font-family:var(--caps);font-weight:400;letter-spacing:.02em;font-size:clamp(28px,4vw,42px);line-height:1.08;margin:0 0 16px}
p{margin:0 0 16px}
em.grad,.grad{font-family:var(--script);font-style:normal;font-weight:400;letter-spacing:0;background:var(--aurora);-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:.06em}
.kicker{display:block;font:400 13px/1.3 var(--caps);letter-spacing:.08em;color:var(--teal);margin-bottom:12px}
.meta{font:400 13px/1.5 var(--mono);letter-spacing:-.01em;color:var(--muted)}
.muted{color:var(--muted);font-size:15px}
.dek{font:400 19px/1.6 var(--sans);color:var(--text-2)}
.rubric{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin:0 0 20px;font:400 18px/1.2 var(--caps);letter-spacing:.06em;color:var(--text)}
.rubric a{font:500 13px/1 var(--sans);color:var(--muted);text-decoration:none}
.rubric a:hover{color:var(--teal)}
.more{display:inline-flex;align-items:center;gap:6px;font:500 14px/1 var(--sans);text-decoration:none;color:var(--teal)}
.more:hover{gap:10px}
mark{background:color-mix(in srgb,var(--teal) 28%,transparent);color:var(--text);padding:0 3px;border-radius:4px}
.empty{color:var(--muted)}

/* Generic page body */
.sheet{padding:56px 0 8px}
.sheet h2{font-size:22px;margin:30px 0 10px}
h2.section{font:500 12px/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-top:1px solid var(--line);padding-top:14px;margin:40px 0 16px}

/* Forms */
label{display:block;font:500 13.5px/1.4 var(--sans);color:var(--text-2);margin:18px 0 8px}
input[type=email],input[type=search],input[type=text],input[type=password],select,textarea{width:100%;padding:13px 15px;font:400 16px/1.3 var(--sans);border:1px solid var(--line-2);border-radius:12px;background:var(--surface);color:var(--text);transition:border-color .15s,box-shadow .15s}
input::placeholder,textarea::placeholder{color:var(--muted)}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 4px color-mix(in srgb,var(--teal) 18%,transparent)}
button:focus-visible,a:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
fieldset{border:0;padding:0;margin:20px 0 0}legend{font:500 13.5px/1.4 var(--sans);color:var(--text-2);margin-bottom:10px;padding:0}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips label{position:relative;margin:0;font:500 13.5px/1 var(--sans);color:var(--text-2);border:1px solid var(--line-2);border-radius:999px;padding:9px 14px;cursor:pointer;background:var(--surface);transition:all .15s}
.chips label:hover{border-color:var(--teal);color:var(--text)}
.chips input{position:absolute;opacity:0;width:1px;height:1px}
.chips label:has(input:checked){background:color-mix(in srgb,var(--teal) 16%,transparent);border-color:var(--teal);color:var(--text)}
.chips label:has(input:checked)::before{content:"✓ ";color:var(--teal)}
.chips label:has(input:focus-visible){outline:2px solid var(--teal);outline-offset:2px}
.hint{font:400 13px/1.5 var(--sans);color:var(--muted);margin:10px 0 0}
button{margin-top:22px;width:100%;padding:15px 18px;font:600 15px/1 var(--sans);letter-spacing:-.01em;color:var(--btn-text);background:var(--btn-bg);border:0;border-radius:12px;cursor:pointer;transition:transform .12s,opacity .15s}
button:hover{opacity:.9}button:active{transform:translateY(1px)}

/* Front page */
.hero-band{position:relative;overflow:hidden;border-bottom:1px solid var(--line)}
.hero-band::before{content:"";position:absolute;inset:-30% -10% -10%;background:radial-gradient(38% 46% at 18% 38%,var(--glow-a),transparent 70%),radial-gradient(34% 42% at 58% 18%,var(--glow-b),transparent 70%),radial-gradient(30% 40% at 88% 52%,var(--glow-c),transparent 70%);filter:blur(28px);animation:aurora 20s ease-in-out infinite alternate;pointer-events:none}
.hero-band::after{content:"";position:absolute;inset:0;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(ellipse 70% 60% at 50% 0%,#000 25%,transparent 75%);mask-image:radial-gradient(ellipse 70% 60% at 50% 0%,#000 25%,transparent 75%);opacity:.55;pointer-events:none}
@keyframes aurora{0%{transform:translate3d(-4%,0,0) scale(1)}100%{transform:translate3d(4%,5%,0) scale(1.08)}}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--teal) 45%,transparent)}50%{box-shadow:0 0 0 6px transparent}}
.hero{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:64px;padding:96px 0 88px;align-items:center}
.eyebrow{display:inline-flex;align-items:center;gap:10px;padding:7px 14px 7px 10px;border:1px solid var(--line-2);border-radius:999px;background:var(--surface);font:500 13px/1 var(--sans);color:var(--text-2);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.eyebrow .dot{width:8px;height:8px;border-radius:50%;background:var(--teal);animation:pulse 2.4s ease-in-out infinite}
.hero h1{font:400 clamp(34px,4.8vw,58px)/1.02 var(--caps);letter-spacing:.02em;margin:26px 0 24px}
.hero h1 .grad{display:block;font-size:1.2em;line-height:1.15;margin-top:6px}
.hero .dek{max-width:33em;font-size:19.5px}
.facts{display:flex;flex-wrap:wrap;gap:14px 40px;margin-top:40px}
.facts div{font:400 13px/1.35 var(--sans);color:var(--muted)}
.facts strong{display:block;font:500 30px/1 var(--mono);letter-spacing:-.04em;color:var(--text);margin-bottom:8px}
.signup{position:relative;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:30px;box-shadow:var(--shadow)}
.signup::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:var(--aurora);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:.75;pointer-events:none}
.signup h2{font:400 26px/1.15 var(--caps);letter-spacing:.04em;margin:0 0 6px}
.signup p{font:400 15px/1.5 var(--sans);color:var(--text-2);margin:0}
.signup p.hint{font-size:13px;color:var(--muted);margin:14px 0 0;text-align:center}
.grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:24px;padding:24px 0 0}
.grid:first-of-type{padding-top:64px}
.grid > *{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:28px 30px;min-width:0}
.lead h2{font:400 clamp(22px,2.4vw,30px)/1.15 var(--caps);letter-spacing:.03em;margin:0 0 14px}
.lead h2 a{text-decoration:none}.lead h2 a:hover{color:var(--text);text-decoration:underline;text-decoration-color:var(--teal);text-decoration-thickness:2px}
.lead .dek{font-size:17px;margin:0 0 16px}
.lead .meta{margin-bottom:18px}
.stack .item{display:block;text-decoration:none;padding:16px 0;border-bottom:1px solid var(--line)}
.stack .item:first-child{padding-top:0}.stack .item:last-child{border-bottom:0;padding-bottom:0}
.stack .item .kicker{margin-bottom:6px;font-size:11.5px}
.stack .item h3{font:400 16px/1.35 var(--caps);letter-spacing:.03em;margin:0 0 6px}
.stack .item p{margin:0}
.stack .item:hover h3{color:var(--teal)}

/* Docket: the meeting list */
.docket{list-style:none;margin:0;padding:0}
.docket>li+li{margin-top:4px}
.docket a{display:grid;grid-template-columns:84px minmax(0,1fr) auto;gap:4px 20px;padding:16px 14px;margin:0 -14px;text-decoration:none;border-radius:14px;transition:background .15s}
.docket a:hover{background:var(--surface-2)}
.docket .when{font:500 11px/1.4 var(--mono);letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding-top:2px}
.docket .when b{display:block;font:500 24px/1.05 var(--mono);letter-spacing:-.04em;color:var(--text);text-transform:none}
.docket h3{font:400 18px/1.3 var(--caps);letter-spacing:.04em;margin:0 0 4px}
.docket a:hover h3{color:var(--teal)}
.docket .parts{list-style:none;margin:0 0 4px;padding:0;font:400 13.5px/1.5 var(--sans);color:var(--muted)}
.docket .headline{font:400 15px/1.5 var(--sans);color:var(--text-2);margin:4px 0 0}
.state{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 10px;border-radius:999px;font:500 11.5px/1 var(--sans);color:var(--muted);background:var(--surface-2);white-space:nowrap;align-self:start}
.state::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.state.work{color:var(--indigo)}.state.work::before{animation:pulse 2s infinite}.state.ready{color:var(--teal)}.state.done{color:var(--muted)}.state.stopped{color:var(--rose)}

/* How we report */
.timeline{list-style:none;margin:0;padding:0}
.timeline li{position:relative;padding:0 0 24px 26px;border-left:1px solid var(--line-2);margin-left:5px}
.timeline li::before{content:"";position:absolute;left:-6px;top:6px;width:11px;height:11px;border-radius:50%;background:var(--bg);border:2px solid var(--muted)}
.timeline li.milestone::before{background:var(--teal);border-color:var(--teal);box-shadow:0 0 14px var(--teal)}
.timeline p{margin:4px 0 0;font-size:16px;color:var(--text-2)}.timeline p.meta{font-size:12.5px}.timeline .meta a{color:var(--teal)}
.method{counter-reset:step;list-style:none;margin:0;padding:0}
.method li{counter-increment:step;position:relative;padding:0 0 20px 46px;font-size:15px;line-height:1.5;color:var(--text-2)}
.method li::before{content:"0" counter(step);position:absolute;left:0;top:1px;font:500 13px/1 var(--mono);padding:6px 0;width:32px;text-align:center;border-radius:8px;background:var(--surface-2);color:var(--teal)}
.method b{display:block;color:var(--text);font-weight:600}
.aside-note{font-size:13.5px;line-height:1.6;color:var(--muted);border-top:1px solid var(--line);padding-top:16px;margin:4px 0 0}

/* Article */
.article{padding:64px 0 24px}
.article h1{font:400 clamp(26px,3.6vw,38px)/1.12 var(--caps);letter-spacing:.025em;margin-bottom:18px}
.byline{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:24px 0 40px}
.byline > *{display:inline-flex;align-items:center;height:32px;padding:0 13px;border:1px solid var(--line-2);border-radius:999px;font:500 13px/1 var(--sans);color:var(--text-2);text-decoration:none}
.byline a:hover{border-color:var(--teal);color:var(--teal)}
.article .parts{list-style:none;margin:0;padding:0;font:400 16px/1.55 var(--sans);color:var(--muted)}
.body{font:400 17.5px/1.75 var(--sans);color:var(--text-2)}
.body > p:first-of-type{font-size:20.5px;line-height:1.6;color:var(--text);letter-spacing:-.01em}
.body h2{display:flex;align-items:center;gap:12px;font:400 17px/1.3 var(--caps);letter-spacing:.08em;margin:52px 0 18px}
.body h2::before{content:"";flex:0 0 4px;height:22px;border-radius:4px;background:var(--aurora)}
.body ul{padding-left:0;margin:0;list-style:none}
.body li{position:relative;padding-left:24px;margin:0 0 14px}
.body li::before{content:"";position:absolute;left:4px;top:.72em;width:7px;height:7px;border-radius:50%;background:var(--aurora)}
.body strong{color:var(--text);font-weight:600}
.body a{color:var(--teal)}
.ts{display:inline-flex;align-items:center;height:22px;padding:0 8px;margin-left:2px;border-radius:6px;background:var(--surface-2);font:500 12px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--text-2);text-decoration:none;white-space:nowrap;vertical-align:1px}
.ts:hover{background:var(--teal);color:var(--bg)}
.notice{margin-top:52px;padding:22px 24px;border:1px solid var(--line);border-radius:16px;background:var(--surface);font:400 14.5px/1.65 var(--sans);color:var(--text-2)}
.notice strong{display:block;font:500 12px/1.4 var(--mono);letter-spacing:.05em;text-transform:uppercase;color:var(--text);margin-bottom:8px}
.notice a{color:var(--teal)}
.status-line{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:16px}
.status-line .muted{margin:0}
.transcript{margin-top:56px}
.transcript p{display:grid;grid-template-columns:76px minmax(0,1fr);gap:12px;font:400 15px/1.6 var(--sans);color:var(--text-2);margin:0 0 12px}
.transcript .who{font:500 12px/1.7 var(--mono);color:var(--muted);font-variant-numeric:tabular-nums}

/* Search and lists */
.hits{display:grid;gap:12px}
.hits .hit{display:block;text-decoration:none;color:inherit;border:1px solid var(--line);background:var(--surface);border-radius:16px;padding:20px 22px;transition:border-color .15s,background .15s}
a.hit:hover{border-color:var(--line-2);background:var(--surface-2)}
.hit .kicker{font-size:11.5px;margin-bottom:8px}
.hit h2{font:400 18px/1.25 var(--caps);letter-spacing:.03em;margin:0 0 8px}
.hit p{margin:0;font:400 15px/1.6 var(--sans);color:var(--text-2)}
a.hit:hover h2{color:var(--teal)}
.search{display:grid;grid-template-columns:minmax(0,1fr) 200px auto;gap:12px;align-items:end;margin:8px 0 24px}
.search label{margin:0 0 8px}.search button{margin:0;width:auto;padding:14px 22px}

/* Sharing, invites and the community goal */
.share{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center}
.share a,.share button{display:inline-flex;align-items:center;width:auto;margin:0;height:38px;padding:0 15px;font:500 14px/1 var(--sans);letter-spacing:-.005em;text-decoration:none;color:var(--text);background:var(--surface);border:1px solid var(--line-2);border-radius:999px;cursor:pointer}
.share a:hover,.share button:hover{border-color:var(--teal);color:var(--teal);opacity:1}
.share .primary{background:var(--btn-bg);color:var(--btn-text);border-color:transparent}.share .primary:hover{color:var(--btn-text);opacity:.88}
.share [hidden]{display:none}
.share-head{font:500 12px/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:center;margin:44px 0 14px}
.goal{margin:22px 0 0}
.goal .bar{height:8px;border-radius:999px;background:var(--surface-2);overflow:hidden}
.goal .bar span{display:block;height:100%;min-width:8px;border-radius:999px;background:var(--aurora);box-shadow:0 0 16px var(--glow-a)}
.goal p{font:400 13px/1.5 var(--sans);color:var(--muted);margin:9px 0 0;text-align:center}
.goal p b{font:500 13px var(--mono);color:var(--text)}
.invited{display:inline-block;font:500 13px/1.3 var(--sans);color:var(--teal);background:color-mix(in srgb,var(--teal) 12%,transparent);border-radius:999px;padding:6px 12px;margin:0 0 14px}
.callout{position:relative;margin:56px 0 0;border:1px solid var(--line);background:var(--card);border-radius:24px;padding:34px 30px 28px;text-align:center;overflow:hidden;box-shadow:var(--shadow)}
.callout::before{content:"";position:absolute;inset:-60% -20% auto;height:120%;background:radial-gradient(40% 50% at 30% 50%,var(--glow-a),transparent 70%),radial-gradient(40% 50% at 70% 40%,var(--glow-b),transparent 70%);filter:blur(24px);pointer-events:none}
.callout > *{position:relative}
.callout h2{font:400 28px/1.15 var(--caps);letter-spacing:.04em;margin:0 0 8px}
.callout > p{font:400 16px/1.5 var(--sans);color:var(--text-2);margin:0}
.callout form{display:flex;gap:10px;max-width:480px;margin:20px auto 0;align-items:stretch}
.callout input[type=email]{flex:1}
.callout button{width:auto;margin:0;padding:0 22px}
.kit{margin:40px 0 0;padding:28px;border:1px solid var(--line);border-radius:20px;background:var(--surface)}
.kit h2{font:400 24px/1.15 var(--caps);letter-spacing:.04em;margin:0 0 8px}
.linkbox{display:flex;gap:8px;margin:18px 0 12px}
.linkbox input{flex:1;min-width:0;font:400 14.5px/1.3 var(--mono)}
.linkbox button{width:auto;margin:0;padding:0 18px}
.kit .share{justify-content:flex-start}
.score{display:flex;gap:16px;align-items:center;margin:26px 0 4px;font:400 14.5px/1.45 var(--sans);color:var(--text-2)}
.score strong{font:500 48px/1 var(--mono);letter-spacing:-.05em;background:var(--aurora);-webkit-background-clip:text;background-clip:text;color:transparent}
.score b{color:var(--text)}
.badges{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;padding:0;margin:18px 0 0}
.badge{border:1px solid var(--line);background:var(--card);border-radius:16px;padding:16px 10px 14px;text-align:center;font:400 12px/1.35 var(--sans);color:var(--muted)}
.badge svg{display:block;width:40px;height:40px;margin:0 auto 10px}
.badge b{display:block;font:600 14px/1.25 var(--sans);letter-spacing:-.015em;color:var(--muted);margin:0 0 4px}
.badge.on{border-color:color-mix(in srgb,var(--green) 55%,transparent);box-shadow:0 0 30px -12px var(--green)}.badge.on b{color:var(--text)}
.badge.founding.on{border-color:color-mix(in srgb,var(--teal) 60%,transparent);box-shadow:0 0 30px -10px var(--teal)}
.reader-no{text-align:center;margin:14px 0 24px;padding:28px 20px;border:1px solid var(--line);border-radius:20px;background:var(--surface)}
.reader-no span{display:block;font:500 12px/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.reader-no strong{display:block;font:500 84px/1 var(--mono);letter-spacing:-.06em;margin:10px 0 8px;background:var(--aurora);-webkit-background-clip:text;background-clip:text;color:transparent}
.steps{list-style:none;padding:0;margin:24px 0;display:grid;gap:10px}
.steps li{display:flex;gap:12px;align-items:center;font:500 15px/1.4 var(--sans);color:var(--muted)}
.steps li::before{content:attr(data-n);flex:0 0 26px;height:26px;border:1px solid currentColor;border-radius:50%;font:500 12px/24px var(--mono);text-align:center}
.steps li.done{color:var(--text-2)}.steps li.done::before{content:"✓";background:var(--green);border-color:var(--green);color:var(--bg)}
.steps li.now{color:var(--text)}.steps li.now::before{border-color:var(--teal);color:var(--teal);box-shadow:0 0 0 4px color-mix(in srgb,var(--teal) 15%,transparent)}

/* Footer */
footer.site{position:relative;margin-top:110px;border-top:1px solid var(--line);padding:52px 0 40px;font:400 14px/1.65 var(--sans);color:var(--muted)}
footer.site::before{content:"";position:absolute;top:-1px;left:12%;right:12%;height:1px;background:var(--aurora);opacity:.7}
.foot{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr);gap:40px}
.foot p{max-width:30em;margin:16px 0 0}
.foot h4{font:500 12px/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--text);margin:4px 0 14px}
.foot nav a{display:block;text-decoration:none;color:var(--text-2);margin:0 0 9px}
.foot nav a:hover{color:var(--teal)}
.fine{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 24px;margin-top:44px;padding-top:22px;border-top:1px solid var(--line);font:400 12.5px/1.5 var(--mono);color:var(--muted)}

@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}html{scroll-behavior:auto}}
@media (max-width:900px){
  .hero,.grid{grid-template-columns:minmax(0,1fr);gap:28px}
  .hero{padding:56px 0 56px}
  .grid:first-of-type{padding-top:40px}
  .search{grid-template-columns:minmax(0,1fr)}.search button{width:100%}
  .foot{grid-template-columns:1fr 1fr}.foot > div:first-child{grid-column:1 / -1}
}
@media (max-width:700px){
  .nav-in{flex-wrap:wrap;gap:0 14px;padding-top:10px}
  .links{order:3;width:100%;overflow-x:auto;scrollbar-width:none;margin:6px -12px 4px;padding-bottom:4px}
  .links::-webkit-scrollbar{display:none}
  .cta{padding:9px 14px;font-size:13.5px}
}
@media (max-width:520px){
  .wrap{padding:0 18px}
  .grid > *{padding:22px 20px}
  .body{font-size:17px}.body > p:first-of-type{font-size:19px}
  .docket a{grid-template-columns:minmax(0,1fr) auto}
  .docket .when{grid-column:1 / -1;padding:0}.docket .when b{display:inline;font-size:13px;margin:0 5px}
  .transcript p{grid-template-columns:minmax(0,1fr);gap:2px}
  .callout{padding:28px 20px 24px}.callout form{flex-direction:column}.callout button{width:100%;padding:15px}
  .kit{padding:22px 18px}
}
`;

const MARK = `<span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#06080b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 18.5l6-9 4 6 3-4 6 7"/></svg></span>`;

function masthead(_compact: boolean): string {
  return `<header class="nav"><div class="wrap nav-in">
<a class="brand" href="/">${MARK}<span>${esc(config.newsletterName)}</span></a>
<nav class="links" aria-label="Sections"><a href="/notes">Recaps</a><a href="/topics">Topics</a><a href="/#docket">Docket</a><a href="/#how">How it works</a></nav>
<a class="cta" href="/#subscribe">Subscribe</a>
</div></header>`;
}

function footer(): string {
  return `<footer class="site"><div class="wrap">
<div class="foot">
<div><a class="brand" href="/">${MARK}<span>${esc(config.newsletterName)}</span></a>
<p>An independent public service from Ketchikan, Alaska. Not an official Ketchikan Gateway Borough publication. Recaps are written with AI from the Borough's own recordings and reviewed before they're published.</p></div>
<nav aria-label="Read"><h4>Read</h4><a href="/notes">Every recap</a><a href="/topics">Topics</a><a href="/#docket">The docket</a></nav>
<nav aria-label="Follow"><h4>Follow</h4><a href="/#subscribe">Subscribe</a><a href="/#how">How we report</a><a href="/sitemap.xml">Sitemap</a></nav>
</div>
<div class="fine"><span>Ketchikan · Southeast Alaska</span><span>55.34°N 131.65°W</span></div>
</div></footer>`;
}

export interface Seo {
  /** Search-result snippet, ~155 characters. */
  description?: string;
  /** Path of the preferred URL for this content, e.g. /notes/abc/assembly-approves-harbor-bond. */
  canonical?: string;
  /** Drafts and admin screens stay out of search engines. */
  noindex?: boolean;
  /** schema.org object, emitted as JSON-LD. */
  jsonLd?: Record<string, unknown>;
  ogType?: 'website' | 'article';
}

function baseUrl(): string {
  try {
    return config.publicBaseUrl;
  } catch {
    return '';
  }
}

function seoTags(title: string, seo: Seo): string {
  const base = baseUrl();
  const url = seo.canonical && base ? `${base}${seo.canonical}` : '';
  const tags = [
    seo.description ? `<meta name="description" content="${esc(seo.description)}">` : '',
    seo.noindex ? '<meta name="robots" content="noindex">' : '',
    url ? `<link rel="canonical" href="${esc(url)}">` : '',
    `<meta property="og:site_name" content="${esc(config.newsletterName)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:type" content="${seo.ogType ?? 'website'}">`,
    seo.description ? `<meta property="og:description" content="${esc(seo.description)}">` : '',
    url ? `<meta property="og:url" content="${esc(url)}">` : '',
    '<meta name="twitter:card" content="summary">',
    // "<" is escaped so a headline can never close the script element.
    seo.jsonLd ? `<script type="application/ld+json">${JSON.stringify(seo.jsonLd).replace(/</g, '\\u003c')}</script>` : '',
  ];
  return tags.filter(Boolean).join('\n');
}

/** Full document: masthead, the page's own main element, footer. */
function shell(title: string, main: string, opts: { compact?: boolean; seo?: Seo; css?: string } = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="theme-color" content="#06080b" media="(prefers-color-scheme: dark)"><meta name="theme-color" content="#fafbfc" media="(prefers-color-scheme: light)"><title>${esc(title)}</title>
${seoTags(title, opts.seo ?? {})}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="/fonts/mislarey.woff" as="font" type="font/woff" crossorigin>
<link rel="preload" href="/fonts/mislarey-sans.woff" as="font" type="font/woff" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${CSS}${opts.css ?? ''}</style></head><body>
${masthead(opts.compact ?? true)}
${main}
${SHARE_JS}
${footer()}
</body></html>`;
}

// Copy buttons and the phone's own share sheet. Links work without it.
const SHARE_JS = `<script>(function(){
document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){
var t=b.getAttribute('data-copy'),l=b.textContent,done=function(){b.textContent='Copied';setTimeout(function(){b.textContent=l},1800)};
if(navigator.clipboard)navigator.clipboard.writeText(t).then(done,function(){prompt('Copy this link',t)});else prompt('Copy this link',t)})});
if(navigator.share)document.querySelectorAll('[data-share]').forEach(function(b){b.hidden=false;b.addEventListener('click',function(){
navigator.share({title:b.getAttribute('data-title')||document.title,text:b.getAttribute('data-text')||'',url:b.getAttribute('data-share')}).catch(function(){})})});
})()</script>`;

function withParam(url: string, key: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

/**
 * Text, email, Facebook, copy. `url` is absolute. Public recap links are tagged
 * with ?via= so the dashboard can tell which channel brought readers; invite links
 * already carry ?r= and are left as they are.
 */
export function shareButtons(url: string, title: string, message: string, opts: { tag?: boolean; copyLabel?: string } = {}): string {
  const tag = opts.tag ?? true;
  const u = (ch: string) => (tag ? withParam(url, 'via', ch) : url);
  const sms = `sms:?&body=${encodeURIComponent(`${message} ${u('sms')}`)}`;
  const mail = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${message}\n\n${u('email')}`)}`;
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u('facebook'))}`;
  return `<div class="share"><button type="button" class="primary" hidden data-share="${esc(u('share'))}" data-title="${esc(title)}" data-text="${esc(message)}">Share</button>
<a href="${esc(sms)}">Text it</a><a href="${esc(mail)}">Email it</a><a href="${esc(fb)}" target="_blank" rel="noopener">Facebook</a>
<button type="button" data-copy="${esc(u('copy'))}">${esc(opts.copyLabel ?? 'Copy link')}</button></div>`;
}

export interface Growth {
  readers: number;
  goal: number;
  /** A valid invite code from the link this visitor arrived on. */
  ref?: string;
}

/** Everyone's progress toward the next round number of readers. */
export function goalBar(g: Growth): string {
  const pct = Math.min(100, (100 * g.readers) / g.goal);
  const share = g.readers >= 25 ? ` That's 1 in ${Math.round(BOROUGH_POPULATION / g.readers).toLocaleString('en-US')} Borough residents.` : '';
  const line = g.readers
    ? `<b>${g.readers.toLocaleString('en-US')}</b> of ${g.goal.toLocaleString('en-US')} Ketchikan readers.${share}${
        g.readers < FOUNDING_READERS ? ` ${FOUNDING_READERS - g.readers} Founding Reader spots left.` : ''
      }`
    : `Be one of the first ${FOUNDING_READERS} readers. They keep a Founding Reader badge.`;
  return `<div class="goal"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${g.goal}" aria-valuenow="${g.readers}" aria-label="Readers toward the goal of ${g.goal}"><span style="width:${pct.toFixed(1)}%"></span></div><p>${line}</p></div>`;
}

/** Sign-up at the foot of a recap: the reader just saw what they'd get. */
export function signupCallout(g: Growth): string {
  return `<section class="callout" id="subscribe">${g.ref ? '<p class="invited">A neighbor invited you to read along.</p>' : ''}<h2>Get the next one</h2>
<p>A plain-language recap in your inbox after every Borough meeting. Free.</p>
<form method="post" action="/subscribe"><input type="hidden" name="ref" value="${esc(g.ref ?? '')}"><input type="email" name="email" required autocomplete="email" placeholder="you@example.com" aria-label="Email address"><button type="submit">Subscribe</button></form>
${goalBar(g)}</section>`;
}

function emblem(kind: 'spruce' | 'star', on: boolean): string {
  const color = on ? (kind === 'star' ? 'var(--accent)' : 'var(--spruce)') : 'var(--rule)';
  const mark =
    kind === 'star'
      ? '<path d="M20 9l3.2 6.6 7.3 1-5.3 5.1 1.3 7.2L20 25.5l-6.5 3.4 1.3-7.2-5.3-5.1 7.3-1z"/>'
      : '<path d="M20 8l5 7h-3l5 7h-3.5l5.5 7H21.5v4h-3v-4H9l5.5-7H11l5-7h-3z"/>';
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.5" fill="none" stroke="${color}" stroke-width="1.5"${on ? '' : ' stroke-dasharray="3 3"'}/><g fill="${on ? color : 'none'}" stroke="${color}" stroke-width="1.2" stroke-linejoin="round">${mark}</g></svg>`;
}

export interface InviteKit {
  url: string;
  count: number;
  readerNo: number | null;
  badges: { at: number; name: string; line: string }[];
  foundingLimit: number;
}

/** A reader's own invite link, how many neighbors joined through it, and the badges along the way. */
export function inviteKit(k: InviteKit): string {
  const next = k.badges.find((b) => k.count < b.at);
  const founding = k.readerNo !== null && k.readerNo <= k.foundingLimit;
  const message = `I've been reading ${config.newsletterName}: plain-language recaps of every Ketchikan Assembly, School Board and Planning Commission meeting. It's free.`;
  const ladder = [
    ...(founding ? [`<li class="badge founding on">${emblem('star', true)}<b>Founding Reader</b>Reader #${k.readerNo} of the first ${k.foundingLimit}</li>`] : []),
    ...k.badges.map((b) => `<li class="badge${k.count >= b.at ? ' on' : ''}">${emblem('spruce', k.count >= b.at)}<b>${esc(b.name)}</b>${k.count >= b.at ? esc(b.line) : `${b.at} neighbor${b.at === 1 ? '' : 's'}`}</li>`),
  ].join('');
  return `<section class="kit" id="invite"><h2>Bring a neighbor</h2>
<p class="muted">Public meetings work better when more people know what happened. Send your link to someone who'd want to know; when they confirm, it counts toward your badges.</p>
<div class="linkbox"><input type="text" readonly value="${esc(k.url)}" aria-label="Your invite link" onfocus="this.select()"><button type="button" data-copy="${esc(k.url)}">Copy</button></div>
${shareButtons(k.url, `${config.newsletterName}`, message, { tag: false, copyLabel: 'Copy invite' })}
<div class="score"><strong>${k.count}</strong><span>neighbor${k.count === 1 ? '' : 's'} joined through your link${next ? `.<br>${next.at - k.count} more and you're a <b>${esc(next.name)}</b>.` : '. Every badge earned. Thank you.'}</span></div>
<ul class="badges">${ladder}</ul></section>`;
}

/** Where a new reader is in signing up. */
export function stepList(current: 1 | 2 | 3): string {
  const steps = ['Sign up', 'Confirm your email', 'Invite a neighbor'];
  return `<ol class="steps">${steps.map((t, i) => `<li data-n="${i + 1}" class="${i + 1 < current ? 'done' : i + 1 === current ? 'now' : ''}">${t}</li>`).join('')}</ol>`;
}

/** A simple centered page for forms, confirmations and admin screens. Not indexed. */
export function page(title: string, inner: string, wide = false, below = ''): string {
  return shell(
    `${title} · ${config.newsletterName}`,
    `<main class="wrap" style="max-width:${wide ? '760px' : '560px'}"><div class="sheet">${inner}</div>${below}</main>`,
    { seo: { noindex: true } },
  );
}

const ADMIN_CSS = `
.adminbar{position:sticky;top:64px;z-index:40;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--bg) 82%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.adminbar .wrap{display:flex;flex-wrap:wrap;align-items:center;gap:2px 4px;min-height:52px;font:500 14px/1 var(--sans)}
.adminbar a{text-decoration:none;color:var(--text-2);padding:8px 12px;border-radius:999px}
.adminbar a:hover{color:var(--text);background:var(--surface-2)}
.adminbar a.on{color:var(--text);background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line-2)}
.adminbar .label{font:500 12px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--teal);margin-right:12px}
.adminbar .right{margin-left:auto;display:flex;gap:2px}
.admin{padding-top:40px;padding-bottom:20px}
.admin h1{font-size:clamp(30px,4vw,44px);margin-bottom:8px}
.admin .lede{font:400 16.5px/1.55 var(--sans);color:var(--text-2);margin:0 0 28px;max-width:46em}
.admin h2.section{display:flex;justify-content:space-between;gap:12px;margin:44px 0 16px}
.admin h2.section a{color:var(--teal);text-decoration:none}
.cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:6px 0 12px}
.card{padding:18px 18px 16px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}
.card .l{font:500 11px/1.4 var(--mono);letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:12px}
.card .n{font:500 36px/1 var(--mono);letter-spacing:-.05em;color:var(--text)}
.card .d{font:400 12.5px/1.4 var(--sans);color:var(--muted);margin-top:10px}
.card .d.up{color:var(--green)}.card .d.down{color:var(--rose)}
.chart{margin:12px 0 0;padding:22px 22px 16px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}
.chart svg{display:block;width:100%;height:auto}
.legend{display:flex;gap:18px;font:400 12.5px/1 var(--sans);color:var(--muted);margin:12px 0 0}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.cols{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:48px}
table.data{width:100%;border-collapse:collapse;font:400 14.5px/1.45 var(--sans)}
table.data th{text-align:left;font:500 11px/1.3 var(--mono);letter-spacing:.05em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line-2);padding:0 12px 10px 0}
table.data td{border-bottom:1px solid var(--line);padding:12px 12px 12px 0;vertical-align:top;color:var(--text-2)}
table.data .num{text-align:right;font:500 14px/1.45 var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap;padding-right:0;color:var(--text)}
table.data a{text-decoration:none;color:var(--text)}table.data a:hover{color:var(--teal)}
table.data .sub{display:block;font-size:12.5px;color:var(--muted);margin-top:3px}
table.data .headline{font:500 16px/1.35 var(--sans);letter-spacing:-.015em}
.meter{display:block;height:3px;border-radius:3px;background:var(--surface-2);margin-top:8px;overflow:hidden}.meter span{display:block;height:3px;background:var(--aurora)}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 18px}
.tabs a{font:500 13.5px/1 var(--sans);text-decoration:none;color:var(--text-2);border:1px solid var(--line-2);border-radius:999px;padding:9px 14px;background:var(--surface)}
.tabs a:hover{color:var(--text)}
.tabs a.on{background:var(--btn-bg);border-color:transparent;color:var(--btn-text)}
.tabs a b{font:500 12.5px var(--mono);margin-left:6px;opacity:.7}
.toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:0 0 10px}
.toolbar form{display:flex;gap:8px;align-items:center;flex:1;min-width:240px;max-width:460px}
.toolbar input{padding:10px 14px}
.btn,button.btn{display:inline-flex;align-items:center;justify-content:center;width:auto;margin:0;height:40px;padding:0 16px;font:600 14px/1 var(--sans);letter-spacing:-.01em;text-decoration:none;color:var(--btn-text);background:var(--btn-bg);border:1px solid transparent;border-radius:10px;cursor:pointer;white-space:nowrap}
.btn:hover{color:var(--btn-text);opacity:.88}
.btn.ghost{background:var(--surface);color:var(--text);border-color:var(--line-2)}.btn.ghost:hover{border-color:var(--teal);color:var(--teal);opacity:1}
.btn.warn{background:transparent;color:var(--rose);border-color:color-mix(in srgb,var(--rose) 50%,transparent)}.btn.warn:hover{background:var(--rose);color:#fff;opacity:1}
.btn[disabled]{opacity:.4;cursor:not-allowed}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.actions form{margin:0}
textarea{min-height:360px;font:400 16px/1.7 var(--sans);resize:vertical}
input.headline{font:600 22px/1.25 var(--sans);letter-spacing:-.025em}
.panel{border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:18px 20px 18px;margin:0 0 14px}
.panel h3{font:500 11px/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
.panel p,.panel li{font:400 14px/1.55 var(--sans);color:var(--text-2)}
.panel ul{margin:0;padding-left:18px}
.panel a{color:var(--teal)}
.panel form+form{margin-top:10px}
.flash{border:1px solid color-mix(in srgb,var(--green) 40%,transparent);background:color-mix(in srgb,var(--green) 10%,transparent);border-radius:12px;padding:12px 16px;font:500 14px/1.5 var(--sans);color:var(--text);margin:0 0 24px}
.flash.bad{border-color:color-mix(in srgb,var(--rose) 45%,transparent);background:color-mix(in srgb,var(--rose) 10%,transparent)}
.editor{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(0,1fr);gap:40px;align-items:start}
.list{list-style:none;margin:0;padding:0}
.list li{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line);padding:12px 0;font:400 14.5px/1.45 var(--sans);color:var(--text-2)}
.list li a{text-decoration:none;color:var(--text)}.list li a:hover{color:var(--teal)}
.list .n{font:400 13px/1.45 var(--mono);color:var(--muted);white-space:nowrap}
.status-grid{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center;margin:0 0 16px;color:var(--text-2)}
.status-grid b{font:500 15px var(--mono);color:var(--text)}
@media (max-width:1000px){.cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:860px){.cols,.editor{grid-template-columns:minmax(0,1fr);gap:28px}.adminbar{top:0;position:relative}.adminbar .right{margin-left:0}}
@media (max-width:640px){table.data .hide-sm{display:none}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.card .n{font-size:30px}}
`;

export type AdminTab = 'overview' | 'posts' | 'meetings' | 'topics' | '';

/** Signed-in screens: a working bar under a compact nameplate, full width. Not indexed. */
export function adminPage(title: string, tab: AdminTab, inner: string, signedIn = true): string {
  const link = (href: string, label: string, key: AdminTab) => `<a href="${href}"${key && key === tab ? ' class="on" aria-current="page"' : ''}>${label}</a>`;
  const links = signedIn
    ? `${link('/admin', 'Overview', 'overview')}${link('/admin/posts', 'Posts', 'posts')}${link('/admin/meetings', 'Meetings', 'meetings')}${link('/admin/topics', 'Topics', 'topics')}<span class="right"><a href="/">View site</a><a href="/admin/logout">Sign out</a></span>`
    : '<span class="right"><a href="/">View site</a></span>';
  return shell(
    `${title} · Admin · ${config.newsletterName}`,
    `<nav class="adminbar" aria-label="Admin"><div class="wrap"><span class="label">Editor's desk</span>${links}</div></nav>
<main class="wrap admin">${inner}</main>`,
    { seo: { noindex: true }, css: ADMIN_CSS },
  );
}

export function noteHref(id: string, headline: string): string {
  const slug = slugify(headline);
  return `/notes/${encodeURIComponent(id)}${slug ? `/${slug}` : ''}`;
}

/** First sentences of a summary, cut to fit a search snippet. */
export function describe(text: string, max = 158): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const sentence = cut.lastIndexOf('. ');
  return sentence > 80 ? cut.slice(0, sentence + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** "Ketchikan Assembly" / "Ketchikan School Board": the place name people search with. */
function placeBody(body: string): string {
  return body === 'Other' ? 'Ketchikan Gateway Borough' : `Ketchikan ${body}`;
}

export interface AdminMeetingRow {
  id: string;
  title: string;
  body: string;
  date: string;
  status: string;
  error: string | null;
  hasTranscript: boolean;
  hasAnalysis: boolean;
  approveHref?: string;
}

/** Staff list. A transcript link means transcription finished, with or without Resend. */
export function adminMeetingsPage(rows: AdminMeetingRow[]): string {
  const list = rows.length
    ? `<div class="hits">${rows
        .map((m) => {
          const links = [
            m.hasTranscript ? `<a href="/admin/meetings/${esc(m.id)}/transcript">Transcript</a>` : '',
            m.hasAnalysis ? `<a href="/admin/posts/${esc(m.id)}">Edit post</a>` : '',
            m.hasAnalysis ? `<a href="/admin/meetings/${esc(m.id)}/preview">Email preview</a>` : '',
            m.approveHref ? `<a href="${esc(m.approveHref)}">Approve</a>` : '',
          ].filter(Boolean);
          return `<div class="hit"><div class="kicker">${esc(m.body)}${m.date ? ` · ${esc(m.date)}` : ''} · ${esc(m.status)}</div><h2>${esc(m.title)}</h2>${m.error ? `<p>${esc(m.error)}</p>` : ''}${links.length ? `<p>${links.join(' · ')}</p>` : ''}</div>`;
        })
        .join('')}</div>`
    : '<p class="muted">No meetings yet. Discovery adds them from the archive.</p>';
  return adminPage(
    'Meetings',
    'meetings',
    `<h1>Meetings</h1><p class="lede">Everything found in the Borough's video archive, newest first. A transcript link means that meeting has been transcribed.</p>${list}`,
  );
}

export function adminTranscriptPage(
  meeting: { id: string; title: string; body: string; meetingDate: Date | null },
  provider: string,
  segments: { start?: number; speaker?: string; text?: string }[],
): string {
  const lines = segments
    .map((s) => {
      const who = typeof s.speaker === 'string' && s.speaker ? `${esc(s.speaker)} · ` : '';
      return `<p><span class="kicker">${who}${hms(Number(s.start) || 0)}</span><br>${esc(s.text)}</p>`;
    })
    .join('');
  return adminPage(
    meeting.title,
    'meetings',
    `<div class="kicker">${esc(meeting.body)}${meeting.meetingDate ? ` · ${esc(formatDate(meeting.meetingDate))}` : ''} · ${esc(provider)} · ${segments.length} lines</div>
<h1>${esc(meeting.title)}</h1>
<p><a href="/admin/meetings">All meetings</a></p>
${lines || '<p class="muted">This transcript is empty.</p>'}`,
  );
}

export function bodyCheckboxes(selected: string[] = []): string {
  return `<fieldset><legend>Which meetings?</legend><div class="chips">
${BODIES.map(
  (b) => `<label><input type="checkbox" name="bodies" value="${esc(b.name)}"${selected.includes(b.name) ? ' checked' : ''}>${esc(b.name)}</label>`,
).join('')}</div><p class="hint">Leave them all off to get every meeting.</p></fieldset>`;
}

export interface TopicOption {
  slug: string;
  name: string;
}

/** Deep-dive opt-in. Only shown once you've approved at least one topic. */
export function topicCheckboxes(topics: TopicOption[], selected: string[] = []): string {
  if (!topics.length) return '';
  return `<fieldset><legend>Follow a topic</legend><div class="chips">
${topics
  .map((t) => `<label><input type="checkbox" name="topics" value="${esc(t.slug)}"${selected.includes(t.slug) ? ' checked' : ''}>${esc(t.name)}</label>`)
  .join('')}</div><p class="hint">Get an in-depth explainer when something big happens on these issues.</p></fieldset>`;
}

export interface NoteHit {
  id: string;
  title: string;
  body: string;
  date: string;
  headline: string;
  snippet: string;
}

export function hitList(hits: NoteHit[]): string {
  if (!hits.length) return '';
  return `<div class="hits">${hits
    .map(
      (h) => `<a class="hit" href="${esc(noteHref(h.id, h.headline))}"><div class="kicker">${esc(h.body)}${h.date ? ` <span class="meta" style="text-transform:none;letter-spacing:0;font-weight:500">· ${esc(h.date)}</span>` : ''}</div><h2>${esc(h.headline)}</h2><p>${h.snippet}</p></a>`,
    )
    .join('')}</div>`;
}

// Short labels in one voice; the tone picks the dot color.
const STATUS: Record<string, { label: string; tone: 'work' | 'ready' | 'done' | 'stopped' }> = {
  DISCOVERED: { label: 'Queued', tone: 'work' },
  RESEARCHING: { label: 'Researching', tone: 'work' },
  DOWNLOADING: { label: 'Downloading', tone: 'work' },
  TRANSCRIBING: { label: 'Transcribing', tone: 'work' },
  ANALYZING: { label: 'Writing recap', tone: 'work' },
  AWAITING_APPROVAL: { label: 'Draft ready', tone: 'ready' },
  SENDING: { label: 'Emailing', tone: 'done' },
  SENT: { label: 'Published', tone: 'done' },
  PUBLISHED: { label: 'Published', tone: 'done' },
  FAILED: { label: 'Not finished', tone: 'stopped' },
  SKIPPED: { label: 'Not transcribed', tone: 'done' },
};

export function pill(status: string): string {
  const s = STATUS[status] ?? { label: status, tone: 'done' as const };
  return `<span class="state ${s.tone}">${esc(s.label)}</span>`;
}

/** What a resident sees about a meeting's state. Internal errors stay on the admin pages. */
function publicStatusNote(status: string, hasDigest: boolean, approved: boolean): string {
  if (status === 'FAILED') return "Processing stopped before it finished. It's retried automatically.";
  if (hasDigest && !approved) return "Draft recap. It hasn't been reviewed yet.";
  if (STATUS[status]?.tone === 'work') return 'This page fills in when transcription finishes.';
  return '';
}

/** Agenda-style items from the archive title, beyond the body name and date. */
function partsList(title: string, body: string): string {
  const parts = meetingParts(title, body);
  return parts.length ? `<ul class="parts">${parts.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
}

export interface WorkHit {
  id: string;
  title: string;
  body: string;
  /** "Wed, Oct 21, 2026" */
  date: string;
  status: string;
  /** The recap headline, once there is one. */
  headline: string;
  /** First paragraph of the recap. */
  summary: string;
}

/** "Wed, Oct 21, 2026" → weekday + "Oct 21" for the docket's date column. */
function docketDate(date: string): string {
  const m = date.match(/^(\w+), (\w+ \d+), (\d{4})$/);
  return m ? `${esc(m[1])}<b>${esc(m[2])}</b>${esc(m[3])}` : `<b>${esc(date || '—')}</b>`;
}

export function workList(hits: WorkHit[]): string {
  if (!hits.length) return '';
  return `<ul class="docket">${hits
    .map(
      (h) => `<li><a href="/meetings/${esc(h.id)}"><div class="when">${docketDate(h.date)}</div>
<div><h3>${esc(h.body)}</h3>${partsList(h.title, h.body)}${h.headline ? `<p class="headline">${esc(h.headline)}</p>` : ''}</div>${pill(h.status)}</a></li>`,
    )
    .join('')}</ul>`;
}

const METHOD = `<ol class="method">
<li><b>Recorded</b>Every meeting the Borough posts to its video archive.</li>
<li><b>Transcribed</b>Word for word, with each point linked to its moment in the video.</li>
<li><b>Checked</b>Names and item numbers against the Borough's roster and agenda, with context from local news.</li>
<li><b>Reviewed</b>A person reads each recap before it's published or emailed.</li>
</ol>
<p class="aside-note">Recaps are written with AI and can contain mistakes. Every item links to the recording so you can hear it yourself.</p>`;

export const signupPage = (recent: NoteHit[], work: WorkHit[], archiveCount: number, sinceLabel: string, topics: TopicOption[] = [], growth?: Growth) => {
  // Lead with the newest reviewed recap; fall back to the newest draft so the page is never empty.
  const draft = work.find((w) => w.headline);
  const lead = recent[0]
    ? { href: noteHref(recent[0].id, recent[0].headline), body: recent[0].body, date: recent[0].date, headline: recent[0].headline, dek: recent[0].snippet, draft: false }
    : draft
      ? { href: `/meetings/${draft.id}`, body: draft.body, date: draft.date, headline: draft.headline, dek: esc(describe(draft.summary, 260)), draft: true }
      : null;
  const more = recent.slice(1, 5);
  const title = `${config.newsletterName}: Ketchikan Assembly, School Board and Planning Commission meetings in plain language`;
  const description =
    'What the Ketchikan Gateway Borough Assembly, School Board and Planning Commission decided, debated and heard from residents, written in plain language and linked to the meeting video.';

  const leadHtml = lead
    ? `<article class="lead"><div class="kicker">${lead.draft ? 'Draft · ' : ''}${esc(lead.body)}</div>
<h2><a href="${esc(lead.href)}">${esc(lead.headline)}</a></h2>
<p class="dek">${lead.dek}</p>
<p class="meta">${esc(lead.date)}${lead.draft ? ' · Not yet reviewed' : ''}</p>
<a class="more" href="${esc(lead.href)}">Read the recap →</a></article>`
    : `<article class="lead"><p class="empty">The first recap appears here as soon as a meeting has been transcribed.</p></article>`;

  const moreHtml = more.length
    ? `<div class="stack">${more
        .map(
          (h) => `<a class="item" href="${esc(noteHref(h.id, h.headline))}"><div class="kicker">${esc(h.body)}</div><h3>${esc(h.headline)}</h3><p class="meta">${esc(h.date)}</p></a>`,
        )
        .join('')}</div>`
    : `<p class="empty">Earlier recaps will collect here.</p>`;

  const docketIntro = archiveCount
    ? `<p class="muted">${archiveCount.toLocaleString('en-US')} meetings on the Borough's video archive. Everything since ${esc(sinceLabel)} is transcribed, newest first.</p>`
    : '<p class="muted">No meetings recorded yet. The archive is checked every few hours.</p>';

  return shell(
    title,
    `<div class="hero-band"><div class="wrap">
<section class="hero">
  <div>
    <span class="eyebrow"><span class="dot"></span>Ketchikan Gateway Borough · Southeast Alaska</span>
    <h1>Every public meeting, <span class="grad">in plain language.</span></h1>
    <p class="dek">What passed, what was debated, what residents said, and what comes next. Written from the official recording, checked against the agenda, and linked to the exact moment in the video.</p>
    <div class="facts">
      <div><strong>${archiveCount.toLocaleString('en-US')}</strong>meetings on the record</div>
      <div><strong>Assembly</strong>School Board, Planning &amp; more</div>
      <div><strong>Free</strong>no ads, unsubscribe anytime</div>
    </div>
  </div>
  <aside class="signup" id="subscribe">
    ${growth?.ref ? '<p class="invited">A neighbor invited you to read along.</p>' : ''}<h2>Get the recap</h2>
    <p>One email after each meeting, usually the next day.</p>
    <form method="post" action="/subscribe"><input type="hidden" name="ref" value="${esc(growth?.ref ?? '')}">
      <label for="email">Email address</label><input id="email" type="email" name="email" required autocomplete="email" placeholder="you@example.com">
      ${bodyCheckboxes()}
      ${topicCheckboxes(topics)}
      <button type="submit">Subscribe</button>
    </form>
    <p class="hint">Confirm by email. One-click unsubscribe in every message.</p>
    ${growth ? goalBar(growth) : ''}
  </aside>
</section>
</div></div>
<main class="wrap">

<section class="grid">
  <div><h2 class="rubric">Latest</h2>${leadHtml}</div>
  <div><h2 class="rubric">More recaps <a href="/notes">All →</a></h2>${moreHtml}</div>
</section>

<section class="grid">
  <div id="docket"><h2 class="rubric">The docket</h2>${docketIntro}${workList(work)}</div>
  <aside id="how"><h2 class="rubric">How we report</h2>${METHOD}</aside>
</section>
</main>`,
    {
      compact: false,
      seo: {
        description,
        canonical: '/',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: config.newsletterName,
          description,
          ...(baseUrl() ? { url: `${baseUrl()}/` } : {}),
          about: { '@type': 'AdministrativeArea', name: 'Ketchikan Gateway Borough, Alaska' },
        },
      },
    },
  );
};

export function notesSearchPage(q: string, body: string, hits: NoteHit[]): string {
  const options = ['<option value="">Every body</option>'].concat(
    BODIES.map((b) => `<option value="${esc(b.name)}"${b.name === body ? ' selected' : ''}>${esc(b.name)}</option>`),
  );
  const list = hits.length
    ? hitList(hits)
    : `<p class="empty">${q ? `Nothing in the published recaps matches “${esc(q)}”.` : 'No published recaps yet. Meetings being transcribed are on the <a href="/#docket">front page</a>.'}</p>`;
  const count = hits.length ? `${hits.length} ${hits.length === 1 ? 'recap' : 'recaps'}${q ? ` matching “${esc(q)}”` : ''}` : '';
  const scope = body ? placeBody(body) : 'Ketchikan Gateway Borough';
  const title = q ? `“${q}” in ${scope} meeting recaps` : `${scope} meeting recaps`;
  return shell(
    `${title} · ${config.newsletterName}`,
    `<main class="wrap" style="max-width:820px"><div class="article">
<div class="kicker">Archive</div>
<h1>${esc(title)}</h1>
<p class="dek">Every reviewed recap, newest first. Search for a street, a project, an ordinance, or a name.</p>
<form method="get" action="/notes" class="search" role="search">
<div><label for="q">Search</label><input id="q" type="search" name="q" value="${esc(q)}" placeholder="harbor, budget, ordinance…"></div>
<div><label for="body">Meetings</label><select id="body" name="body">${options.join('')}</select></div>
<button type="submit">Search</button></form>
<h2 class="rubric" style="margin-top:34px">${q ? 'Results' : 'Most recent'}${count ? ` <span class="meta" style="letter-spacing:0;text-transform:none">${count}</span>` : ''}</h2>
${list}</div></main>`,
    {
      seo: {
        description: `Plain-language recaps of ${scope} public meetings: decisions, votes, public comment and what's coming up, linked to the meeting video.`,
        canonical: q ? undefined : `/notes${body ? `?body=${encodeURIComponent(body)}` : ''}`,
        noindex: Boolean(q),
      },
    },
  );
}

export function transcriptHtml(segments: { start?: number; speaker?: string; text?: string }[] | null | undefined): string {
  if (!segments?.length) return '';
  return `<section class="transcript"><h2 class="rubric">Transcript</h2>${segments
    .map((s) => {
      const who = typeof s.speaker === 'string' && s.speaker ? `${esc(s.speaker)}<br>` : '';
      return `<p><span class="who">${who}${hms(Number(s.start) || 0)}</span><span>${esc(s.text)}</span></p>`;
    })
    .join('')}</section>`;
}

type MeetingInfo = { id: string; title: string; body: string; meetingDate: Date | null; sourceUrl: string; platform: string };

export function meetingPage(
  meeting: MeetingInfo & { status: string; error: string | null },
  digest: MeetingDigest | null,
  approved: boolean,
  segments: { start?: number; speaker?: string; text?: string }[],
): string {
  const note = publicStatusNote(meeting.status, Boolean(digest), approved);
  const banner = `<div class="status-line">${pill(meeting.status)}${note ? `<p class="muted">${esc(note)}</p>` : ''}</div>`;
  const transcript = transcriptHtml(segments);
  // A reviewed recap has its own canonical page; drafts stay out of search.
  if (digest) return noteDetailPage(meeting, digest, { banner, after: transcript, draft: !approved });
  const date = formatDate(meeting.meetingDate);
  return shell(
    `${placeBody(meeting.body)} meeting${date ? `, ${date}` : ''} · ${config.newsletterName}`,
    `<main class="wrap" style="max-width:720px"><article class="article">
${banner}<div class="kicker">${esc(meeting.body)}</div>
<h1>${esc(placeBody(meeting.body))} meeting</h1>
${partsList(meeting.title, meeting.body)}
<div class="byline"><span>${esc(date || 'Date unknown')}</span><a href="${esc(meeting.sourceUrl)}">Watch the recording</a></div>
${transcript || '<p class="empty">No transcript yet.</p>'}
</article></main>`,
    { seo: { noindex: true } },
  );
}

export function noteDetailPage(
  meeting: MeetingInfo,
  d: MeetingDigest,
  opts: { banner?: string; after?: string; draft?: boolean; growth?: Growth } = {},
): string {
  const ts = (t: number) =>
    `<a class="ts" href="${esc(timestampUrl(meeting.sourceUrl, meeting.platform, t))}">▶ ${hms(t)}</a>`;
  const h2 = (s: string) => `<h2>${esc(s)}</h2>`;
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '');
  const actions = (d.actions ?? []).filter((a) => a && (a.item || a.outcome));
  const discussion = (d.discussion ?? []).filter((x) => x && (x.topic || x.gist));
  const comments = (d.publicComment ?? []).filter((x) => x && (x.who || x.topic || x.gist));
  const upcoming = (d.upcoming ?? []).filter((x) => x && x.item);
  const background = (d.background ?? []).filter((x) => x && x.point);
  const fixes = (d.nameCorrections ?? []).filter((x) => x && x.heard && x.corrected);
  const checked = (d.checkedAgainst ?? []).map((c) => `<a href="${esc(c.url)}">${esc(c.label)}</a>`);
  const sections = [
    String(d.summary ?? '')
      .split(/\n\s*\n/)
      .map((p) => `<p>${esc(p.trim())}</p>`)
      .join(''),
    actions.length
      ? h2('What they decided') +
        list(actions.map((a) => `<strong>${esc(a.item)}</strong> — ${esc(a.outcome)}${a.vote ? ` (${esc(a.vote)})` : ''} ${ts(a.t)}`))
      : '',
    discussion.length
      ? h2('Also discussed') + list(discussion.map((x) => `<strong>${esc(x.topic)}.</strong> ${esc(x.gist)} ${ts(x.t)}`))
      : '',
    comments.length
      ? h2('What residents said') +
        list(comments.map((x) => `<strong>${esc(x.who)}</strong>, on ${esc(x.topic)}: ${esc(x.gist)} ${ts(x.t)}`))
      : '',
    upcoming.length
      ? h2('Coming up') + list(upcoming.map((x) => `${esc(x.item)}${x.when ? ` — <strong>${esc(x.when)}</strong>` : ''}`))
      : '',
    background.length
      ? h2('Background from local news') +
        list(background.map((x) => `${esc(x.point)} ${(x.sources ?? []).map((u) => `<a href="${esc(u)}">${esc(sourceLabel(u))}</a>`).join(' · ')}`))
      : '',
  ].join('');
  const caveats = [
    ...(Array.isArray(d.caveats) ? d.caveats.filter((c) => typeof c === 'string') : []),
    ...(fixes.length
      ? [`Names corrected from the transcript using the Borough's published spelling: ${fixes.map((f) => `"${f.heard}" → ${f.corrected}`).join(', ')}.`]
      : []),
  ];
  const date = formatDate(meeting.meetingDate);
  const short = meeting.meetingDate ? shortDate(meeting.meetingDate, false) : '';
  // Headline first for search results, then the place and date people search with.
  const title = `${d.headline} | ${placeBody(meeting.body)}${short ? `, ${short}` : ''}`;
  const canonical = noteHref(meeting.id, d.headline);
  const description = describe(d.summary);
  const base = baseUrl();
  return shell(
    title,
    `<main class="wrap" style="max-width:720px"><article class="article">
${opts.banner ?? ''}<div class="kicker">${esc(placeBody(meeting.body))}</div>
<h1>${esc(d.headline)}</h1>
${partsList(meeting.title, meeting.body)}
<div class="byline"><span>${esc(date ? `Meeting of ${date}` : 'Meeting date unknown')}</span><a href="${esc(meeting.sourceUrl)}">Watch the recording</a>${opts.draft ? '' : `<a href="/notes">More recaps</a>`}</div>
<div class="body">${sections}</div>
<div class="notice"><strong>How this was made</strong>Written with AI from the Borough's recording and an automated transcript${opts.draft ? '' : ', then reviewed by a person'}. Names, numbers and votes can be misheard; use the ▶ links to check the video.${checked.length ? `<br><br>Names checked against the ${checked.join(', ')}.` : ''}${caveats.length ? `<br><br>${caveats.map(esc).join('<br>')}` : ''}</div>
${opts.after ?? ''}
${!opts.draft && base ? `<p class="share-head">Share this recap</p>${shareButtons(base + canonical, d.headline, `${d.headline}: what happened at the ${placeBody(meeting.body)} meeting.`)}` : ''}
${!opts.draft && opts.growth ? signupCallout(opts.growth) : ''}
</article></main>`,
    {
      seo: {
        description,
        canonical,
        noindex: opts.draft,
        ogType: 'article',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: d.headline.slice(0, 110),
          description,
          ...(meeting.meetingDate ? { datePublished: meeting.meetingDate.toISOString().slice(0, 10) } : {}),
          ...(base ? { url: `${base}${canonical}`, mainEntityOfPage: `${base}${canonical}` } : {}),
          author: { '@type': 'Organization', name: config.newsletterName },
          publisher: { '@type': 'Organization', name: config.newsletterName },
          about: {
            '@type': 'Event',
            name: `${placeBody(meeting.body)} meeting`,
            ...(meeting.meetingDate ? { startDate: meeting.meetingDate.toISOString().slice(0, 10) } : {}),
            location: { '@type': 'Place', name: 'Ketchikan, Alaska' },
          },
          isBasedOn: meeting.sourceUrl,
        },
      },
    },
  );
}

export interface TopicSummary {
  slug: string;
  name: string;
  description: string;
  meetings: number;
  lastDate: string;
  latest: string;
}

export function topicsIndexPage(topics: TopicSummary[]): string {
  const list = topics.length
    ? `<ul class="docket">${topics
        .map(
          (t) => `<li><a href="/topics/${esc(t.slug)}" style="grid-template-columns:minmax(0,1fr) auto"><div><h3>${esc(t.name)}</h3><p class="headline">${esc(t.description)}</p>${t.latest ? `<p class="meta" style="margin-top:6px">Latest${t.lastDate ? `, ${esc(t.lastDate)}` : ''}: ${esc(t.latest)}</p>` : ''}</div><span class="state done">${t.meetings} meeting${t.meetings === 1 ? '' : 's'}</span></a></li>`,
        )
        .join('')}</ul>`
    : '<p class="empty">Topics appear here once the first issues have been picked out of the recaps.</p>';
  const description = 'The issues that keep coming back to Ketchikan Gateway Borough meetings, each followed from meeting to meeting in plain language.';
  return shell(
    `Ketchikan issues to follow · ${config.newsletterName}`,
    `<main class="wrap" style="max-width:820px"><div class="article">
<div class="kicker">Topics</div>
<h1>The issues, meeting by meeting</h1>
<p class="dek">Some questions take months to settle. Each topic follows one issue across every meeting where it came up, with an in-depth explainer whenever something big happens.</p>
<h2 class="rubric" style="margin-top:30px">Following now</h2>
${list}
<div class="signup" style="margin-top:36px"><h2>Follow an issue</h2><p>Pick topics when you <a href="/#subscribe">subscribe</a>, or from the link at the bottom of any email.</p></div>
</div></main>`,
    { seo: { description, canonical: '/topics' } },
  );
}

export interface TopicTimelineRow {
  meetingId: string;
  body: string;
  date: string;
  summary: string;
  milestone: boolean;
  why: string | null;
  href: string;
  videoHref: string;
}

/** The evergreen page for one issue: the latest deep dive, then every meeting that touched it. */
export function topicPage(
  topic: { slug: string; name: string; description: string },
  rows: TopicTimelineRow[],
  dive: { article: DeepDiveArticle; date: Date; videoAt: (meetingId: string, t: number) => string } | null,
  topics: TopicOption[],
): string {
  const a = dive?.article;
  const ts = (meetingId: string, t: number) => (dive ? `<a class="ts" href="${esc(dive.videoAt(meetingId, t))}">▶ ${hms(t)}</a>` : '');
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '');
  const story = a
    ? `<div class="body">
${a.latest ? `<p>${esc(a.latest)}</p>` : ''}
${a.whyItMatters ? `<h2>Why it matters</h2><p>${esc(a.whyItMatters)}</p>` : ''}
${a.residents.length ? `<h2>What residents said</h2>${list(a.residents.map((x) => `<strong>${esc(x.who)}:</strong> ${esc(x.gist)} ${ts(x.meetingId, x.t)}`))}` : ''}
${a.whatsNext.length ? `<h2>What's next</h2>${list(a.whatsNext.map((x) => `${esc(x.item)}${x.when ? ` — <strong>${esc(x.when)}</strong>` : ''}`))}` : ''}
${a.background.length ? `<h2>Background from local news</h2>${list(a.background.map((x) => `${esc(x.point)} ${x.sources.map((u) => `<a href="${esc(u)}">${esc(sourceLabel(u))}</a>`).join(' · ')}`))}` : ''}
</div>`
    : '';
  const timeline = rows.length
    ? `<ol class="timeline">${rows
        .map(
          (r) => `<li class="${r.milestone ? 'milestone' : ''}"><div class="meta">${esc(r.date || 'Date unknown')} · ${esc(r.body)}${r.milestone ? ' · <b>Key moment</b>' : ''}</div><p>${esc(r.summary)}</p><p class="meta"><a href="${esc(r.href)}">Meeting recap</a> · <a href="${esc(r.videoHref)}">Recording</a></p></li>`,
        )
        .join('')}</ol>`
    : '<p class="empty">No meetings on this topic yet.</p>';
  const headline = a?.headline || topic.name;
  const description = a?.dek || `${topic.description} Followed across every Ketchikan Gateway Borough meeting where it came up.`;
  return shell(
    `${topic.name} in Ketchikan: ${a ? a.headline : 'what the Borough has decided'} · ${config.newsletterName}`,
    `<main class="wrap" style="max-width:720px"><article class="article">
<div class="kicker">Topic · ${esc(topic.name)}</div>
<h1>${esc(headline)}</h1>
${a?.dek ? `<p class="dek">${esc(a.dek)}</p>` : `<p class="dek">${esc(topic.description)}</p>`}
<div class="byline"><span>${rows.length} meeting${rows.length === 1 ? '' : 's'}${dive ? ` · Updated ${esc(shortDate(dive.date, false))}` : ''}</span><a href="#follow">Follow this topic</a><a href="/topics">All topics</a></div>
${story}
<section><h2 class="rubric" style="margin-top:40px">How we got here</h2>${timeline}</section>
<aside class="signup" id="follow" style="margin-top:40px"><h2>Follow ${esc(topic.name)}</h2><p>We'll email you an explainer when something big happens.</p>
<form method="post" action="/subscribe"><label for="email">Email address</label><input id="email" type="email" name="email" required autocomplete="email" placeholder="you@example.com">
<input type="hidden" name="topics" value="${esc(topic.slug)}"><input type="hidden" name="topicOnly" value="1">
<button type="submit">Follow</button></form><p class="hint">Topic emails only. Add meeting recaps anytime from the link in each email.</p></aside>
</article></main>`,
    {
      seo: {
        description: describe(description),
        canonical: `/topics/${topic.slug}`,
        ogType: dive ? 'article' : 'website',
        jsonLd: dive
          ? {
              '@context': 'https://schema.org',
              '@type': 'NewsArticle',
              headline: headline.slice(0, 110),
              description: describe(description),
              dateModified: dive.date.toISOString().slice(0, 10),
              author: { '@type': 'Organization', name: config.newsletterName },
              publisher: { '@type': 'Organization', name: config.newsletterName },
              about: { '@type': 'Thing', name: `${topic.name}, Ketchikan Gateway Borough` },
            }
          : undefined,
      },
    },
  );
}

export interface AdminTopicRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  meetings: number;
  milestones: number;
  dives: { id: string; status: string; createdAt: Date; headline: string; previewHref: string; approveHref: string }[];
}

/** Suggestions to approve or archive, approved topics, and deep-dive drafts. */
export function adminTopicsPage(rows: AdminTopicRow[]): string {
  const btn = (action: string, label: string, cls = '') =>
    `<form method="post" action="${esc(action)}" style="display:inline"><button type="submit" class="btn ${cls}">${esc(label)}</button></form>`;
  const card = (t: AdminTopicRow) => `<div class="hit"><div class="kicker">${esc(t.status)} · ${t.meetings} meeting${t.meetings === 1 ? '' : 's'} · ${t.milestones} key moment${t.milestones === 1 ? '' : 's'}</div>
<h2>${esc(t.name)}</h2><p>${esc(t.description)}</p>
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px">${
    t.status === 'SUGGESTED'
      ? btn(`/admin/topics/${t.id}/approve`, 'Approve') + btn(`/admin/topics/${t.id}/archive`, 'Not a topic', 'ghost')
      : `${btn(`/admin/topics/${t.id}/dive`, 'Write a deep dive now')}${btn(`/admin/topics/${t.id}/archive`, 'Archive', 'ghost')}<a href="/topics/${esc(t.slug)}" class="meta">Public page →</a>`
  }</div>
${t.dives.length ? `<ul class="parts" style="margin-top:10px">${t.dives.map((d) => `<li>${esc(d.status)} · ${esc(d.headline)} · <a href="${esc(d.previewHref)}">Preview</a>${d.status === 'DRAFT' ? ` · <a href="${esc(d.approveHref)}">Approve and send</a>` : ''}</li>`).join('')}</ul>` : ''}</div>`;
  const suggested = rows.filter((r) => r.status === 'SUGGESTED');
  const approved = rows.filter((r) => r.status === 'APPROVED');
  return adminPage(
    'Topics',
    'topics',
    `<h1>Topics</h1>
<p class="lede">Claude suggests issues as it reads each recap; the ones raised at the most meetings are at the top. Approved topics get a public page, a signup option, and a deep dive drafted automatically after each key moment.</p>
<p>${btn('/admin/topics/scan', 'Tag older recaps now')}</p>
<h2 class="section">Suggested (${suggested.length})</h2>${suggested.length ? `<div class="hits">${suggested.map(card).join('')}</div>` : '<p class="muted">No suggestions waiting.</p>'}
<h2 class="section">Approved (${approved.length})</h2>${approved.length ? `<div class="hits">${approved.map(card).join('')}</div>` : '<p class="muted">None yet.</p>'}
`,
  );
}
