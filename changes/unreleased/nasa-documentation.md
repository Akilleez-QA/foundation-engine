- **Control documents and trace check.** The docs now include a management plan, requirements mapping matrix,
  data dictionary, test plan, test reports, version description and assurance record, and the requirements,
  design, interface and configuration documents carry metadata headers and full traceability. `npm run lint:trace`
  fails on an untraced requirement, a missing test file, a missing header or a dead link or anchor; see the
  [documentation index](docs/README.md#engineering-records).
