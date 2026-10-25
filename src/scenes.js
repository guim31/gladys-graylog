// -----------------------------------------------------------------------------
// Scene action handler (manifest `scene_actions`, Gladys 5.1+).
//
// "Are there alerts?" is already a scene condition on the device features.
// This action does what a condition cannot: put the latest alerts (or
// events) in words for a message ("2 alert(s): Disk failure at 14:32…"),
// of one event definition or of all, added to Gladys or not, with the
// message of the last one. It reads Graylog again when the last read is
// older than 15 seconds.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './graylog/client.js';
import { ACTION_TEXT, ERROR_TEXT, pick } from './texts.js';

// Events listed in the `names` output, at most (the rest is counted).
export const MAX_LISTED = 10;

export const SCOPES = Object.freeze({ ALERTS: 'alerts', ALL: 'all' });

const TIME = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
const clock = (timestamp, language) =>
  new Intl.DateTimeFormat(TIME[language] ?? 'en-GB', { timeStyle: 'short' }).format(
    new Date(timestamp),
  );

function assertReadable(hub) {
  const language = hub.config?.language;
  if (!hub.client) {
    throw new Error(pick(ACTION_TEXT.noServer, language));
  }
  if (hub.error || !hub.data) {
    throw new Error(pick(ERROR_TEXT[hub.error?.kind ?? ERROR_KINDS.UNREACHABLE], language));
  }
}

export const SCENE_ACTIONS = {
  async get_alerts(hub, { fields = {} }) {
    const language = hub.config?.language;
    if (!hub.client) {
      throw new Error(pick(ACTION_TEXT.noServer, language));
    }
    await hub.refreshIfStale();
    assertReadable(hub);
    let scope = null;
    if (fields.device) {
      const definition = hub.findDefinition(fields.device);
      if (!definition) {
        throw new Error(pick(ACTION_TEXT.unknownDefinition, language));
      }
      scope = new Set([definition.id]);
    }
    const all = fields.include === SCOPES.ALL;
    const events = hub.recentEvents({ scope, all });
    const count = hub.countEvents({ scope, all, listed: events.length });
    const listed = events
      .slice(0, MAX_LISTED)
      .map((event) => `${event.title || event.definitionId} (${clock(event.timestamp, language)})`);
    const last = events[0];
    return {
      count,
      last_title: last ? last.title : '',
      last_message: last
        ? last.message
        : pick(all ? ACTION_TEXT.noEvent : ACTION_TEXT.none, language),
      minutes_ago: last ? Math.max(0, Math.round((hub.now() - last.timestamp) / 60_000)) : -1,
      names:
        count > listed.length
          ? `${listed.join(', ')}, +${count - listed.length}`
          : listed.join(', '),
    };
  },
};
