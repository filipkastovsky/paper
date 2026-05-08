# ADR 0008 — Linter, formatter, pre-commit

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-05-07 |
| **Decision owner** | Filip Kaštovský |
| **Drafted by** | CTO agent (Claude) |
| **Audience** | Implementation engineer |
| **Companion** | ADR 0007 (monorepo) |

---

## TL;DR

**Biome** as the single linter + formatter. **lefthook** for pre-commit hooks running `biome check --apply` and `pnpm gen:api-client` (when server routes change).

## Context

ADR 0001 §7.7 left the linter/formatter open. Solo founder velocity is the dominant constraint; tooling friction must be near zero.

The conventional 2026 default in greenfield TypeScript projects is either:
- ESLint + Prettier (mature, multi-tool, more config)
- Biome (single tool, faster, fewer rules but covers the common 80%)

## Decision

### Linter + formatter — Biome

- One binary, one config file (`biome.json`), one CLI verb (`biome check`).
- Covers lint + format + import sorting in a single pass.
- ~35× faster than ESLint+Prettier on equivalent codebases.
- Built-in rules cover most of `@typescript-eslint`, `react-hooks`, and `jsx-a11y`.
- Zero plugin ecosystem to manage.

`biome.json` (rough sketch — finalised on first PR):

```json
{
  "$schema": "https://biomejs.dev/schemas/latest/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignore": ["**/dist", "**/.tanstack", "packages/api-client/src"] },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "a11y": { "recommended": true },
      "style": { "useImportType": "error" },
      "correctness": { "noUnusedImports": "error", "useExhaustiveDependencies": "error" }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": { "quoteStyle": "double", "semicolons": "always", "trailingCommas": "all" }
  }
}
```

`packages/api-client/src` is ignored because it's Kubb-generated — formatting drift would create constant regen noise.

### Pre-commit — lefthook

- Faster than Husky (Go binary, parallel execution).
- Matches the lab repo's hands-off ethos (no Node-runtime overhead in pre-commit).

`lefthook.yml`:

```yaml
pre-commit:
  parallel: true
  commands:
    biome:
      glob: '*.{ts,tsx,js,jsx,json}'
      run: pnpm exec biome check --apply --no-errors-on-unmatched {staged_files}
      stage_fixed: true
    typecheck:
      glob: '*.{ts,tsx}'
      run: pnpm -r typecheck
    api-client-regen:
      glob: 'apps/server/src/{routes,db}/**/*.ts'
      run: pnpm gen:api-client && git add packages/api-client/src
```

The `api-client-regen` hook ensures generated client artefacts stay in sync with server schema changes (per ADR 0007's mitigation note).

### Editor integration

- VS Code: official Biome extension (`biomejs.biome`) set as the default formatter for TS/TSX/JSON.
- Format-on-save enabled in workspace settings.
- ESLint extension explicitly disabled to avoid double-fixing.

## Rationale

1. **Single-tool simplicity.** One config, one CLI, one mental model. Solo dev wins on cognitive overhead saved.
2. **Speed isn't a luxury at v0.** Pre-commit must complete in under 1s on a typical PR; Biome makes this trivial.
3. **Rule coverage is sufficient.** The recommended preset + a11y rules + a small set of style rules covers everything the team would otherwise hand-wire in ESLint configs. Edge cases (e.g. specific TanStack Query lint rules) are accepted as "won't catch automatically; Filip catches in code review".
4. **lefthook over Husky** for the same single-tool reason: Go binary, no Node startup tax.

## Consequences

### Positive

- A new contributor (or an AI agent) needs to learn one tool, not three.
- CI lint step runs in seconds.
- Configuration changes are localised to `biome.json` — no `.eslintrc.*`, `.prettierrc`, `.eslintignore`, `.prettierignore`, plugin packages, etc.

### Negative / accepted

- **No ecosystem of niche lint rules.** If a specific `@typescript-eslint` rule becomes critical (e.g. a TanStack Query "exhaustive deps" equivalent), Biome may not have a counterpart. Mitigation: enforce the missing pattern via a quick code-review checklist; revisit if Biome adds the rule (it ships rapidly).
- **Tailwind class sorting.** Biome doesn't sort Tailwind classes the way `prettier-plugin-tailwindcss` does. Acceptable in v0 (cva extracts class strings into one place per primitive); revisit at v0.1 if string sprawl becomes a readability issue.

## Alternatives considered

### A. ESLint + Prettier
**Rejected.** Two configs, slower, plugin sprawl, more CI minutes. Mature is not the same as low-friction.

### B. Deno lint + dprint
**Rejected.** Tooling outside the Node runtime adds friction in a Node project.

### C. Oxlint
**Considered, rejected.** Faster than Biome on lint, but doesn't format. Biome's combined story wins on simplicity.

### D. No pre-commit hook (CI-only)
**Rejected.** Catching `biome check` failures in CI wastes a minute per push. Local pre-commit is faster and frees CI for tests.

## References

- ADR 0001 §7.7
- Biome: https://biomejs.dev
- lefthook: https://github.com/evilmartians/lefthook
