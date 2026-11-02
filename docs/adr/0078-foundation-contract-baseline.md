# ADR 0078: Source identity and read-only tool schema baseline

Status: Proposed

## Requirement and decision

The creator requires a Foundation contract in a small first change. Reuse the
existing `@engine` validator seam for render masks and scene output. Pin their JSON
input/output subset without introducing an executor. Generate a versioned SHA-256
map of Git-tracked source bytes using the sibling manifest convention.

## Consequences and verification

Git owns membership; tooling owns generation and drift checking. Local artifacts
and the manifest itself are excluded. Work scales with tracked bytes, with no
runtime queue or cancellation lifecycle. Missing files fail generation; regenerate
after fixing or staging intended changes. Schema tests compare native constants,
defaults and rejection boundaries. Manifest mutation tests detect changed bytes and
new membership. CI checks drift independently. The follow-on stdio implementation and its admission/error contract are recorded
in the ICD; the original static baseline remains the first stacked change.
