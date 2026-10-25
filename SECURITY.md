# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the Graylog access token (or the password of a Graylog user) is
  a `secret` field of the Gladys configuration. The integration reads it from
  Gladys at startup, keeps it in memory, sends it only to the Graylog address
  of the configuration (the `Authorization: Basic` header), and never writes
  it to `/data` nor to the logs. The token has the rights of its user: the
  documentation asks for a user with the Reader role and Viewer shares only,
  and the integration only reads (its two POST requests, a metrics read and
  an event search, change nothing).
- **Stored in `/data`**: `graylog-state.json`, what was already announced: the
  ids and dates of the events of the last 24 hours, the failed inputs (node
  id, input id, title, state, error message), a red storage, the address of
  the configuration and a truncated hash of the token or user name, so that a
  restart neither repeats nor misses a scene event. No secret.
- **Network**: requests go only to the Graylog address typed in the
  configuration, in HTTP by default (Graylog's default) or HTTPS when typed.
  On an untrusted network, put Graylog behind HTTPS: in plain HTTP the token
  travels in clear. "Accept self-signed certificates" is off by default; ticked,
  the connection is encrypted but the server is not authenticated. The
  integration opens no port and calls no cloud service.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Graylog itself, and the logs it collects.
