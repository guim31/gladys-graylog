// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab (the user adds the ones to
// follow, nothing is created on their behalf):
//
//   - one "Graylog" device, the server (or cluster) as a whole:
//       throughput        counter-sensor/integer, messages per second (the
//                         sum over the nodes of the cluster)
//       inputs_failed     counter-sensor/integer, inputs FAILED, FAILING or
//                         with an invalid configuration, on any node (an
//                         input stopped on purpose does not count)
//       storage_red       input/binary, 1 when the OpenSearch / Elasticsearch
//                         cluster health is red (yellow is a missing replica,
//                         the usual state of a single-node install)
//       journal_backlog   counter-sensor/integer, messages written to the
//                         disk journal and not processed yet
//       events_24h        counter-sensor/integer, events of the last 24 hours
//       alerts_24h        counter-sensor/integer, the alerts among them
//   - one device per event definition, identity = the id Graylog gives it
//     (a MongoDB object id, stable across renames):
//       events_24h        counter-sensor/integer, its events of the last 24 h
//       last_event        text/text, date and time of its last event (local
//                         time of Gladys), in the last 24 hours
//
// Published with should_poll: false: the integration reads Graylog on its
// own timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const SERVER_TYPE = 'server';
export const SERVER_ID = 'main';
export const DEFINITION_TYPE = 'definition';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  THROUGHPUT: 'throughput',
  INPUTS_FAILED: 'inputs_failed',
  STORAGE_RED: 'storage_red',
  JOURNAL: 'journal_backlog',
  EVENTS: 'events_24h',
  ALERTS: 'alerts_24h',
  LAST_EVENT: 'last_event',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.THROUGHPUT]: 'Messages per second',
    [FEATURE_KEYS.INPUTS_FAILED]: 'Failed inputs',
    [FEATURE_KEYS.STORAGE_RED]: 'Storage in red',
    [FEATURE_KEYS.JOURNAL]: 'Messages waiting in the journal',
    [FEATURE_KEYS.EVENTS]: 'Events (24 h)',
    [FEATURE_KEYS.ALERTS]: 'Alerts (24 h)',
    [FEATURE_KEYS.LAST_EVENT]: 'Last event',
  },
  fr: {
    [FEATURE_KEYS.THROUGHPUT]: 'Messages par seconde',
    [FEATURE_KEYS.INPUTS_FAILED]: 'Entrées en échec',
    [FEATURE_KEYS.STORAGE_RED]: 'Stockage en rouge',
    [FEATURE_KEYS.JOURNAL]: 'Messages en attente (journal)',
    [FEATURE_KEYS.EVENTS]: 'Événements (24 h)',
    [FEATURE_KEYS.ALERTS]: 'Alertes (24 h)',
    [FEATURE_KEYS.LAST_EVENT]: 'Dernier événement',
  },
  de: {
    [FEATURE_KEYS.THROUGHPUT]: 'Nachrichten pro Sekunde',
    [FEATURE_KEYS.INPUTS_FAILED]: 'Fehlerhafte Inputs',
    [FEATURE_KEYS.STORAGE_RED]: 'Speicher rot',
    [FEATURE_KEYS.JOURNAL]: 'Wartende Nachrichten (Journal)',
    [FEATURE_KEYS.EVENTS]: 'Ereignisse (24 h)',
    [FEATURE_KEYS.ALERTS]: 'Alarme (24 h)',
    [FEATURE_KEYS.LAST_EVENT]: 'Letztes Ereignis',
  },
  es: {
    [FEATURE_KEYS.THROUGHPUT]: 'Mensajes por segundo',
    [FEATURE_KEYS.INPUTS_FAILED]: 'Entradas con fallo',
    [FEATURE_KEYS.STORAGE_RED]: 'Almacenamiento en rojo',
    [FEATURE_KEYS.JOURNAL]: 'Mensajes en espera (diario)',
    [FEATURE_KEYS.EVENTS]: 'Eventos (24 h)',
    [FEATURE_KEYS.ALERTS]: 'Alertas (24 h)',
    [FEATURE_KEYS.LAST_EVENT]: 'Último evento',
  },
};

export const SERVER_NAME = 'Graylog';

// Display bounds (the core never applies them on write).
export const MAX_COUNT = 1_000_000_000;

export const MODEL_SERVER = 'Graylog';
export const MODEL_DEFINITION = 'Graylog event definition';
export const PARAMS = Object.freeze({
  ADDRESS: 'GRAYLOG_ADDRESS',
  DEFINITION: 'GRAYLOG_DEFINITION',
});

export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_ID);
export const definitionIds = (gladys, id) => gladys.externalIds(DEFINITION_TYPE, id);

/** The event definition id of a device external id, null when it is not one of ours. */
export function parseDefinitionId(gladys, externalId) {
  const prefix = definitionIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return id && !id.includes(':') ? id : null;
}

const readOnly = { read_only: true, has_feedback: false };

function counter(name, externalId) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    ...readOnly,
    keep_history: true,
    min: 0,
    max: MAX_COUNT,
  };
}

function binary(name, externalId) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.INPUT,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    ...readOnly,
    keep_history: true,
    min: 0,
    max: 1,
  };
}

function text(name, externalId) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    ...readOnly,
    keep_history: false,
    // NOT NULL in the core, even for a text.
    min: 0,
    max: 0,
  };
}

/** The discovery payload of the "Graylog" device. */
export function buildServerDevice(gladys, address, language = 'en') {
  const ids = serverIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: SERVER_NAME,
    external_id: ids.device,
    model: MODEL_SERVER,
    should_poll: false,
    params: [{ name: PARAMS.ADDRESS, value: String(address ?? '').slice(0, 255) }],
    features: [
      counter(names[FEATURE_KEYS.THROUGHPUT], ids.feature(FEATURE_KEYS.THROUGHPUT)),
      counter(names[FEATURE_KEYS.INPUTS_FAILED], ids.feature(FEATURE_KEYS.INPUTS_FAILED)),
      binary(names[FEATURE_KEYS.STORAGE_RED], ids.feature(FEATURE_KEYS.STORAGE_RED)),
      counter(names[FEATURE_KEYS.JOURNAL], ids.feature(FEATURE_KEYS.JOURNAL)),
      counter(names[FEATURE_KEYS.EVENTS], ids.feature(FEATURE_KEYS.EVENTS)),
      counter(names[FEATURE_KEYS.ALERTS], ids.feature(FEATURE_KEYS.ALERTS)),
    ],
  };
}

/** The discovery payload of an event definition. */
export function buildDefinitionDevice(gladys, definition, language = 'en') {
  const ids = definitionIds(gladys, definition.id);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: (definition.title || definition.id).slice(0, 255),
    external_id: ids.device,
    model: MODEL_DEFINITION,
    should_poll: false,
    params: [{ name: PARAMS.DEFINITION, value: definition.id.slice(0, 255) }],
    features: [
      counter(names[FEATURE_KEYS.EVENTS], ids.feature(FEATURE_KEYS.EVENTS)),
      text(names[FEATURE_KEYS.LAST_EVENT], ids.feature(FEATURE_KEYS.LAST_EVENT)),
    ],
  };
}

/**
 * Feature values of the Graylog device (null: nothing to publish, the last
 * value stands).
 * @param {object} data see GraylogClient.snapshot()
 * @returns {Array<{ externalId: string, value: number|null }>}
 */
export function serverValues(gladys, data) {
  const ids = serverIds(gladys);
  return [
    { externalId: ids.feature(FEATURE_KEYS.THROUGHPUT), value: data.throughput },
    { externalId: ids.feature(FEATURE_KEYS.INPUTS_FAILED), value: data.inputs.failed.length },
    {
      externalId: ids.feature(FEATURE_KEYS.STORAGE_RED),
      value: data.storage === null ? null : data.storage === 'red' ? 1 : 0,
    },
    { externalId: ids.feature(FEATURE_KEYS.JOURNAL), value: data.journal },
    { externalId: ids.feature(FEATURE_KEYS.EVENTS), value: data.events.total },
    { externalId: ids.feature(FEATURE_KEYS.ALERTS), value: data.events.alerts },
  ];
}

/**
 * Feature values of an event definition.
 * @param {{ count: number, last: number|null }} stats its events of the last 24 hours
 * @param {(timestamp: number) => string} formatTime
 */
export function definitionValues(gladys, id, stats, formatTime) {
  const ids = definitionIds(gladys, id);
  return [
    { externalId: ids.feature(FEATURE_KEYS.EVENTS), value: stats.count },
    // A text is never empty (Gladys ignores it): nothing until a first event.
    {
      externalId: ids.feature(FEATURE_KEYS.LAST_EVENT),
      value: stats.last ? formatTime(stats.last) : null,
    },
  ];
}
