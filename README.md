# Graylog for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[Graylog](https://graylog.org/): your event definitions as devices, scenes
that react when an alert fires, when an input fails or when the storage turns
red, a scene action that reads the latest alerts, and a dashboard widget.

It reads the REST API of Graylog (port 9000) on your local network, with an
access token. Read only: nothing is changed in Graylog.

## Features

- **One device per event definition**: its events of the last 24 hours, the
  date and time of the last one.
- **A "Graylog" device**: messages per second (all nodes), failed inputs,
  storage in red (OpenSearch / Elasticsearch health), messages waiting in the
  disk journal, events and alerts of the last 24 hours.
- **Scene triggers**: a Graylog event fires (filters: definitions, alert or
  event, priority), an input fails, an input runs again, the storage turns
  red, the storage is no longer red, Graylog no longer answers. Each event is
  announced once, even across restarts.
- **Scene action**: read the latest alerts (or events), of one definition or
  of all: count, last message, list.
- **Widget**: alerts of the day, failed inputs, throughput, then the problems
  of Graylog itself and the latest alerts with their time.
- Feature names, messages and documentation in English, French, German and
  Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Graylog 6 (tested on 6.1; Graylog 5 has the same API but was not tested),
  reachable on port 9000 or behind a reverse proxy.
- A Graylog user with the **Reader** role and an access token; the event
  definitions, the **All events** stream and the streams the definitions
  search shared with it (Viewer). Details in [`docs/en.md`](docs/en.md).

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-graylog` (or
   install **Graylog** from the catalog once it is listed).
2. In **Configuration**, enter the address of Graylog (`192.168.1.2`:
   `http://` and port 9000 are added) and the access token. Save, then click
   **Test the connection**.
3. Open the **Discover** tab and add the "Graylog" device and the event
   definitions to follow.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

Every minute by default, the integration sends five or six requests to the
REST API (`http://<host>:9000/api`), in Basic auth (`<token>:token`):
`POST cluster/metrics/multiple` (input rate and journal of every node),
`GET cluster/inputstates`, `GET system/indexer/cluster/health`,
`GET events/definitions`, `POST events/search` (the 200 newest events of the
last 24 hours, plus one count of the alerts when they do not fit), and
`GET system` once an hour for the version. The POSTs change nothing; they
carry `X-Requested-By`, as Graylog requires. The states of the added devices
are sent only when they change (and every 6 hours), the scene events for
every definition, added or not. The ids of the events already announced, the
failed inputs and a red storage are kept in `/data`: a restart neither repeats
nor misses an event.

## Checked on a real Graylog

On 25/10/2026, the client ran in a container with the constraints of the
Gladys sandbox (read-only rootfs, no capability) against Graylog 6.1.16
(official `graylog/graylog:6.1` Docker image, MongoDB 6, OpenSearch 2.15):
GELF HTTP and Syslog UDP inputs, a GELF TCP input failing to bind, two
aggregation event definitions fed by GELF messages (one with an HTTP
notification, so its events are alerts), the "System notification events"
definition, an access token, a refused token, a Reader user with and without
shares, the web interface and OpenSearch answering on the wrong address. The
answers are kept as anonymized fixtures in
[`test/fixtures/graylog`](test/fixtures/graylog).

## Limitations

- One Graylog (or cluster) per integration; read only, no acknowledgement.
- Polling: an event is seen up to one interval after Graylog stores it.
- At most the 200 newest events per read are examined for scene events, and
  30 scene events are sent per read.
- No message search: the integration follows what the event definitions find.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK and an in-memory Graylog
(`test/helpers/fakeGraylog.js`) seeded with real answers. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- Started from the official
  [integration template](https://github.com/GladysAssistant/integration-template-js)
  and the [integration SDK](https://github.com/GladysAssistant/integration-sdk-js)
  of Gladys Assistant (Apache-2.0).
- The answers of a real Graylog 6.1 and its API browser were the references
  for the API calls; no code is copied from another project. Architecture
  shared with [gladys-icinga](https://github.com/guim31/gladys-icinga).
- Cover: the Graylog logo from
  [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Graylog_logo.svg)
  (public domain),
  a trademark of Graylog, Inc.

## Disclaimer

Not affiliated with Graylog, Inc. Graylog is a trademark of Graylog, Inc.

## License

[Apache-2.0](LICENSE)
