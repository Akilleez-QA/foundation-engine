- **Bridge error paths tested; records corrected.** The stdio bridge's -32603 internal-error answers and its
  1,048,576-byte output bound now have tests and are stated as REQ-FND-004 and REQ-FND-005 (formerly untested
  gaps GAP-001 and GAP-002). The foundation-contract decision record, which shared number 0078 with the
  render-backend decision, is now [ADR 0156](docs/adr/0156-foundation-contract-baseline.md). THIRD_PARTY_NOTICES.md
  gives the lockfile versions of ws, prettier, playwright-core and `@types/node`; their licenses are unchanged.
  Found by the family findings sweep.
