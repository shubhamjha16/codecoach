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

## AI Coaching Interface

CodeCoach is fully integrated into the VS Code Chat interface. Talk to `@codecoach` to:
- Get conceptual, architectural, or implementation hints.
- Receive feedback on your code quality and efficiency.
- Track your streak and sessions without leaving the chat.

## Technology Independent

CodeCoach works with any language that can be tested from a terminal.
- **Python**: `codecoach.evaluationCommand` = `pytest`
- **C++**: `codecoach.evaluationCommand` = `g++ test.cpp -o t && ./t`
- **SQL**: `codecoach.evaluationCommand` = `psql -f test.sql`

## Placement Readiness

The engine is designed to prepare you for live technical interviews by:
1. **Forcing Explanation**: You must explain your logic before unlocking hints.
2. **Penalizing Performance**: Signals like nested loops and slow execution lower your score.
3. **Staged Guidance**: Hints never give the full answer, only "nudges" to keep you thinking.

## Commands
- `@codecoach /start` - Start a new session.
- `@codecoach /hint` - Request a thinking nudge.
- `@codecoach /evaluate` - Run tests and get a score report.
- `@codecoach /status` - See your current profile and streak.

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
