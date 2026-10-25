// -----------------------------------------------------------------------------
// The Graylog hub: reads Graylog on a timer of the container (the interval
// chosen in the configuration), publishes the states of the added devices
// when they change, fires the scene events (a new event or alert, an input
// failing or running again, the storage turning red or back, Graylog silent),
// and holds the views the widget and the scene action read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire for every event definition, added to Gladys or not.
//
// What was already announced is kept in /data (src/store.js): the ids of the
// events seen in the last 24 hours, the failed inputs, a red storage. An
// event raised while the integration or Gladys restarted is still announced,
// once. The very first read only records what is there.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { addressOf } from './config.js';
import {
  buildDefinitionDevice,
  buildServerDevice,
  definitionIds,
  definitionValues,
  parseDefinitionId,
  serverIds,
  serverValues,
} from './devices.js';
import { ERROR_KINDS, GraylogClient, GraylogError } from './graylog/client.js';
import { FailureLog } from './logs.js';
import { CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'graylog-hub' });

export const WIDGET_KEY = 'alerts';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  EVENT: 'event_triggered',
  INPUT_FAILED: 'input_failed',
  INPUT_RECOVERED: 'input_recovered',
  STORAGE_RED: 'storage_red',
  STORAGE_RECOVERED: 'storage_recovered',
  UNREACHABLE: 'graylog_unreachable',
});

// Graylog's priorities of an event definition; 4 and above: critical.
export const PRIORITY_NAMES = {
  en: ['low', 'normal', 'high', 'critical'],
  fr: ['basse', 'normale', 'haute', 'critique'],
  de: ['niedrig', 'normal', 'hoch', 'kritisch'],
  es: ['baja', 'normal', 'alta', 'crítica'],
};
export const priorityName = (priority, language) =>
  (PRIORITY_NAMES[language] ?? PRIORITY_NAMES.en)[Math.min(4, Math.max(1, priority)) - 1];

export const HUB_TIMINGS = {
  // A Graylog that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before Graylog counts as unreachable (scene event).
  downAfterFailures: 2,
  // A scene action or the widget reads Graylog again when the last read is older.
  freshMs: 15_000,
  // The version is read again this often (Graylog upgraded in place).
  detectEveryMs: 3600_000,
  // An unchanged value is sent again this often: Gladys marks a value older
  // than 48 h as outdated.
  heartbeatMs: 6 * 3600_000,
};

// Scene events per read, at most: Gladys accepts 300 per minute, and a
// definition without grace period can raise dozens of events at once. The
// rest waits for the next reads.
export const MAX_EVENTS_PER_READ = 30;
// Event ids kept as "seen": a day of events, and no more than this many.
const SEEN_KEEP_MS = 25 * 3600_000;
const MAX_SEEN = 3000;

const MAX_STATES_PER_REQUEST = 100;

const signature = (config) =>
  JSON.stringify([
    config.apiUrl,
    config.token,
    config.username,
    config.password,
    config.allowSelfSigned,
  ]);
// What decides which events are seen: another server or another user (who
// may see other streams). Hashed: the token never reaches /data.
const scopeOf = (config) =>
  JSON.stringify([
    config.apiUrl,
    createHash('sha256')
      .update(config.token ? `token:${config.token}` : `user:${config.username}`)
      .digest('hex')
      .slice(0, 16),
  ]);

const minutesSince = (since, now) => (since ? Math.max(0, Math.round((now - since) / 60_000)) : 0);

/** "25/10/2026 14:32" in the language of the configuration and the time zone of Gladys. */
export function formatTime(timestamp, language) {
  const locales = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
  return new Intl.DateTimeFormat(locales[language] ?? 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export class GraylogHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/graylog/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.signature = null;
    /** Last successful read (GraylogClient.snapshot()). */
    this.data = null;
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.readAt = 0;
    this.detectedAt = 0;
    this.polling = null;
    this.generation = 0;
    /** Last value published per feature external id, and when. */
    this.published = new Map();
    this.publishedAt = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = emptySaved(null);
    this.pollTimer = null;
    this.retryTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.failureLog = new FailureLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const object = (value) => (value && typeof value === 'object' ? value : {});
    this.saved = {
      scope: typeof saved.scope === 'string' ? saved.scope : null,
      primed: saved.primed === true,
      seen: object(saved.seen),
      inputs: object(saved.inputs),
      storage: saved.storage && typeof saved.storage === 'object' ? saved.storage : null,
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.publishedAt.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config?.language !== config.language;
    this.config = config;
    if (this.signature !== signature(config)) {
      this.generation += 1; // a read in progress for the old server is ignored
      this.signature = signature(config);
      this.client = config.apiUrl
        ? new GraylogClient({
            url: config.apiUrl,
            token: config.token,
            username: config.username,
            password: config.password,
            insecure: config.allowSelfSigned,
            request: this.request,
          })
        : null;
      this.data = null;
      this.error = null;
      this.failures = 0;
      this.down = false;
      this.readAt = 0;
      clearTimeout(this.retryTimer);
    }
    const scope = scopeOf(config);
    if (this.saved.scope !== scope) {
      this.generation += 1; // a read in progress for the old scope is ignored
      this.saved = emptySaved(scope);
      this.store.save(this.saved);
    }
    if (languageChanged) {
      this.discovered = null;
      // The "last event" texts are written in the language of the configuration.
      this.published.clear();
    }
    await this.pollAll({ publish: true });
    this.schedulePoll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.retryTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.failureLog.recover('poll', 'Reading Graylog works again');
      } catch (err) {
        this.failureLog.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading Graylog ---------------------------------------------------------

  async pollAll({ publish = false, fresh = false } = {}) {
    const changed = await this.poll({ fresh });
    await this.afterChanges(changed, { publish });
  }

  /** Gladys asks for a refresh (onPoll): read now. */
  async pollDevice() {
    await this.pollAll();
  }

  /** Read again when the last read is older than `freshMs` (scene actions, widget). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollAll();
    }
  }

  /**
   * Read Graylog and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll({ fresh = false } = {}) {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (this.polling && (fresh || this.pollingGeneration !== this.generation)) {
      // A read started before a refresh request or a new configuration:
      // read again once it is over.
      return this.polling.catch(() => {}).then(() => this.poll());
    }
    if (!this.polling) {
      this.pollingGeneration = this.generation;
      this.polling = this.read().finally(() => {
        this.polling = null;
      });
    }
    return this.polling;
  }

  async read() {
    const { generation, client } = this;
    if (this.now() - this.detectedAt >= this.timings.detectEveryMs) {
      client.reset();
      this.detectedAt = this.now();
    }
    try {
      const snapshot = await client.snapshot();
      return generation === this.generation ? await this.applySuccess(snapshot) : false;
    } catch (caught) {
      // An answer of an unexpected shape (a list that is not one…).
      const err = caught.kind ? caught : new GraylogError(ERROR_KINDS.HTTP, caught.message);
      client.reset(); // read the version again: Graylog may have been upgraded
      return generation === this.generation ? await this.applyFailure(err) : false;
    }
  }

  instanceName() {
    return addressOf(this.config.apiUrl);
  }

  async applySuccess(snapshot) {
    const previous = this.data;
    if (this.error) {
      logger.info(`Graylog ${this.instanceName()} answers again`);
    }
    if (!previous || snapshot.version !== previous.version) {
      logger.info(
        `Graylog ${snapshot.version} at ${this.instanceName()}: ` +
          `${snapshot.inputs.total} input(s), ${snapshot.definitions.length} event definition(s)`,
      );
    }
    const widgetChanged =
      this.error !== null || previous === null || widgetKey(previous) !== widgetKey(snapshot);
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.readAt = this.now();
    this.data = snapshot;
    const { generation } = this;
    await this.transitions();
    if (generation !== this.generation) {
      return false; // reconfigured while Gladys took the events
    }
    await this.publishStates();
    return widgetChanged;
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Graylog ${this.instanceName()}: ${err.message}`);
    }
    // Only silence counts as unreachable: a refused token is a configuration
    // problem, reported by the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      this.failures = 0;
      this.down = false; // a later outage is announced again
      return wasError !== err.kind;
    }
    this.failures += 1;
    if (this.failures === 1) {
      this.scheduleRetry();
    }
    if (!this.down && this.failures >= this.timings.downAfterFailures) {
      this.down = true;
      await this.fireEvent(TRIGGERS.UNREACHABLE, {
        address: this.instanceName(),
        error: pick(ERROR_TEXT[err.kind], this.config.language),
      });
    }
    return wasError !== err.kind;
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.pollAll()
        .then(() => this.failureLog.recover('retry'))
        .catch((err) => this.failureLog.fail('retry', `Retry failed: ${err.message}`, 'error'));
    }, this.timings.retryMs);
    this.retryTimer.unref?.();
  }

  /**
   * Compare with what was already seen and fire the scene events. A change is
   * marked announced only once Gladys accepted its event (Gladys restarting,
   * a burst beyond the cap: sent at a next read), and an end is announced
   * only if its start was. What is already there at the first read (or after
   * a change of server or user) is recorded, not announced.
   */
  async transitions() {
    const { generation } = this;
    const { seen, inputs: knownInputs, primed } = this.saved;
    const now = this.now();
    const language = this.config.language;
    const events = [];

    // New events, the oldest first. Tracked by id, not by date: an
    // aggregation event carries the time of its search window and can be
    // stored after a newer one.
    const fresh = this.data.events.list
      .filter((event) => !(event.id in seen))
      .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    for (const event of fresh) {
      if (primed) {
        events.push({ key: TRIGGERS.EVENT, event });
      } else {
        seen[event.id] = event.timestamp || now;
      }
    }

    // Inputs failing, and running again.
    const byKey = new Map(this.data.inputs.all.map((input) => [input.key, input]));
    for (const input of this.data.inputs.failed) {
      let entry = knownInputs[input.key];
      if (!entry) {
        entry = { since: now, announced: !primed };
        knownInputs[input.key] = entry;
      }
      Object.assign(entry, { title: input.title, type: input.type, state: input.state });
      entry.message = input.message;
      if (!entry.announced) {
        events.push({ key: TRIGGERS.INPUT_FAILED, input, entry });
      }
    }
    for (const [key, entry] of Object.entries(knownInputs)) {
      const input = byKey.get(key);
      if (input && this.data.inputs.failed.includes(input)) {
        continue;
      }
      if (input?.state === 'RUNNING' && entry.announced) {
        events.push({ key: TRIGGERS.INPUT_RECOVERED, input, entry, inputKey: key });
      } else if (!input || input.state === 'RUNNING' || input.state === 'STOPPED') {
        // Deleted, stopped on purpose, or never announced: no recovery to tell.
        delete knownInputs[key];
      }
      // Otherwise STARTING…: wait for the outcome.
    }

    // The storage turning red, and back.
    const storage = this.data.storage;
    if (storage === 'red') {
      this.saved.storage ??= { since: now, announced: !primed };
      if (!this.saved.storage.announced) {
        events.push({ key: TRIGGERS.STORAGE_RED });
      }
    } else if (storage !== null && this.saved.storage) {
      if (this.saved.storage.announced) {
        events.push({ key: TRIGGERS.STORAGE_RECOVERED, status: storage });
      } else {
        this.saved.storage = null;
      }
    }
    this.saved.primed = true;

    const sent = events.slice(0, MAX_EVENTS_PER_READ);
    if (events.length > sent.length) {
      logger.warn(`${events.length - sent.length} change(s) left for the next read`);
    }
    for (const item of sent) {
      if (generation !== this.generation) {
        break; // reconfigured meanwhile: these events belong to the old scope
      }
      const data = this.eventData(item, now, language);
      logger.debug(`${item.key}: ${JSON.stringify(data).slice(0, 200)}`);
      if (!(await this.fireEvent(item.key, data))) {
        break; // Gladys refuses: keep the order, try again at the next read
      }
      if (item.key === TRIGGERS.EVENT) {
        seen[item.event.id] = item.event.timestamp || now;
      } else if (item.key === TRIGGERS.INPUT_FAILED) {
        item.entry.announced = true;
      } else if (item.key === TRIGGERS.INPUT_RECOVERED) {
        delete knownInputs[item.inputKey];
      } else if (item.key === TRIGGERS.STORAGE_RED) {
        this.saved.storage.announced = true;
      } else {
        this.saved.storage = null;
      }
    }
    pruneSeen(seen, now);
    this.store.save(this.saved);
  }

  eventData(item, now, language) {
    if (item.key === TRIGGERS.EVENT) {
      const { event } = item;
      return {
        device: definitionIds(this.gladys, event.definitionId).device,
        definition: event.title,
        message: event.message,
        type: event.alert ? 'alert' : 'event',
        priority: String(Math.min(4, Math.max(1, event.priority))),
        priority_name: priorityName(event.priority, language),
        source: event.source,
        event_key: event.key,
      };
    }
    if (item.key === TRIGGERS.INPUT_FAILED) {
      return {
        input: item.input.title,
        input_type: item.input.type,
        state: item.input.state,
        message: item.input.message,
      };
    }
    if (item.key === TRIGGERS.INPUT_RECOVERED) {
      return {
        input: item.input.title,
        input_type: item.input.type,
        duration_minutes: minutesSince(item.entry.since, now),
      };
    }
    if (item.key === TRIGGERS.STORAGE_RED) {
      return { address: this.instanceName(), status: 'red' };
    }
    return {
      address: this.instanceName(),
      status: item.status,
      duration_minutes: minutesSince(this.saved.storage?.since, now),
    };
  }

  /** @returns {Promise<boolean>} whether Gladys accepted the event */
  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.failureLog.recover('event', 'Scene events accepted again');
      return true;
    } catch (err) {
      this.failureLog.fail('event', `Scene event refused: ${err.message}`);
      return false;
    }
  }

  // --- Devices -----------------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  discoveredDevices() {
    if (!this.data) {
      return [];
    }
    const language = this.config.language;
    return [
      buildServerDevice(this.gladys, this.instanceName(), language),
      ...this.data.definitions.map((definition) =>
        buildDefinitionDevice(this.gladys, definition, language),
      ),
    ];
  }

  /** Publish the Discovery list when it changed (a definition added, renamed…). */
  async publishDevices({ force = false } = {}) {
    // Nothing read yet: keep the list Gladys has (an empty list only once
    // the address is removed from the configuration).
    if (!this.data && (!force || this.client)) {
      return;
    }
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.failureLog.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.failureLog.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read Graylog, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.publishDevices({ force: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (!this.data) {
      return;
    }
    const externalId = device.external_id;
    if (externalId === serverIds(this.gladys).device) {
      await this.sendStates(serverValues(this.gladys, this.data), { force: true });
    } else {
      const definition = this.findDefinition(externalId);
      if (!definition) {
        return;
      }
      await this.sendStates(this.definitionStates(definition.id), { force: true });
    }
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  definitionStates(id) {
    const stats = this.data.events.byDefinition.get(id) ?? { count: 0, last: null };
    return definitionValues(this.gladys, id, stats, (timestamp) =>
      formatTime(timestamp, this.config.language),
    );
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /** The states of the added devices that changed (or are due for a heartbeat). */
  async publishStates() {
    const values = [];
    if (this.isCreated(serverIds(this.gladys).device)) {
      values.push(...serverValues(this.gladys, this.data));
    }
    for (const definition of this.data.definitions) {
      if (this.isCreated(definitionIds(this.gladys, definition.id).device)) {
        values.push(...this.definitionStates(definition.id));
      }
    }
    await this.sendStates(values);
  }

  async sendStates(values, { force = false } = {}) {
    const now = this.now();
    const known = values.filter(({ value }) => value !== null); // unknown: the last value stands
    const changed = known.filter(
      ({ externalId, value }) => force || this.published.get(externalId) !== value,
    );
    const due = known.filter(
      ({ externalId, value }) =>
        !force &&
        this.published.get(externalId) === value &&
        now - (this.publishedAt.get(externalId) ?? 0) >= this.timings.heartbeatMs,
    );
    const states = [...changed, ...due].map(({ externalId, value }) =>
      typeof value === 'string'
        ? { device_feature_external_id: externalId, text: value }
        : { device_feature_external_id: externalId, state: value },
    );
    for (let at = 0; at < states.length; at += MAX_STATES_PER_REQUEST) {
      const batch = states.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(batch);
        for (const state of batch) {
          this.published.set(state.device_feature_external_id, state.text ?? state.state);
          this.publishedAt.set(state.device_feature_external_id, now);
        }
        this.failureLog.recover('states', 'States accepted again');
      } catch (err) {
        this.failureLog.fail('states', `States refused: ${err.message}`);
      }
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable" while Graylog is. */
  async publishTransports() {
    if (!this.data || this.readAt === 0) {
      return;
    }
    const transport = this.error === null ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    const ids = [
      serverIds(this.gladys).device,
      ...this.data.definitions.map(
        (definition) => definitionIds(this.gladys, definition.id).device,
      ),
    ];
    const entries = ids
      .filter((id) => this.isCreated(id) && this.transports.get(id) !== transport)
      .map((id) => ({ external_id: id, transport }));
    for (let at = 0; at < entries.length; at += MAX_STATES_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.failureLog.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.failureLog.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    const { apiUrl, invalidUrl } = this.config;
    if (!apiUrl) {
      return {
        connected: false,
        message: invalidUrl ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noServer,
      };
    }
    if (!this.error) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noServer)) {
      message[language] = pick(ERROR_TEXT[this.error.kind], language);
    }
    return { connected: false, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.failureLog.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.failureLog.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene action, report) --------------------------------------------

  /** The event definition of a device external id, null when unknown. */
  findDefinition(externalId) {
    const id = parseDefinitionId(this.gladys, externalId);
    return id ? (this.data?.definitions.find((definition) => definition.id === id) ?? null) : null;
  }

  /**
   * The events read, newest first, of the definitions in `scope` (a Set of
   * definition ids, null for all), alerts only unless `all`.
   */
  recentEvents({ scope = null, all = false } = {}) {
    return (this.data?.events.list ?? [])
      .filter((event) => (!scope || scope.has(event.definitionId)) && (all || event.alert))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /** "Test the connection": read now, one line. */
  async testConnection() {
    await this.pollAll({ publish: true, fresh: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const status = this.connectionStatus();
      if (!status.connected || !this.data) {
        message[language] = labelled(
          this.config.apiUrl ? this.instanceName() : 'Graylog',
          pick(status.message ?? ERROR_TEXT[ERROR_KINDS.UNREACHABLE], language),
          language,
        );
        continue;
      }
      const parts = [
        text.ok,
        `Graylog ${this.data.version}`,
        ...(this.data.throughput === null ? [] : [text.rate(this.data.throughput)]),
        text.inputs(this.data.inputs.failed.length, this.data.inputs.total),
        text.definitions(this.data.definitions.length),
        text.alerts(this.data.events.alerts),
      ];
      message[language] = labelled(this.instanceName(), parts.join(', '), language);
    }
    return message;
  }
}

function emptySaved(scope) {
  return { scope, primed: false, seen: {}, inputs: {}, storage: null };
}

/** Forget the events older than a day, and the oldest beyond MAX_SEEN. */
function pruneSeen(seen, now) {
  const entries = Object.entries(seen).filter(([, at]) => now - at < SEEN_KEEP_MS);
  entries.sort((a, b) => b[1] - a[1]);
  const kept = new Set(entries.slice(0, MAX_SEEN).map(([id]) => id));
  for (const id of Object.keys(seen)) {
    if (!kept.has(id)) {
      delete seen[id];
    }
  }
}

/** What the widget shows: it is reloaded only when this changes. */
function widgetKey(data) {
  return JSON.stringify([
    data.storage,
    data.inputs.failed.map((input) => [input.key, input.state]),
    data.events.alerts,
    data.events.list.slice(0, 10).map((event) => event.id),
  ]);
}
