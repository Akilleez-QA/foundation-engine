# Predeclared acceptance evidence

Candidate development tool: [contract, API and CLI](../../tools/acceptance-evidence/README.md).

A runner must distinguish “no differences observed” from “every required observation was compared.” Predeclare named cases and sample minima, preserve artifact/configuration/oracle/environment identity, then refuse missing, skipped, failed or under-sampled results. An empty fixture inventory is invalid.

This prototype has two consumers in tests: the existing replay comparator and retained historical save migration with a fresh owner. It does not introduce another test executor, persistence owner, scheduler or runtime kit. The CLI is optional; its own regressions join the existing repository test glob.

The evidence envelope checks reporting completeness, not truth. The runner still owns independent expected values, required channels, actual observation counts and faithful error propagation. Synthetic identity strings in tests are not production provenance. A backend migration needs both value/error equivalence and existing owner/cancellation/publication checks; this prototype does not establish them by itself.

Status: implemented local candidate with focused tests; not integrated or physical-device accepted. No performance claim or budget change.
