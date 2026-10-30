# Publish an immutable content bundle

Use `npm run content:publish -- description.json output-directory` for separately compiled content artifacts. This is an optional local publication tool, not a production deployment command or replacement for the application build/gate.

A description contains a positive `schemaVersion`, stable `contentVersion`, and `artifacts` rows with `path` (bundle-relative output), `source` (description-relative input), and optional `references` (other output paths). Semantic compilation and schema validation must succeed before invoking publication; this tool verifies file identity and dependency presence, not application-specific meaning.

All inputs are read and checked before writes. At most 1,024 artifacts and 16 MiB of bytes are admitted. The tool writes a staging directory, verifies written hashes, renames the complete immutable release, then atomically replaces `active.json`. Consumers resolve the active release once per load and keep that manifest for all subsequent artifact reads. Do not read individual files from a mutable directory.

A failed artifact write, corrupt staged bytes or missing dependency cannot promote a bundle. Previous immutable releases remain available; `active.json` records the preceding ID. Repeating the same publication preserves that recovery pointer. A publication lock prevents concurrent writers. Process death may leave a lock/staging directory; inspect and remove abandoned staging/lock files before retrying. Atomic rename is not a guarantee against storage-device failure or an unflushed power loss.

Retention is bounded at 32 releases. Archive releases deliberately before adding more; do not remove the active release or any release still in use. This tool does not claim dependency-aware incremental compilation, schema migrations, or a hosted asset service.

Artifact rows use locale-independent UTF-16 code-unit path order when deriving the
manifest and release ID. Reference arrays retain their authored order and duplicates.
Earlier versions used host-locale collation: republishing a bundle whose path order
changes can produce a new ID even when artifact bytes are unchanged. Existing
immutable releases remain valid and are retained under the normal retention policy;
this does not rewrite their manifests or require consumers to migrate their IDs.
