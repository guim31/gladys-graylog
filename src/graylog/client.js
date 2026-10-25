// -----------------------------------------------------------------------------
// Graylog REST API client (`http://<host>:9000/api`), in HTTP Basic auth: an
// access token (`<token>:token`, the way Graylog documents it) or a user and
// its password. Read only: every request is a GET, except the event search,
// and the metrics, POSTs that change nothing (Graylog wants `X-Requested-By`).
//
// One read (snapshot) = five or six requests: the version (`system`, once
// an hour), the throughput and journal of every node (`cluster/metrics`), the
// input states of every node, the health of the OpenSearch / Elasticsearch
// cluster, the event definitions, and the events of the last 24 hours
// (`events/search`), newest first.
//
// Errors are thrown as GraylogError with a `kind` (ERROR_KINDS): the hub and
// the texts know what to tell the user from it.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer, timeout, 502/503/504
  TLS: 'tls', // the certificate does not verify (and the option is off)
  AUTH: 'auth', // token, user or password refused (401)
  CREDENTIALS_MISSING: 'credentials_missing', // nothing in the configuration
  NOT_GRAYLOG: 'not_graylog', // something answers, but not the REST API of Graylog
  PERMISSION: 'permission', // 403: the user lacks a permission
  HTTP: 'http', // anything else
});

export class GraylogError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message for the logs (never a secret)
   * @param {object} [extra] e.g. { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'GraylogError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// The events counted and listed: the last 24 hours.
export const EVENTS_RANGE_SECONDS = 24 * 3600;
// Events read per cycle, newest first: the counts come from Graylog's total,
// the new events from this page.
export const EVENTS_PAGE = 200;
// Definitions counted one by one when the page does not hold every event.
export const MAX_COUNTED_DEFINITIONS = 50;
export const DEFINITIONS_PAGE = 500;

// Input states that mean "broken", not "stopped by someone": Graylog marks a
// failed input FAILED (or FAILING while it retries), and a configuration it
// cannot use INVALID_CONFIGURATION. A STOPPED input was stopped on purpose.
export const FAILED_INPUT_STATES = new Set(['FAILED', 'FAILING', 'INVALID_CONFIGURATION']);
export const STORAGE_STATES = ['green', 'yellow', 'red'];

export const METRICS = Object.freeze({
  IN: 'org.graylog2.throughput.input.1-sec-rate',
  OUT: 'org.graylog2.throughput.output.1-sec-rate',
  JOURNAL: 'org.graylog2.journal.entries-uncommitted',
});

const integer = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : null);
const string = (value) => (typeof value === 'string' ? value : '');

export class GraylogClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL of the REST API (…/api)
   * @param {string} [options.token] access token (preferred)
   * @param {string} [options.username]
   * @param {string} [options.password]
   * @param {boolean} [options.insecure] accept a certificate that does not verify
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({
    url,
    token = '',
    username = '',
    password = '',
    insecure = false,
    request = httpRequest,
    timeoutMs = 15_000,
  }) {
    this.url = url;
    this.credentials = token
      ? `${token}:token`
      : username && password
        ? `${username}:${password}`
        : '';
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.info = null;
  }

  /** Forget the version: read again before the next request (Graylog upgraded). */
  reset() {
    this.info = null;
  }

  /**
   * One request to the REST API.
   * @param {string} path after the API base, e.g. `/system`
   * @param {{ method?: string, body?: object, optional?: boolean }} [options]
   *   optional: a 403 or 404 answers null (a permission or an endpoint the
   *   user or the version does not have)
   * @returns {Promise<object|null>} the parsed answer
   * @throws {GraylogError}
   */
  async call(path, { method = 'GET', body, optional = false } = {}) {
    if (!this.credentials) {
      throw new GraylogError(ERROR_KINDS.CREDENTIALS_MISSING, 'No token nor user configured');
    }
    const headers = {
      authorization: `Basic ${Buffer.from(this.credentials).toString('base64')}`,
      accept: 'application/json',
      // Graylog refuses a POST without it (CSRF protection).
      'x-requested-by': 'gladys',
    };
    if (body) {
      headers['content-type'] = 'application/json';
    }
    let response;
    try {
      response = await this.request(`${this.url}${path}`, {
        method,
        body: body ? JSON.stringify(body) : '',
        headers,
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (TLS_CODES.has(err.code)) {
        throw new GraylogError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
      }
      if (!err.code) {
        // The server answers, but not as expected (an answer too large…).
        throw new GraylogError(ERROR_KINDS.HTTP, err.message);
      }
      // Plain HTTP on an HTTPS port, a refused connection, a timeout.
      throw new GraylogError(ERROR_KINDS.UNREACHABLE, `${err.code}`);
    }

    const { status } = response;
    if ([502, 503, 504].includes(status)) {
      // A reverse proxy in front of a stopped Graylog, or Graylog starting.
      throw new GraylogError(ERROR_KINDS.UNREACHABLE, `HTTP ${status}`, { status });
    }
    if (status === 401) {
      throw new GraylogError(ERROR_KINDS.AUTH, 'Refused (HTTP 401)', { status });
    }
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      parsed = null;
    }
    if (optional && (status === 403 || status === 404)) {
      return null;
    }
    if (status === 403) {
      throw new GraylogError(ERROR_KINDS.PERMISSION, `${method} ${path}: HTTP 403`, { status });
    }
    if (status >= 200 && status < 300 && parsed && typeof parsed === 'object') {
      return parsed;
    }
    // Not JSON, or a 404 on the very first request: not a Graylog API.
    throw new GraylogError(
      parsed === null || status === 404 ? ERROR_KINDS.NOT_GRAYLOG : ERROR_KINDS.HTTP,
      `${method} ${path}: ${parsed === null ? 'not a Graylog API answer' : string(parsed.message).slice(0, 200)} (HTTP ${status})`,
      { status },
    );
  }

  /** Read the version once (again after reset()). */
  async detect() {
    if (this.info) {
      return this.info;
    }
    let system;
    try {
      system = await this.call('/system');
    } catch (err) {
      // Another JSON API on this port (OpenSearch answers 400) is not Graylog.
      throw err.kind === ERROR_KINDS.HTTP
        ? new GraylogError(ERROR_KINDS.NOT_GRAYLOG, err.message, { status: err.status })
        : err;
    }
    if (typeof system.version !== 'string' || !system.cluster_id) {
      throw new GraylogError(ERROR_KINDS.NOT_GRAYLOG, 'GET /system: no Graylog version');
    }
    // "6.1.10+e6b6bd5": the build after the "+" says nothing to a user.
    this.info = { version: system.version.split('+')[0] };
    return this.info;
  }

  /**
   * Messages per second and journal backlog, summed over the nodes of the
   * cluster (one request: the metrics the header of the web interface shows).
   * A metric Graylog has not created yet (no message received since it
   * started) is absent: 0 for the rate. Null when not readable.
   * @returns {Promise<{ throughput: number|null, journal: number|null }>}
   */
  async metrics() {
    const answer = await this.call('/cluster/metrics/multiple', {
      method: 'POST',
      body: { metrics: [METRICS.IN, METRICS.OUT, METRICS.JOURNAL] },
      optional: true,
    });
    const nodes = Object.values(answer ?? {}).filter((node) => Array.isArray(node?.metrics));
    if (nodes.length === 0) {
      // No metrics:read permission, or an older Graylog: this node only.
      const [rate, journal] = [
        await this.call('/system/throughput', { optional: true }),
        await this.call('/system/journal', { optional: true }),
      ];
      return {
        throughput: integer(rate?.throughput),
        journal: integer(journal?.uncommitted_journal_entries),
      };
    }
    const sum = (name) => {
      const values = nodes
        .map((node) => node.metrics.find((metric) => metric?.full_name === name)?.metric?.value)
        .filter((value) => Number.isFinite(Number(value)));
      return values.length > 0 ? values.reduce((total, value) => total + Number(value), 0) : null;
    };
    const input = sum(METRICS.IN);
    return {
      // Received, as the "In" of the web interface; sent to storage before
      // the first message, which creates the input metric.
      throughput: integer(input ?? sum(METRICS.OUT) ?? 0),
      journal: integer(sum(METRICS.JOURNAL)),
    };
  }

  /** The inputs of every node, and the ones that failed. */
  async inputs() {
    const answer = await this.call('/cluster/inputstates', { optional: true });
    const all = [];
    for (const [node, states] of Object.entries(answer ?? {})) {
      for (const entry of Array.isArray(states) ? states : []) {
        const input = entry?.message_input ?? {};
        const id = string(input.id) || string(entry?.id);
        if (!id) {
          continue;
        }
        all.push({
          key: `${node}:${id}`,
          id,
          node,
          title: string(input.title) || id,
          type: string(input.name) || string(input.type).split('.').pop(),
          state: string(entry.state),
          message: string(entry.detailed_message).split('\n')[0].slice(0, 300),
        });
      }
    }
    return {
      total: all.length,
      all,
      failed: all.filter((input) => FAILED_INPUT_STATES.has(input.state)),
    };
  }

  /** green, yellow or red; null when not readable (no permission). */
  async storage() {
    const answer = await this.call('/system/indexer/cluster/health', { optional: true });
    const status = string(answer?.status).toLowerCase();
    return STORAGE_STATES.includes(status) ? status : null;
  }

  /** The event definitions, sorted by title. */
  async definitions() {
    const answer = await this.call(`/events/definitions?per_page=${DEFINITIONS_PAGE}&page=1`, {
      optional: true,
    });
    return (Array.isArray(answer?.event_definitions) ? answer.event_definitions : [])
      .filter((definition) => typeof definition?.id === 'string' && definition.id)
      .map((definition) => ({
        id: definition.id,
        title: string(definition.title) || definition.id,
        priority: integer(definition.priority) ?? 2,
        alert: Boolean(definition.alert),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  /**
   * Search the events of the last 24 hours, newest first.
   * @param {{ perPage?: number, alerts?: 'include'|'only'|'exclude', definitions?: string[] }} [options]
   */
  async search({ perPage = EVENTS_PAGE, alerts = 'include', definitions = [] } = {}) {
    const answer = await this.call('/events/search', {
      method: 'POST',
      body: {
        query: '',
        page: 1,
        per_page: perPage,
        filter: { alerts, event_definitions: definitions },
        timerange: { type: 'relative', range: EVENTS_RANGE_SECONDS },
        sort_by: 'timestamp',
        sort_direction: 'desc',
      },
    });
    const titles = answer.context?.event_definitions ?? {};
    const events = (Array.isArray(answer.events) ? answer.events : [])
      .map((row) => row?.event ?? {})
      .filter((event) => typeof event.id === 'string' && event.id)
      .map((event) => ({
        id: event.id,
        definitionId: string(event.event_definition_id),
        title: string(titles[event.event_definition_id]?.title),
        message: string(event.message).split('\n')[0].slice(0, 500),
        alert: Boolean(event.alert),
        priority: integer(event.priority) ?? 2,
        source: string(event.source),
        key: string(event.key),
        timestamp: Date.parse(event.timestamp) || 0,
      }));
    return { total: integer(answer.total_events) ?? events.length, events };
  }

  /**
   * Everything one cycle needs.
   * @returns {Promise<object>} version, throughput, inputs, storage, journal,
   *   definitions, events { total, alerts, list, byDefinition }
   * @throws {GraylogError}
   */
  async snapshot() {
    const info = await this.detect();
    const [{ throughput, journal }, inputs, storage, definitions, page] = [
      await this.metrics(),
      await this.inputs(),
      await this.storage(),
      await this.definitions(),
      await this.search(),
    ];
    const complete = page.events.length >= page.total;
    const alerts = complete
      ? page.events.filter((event) => event.alert).length
      : (await this.search({ perPage: 1, alerts: 'only' })).total;

    // Per definition: its count and its last event, from the page when it
    // holds every event of the last 24 hours, else one small search each.
    const byDefinition = new Map(definitions.map((d) => [d.id, { count: 0, last: null }]));
    for (const event of page.events) {
      const stats = byDefinition.get(event.definitionId);
      if (stats && complete) {
        stats.count += 1;
      }
      if (stats && (stats.last === null || event.timestamp > stats.last)) {
        stats.last = event.timestamp;
      }
    }
    if (!complete) {
      for (const definition of definitions.slice(0, MAX_COUNTED_DEFINITIONS)) {
        const one = await this.search({ perPage: 1, definitions: [definition.id] });
        byDefinition.set(definition.id, {
          count: one.total,
          last: one.events[0]?.timestamp ?? null,
        });
      }
    }
    for (const event of page.events) {
      event.title ||= definitions.find((d) => d.id === event.definitionId)?.title ?? '';
    }
    return {
      ...info,
      throughput,
      inputs,
      storage,
      journal,
      definitions,
      events: { total: page.total, alerts, list: page.events, byDefinition },
    };
  }
}
