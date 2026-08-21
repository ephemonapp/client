# Strict Plan Mode

- The approved plan is an allowlist of work.
- When fixing a bug, restore the existing intended mechanism first. Do not design a replacement unless the plan
  explicitly requires it.
- Do not add storage, migrations, protocols, abstractions, APIs, dependencies, or compatibility layers without explicit
  user approval.
- If a solution requires deviating from the plan, stop and ask the user before making changes.
- Do not fix unrelated problems discovered along the way.
- Every change must have a direct chain: current plan item -> observed defect -> minimal necessary change.
- Prefer the smallest patch that preserves existing behavior and contracts.
- Do not start preparatory work for later increments before the current increment is complete and reviewed.
- Record completed work and the next approved step in the project Markdown working log.
- Never create a Git commit unless the user explicitly approves that exact commit.
