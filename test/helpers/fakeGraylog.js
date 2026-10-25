// -----------------------------------------------------------------------------
// An in-memory Graylog REST API, built from the real answers of Graylog
// 6.1.16 (test/fixtures/graylog/, recorded against graylog/graylog:6.1 with
// MongoDB 6 and OpenSearch 2.15, ids and host names anonymized). The tests
// change its state (an input failing, the storage turning red, new events)
// and its behaviour (silent, refusing the token…).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/graylog/${name}.json`, import.meta.url), 'utf8'));

export const ADDRESS = '192.0.2.10';
export const API_URL = 'http://192.0.2.10:9000/api';
export const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstuvwxyz';
export const NODE_ID = '00000000-0000-4000-8000-000000000001';

export class FakeGraylog {
  constructor() {
    this.system = fixture('system');
    this.metrics = fixture('metrics');
    this.inputStates = fixture('inputstates');
    this.health = fixture('health');
    this.definitionsAnswer = fixture('definitions');
    const search = fixture('events');
    this.events = search.events;
    this.titles = search.context.event_definitions;
    /** null, 'down' (no answer), 'auth' (401), 'html' (a web page), 'forbidden' (403 on every call) */
    this.failure = null;
    /** Paths answered 403 / 404 (a permission or an endpoint missing). */
    this.forbidden = new Set();
    this.missing = new Set();
    this.requests = [];
  }

  /** Set the state of an input by title (RUNNING, FAILED…), with its message. */
  setInput(title, state, message = null) {
    const entry = Object.values(this.inputStates)
      .flat()
      .find((input) => input.message_input.title === title);
    entry.state = state;
    entry.detailed_message = message;
  }

  setStorage(status) {
    this.health.status = status;
  }

  /** A new event of a definition, now (or at `time`). */
  addEvent({ id, definitionId, message, alert = false, priority = 2, time }) {
    this.events.unshift({
      event: {
        id,
        event_definition_type: 'aggregation-v1',
        event_definition_id: definitionId,
        timestamp: new Date(time).toISOString(),
        message,
        source: 'graylog',
        key: null,
        priority,
        alert,
        fields: {},
      },
      index_name: 'gl-events_0',
      index_type: 'message',
    });
  }

  answer(status, body) {
    return {
      status,
      headers: {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    };
  }

  async request(url, { method = 'GET', body, headers = {} } = {}) {
    const target = new URL(url);
    const path = target.pathname.replace(/^\/api/, '');
    this.requests.push({ method, path, headers, body });
    if (this.failure === 'down') {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
    if (this.failure === 'html') {
      return this.answer(200, '<!DOCTYPE html><html><title>Graylog Web Interface</title></html>');
    }
    if (this.failure === 'auth' || !this.authorized(headers.authorization)) {
      return this.answer(401, '');
    }
    if (this.failure === 'forbidden' || this.forbidden.has(path)) {
      return this.answer(403, { type: 'ApiError', message: 'Not authorized' });
    }
    if (this.missing.has(path)) {
      return this.answer(404, { type: 'ApiError', message: 'HTTP 404 Not Found' });
    }
    if (method === 'POST' && headers['x-requested-by'] === undefined) {
      return this.answer(400, { type: 'ApiError', message: 'CSRF protection' });
    }
    const route = `${method} ${path}`;
    switch (route) {
      case 'GET /system':
        return this.answer(200, this.system);
      case 'POST /cluster/metrics/multiple':
        return this.answer(200, this.metrics);
      case 'GET /system/throughput':
        return this.answer(200, { throughput: 3 });
      case 'GET /system/journal':
        return this.answer(200, { uncommitted_journal_entries: 0 });
      case 'GET /cluster/inputstates':
        return this.answer(200, this.inputStates);
      case 'GET /system/indexer/cluster/health':
        return this.answer(200, this.health);
      case 'GET /events/definitions':
        return this.answer(200, this.definitionsAnswer);
      case 'POST /events/search':
        return this.answer(200, this.search(JSON.parse(body)));
      default:
        return this.answer(404, { type: 'ApiError', message: 'HTTP 404 Not Found' });
    }
  }

  authorized(header = '') {
    const decoded = Buffer.from(header.replace(/^Basic /, ''), 'base64').toString('utf8');
    return decoded === `${TOKEN}:token` || decoded === 'admin:secret-password';
  }

  search({ per_page: perPage, filter }) {
    const matching = this.events.filter(
      ({ event }) =>
        (filter.alerts !== 'only' || event.alert) &&
        (filter.alerts !== 'exclude' || !event.alert) &&
        (filter.event_definitions.length === 0 ||
          filter.event_definitions.includes(event.event_definition_id)),
    );
    const sorted = [...matching].sort((a, b) => b.event.timestamp.localeCompare(a.event.timestamp));
    return {
      events: sorted.slice(0, perPage),
      total_events: matching.length,
      context: { event_definitions: this.titles, streams: {} },
    };
  }
}
