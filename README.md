# CodeCoach

A **Structured Coding Discipline Engine** for VS Code.

CodeCoach is designed to make AI-assisted coding a training system instead of a shortcut system.

## What this build now includes

### 1) Structured session flow
- Start a challenge from a configurable catalog.
- Track challenge difficulty and per-session activity.
- End session and persist learner profile metrics.

### 2) Attempt-first + explanation-before-hint
- Hints stay locked until the minimum attempt threshold is met.
- Optional policy requires a meaningful written explanation before each hint unlock.
- Hints are staged across three levels to prevent instant solution drops.

### 3) Local evaluation + scoring snapshot
- Run any local command (`codecoach.evaluationCommand`).
- Store a score breakdown:
  - Correctness
  - Efficiency
  - Code quality
  - Overall score
- Capture brute-force signals from active code (e.g., nested loops).

### 4) Skill progression tracking
- Persist global learner profile:
  - sessions completed
  - current streak
  - best streak
  - simple weakness mapping by topic

### 5) Progress visibility
- `Show Progress` for quick in-editor status.
- `Generate Progress Report` to open a markdown report in VS Code.

## Commands

- `CodeCoach: Start Session`
- `CodeCoach: Log Attempt`
- `CodeCoach: Request Hint`
- `CodeCoach: Run Local Evaluation`
- `CodeCoach: Show Progress`
- `CodeCoach: Generate Progress Report`
- `CodeCoach: End Session`

## Settings

- `codecoach.evaluationCommand` - local command run for evaluation.
- `codecoach.minimumAttemptsForHint` - attempts required before hints unlock.
- `codecoach.requireExplanationForHint` - enforce explanation-before-hint.
- `codecoach.challengeCatalog` - challenge list shown when starting sessions.

## Development

```bash
npm install
npm run compile
```

Then press `F5` in VS Code to launch an Extension Development Host.
