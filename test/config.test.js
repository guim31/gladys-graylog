// Normalization of the configuration: the address typed in every usual form.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseApiUrl } from '../src/config.js';

test('the address: bare, with port, with scheme, copied from the browser', () => {
  const cases = [
    ['192.0.2.5', 'http://192.0.2.5:9000/api'],
    ['  graylog.lan:9001 ', 'http://graylog.lan:9001/api'],
    ['http://192.0.2.5:9000/', 'http://192.0.2.5:9000/api'],
    ['http://192.0.2.5:9000/api/api-browser', 'http://192.0.2.5:9000/api'],
    ['http://192.0.2.5:9000/search?q=1', 'http://192.0.2.5:9000/api'],
    ['http://192.0.2.5:9000/alerts/definitions', 'http://192.0.2.5:9000/api'],
    // A reverse proxy: the port of the scheme, the path prefix kept.
    ['https://logs.example.org', 'https://logs.example.org/api'],
    ['https://example.org/graylog/system/inputs', 'https://example.org/graylog/api'],
    ['[2001:db8::5]', 'http://[2001:db8::5]:9000/api'],
  ];
  for (const [typed, expected] of cases) {
    assert.equal(parseApiUrl(typed), expected, typed);
  }
});

test('unusable addresses, and credentials in an address, are refused', () => {
  for (const typed of [
    '',
    '   ',
    'ftp://192.0.2.5',
    'http://',
    'http://user:pass@192.0.2.5:9000',
    42,
  ]) {
    assert.equal(parseApiUrl(typed), null, String(typed));
  }
  assert.equal(normalizeConfig({ graylog_url: 'ftp://x' }).invalidUrl, true);
  assert.equal(normalizeConfig({ graylog_url: '' }).invalidUrl, false);
});

test('defaults, trimmed secrets, unknown values', () => {
  assert.deepEqual(normalizeConfig({}), {
    apiUrl: null,
    invalidUrl: false,
    token: '',
    username: '',
    password: '',
    pollIntervalMs: 60_000,
    allowSelfSigned: DEFAULT_CONFIG.allow_self_signed,
    language: 'fr',
  });
  const config = normalizeConfig({
    graylog_url: '192.0.2.5',
    api_token: ' abc\n',
    poll_interval: 300,
    allow_self_signed: 'true',
    language: 'it',
  });
  assert.equal(config.token, 'abc');
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.allowSelfSigned, true);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollIntervalMs, 60_000);
});
