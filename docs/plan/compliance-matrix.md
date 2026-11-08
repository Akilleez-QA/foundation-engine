# Foundation Engine requirements mapping matrix

| Field | Value |
|---|---|
| Document ID | FENGINE-RMM |
| Version | 1.0 |
| Status | Baselined |
| Owner | Akilleez-QA |
| Date | 2026-11-08 |
| Baseline commit | `a9e8cc6f175b5055b18abf26579ecc432a6ac53b` |
| Applies to | foundation-engine main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

Self-assessed class: Class E analog, not safety-critical. Baseline: Class E with
voluntary adoption of the Class D documentation set. Rows are NPR 7150.2D SWE
requirements. The class column was parsed from the Appendix C table text; check an edge
case against the NPR before citing it. Decision values: Applies, Tailored, N/A.

| SWE | Topic | NPR classes | Decision | How met / rationale |
|---|---|---|---|---|
| 013 | Software plans | A–E | Applies | [SMP](software-management-plan.md) |
| 020 | Classification | A–E | Applies | [SMP §1](software-management-plan.md#1-software-classification-self-assessed) |
| 176 | Classification records | A–E | Applies | SMP §1 and its change history |
| 205 | Safety-critical determination | A–E | Applies | SMP §1: not safety-critical |
| 022 | Assurance, safety and IV&V planning | A–E | Tailored | [SMP §6](software-management-plan.md#6-software-assurance); no independent assurance organization; no IV&V |
| 033 | Acquire versus develop | A–E | Applies | [SMP §8](software-management-plan.md#8-open-source-reused-and-vendored-components): developed in house on reused OSS |
| 042 | Source code access | A–E | Applies | Public repository |
| 121 / 139 / 125 | Tailoring, compliance, this matrix | A–E | Applies | This document |
| 148 | Contribute to reuse | A–E | Applies | GPL-3.0-only [LICENSE](../../LICENSE); [README](../../README.md) related projects |
| 156 | Cybersecurity assessment | A–E | Applies | [SMP §7](software-management-plan.md#7-security-privacy-and-secure-coding), [SECURITY.md](../../SECURITY.md) |
| 024 / 034 / 036 / 037 | Tracking, acceptance criteria, documentation plan, milestones | A–D | Tailored | Issues; [SMP §5](software-management-plan.md#5-verification-and-validation-approach) acceptance; [docs index](../README.md) |
| 039 / 040 | Status reporting and deliverables to an acquirer | A–D | N/A | No acquirer and supplier split; the public repository and releases serve the purpose |
| 027 | COTS and OSS components | A–D | Applies | SMP §8, [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) |
| 015 / 151 / 174 / 016 / 046 / 018 | Cost and schedule | A–D (018: A–C) | N/A | Unfunded single-maintainer project |
| 017 | Training | A–C | N/A | [SMP §14](software-management-plan.md#14-training) |
| 141 / 131 / 178 / 179 | IV&V | A–B | N/A | Not an IV&V-category project |
| 023 / 134 / 219 / 220 | Safety-critical software | A–D if safety-critical | N/A | Not safety-critical (SWE-205) |
| 032 | CMMI rating | A–B | N/A | Not applicable to an open-source single-maintainer project |
| 146 / 206 | Auto-generated code | A–C / A–D | Applies | Generated sources (`src/generated/`, `keys.gen.ts`, capability inventory, source manifest) are controlled in [SCMP §5](../configuration/configuration-management.md#5-control-of-generated-outputs) |
| 147 | Reusability requirements | A–D | Applies | REQ-ARCH-001 and REQ-PURE-001 in the [SRS](../requirements/requirements.md) |
| 154 / 157 / 159 / 207 / 185 / 210 | Cybersecurity risks, protections, secure coding, verification | A–D (210: A–C) | Tailored | SMP §7; static analysis and secret scan in the [SAR](../assurance/assurance-record.md) |
| 050 / 051 / 053 / 054 / 055 | Requirements | A–D (051: A–C) | Applies | [SRS](../requirements/requirements.md); requirements analysis in the SAR |
| 184 | Safety constraints in requirements | A–C | N/A | No hazards ([SRS §1.2](../requirements/requirements.md#12-not-applicable-requirement-categories)) |
| 052 | Bidirectional traceability | A–D | Applies | [Verification matrix](../verification/verification-matrix.md), `npm run lint:trace` |
| 057 / 058 | Architecture and design | A–C | Applies (voluntary) | [SDD](../architecture/architecture.md), [ICD](../icd/icd-dependencies.md), [ADRs](../adr/README.md) |
| 143 | Architecture review | A–C | Tailored | Pull-request review of SDD and ADR changes |
| 060 / 061 | Code and coding standards | A–C / A–D | Applies | [STANDARD.md](../STANDARD.md), [CONTRIBUTING](../../CONTRIBUTING.md), lint chain |
| 135 | Static analysis | A–D | Applies | SMP §6, SAR |
| 062 / 186 | Unit test, repeatable | A–D | Applies | [Test plan](../verification/test-plan.md) |
| 063 | Version description | A–D | Applies | [Version descriptions](../releases/README.md) |
| 136 / 070 | Tool and model accreditation | A–C | Tailored | Tools pinned in [SMP §4](software-management-plan.md#4-engineering-and-test-environment); no accreditation |
| 065 / 066 / 068 / 071 | Test plan, testing, evaluate results, update | A–D | Applies | [Test plan](../verification/test-plan.md), [test reports](../verification/reports/README.md) |
| 187 | CM before test | A–C | Applies | CI runs on committed code |
| 073 | Target platform validation | A–C | Tailored | CI Node 22 and 26 on Ubuntu; browser checks in Chromium; no physical-device validation (GAP-004) |
| 189 / 190 | Code coverage | A–D / A–C | Tailored | Measured with Node coverage, value in [test plan §5](../verification/test-plan.md#5-coverage-and-static-analysis); no threshold |
| 191 | Regression testing | A–C | Applies | Full suites on every pull request with code changes |
| 192 / 193 | Hazard tests, uplinked data | A–D / A–B | N/A | No hazards; no uplink |
| 211 | Test reused components | A–C | Tailored | Dependencies exercised by the engine's own suites; retained v0.2.0 compatibility snapshot |
| 075 / 077 / 194 / 195 / 196 | Operations, delivery, maintenance, retirement | A–D | Tailored | [SMP §11](software-management-plan.md#11-operations-maintenance-and-retirement), version descriptions |
| 079–085 | Configuration management | A–D | Applies | [SCMP](../configuration/configuration-management.md) |
| 045 | Joint audits | A–C | N/A | No acquirer |
| 086 | Risk management | A–C | Tailored | [SMP §12](software-management-plan.md#12-risk-register) |
| 087 / 088 / 089 | Peer review | A–C | Tailored | [Pull request template](../../.github/pull_request_template.md); SAR summary; no effort metrics |
| 090 / 093 / 094 / 199 / 200 | Measurement | A–C (200: A–B) | Tailored | Metrics block in each test report |
| 201 / 202 | Non-conformances, severity | A–D / A–C | Applies | Issues; [SMP §9](software-management-plan.md#9-problem-reporting-and-severity) |
| 203 / 204 | OSS defect assessment, process assessment | A–C / A–B | Tailored | Dependabot updates reviewed in pull requests; S1 root cause recorded in the issue |

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-08 | `a9e8cc6` | Initial baseline | PR #346 |
