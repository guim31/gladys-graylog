// The hub against the fake Graylog (real answers of Graylog 6.1.16):
// discovery, states of the added devices only, scene events (new events,
// inputs, storage) kept across a restart, Graylog unreachable, heartbeat, the
// reading timer, and quiet logs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS } from '../src/devices.js';
import { MAX_EVENTS_PER_READ, TRIGGERS } from '../src/hub.js';
import {
  BASE_CONFIG,
  DISK,
  FakeGraylog,
  SSH,
  SYSTEM,
  createClock,
  createDevices,
  createWorld,
  definitionDevice,
  definitionFeature,
  serverFeature,
} from './helpers/world.js';

/** The lines written at `LOG_LEVEL=info` from now on (the SDK logger reads it per line). */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  for (const stream of ['log', 'error']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

async function world(t, options = {}) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

const keysOf = (w) => w.fake.sceneEvents.map((event) => event.key);
let sequence = 0;
const newEvent = (w, fields = {}) =>
  w.graylog.addEvent({
    id: `01NEW${String((sequence += 1)).padStart(21, '0')}`,
    definitionId: DISK,
    message: 'Disk failure',
    alert: true,
    priority: 3,
    time: w.clock.now(),
    ...fields,
  });

test('discovery: the Graylog device and one device per event definition', async (t) => {
  const w = await world(t);
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Graylog', 'Disk failure', 'SSH login', 'System notification events'],
  );
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  // Nothing is published for a device not added: Gladys would drop it.
  assert.equal(w.fake.states.length, 0);
  // The events already there are recorded, not announced.
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('the access token goes in Basic auth as <token>:token, POSTs carry X-Requested-By', async (t) => {
  const w = await world(t);
  const [first] = w.graylog.requests;
  const decoded = Buffer.from(first.headers.authorization.slice(6), 'base64').toString();
  assert.match(decoded, /:token$/);
  for (const request of w.graylog.requests.filter((r) => r.method === 'POST')) {
    assert.equal(request.headers['x-requested-by'], 'gladys');
  }
});

test('a user and its password work without token', async (t) => {
  const w = await world(t, {
    config: {
      graylog_url: BASE_CONFIG.graylog_url,
      username: 'admin',
      password: 'secret-password',
    },
  });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('added devices get every state, then only the changes', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const server = (key) => w.fake.lastState(serverFeature(w.gladys, key));
  assert.equal(server(FEATURE_KEYS.INPUTS_FAILED), 1, 'Broken GELF TCP');
  assert.equal(server(FEATURE_KEYS.STORAGE_RED), 0);
  assert.equal(server(FEATURE_KEYS.EVENTS), 12);
  assert.equal(server(FEATURE_KEYS.ALERTS), 2);
  assert.equal(server(FEATURE_KEYS.THROUGHPUT), 0);
  assert.equal(server(FEATURE_KEYS.JOURNAL), 0);
  assert.equal(w.fake.lastState(definitionFeature(w.gladys, DISK, FEATURE_KEYS.EVENTS)), 5);
  assert.equal(w.fake.lastState(definitionFeature(w.gladys, SSH, FEATURE_KEYS.EVENTS)), 3);
  assert.equal(w.fake.lastState(definitionFeature(w.gladys, SYSTEM, FEATURE_KEYS.EVENTS)), 4);
  // 05:55:47Z in the time zone of the test run: only the shape is checked.
  assert.match(
    String(w.fake.lastState(definitionFeature(w.gladys, DISK, FEATURE_KEYS.LAST_EVENT))),
    /^25\/10\/2026,? \d\d:\d\d$/,
  );

  const before = w.fake.states.length;
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, before, 'nothing changed, nothing sent');

  newEvent(w);
  await w.hub.pollAll();
  const sent = w.fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.deepEqual(
    sent.sort(),
    [
      definitionFeature(w.gladys, DISK, FEATURE_KEYS.EVENTS),
      definitionFeature(w.gladys, DISK, FEATURE_KEYS.LAST_EVENT),
      serverFeature(w.gladys, FEATURE_KEYS.ALERTS),
      serverFeature(w.gladys, FEATURE_KEYS.EVENTS),
    ].sort(),
  );
});

test('a new event fires event_triggered once, with its definition, kind and priority', async (t) => {
  const w = await world(t);
  newEvent(w, { message: 'disk failure on sdb' });
  newEvent(w, { definitionId: SSH, message: 'SSH login', alert: false, priority: 1 });
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: TRIGGERS.EVENT,
      data: {
        device: definitionDevice(w.gladys, DISK),
        definition: 'Disk failure',
        message: 'disk failure on sdb',
        type: 'alert',
        priority: '3',
        priority_name: 'high',
        source: 'graylog',
        event_key: '',
      },
    },
    {
      key: TRIGGERS.EVENT,
      data: {
        device: definitionDevice(w.gladys, SSH),
        definition: 'SSH login',
        message: 'SSH login',
        type: 'event',
        priority: '1',
        priority_name: 'low',
        source: 'graylog',
        event_key: '',
      },
    },
  ]);
});

test('an event stored late, with an older timestamp, is still announced', async (t) => {
  const w = await world(t);
  // An aggregation event carries the time of its search window.
  newEvent(w, { time: Date.parse('2026-10-25T05:00:00Z') });
  await w.hub.pollAll();
  assert.deepEqual(keysOf(w), [TRIGGERS.EVENT]);
});

test('the events already announced are not announced again after a restart', async (t) => {
  const clock = createClock();
  const graylog = new FakeGraylog();
  const first = await createWorld({ clock, graylog });
  newEvent(first);
  await first.hub.pollAll();
  assert.equal(first.fake.sceneEvents.length, 1);
  await first.app.stop();

  // A new event while the integration was stopped: announced at start.
  newEvent(first);
  const second = await world(t, { clock, graylog, dataDir: first.dataDir });
  assert.deepEqual(keysOf(second), [TRIGGERS.EVENT]);
});

test('Gladys refusing a scene event: sent again at the next read, in order', async (t) => {
  const w = await world(t);
  newEvent(w, { message: 'first' });
  newEvent(w, { message: 'second', time: w.clock.now() + 1000 });
  let refuse = true;
  const original = w.gladys.publishSceneEvent.bind(w.gladys);
  t.mock.method(w.gladys, 'publishSceneEvent', async (...args) => {
    if (refuse) {
      throw new Error('HTTP 503');
    }
    return original(...args);
  });
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, 0);
  refuse = false;
  await w.hub.pollAll();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => event.data.message),
    ['first', 'second'],
  );
});

test('a burst of events is capped per read, the rest follows', async (t) => {
  const w = await world(t);
  for (let i = 0; i < MAX_EVENTS_PER_READ + 5; i += 1) {
    newEvent(w, { time: w.clock.now() + i });
  }
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, MAX_EVENTS_PER_READ);
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, MAX_EVENTS_PER_READ + 5);
});

test('an input failing, then running again; one stopped on purpose is quiet', async (t) => {
  const w = await world(t);
  // "Broken GELF TCP" already failed at the first read: recorded, not
  // announced; its recovery is (it was a problem all along).
  w.graylog.setInput('Syslog UDP', 'FAILED', 'bind(..) failed: Address already in use.');
  await w.hub.pollAll();
  await w.hub.pollAll();
  w.clock.advance(5 * 60_000);
  w.graylog.setInput('Syslog UDP', 'RUNNING');
  w.graylog.setInput('Broken GELF TCP', 'RUNNING');
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: TRIGGERS.INPUT_FAILED,
      data: {
        input: 'Syslog UDP',
        input_type: 'Syslog UDP',
        state: 'FAILED',
        message: 'bind(..) failed: Address already in use.',
      },
    },
    {
      key: TRIGGERS.INPUT_RECOVERED,
      data: { input: 'Broken GELF TCP', input_type: 'GELF TCP', duration_minutes: 5 },
    },
    {
      key: TRIGGERS.INPUT_RECOVERED,
      data: { input: 'Syslog UDP', input_type: 'Syslog UDP', duration_minutes: 5 },
    },
  ]);

  w.graylog.setInput('GELF HTTP', 'FAILING', 'retrying');
  await w.hub.pollAll();
  w.graylog.setInput('GELF HTTP', 'STOPPED');
  await w.hub.pollAll();
  w.graylog.setInput('GELF HTTP', 'RUNNING');
  await w.hub.pollAll();
  assert.deepEqual(keysOf(w).slice(3), [TRIGGERS.INPUT_FAILED], 'no recovery for a stop');
});

test('the storage turning red, then yellow', async (t) => {
  const w = await world(t);
  await createDevices(w);
  w.graylog.setStorage('yellow');
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [], 'yellow is not an alarm');
  w.graylog.setStorage('red');
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(serverFeature(w.gladys, FEATURE_KEYS.STORAGE_RED)), 1);
  w.clock.advance(12 * 60_000);
  w.graylog.setStorage('yellow');
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [
    { key: TRIGGERS.STORAGE_RED, data: { address: '192.0.2.10:9000', status: 'red' } },
    {
      key: TRIGGERS.STORAGE_RECOVERED,
      data: { address: '192.0.2.10:9000', status: 'yellow', duration_minutes: 12 },
    },
  ]);
  assert.equal(w.fake.lastState(serverFeature(w.gladys, FEATURE_KEYS.STORAGE_RED)), 0);
});

test('a storage health without permission is unknown, not green', async (t) => {
  const graylog = new FakeGraylog();
  graylog.forbidden.add('/system/indexer/cluster/health');
  const w = await world(t, { graylog });
  await createDevices(w);
  assert.equal(w.fake.lastState(serverFeature(w.gladys, FEATURE_KEYS.STORAGE_RED)), undefined);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('Graylog silent twice: graylog_unreachable once, badge unreachable, then back', async (t) => {
  const w = await world(t);
  await createDevices(w);
  w.graylog.failure = 'down';
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [], 'one failure is a blip');
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: TRIGGERS.UNREACHABLE,
      data: { address: '192.0.2.10:9000', error: 'Graylog does not answer' },
    },
  ]);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  w.graylog.failure = null;
  await w.hub.pollAll();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.transports.at(-1).transport, 'local');
});

test('a refused token is a configuration problem, not an outage', async (t) => {
  const graylog = new FakeGraylog();
  graylog.failure = 'auth';
  const w = await world(t, { graylog });
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.connectionStatus.message.en, 'access token, user or password refused');
});

test('the web interface instead of the API: not a Graylog API', async (t) => {
  const graylog = new FakeGraylog();
  graylog.failure = 'html';
  const w = await world(t, { graylog });
  assert.match(w.fake.connectionStatus.message.fr, /pas d'API Graylog/);
});

test('no address: the status says what to do, and no request is made', async (t) => {
  const w = await world(t, { config: { language: 'fr' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /Saisissez l'adresse/);
  assert.equal(w.graylog.requests.length, 0);
});

test('another user forgets what was seen: its events are recorded, not announced', async (t) => {
  const w = await world(t);
  newEvent(w);
  await w.fake.configUpdated({
    graylog_url: BASE_CONFIG.graylog_url,
    username: 'admin',
    password: 'secret-password',
  });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.deepEqual(w.fake.sceneEvents, []);
  newEvent(w);
  await w.hub.pollAll();
  assert.deepEqual(keysOf(w), [TRIGGERS.EVENT]);
});

test('heartbeat: an unchanged value is sent again after 6 hours', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const before = w.fake.states.length;
  w.clock.advance(6 * 3600_000);
  await w.hub.pollAll();
  assert.ok(w.fake.states.length > before);
});

test('the reading timer reads Graylog without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, {
    timers: true,
    config: { ...BASE_CONFIG, poll_interval: '30' },
  });
  const before = w.graylog.requests.length;
  t.mock.timers.tick(30_000);
  await new Promise((resolve) => setImmediate(resolve));
  await w.hub.polling;
  assert.ok(w.graylog.requests.length > before);
});

test('a normal reading cycle writes nothing at info level', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const lines = captureLogs(t);
  newEvent(w);
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(lines, []);
});

test('no secret in the logs, even when Graylog refuses', async (t) => {
  const lines = captureLogs(t);
  const graylog = new FakeGraylog();
  graylog.failure = 'auth';
  const w = await world(t, { graylog });
  await w.hub.pollAll();
  assert.ok(lines.length > 0);
  assert.ok(lines.every((line) => !line.includes(BASE_CONFIG.api_token)));
});
