// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Graylog server (or cluster), through its REST API: `http://host:9000/api`
// by default. The address can be typed with or without scheme and port, or
// copied from the web interface or the API browser
// (`http://192.0.2.5:9000/api/api-browser`).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  graylog_url: '',
  api_token: '',
  username: '',
  password: '',
  poll_interval: '60',
  allow_self_signed: false,
  language: 'fr',
};

export const DEFAULT_PORT = '9000';
const API_PATH = '/api';

/**
 * Parse the address typed by the user into the base URL of the REST API:
 * `192.0.2.5`, `graylog.lan:9000`, `https://logs.example.org`,
 * `http://192.0.2.5:9000/api/…`, or a reverse proxy path. HTTP and port 9000
 * unless typed; with https:// and no port, the port of HTTPS (a reverse proxy).
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host:port[/prefix]/api`, null when unusable
 */
export function parseApiUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  const withScheme = hasScheme ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  // A bare address is the Graylog server itself, on port 9000. An address
  // typed with its scheme keeps that scheme's port: the reverse proxy case.
  const authority = (withScheme.split('/')[2] ?? '').split(/[?#]/)[0];
  if (!hasScheme && !/:\d+$/.test(authority)) {
    url.port = DEFAULT_PORT;
  }
  // Everything before /api is the prefix of a reverse proxy. The paths of the
  // web interface (/search, /alerts, /system/…) are dropped.
  const at = url.pathname.search(/\/api(\/|$)/);
  let prefix = at >= 0 ? url.pathname.slice(0, at) : url.pathname;
  prefix = prefix.replace(/\/(search|alerts|streams|system|dashboards|welcome)(\/.*)?$/, '');
  prefix = prefix.replace(/\/+$/, '');
  return `${url.origin}${prefix}${API_PATH}`;
}

/** The address shown to the user: host and port, without scheme nor API path. */
export const addressOf = (apiUrl) =>
  apiUrl.replace(/^https?:\/\//, '').replace(new RegExp(`${API_PATH}$`), '');

const isTrue = (value) => value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  // A pasted secret often carries a trailing space or new line.
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  const typed = text('graylog_url');
  const apiUrl = parseApiUrl(typed);
  return {
    apiUrl,
    invalidUrl: Boolean(typed) && !apiUrl,
    token: text('api_token'),
    username: text('username'),
    password: text('password'),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    allowSelfSigned:
      source.allow_self_signed === undefined || source.allow_self_signed === null
        ? DEFAULT_CONFIG.allow_self_signed
        : isTrue(source.allow_self_signed),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
