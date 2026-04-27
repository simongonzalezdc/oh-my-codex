# OMX context packs

Context packs are compact execution handoff artifacts for approved plans.
They live under `.omx/context/` and use JSON schema `omx-context-pack-v1`.

They are intentionally narrow: Ralph and Team only read a pack after the
existing approved PRD/test-spec handoff path has been selected. Normal Ralph or
Team launches do not implicitly consume `.omx/context` files.

## Shape

```json
{
  "schema": "omx-context-pack-v1",
  "slug": "issue-1970",
  "basis": {
    "prd": { "path": ".omx/plans/prd-issue-1970.md", "sha1": "<sha1>" },
    "testSpecs": [
      { "path": ".omx/plans/test-spec-issue-1970.md", "sha1": "<sha1>" }
    ]
  },
  "entries": [
    { "path": "docs/context-packs.md", "roles": ["scope"] },
    {
      "path": "src/planning/artifacts.ts",
      "roles": ["build"],
      "selector": { "type": "lines", "start": 1, "end": 120 }
    },
    { "path": "src/planning/__tests__/artifacts.test.ts", "roles": ["verify"] }
  ]
}
```

## Validation contract

- `basis.prd` and every `basis.testSpecs[]` entry must match the selected
  approved PRD/test-spec file path and SHA-1 digest.
- `entries` must be non-empty.
- Entry `roles` are limited to `scope`, `build`, and `verify`.
- Optional selectors currently support only line ranges with
  `1 <= start <= end`.
- A stale or malformed relevant pack blocks approved Ralph/Team handoff with an
  actionable error; a missing pack preserves existing behavior.
