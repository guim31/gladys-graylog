// The scene action and the widget on the real answers of Graylog 6.1.16.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { ACTIONS, MAX_ROWS } from '../src/widgets.js';
import {
  BASE_CONFIG,
  DISK,
  FakeGraylog,
  SSH,
  createDevices,
  createWorld,
  definitionDevice,
} from './helpers/world.js';

async function world(t, options = {}) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

const outputs = async (w, fields = {}) => {
  const ack = await w.fake.sceneAction('get_alerts', fields);
  assert.equal(ack.success, true, ack.error);
  return ack.data.outputs;
};

test('get_alerts: the alerts of the last 24 hours, the newest first', async (t) => {
  const w = await world(t);
  const result = await outputs(w);
  assert.equal(result.count, 2);
  assert.equal(result.last_title, 'Disk failure');
  assert.equal(result.last_message, 'Disk failure');
  assert.equal(result.minutes_ago, 4);
  assert.match(result.names, /^Disk failure \(\d\d:\d\d\), Disk failure \(\d\d:\d\d\)$/);
});

test('get_alerts: every event, of one definition', async (t) => {
  const w = await world(t);
  const result = await outputs(w, { device: definitionDevice(w.gladys, SSH), include: 'all' });
  assert.equal(result.count, 3);
  assert.equal(result.last_title, 'SSH login');
  const none = await outputs(w, { device: definitionDevice(w.gladys, SSH) });
  assert.equal(none.count, 0);
  assert.equal(none.minutes_ago, -1);
  assert.equal(none.last_message, 'No alert in the last 24 hours.');
});

test('get_alerts: an unknown device, Graylog down, nothing configured', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, language: 'fr' } });
  const unknown = await w.fake.sceneAction('get_alerts', { device: 'not-ours' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /n'est pas une définition/);
  w.graylog.failure = 'down';
  w.clock.advance(60_000);
  const down = await w.fake.sceneAction('get_alerts', {});
  assert.equal(down.success, false);
  assert.match(down.error, /Graylog ne répond pas/);

  const empty = await world(t, { config: { language: 'en' } });
  const ack = await empty.fake.sceneAction('get_alerts', {});
  assert.match(ack.error, /No Graylog is configured/);
});

async function widget(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  return content;
}

const statusRows = (content) => content.components.find((c) => c.type === 'status').items;

test('widget: alerts, failed inputs, throughput, then Graylog problems and alerts', async (t) => {
  const w = await world(t);
  const content = await widget(w);
  assert.deepEqual(
    content.components.map((c) => c.type),
    ['value', 'value', 'value', 'status', 'button'],
  );
  assert.deepEqual(
    content.components.slice(0, 3).map((c) => [c.label, c.value]),
    [
      ['Alerts (24 h)', 2],
      ['Failed inputs', 1],
      ['Messages/s', 0],
    ],
  );
  const rows = statusRows(content);
  assert.deepEqual(rows[0], {
    label: 'Input FAILED',
    value: 'Broken GELF TCP',
    icon: 'alert-octagon',
    color: 'danger',
  });
  assert.deepEqual(
    rows.slice(1).map((row) => [row.label, row.icon]),
    [
      ['Disk failure', 'bell'],
      ['Disk failure', 'bell'],
    ],
  );
  assert.match(rows[1].value, /^\d\d:\d\d$/, 'today: the time only');
});

test('widget: every event of the chosen definitions, capped to ten rows', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const content = await widget(w, { include: 'all' }, 'fr');
  assert.equal(content.components[0].label, 'Événements (24 h)');
  assert.equal(content.components[0].value, 12);
  const rows = statusRows(content);
  assert.equal(rows.length, MAX_ROWS);
  assert.equal(rows.at(-1).label, 'Autres');
  assert.equal(rows.at(-1).value, '+4');

  const chosen = await widget(w, {
    definitions: [definitionDevice(w.gladys, SSH)],
    include: 'all',
  });
  assert.equal(chosen.components[0].value, 3);
  assert.deepEqual(
    statusRows(chosen)
      .slice(1)
      .map((row) => [row.label, row.icon]),
    [
      ['SSH login', 'info'],
      ['SSH login', 'info'],
      ['SSH login', 'info'],
    ],
  );
});

test('widget: storage red, nothing to report, Graylog down, not configured', async (t) => {
  const graylog = new FakeGraylog();
  graylog.setInput('Broken GELF TCP', 'RUNNING');
  graylog.setStorage('red');
  const w = await world(t, { graylog });
  const rows = statusRows(await widget(w, { definitions: [definitionDevice(w.gladys, SSH)] }));
  assert.deepEqual(rows, [
    { label: 'Storage', value: 'red', icon: 'database', color: 'danger' },
    { label: 'No alert in 24 h', value: 'Storage red', icon: 'check-circle', color: 'success' },
  ]);

  graylog.failure = 'down';
  await w.hub.pollAll();
  const down = await widget(w);
  assert.ok(
    down.components.some((c) => c.type === 'text' && /Graylog does not answer/.test(c.text)),
  );

  const empty = await world(t, { config: { language: 'en' } });
  const configure = await widget(empty);
  assert.deepEqual(
    configure.components.map((c) => c.type),
    ['text'],
  );
});

test('widget: Refresh reads Graylog again', async (t) => {
  const w = await world(t);
  const before = w.graylog.requests.length;
  const ack = await w.fake.widgetAction(WIDGET_KEY, ACTIONS.REFRESH, {});
  assert.equal(ack.success, true, ack.error);
  assert.ok(w.graylog.requests.length > before);
  assert.equal(ack.data.message.en, 'Graylog read again.');
});

test('a device added makes the widget refresh', async (t) => {
  const w = await world(t);
  const before = w.fake.widgetRefreshes.length;
  await createDevices(w, (device) => device.external_id === definitionDevice(w.gladys, DISK));
  assert.ok(w.fake.widgetRefreshes.length > before);
});
