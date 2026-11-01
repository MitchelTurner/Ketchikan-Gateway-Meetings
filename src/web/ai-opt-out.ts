import type { NextFunction, Request, Response } from 'express';

/**
 * Product tokens for crawlers that train models or answer from other people's
 * sites. Ordinary search (Googlebot, Bingbot) and link-preview fetchers stay
 * allowed. Names follow the public AI crawler list, minus tokens short enough
 * to match a normal browser and minus Applebot and facebookexternalhit.
 */
const AI_CRAWLERS = `
AddSearchBot
AgentDataBot
AgentTimes
AGI Agent
AI2Bot
AI2Bot-DeepResearchEval
Ai2Bot-Dolma
aiHitBot
AIWebIndex
amazon-kendra
amazon-QBusiness
Amazonbot
AmazonBuyForMe
Amzn-SearchBot
Amzn-User
Andibot
Anomura
anthropic-ai
ApifyBot
ApifyWebsiteContentCrawler
Applebot-Extended
Aranet-SearchBot
atlassian-bot
Awario
AzureAI-SearchBot
bedrockbot
bigsur.ai
BixelBot
Bravebot
Brightbot
Brightbot 1.0
BuddyBot
Bytespider
CartAI Agentic Commerce
CCBot
Channel3Bot
ChatGLM-Spider
ChatGPT Agent
ChatGPT-User
Claude-Code
Claude-SearchBot
Claude-User
Claude-Web
ClaudeBot
CledaraBot
Cloudflare-AutoRAG
CloudflareBrowserRenderingCrawler
CloudVertexBot
Codex
cohere-ai
cohere-training-data-crawler
Cotoyogi
CragCrawler
Crawl4AI
Crawlspace
Cursor
Datenbank Crawler
DeepSeekBot
Devin
Diffbot
Diffbot-User
DoubaoBot
DuckAssistBot
Echobot Bot
EchoboxBot
ElevenlabsBot
ElevenlabsCrawler
ERNIEBot
ExaBot
ExaSearchBot
ExaUser
FacebookBot
Factset_spyderbot
FirecrawlAgent
FriendlyCrawler
GeistHaus-PageFetcher
Gemini-Deep-Research
Google-Agent
Google-CloudVertexBot
Google-Extended
Google-Firebase
Google-Gemini-CLI
Google-NotebookLM
GoogleAgent-Mariner
GoogleAgent-URLContext
GoogleOther
GoogleOther-Image
GoogleOther-Video
GPTBot
Grok Bot
GrokAppAndroid
GrokBot
HarkBot
HenkBot
Hunyuan
iAskBot
iaskspider
iaskspider/2.0
ICC-Crawler
ImagesiftBot
imageSpider
img2dataset
ISSCyberRiskCrawler
kagi-fetcher
Kangaroo Bot
KeenableBot
Kimi-Agent
Kimi-SearchBot
Kimi-User
KimiBot
KlaviyoAIBot
KunatoCrawler
laion-huggingface-processor
LAIONDownloader
Lightpanda
LinerBot
Linguee Bot
LinkupBot
Manus-User
Meta-ExternalAgent
Meta-ExternalFetcher
meta-webindexer
MistralAI-Index
MistralAI-Training
MistralAI-User
MistralAI-User/1.0
MoonshotBot
Mozilla-Tabstack
MyCentralAIScraperBot
NagetBot
netEstate Imprint Crawler
newsai
NotebookLM
NovaAct
OAI-AdsBot
OAI-SearchBot
omgili
omgilibot
OpenAI
opencode
PanguBot
Panscient
panscient.com
Payhawk Invoice Fetching Agent
Perplexity-User
PerplexityBot
PetalBot
PhindBot
Poggio-Citations
Poseidon Research Crawler
qodercli
QualifiedBot
Querit-SearchBot
QueritBot
QuillBot
quillbot.com
QwenBot
Reflectionbot
SBIntuitionsBot
Scrapy
ScryBot
SemrushBot-OCOB
SemrushBot-SWA
Shap-User
ShapBot
Sidetrade indexer bot
TavilyBot
Terra Cotta
TerraCotta
Thinkbot
TikTokSpider
Timpibot
TongyiBot
Trae
TwinAgent
UseAI
VelenPublicWebCrawler
WARDBot
Webzio-Extended
WRTNBot
xAI-Grok
YandexAdditional
YandexAdditionalBot
YiBot
YiyanBot
YouBot
ZanistaBot
`
  .trim()
  .split(/\n+/)
  .map((name) => name.trim())
  .filter(Boolean);

const AI_CRAWLER_TOKENS = [...new Set(AI_CRAWLERS.map((name) => name.toLowerCase()))];

/** Spawning-style robots tokens. Search engines ignore the ones they do not know. */
export const AI_ROBOTS_CONTENT = 'noai, noimageai';

/** W3C Text and Data Mining Reservation. 1 means the content is reserved. */
export const TDM_RESERVATION = '1';

/** True when this User-Agent is a known AI crawler. An empty agent is not one. */
export function isAiCrawler(userAgent: string | undefined): boolean {
  const ua = String(userAgent ?? '').toLowerCase();
  if (!ua) return false;
  return AI_CRAWLER_TOKENS.some((token) => token.length >= 5 && ua.includes(token));
}

/** robots.txt group: every listed crawler is disallowed from the whole site. */
export function aiRobotsGroup(): string {
  return `${AI_CRAWLERS.map((name) => `User-agent: ${name}`).join('\n')}\nDisallow: /\n`;
}

function requestPath(req: Request): string {
  return String(req.originalUrl || req.url || '/').split('?')[0];
}

/**
 * Asks every response not to be mined, and refuses known AI crawlers.
 * robots.txt and the health check stay readable so the crawler can see the
 * refusal and Railway can see the process.
 */
export function refuseAiCrawlers(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Robots-Tag', AI_ROBOTS_CONTENT);
  res.setHeader('tdm-reservation', TDM_RESERVATION);
  const path = requestPath(req);
  if (path === '/robots.txt' || path === '/health') {
    next();
    return;
  }
  const header = req.headers['user-agent'];
  const agent = Array.isArray(header) ? header.join(' ') : header;
  if (!isAiCrawler(agent)) {
    next();
    return;
  }
  res.status(403).type('text/plain; charset=utf-8').send('This content is not available to AI crawlers.\n');
}
