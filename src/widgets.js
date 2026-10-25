// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `alerts`.
//
// The use case: a glance at the wall tablet tells whether the log server is
// fine and what it caught lately. So the widget shows the alerts of the last
// 24 hours, the inputs that failed and the messages per second, then one row
// per problem of Graylog itself (a failed input, the storage in red or
// yellow) and one row per recent alert (or event), the newest first, with
// its time.
//
// Every event definition by default, or the ones chosen in the widget
// settings (devices added to Gladys); "Alerts only" by default, events too
// on demand. The figures are sent as values, not bound to device features:
// the widget works before any device is added.
//
// Budget (8 components, 2 texts): three tiles, one status list of ten rows at
// most, one text while Graylog does not answer, and a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, labelled, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  configure: {
    en: 'Enter the address of your Graylog and an access token in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre Graylog et un jeton d'accès dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Graylog und ein Zugriffstoken in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su Graylog y un token de acceso en la configuración de la integración.',
  },
  alerts: { en: 'Alerts (24 h)', fr: 'Alertes (24 h)', de: 'Alarme (24 h)', es: 'Alertas (24 h)' },
  events: {
    en: 'Events (24 h)',
    fr: 'Événements (24 h)',
    de: 'Ereignisse (24 h)',
    es: 'Eventos (24 h)',
  },
  inputs: {
    en: 'Failed inputs',
    fr: 'Entrées en échec',
    de: 'Fehlerhafte Inputs',
    es: 'Entradas con fallo',
  },
  rate: { en: 'Messages/s', fr: 'Messages/s', de: 'Nachrichten/s', es: 'Mensajes/s' },
  storage: { en: 'Storage', fr: 'Stockage', de: 'Speicher', es: 'Almacenamiento' },
  input: { en: 'Input', fr: 'Entrée', de: 'Input', es: 'Entrada' },
  noAlert: {
    en: 'No alert in 24 h',
    fr: 'Aucune alerte en 24 h',
    de: 'Kein Alarm in 24 h',
    es: 'Ninguna alerta en 24 h',
  },
  noEvent: {
    en: 'No event in 24 h',
    fr: 'Aucun événement en 24 h',
    de: 'Kein Ereignis in 24 h',
    es: 'Ningún evento en 24 h',
  },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Graylog read again.',
    fr: 'Graylog relu.',
    de: 'Graylog neu gelesen.',
    es: 'Graylog leído de nuevo.',
  },
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
/** "14:32" today, "24/10 14:32" before. */
function when(timestamp, now, language) {
  const locale = LOCALES[language] ?? 'en-GB';
  const date = new Date(timestamp);
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(date);
  const day = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' });
  return day.format(date) === day.format(new Date(now)) ? time : `${day.format(date)} ${time}`;
}

const refreshButton = (language) => ({
  type: 'button',
  label: pick(TEXT.refresh, language),
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: ACTIONS.REFRESH },
});

/** The definitions the widget shows: the ids of the chosen devices, or null for all. */
export function chosenDefinitions(hub, settings) {
  const chosen = [settings?.definitions ?? []].flat().filter((id) => typeof id === 'string' && id);
  // Chosen definitions that were deleted show nothing, not every definition.
  return chosen.length > 0 ? new Set(chosen.map((id) => hub.findDefinition(id)?.id)) : null;
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: pick(TEXT.configure, language) }],
    };
  }
  const error = hub.error
    ? {
        type: 'text',
        variant: 'body',
        text: labelled(hub.instanceName(), pick(ERROR_TEXT[hub.error.kind], language), language),
      }
    : null;
  if (!hub.data) {
    return { ttl_seconds: 30, components: [error, refreshButton(language)].filter(Boolean) };
  }

  const all = settings?.include === 'all';
  const scope = chosenDefinitions(hub, settings);
  const events = hub.recentEvents({ scope, all });
  const { data } = hub;
  const failed = data.inputs.failed;
  const count = scope ? events.length : all ? data.events.total : data.events.alerts;

  const components = [
    {
      type: 'value',
      value: count,
      label: pick(all ? TEXT.events : TEXT.alerts, language),
      icon: 'bell',
      color: count > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      value: failed.length,
      label: pick(TEXT.inputs, language),
      icon: 'log-in',
      color: failed.length > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
  ];
  if (data.throughput !== null) {
    components.push({
      type: 'value',
      value: data.throughput,
      label: pick(TEXT.rate, language),
      icon: 'activity',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (error) {
    components.push(error);
  }

  // Graylog itself first: what makes it lose messages.
  const items = failed.map((input) => ({
    label: fit(`${pick(TEXT.input, language)} ${input.state}`, 40),
    value: fit(input.title, 40),
    icon: 'alert-octagon',
    color: WIDGET_COLORS.DANGER,
  }));
  if (data.storage === 'red' || data.storage === 'yellow') {
    items.push({
      label: pick(TEXT.storage, language),
      value: data.storage,
      icon: 'database',
      color: data.storage === 'red' ? WIDGET_COLORS.DANGER : WIDGET_COLORS.WARNING,
    });
  }
  const room = MAX_ROWS - items.length;
  if (events.length === 0) {
    items.push({
      label: pick(all ? TEXT.noEvent : TEXT.noAlert, language),
      value: data.storage ? `${pick(TEXT.storage, language)} ${data.storage}` : '✓',
      icon: 'check-circle',
      color: WIDGET_COLORS.SUCCESS,
    });
  } else if (room > 0) {
    const shown = events.length > room ? events.slice(0, room - 1) : events;
    for (const event of shown) {
      items.push({
        label: fit(event.title || event.definitionId, 40),
        value: when(event.timestamp, hub.now(), language),
        icon: event.alert ? 'bell' : 'info',
        color: event.alert ? WIDGET_COLORS.WARNING : WIDGET_COLORS.INFO,
      });
    }
    if (events.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${events.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  components.push({ type: 'status', items: items.slice(0, MAX_ROWS) });
  components.push(refreshButton(language));

  return { ttl_seconds: failed.length > 0 || error ? 30 : 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollAll({ fresh: true });
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
