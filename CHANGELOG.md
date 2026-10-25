# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-25

### Added

- One device per Graylog event definition: its events of the last 24 hours,
  the date and time of the last one.
- A "Graylog" device: messages per second (all nodes), failed inputs, storage
  in red (OpenSearch / Elasticsearch health), messages waiting in the disk
  journal, events and alerts of the last 24 hours.
- Scene triggers: a Graylog event fires (filters: event definitions, alert or
  event, priority), an input fails, an input runs again, the storage turns
  red, the storage is no longer red, Graylog no longer answers. Each event is
  announced once, even across restarts.
- Scene action: read the latest alerts (or events) of the last 24 hours, of
  one definition or of all, for a message.
- Dashboard widget: alerts of the day, failed inputs, throughput, the problems
  of Graylog itself and the latest alerts with their time.
- Graylog REST API with an access token (or a user and its password), read
  only; address typed with or without scheme and port, reverse proxies and
  self-signed certificates supported.
- Feature names, messages and documentation in English, French, German and
  Spanish.

[Unreleased]: https://github.com/guim31/gladys-graylog/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-graylog/releases/tag/v1.0.0
