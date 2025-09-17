# PR Summary

- What change is introduced?
- Why is this necessary now?
- How was this tested?

## Governance

- Glyph(s) referenced:
  - `SIG-FLD-VAL-001` — Declaration Echoes Return Amplified
- Contracts impacted (list IDs):
  - e.g., `SIG-SYS-NOT-027` — Secrets & Privacy

## Downgrade Notes (if any)

If using a legacy or less-preferred path (e.g., Notion legacy DB API instead of Data Sources), explain:
- Reason for downgrade:
- Scope and duration:
- Mitigations and plan to restore alignment:

## Checklist

- [ ] New/changed source files include the glyph header on the first lines:

```ts
// [SIG-FLD-VAL-001] Declared in posture, amplified in field.
```

- [ ] CI will run governance checks. If this is from a fork or CI cannot access governance repo, confirm local run:
  - `npm run check:glyph-header`
  - `npm run ci:pr`
  - `npm run validate:links`
  - `npm run perf:budgets`
  - `npm run fixtures:redact`
