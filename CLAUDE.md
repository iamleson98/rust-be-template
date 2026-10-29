# Agent guidelines

## Spawning sessions and subagents

Pick each spawned session's or subagent's `model` and `effort` for its task;
never let it inherit the parent's by default. Say the choice in one line
when starting it.

| Task | Model | Effort |
| --- | --- | --- |
| Read-only search, audit, mechanical edits | Haiku or Sonnet | low–medium |
| Bounded fix with clear scope (one route, one component, its tests) | Sonnet | medium |
| Design-heavy or risky work (architecture, security, data migrations, concurrency) | Opus | high |
