# Security reporting

Do not put exploitable vulnerability details, credentials, personal data, or private application files in a public issue or pull request.

A private reporting channel has not yet been verified for this repository. Until one is confirmed, you may open a minimal issue asking the maintainer to provide a private security-reporting channel. Include **no vulnerability description, affected endpoint, reproduction, or exploit** in that request. Wait for a private channel before sending sensitive details. Do not send a report to an address inferred from commit history.

If GitHub's “Report a vulnerability” option becomes available in this repository's Security tab, it provides a private channel for a report. This document does not claim that option is currently enabled.

Once a private channel is confirmed, useful report information includes:

- The affected commit or version and the relevant component.
- A minimal reproduction using synthetic data and an environment you control.
- Expected versus actual behavior and the security impact.
- Any suggested mitigation, without disclosing third-party secrets.

Limit testing to systems and data you own or are authorized to assess. Do not access other people's data, disrupt services, or publish working exploit details before discussing disclosure with the maintainer. This policy does not authorize testing a third-party game or hosting provider.

For building games: browser clients are untrusted, and client-side anti-cheat is not a security boundary. The [command integrity guide](docs/guides/integrity.md) maps the engine's host-side protections (authority, validation, scoped views, rate limits, integrity rules) and what each does and does not stop.

There is currently no published supported-version window, security response SLA, or vulnerability bounty. Fixes and release availability must be checked against the repository's actual commits and releases. Ordinary correctness bugs without sensitive security implications can use the bug report template.
