# Secret scanning

The repository extends Gitleaks' default rules. Source manifest entries map paths
to SHA-256 content digests; names containing `key` or `token` can trigger the
generic API key detector even though their values are hashes.

The allowlist applies only when all of these conditions hold:

- The rule is `generic-api-key`.
- The path is exactly `SOURCE-MANIFEST.json`.
- The extracted value is exactly 64 lowercase hexadecimal characters.

Other rules and other files retain their default checks. This is a format-based
exception, not proof that arbitrary future manifest content is harmless. Review
manifest generation and unexpected value changes with the source-manifest checks.

The `targetRules` configuration requires Gitleaks 8.25.0 or later; see the
[upstream configuration reference](https://github.com/gitleaks/gitleaks/blob/v8.30.1/README.md#configuration).
The local verification used Gitleaks 8.30.1. It checked that manifest digests match
file contents and used disposable synthetic inputs outside the checkout to confirm
that a hash in another file and a non-hash value in the manifest remain findings.

Before publishing, run from the checkout root:

```sh
~/.local/bin/gitleaks detect --no-git -s . --no-banner --redact=100
trufflehog filesystem . --no-update --only-verified
```

Both commands must exit successfully. A clean filesystem scan does not certify
Git history or prove that no undiscovered credential exists.
