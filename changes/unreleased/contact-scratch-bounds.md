- **Bounded contact scratch storage.** Contact updates retain one neighbor row and admitted pairs instead of
  materializing every overlap before applying limits. Continuing-pair priority, refusal counts and snapshot
  semantics stay unchanged; dense overlap processing is still density-sensitive. See the
  [contact contract](src/kits/contact/README.md).
