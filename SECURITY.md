# Security reporting

Do not put exploitable vulnerability details, credentials, personal data, or private application files in a public issue or pull request.

Private vulnerability reporting is enabled for this repository (checked through the GitHub API on 2026-10-02). To report a vulnerability privately, open the repository's **Security** tab and choose **Report a vulnerability**, or go directly to <https://github.com/Akilleez-QA/foundation-engine/security/advisories/new>. The report is visible only to you and the maintainers until a fix or advisory is published. Do not send a report to an address inferred from commit history.

If that option is ever unavailable, open a minimal public issue asking the maintainer for a private channel, with **no vulnerability description, affected endpoint, reproduction, or exploit**, and wait for that channel before sending details.

Useful report information includes:

- The affected commit or version and the relevant component.
- A minimal reproduction using synthetic data and an environment you control.
- Expected versus actual behavior and the security impact.
- Any suggested mitigation, without disclosing third-party secrets.

Limit testing to systems and data you own or are authorized to assess. Do not access other people's data, disrupt services, or publish working exploit details before discussing disclosure with the maintainer. This policy does not authorize testing a third-party game or hosting provider.

For building games: browser clients are untrusted, and client-side anti-cheat is not a security boundary. The [command integrity guide](docs/guides/integrity.md) maps the engine's host-side protections (authority, validation, scoped views, rate limits, integrity rules) and what each does and does not stop.

There is currently no published supported-version window, security response SLA, or vulnerability bounty. Fixes and release availability must be checked against the repository's actual commits and releases. Ordinary correctness bugs without sensitive security implications can use the bug report template.
