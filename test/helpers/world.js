// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Graylog, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read Graylog with
// `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { definitionIds, serverIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { ADDRESS, API_URL, FakeGraylog, TOKEN } from './fakeGraylog.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const BASE_CONFIG = {
  graylog_url: ADDRESS,
  api_token: TOKEN,
  language: 'en',
};

/** A manual clock, shared by the hub and the tests (the fixture events end at 05:55:47Z). */
export function createClock(start = Date.parse('2026-10-25T06:00:00Z')) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  clock = createClock(),
  graylog = new FakeGraylog(),
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-graylog-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: (url, options) => {
      if (!url.startsWith(new URL(API_URL).origin)) {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      }
      return graylog.request(url, options);
    },
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, graylog, app, hub: app.hub, clock, dataDir };
}

export const definitionDevice = (gladys, id) => definitionIds(gladys, id).device;
export const definitionFeature = (gladys, id, key) => definitionIds(gladys, id).feature(key);
export const serverFeature = (gladys, key) => serverIds(gladys).feature(key);

// The event definitions of the fixture.
export const DISK = '6add9906d5cba37b30f122a9';
export const SSH = '6add9906d5cba37b30f122b0';
export const SYSTEM = '6add98b2d5cba37b30f121dd';

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { ADDRESS, API_URL, FakeGraylog, TOKEN };
