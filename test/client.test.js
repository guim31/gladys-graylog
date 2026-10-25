// The Graylog client on the real answers of Graylog 6.1.16, and its errors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, GraylogClient } from '../src/graylog/client.js';
import { API_URL, FakeGraylog, TOKEN } from './helpers/fakeGraylog.js';

const DISK = '6add9906d5cba37b30f122a9';

function client(graylog = new FakeGraylog(), options = {}) {
  return new GraylogClient({
    url: API_URL,
    token: TOKEN,
    request: (url, request) => graylog.request(url, request),
    ...options,
  });
}

/** A client whose every request answers `answer` (or throws it). */
const answering = (answer) =>
  new GraylogClient({
    url: API_URL,
    token: TOKEN,
    request: async () => {
      if (answer instanceof Error) {
        throw answer;
      }
      return { headers: {}, ...answer };
    },
  });

test('snapshot: version, inputs, storage, definitions and events of a real Graylog', async () => {
  const snapshot = await client().snapshot();
  assert.equal(snapshot.version, '6.1.16');
  assert.equal(snapshot.throughput, 0);
  assert.equal(snapshot.journal, 0);
  assert.equal(snapshot.storage, 'green');
  assert.equal(snapshot.inputs.total, 3);
  assert.deepEqual(
    snapshot.inputs.failed.map((input) => [input.title, input.type, input.state, input.message]),
    [['Broken GELF TCP', 'GELF TCP', 'FAILED', 'bind(..) failed: Address already in use.']],
  );
  assert.deepEqual(
    snapshot.definitions.map((definition) => definition.title),
    ['Disk failure', 'SSH login', 'System notification events'],
  );
  assert.equal(snapshot.events.total, 12);
  assert.equal(snapshot.events.alerts, 2);
  assert.equal(snapshot.events.list[0].title, 'Disk failure');
  assert.equal(snapshot.events.list[0].alert, true);
  assert.equal(snapshot.events.list[0].timestamp, Date.parse('2026-10-25T05:55:47.772Z'));
  assert.deepEqual(snapshot.events.byDefinition.get(DISK), {
    count: 5,
    last: Date.parse('2026-10-25T05:55:47.772Z'),
  });
});

test('a page that does not hold every event: counts come from Graylog, per definition', async () => {
  const graylog = new FakeGraylog();
  const snapshot = await client(graylog).snapshot();
  const original = graylog.search.bind(graylog);
  // Pretend the page is 3 events long.
  graylog.search = (body) => original({ ...body, per_page: Math.min(body.per_page, 3) });
  const partial = await client(graylog).snapshot();
  assert.equal(partial.events.list.length, 3);
  assert.equal(partial.events.total, 12);
  assert.equal(partial.events.alerts, 2);
  assert.deepEqual(
    [...partial.events.byDefinition.entries()],
    [...snapshot.events.byDefinition.entries()],
  );
});

test('the cluster metrics sum the nodes; without them, this node only', async () => {
  const graylog = new FakeGraylog();
  graylog.metrics = {
    a: {
      metrics: [{ full_name: 'org.graylog2.throughput.input.1-sec-rate', metric: { value: 2.4 } }],
    },
    b: {
      metrics: [
        { full_name: 'org.graylog2.throughput.input.1-sec-rate', metric: { value: 3.3 } },
        { full_name: 'org.graylog2.journal.entries-uncommitted', metric: { value: 40 } },
      ],
    },
  };
  assert.deepEqual(await client(graylog).metrics(), { throughput: 6, journal: 40 });
  graylog.forbidden.add('/cluster/metrics/multiple');
  assert.deepEqual(await client(graylog).metrics(), { throughput: 3, journal: 0 });
});

test('a section the user may not read is unknown, not an error', async () => {
  const graylog = new FakeGraylog();
  graylog.forbidden.add('/system/indexer/cluster/health');
  graylog.forbidden.add('/cluster/inputstates');
  const snapshot = await client(graylog).snapshot();
  assert.equal(snapshot.storage, null);
  assert.equal(snapshot.inputs.total, 0);
});

test('error kinds', async () => {
  const kind = (c) =>
    c.snapshot().then(
      () => 'none',
      (err) => err.kind,
    );
  const graylog = new FakeGraylog();
  graylog.failure = 'auth';
  assert.equal(await kind(client(graylog)), ERROR_KINDS.AUTH);
  graylog.failure = 'html';
  assert.equal(await kind(client(graylog)), ERROR_KINDS.NOT_GRAYLOG);
  graylog.failure = 'forbidden';
  assert.equal(await kind(client(graylog)), ERROR_KINDS.PERMISSION);
  graylog.failure = 'down';
  assert.equal(await kind(client(graylog)), ERROR_KINDS.UNREACHABLE);
  assert.equal(
    await kind(
      answering(Object.assign(new Error('self signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })),
    ),
    ERROR_KINDS.TLS,
  );
  assert.equal(
    await kind(answering({ status: 502, body: 'Bad Gateway' })),
    ERROR_KINDS.UNREACHABLE,
  );
  // OpenSearch on the port: a JSON answer, but not Graylog's (recorded).
  assert.equal(
    await kind(
      answering({
        status: 400,
        body: '{"error":"no handler found for uri [/api/system] and method [GET]"}',
      }),
    ),
    ERROR_KINDS.NOT_GRAYLOG,
  );
  assert.equal(
    await kind(new GraylogClient({ url: API_URL, request: () => assert.fail('no request') })),
    ERROR_KINDS.CREDENTIALS_MISSING,
  );
});

test('the version drops the build hash, and is read again after reset()', async () => {
  const graylog = new FakeGraylog();
  const c = client(graylog);
  assert.deepEqual(await c.detect(), { version: '6.1.16' });
  graylog.system.version = '6.2.0+abcdef0';
  assert.deepEqual(await c.detect(), { version: '6.1.16' });
  c.reset();
  assert.deepEqual(await c.detect(), { version: '6.2.0' });
});
