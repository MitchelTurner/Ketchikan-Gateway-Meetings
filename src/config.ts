// All settings come from environment variables (see .env.example).
// Getters are lazy so a missing key only errors when that feature is used.

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
}
function opt(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  get port() { return Number(opt('PORT', '3000')); },
  /**
   * Public origin, always https except on localhost. A Railway value of
   * http://ketchikan.vote would otherwise put http links in emails and the
   * canonical tag, and the browser would show the site as not secure.
   */
  get publicBaseUrl() {
    const raw = req('PUBLIC_BASE_URL').replace(/\/$/, '');
    try {
      const u = new URL(raw);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
      if (u.protocol === 'http:' && !local) return raw.replace(/^http:/, 'https:');
    } catch {
      /* keep the raw value; callers already require a usable URL */
    }
    return raw;
  },

  // Source
  get archiveUrl() { return opt('ARCHIVE_URL', 'https://www.kgbak.us/434/Meeting-Video-Archive'); },
  /**
   * City of Ketchikan posts council and board meetings here.
   * Set CITY_YOUTUBE_URL empty to skip them.
   */
  get cityYoutubeUrl() {
    const v = process.env.CITY_YOUTUBE_URL;
    if (v === undefined) return 'https://www.youtube.com/@cityofketchikan8631';
    return v.trim();
  },
  get userAgent() {
    return opt('SCRAPER_USER_AGENT', 'KGBMeetingDigest/0.1 (+contact: set SCRAPER_USER_AGENT)');
  },
  get discoveryCron() { return opt('DISCOVERY_CRON', '17 */3 * * *'); },
  get timezone() { return opt('TZ_NAME', 'America/Anchorage'); },
  /** Meetings dated before this are recorded but not processed (avoids paying to backfill the whole archive). */
  get processSince(): Date {
    const v = process.env.PROCESS_SINCE;
    if (v) return new Date(`${v}T00:00:00Z`);
    return new Date(Date.now() - 14 * 24 * 3600 * 1000);
  },
  /**
   * Meetings dated before this are backfill: transcribed and published on /notes,
   * but never emailed (no review email, no subscriber email). Default: 14 days ago.
   */
  get emailSince(): Date {
    const v = process.env.EMAIL_SINCE;
    if (v) return new Date(`${v}T00:00:00Z`);
    return new Date(Date.now() - 14 * 24 * 3600 * 1000);
  },
  get channelListLimit() { return Number(opt('CHANNEL_LIST_LIMIT', '30')); },

  // Media
  get ytdlpPath() { return opt('YTDLP_PATH', 'yt-dlp'); },
  get ytdlpCookiesB64() { return process.env.YTDLP_COOKIES_B64 || ''; },

  // Transcription
  get transcriptionProvider() { return opt('TRANSCRIPTION_PROVIDER', 'assemblyai') as 'assemblyai' | 'openai'; },
  get assemblyaiKey() { return req('ASSEMBLYAI_API_KEY'); },
  get openaiKey() { return req('OPENAI_API_KEY'); },

  // Analysis
  get anthropicKey() { return req('ANTHROPIC_API_KEY'); },
  get anthropicModel() { return opt('ANTHROPIC_MODEL', 'claude-sonnet-5-5'); },

  // Research: names, agenda and news found on the web before transcription
  get researchEnabled() { return opt('RESEARCH_ENABLED', 'true') === 'true'; },
  get researchModel() { return opt('RESEARCH_MODEL', this.anthropicModel); },
  /** Sites web search and fetch may use. Empty = the whole web. */
  get researchDomains(): string[] {
    return list(opt('RESEARCH_DOMAINS', 'kgbak.us,granicus.com,ktn-ak.us,ketchikan.gov,kgbsd.org,ketchikandailynews.com,krbd.org,alaskapublic.org,alaskabeacon.com,adn.com,akleg.gov'));
  },
  /** "Name — Role; Name — Role". Spellings you want used even when the web disagrees. */
  get knownNames(): { name: string; role: string }[] {
    return (process.env.KNOWN_NAMES || '')
      .split(';')
      .map((s) => s.split(/\s+[—–-]\s+/))
      .map(([name, role]) => ({ name: (name || '').trim(), role: (role || '').trim() }))
      .filter((p) => p.name);
  },

  // Email
  get resendKey() { return req('RESEND_API_KEY'); },
  get emailFrom() { return req('EMAIL_FROM'); },
  get newsletterName() {
    const v = opt('NEWSLETTER_NAME', 'Ketchikan.Vote');
    return v === 'Borough Meeting Recap' ? 'Ketchikan.Vote' : v;
  },
  get mailingAddress() { return req('MAILING_ADDRESS'); }, // CAN-SPAM requires a postal address
  get adminEmail() { return req('ADMIN_EMAIL'); },
  get autoSend() { return opt('AUTO_SEND', 'false') === 'true'; },
  /**
   * Subscriber mail. The admin address and signing secret are only for a
   * review copy, which new posts no longer wait on.
   */
  get emailReady() {
    return Boolean(
      process.env.RESEND_API_KEY &&
        process.env.EMAIL_FROM &&
        process.env.MAILING_ADDRESS &&
        process.env.PUBLIC_BASE_URL,
    );
  },

  // Security
  get adminToken() { return req('ADMIN_TOKEN'); },
  get signingSecret() { return req('SIGNING_SECRET'); },

  // Redis. Railway only injects REDIS_URL when this service references the
  // Redis service. REDISHOST / REDIS_HOST are the template's other names.
  // The image starts a local Redis when none of these are set.
  get redisUrl() { return resolveRedisUrl(); },
};

function list(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function resolveRedisUrl(): string {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const host = process.env.REDISHOST || process.env.REDIS_HOST;
  if (host) {
    const port = process.env.REDISPORT || process.env.REDIS_PORT || '6379';
    const user = process.env.REDISUSER || process.env.REDIS_USER || '';
    const pass = process.env.REDISPASSWORD || process.env.REDIS_PASSWORD || '';
    const auth = user || pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
    return `redis://${auth}${host}:${port}`;
  }
  return 'redis://127.0.0.1:6379';
}

/** ioredis options from a URL. family: 0 is needed for Railway's private (IPv6) network. */
export function redisConnection() {
  const u = new URL(config.redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    family: 0,
    maxRetriesPerRequest: null,
  };
}
