# Shared extension contracts

This workspace contains versioned, strict data contracts for module discovery,
numeric controls, resource references, source-coordinate frames, analysis/render
ports, command envelopes, candidate outcomes and AI result decisions.

`createBuiltinRegistry()` is used by the real `GET /v1/modules` API. The real
decision API validates `AiResultDecisionRequest` with the exported discriminated
schema. `GET /v1/editor-contract` derives descriptors from the editor's executable
registries instead of maintaining a second list of ranges.

No capability grants authorization, executes remote plugin code or supplies an
API credential. `implemented`, `adapter-required`, and `contract-only` distinguish
code existence from runtime readiness. Source-coordinate frames bind analysis to
the exact image hash, oriented dimensions, and model-owned algorithm version.

See [the extension guide](../../docs/EXTENSIONS.md) for module code paths, data
flow, addition procedures, adoption transactions and remaining algorithm ports.
