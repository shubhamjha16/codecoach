import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const SESSION_KEY = 'codecoach.session';
const PROFILE_KEY = 'codecoach.profile';

type HintLevel = 1 | 2 | 3;

type Difficulty = 'beginner' | 'intermediate' | 'advanced';

interface Attempt {
  at: string;
  note: string;
}

interface EvaluationSnapshot {
  command: string;
  success: boolean;
  correctnessScore: number;
  efficiencyScore: number;
  qualityScore: number;
  overallScore: number;
  bruteForceSignals: string[];
  outputSummary: string;
  runAt: string;
}

interface SessionState {
  challengeId: string;
  difficulty: Difficulty;
  startedAt: string;
  attempts: Attempt[];
  hintsUsed: HintLevel[];
  hintExplanations: string[];
  latestEvaluation?: EvaluationSnapshot;
}

interface LearnerProfile {
  sessionsCompleted: number;
  currentStreak: number;
  bestStreak: number;
  lastSessionDate?: string;
  weakestAreas: Record<string, number>;
}

interface ChallengeCatalogItem {
  id: string;
  difficulty?: Difficulty;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codecoach.startSession', () => startSession(context)),
    vscode.commands.registerCommand('codecoach.logAttempt', () => logAttempt(context)),
    vscode.commands.registerCommand('codecoach.requestHint', () => requestHint(context)),
    vscode.commands.registerCommand('codecoach.runEvaluation', () => runEvaluation(context)),
    vscode.commands.registerCommand('codecoach.showProgress', () => showProgress(context)),
    vscode.commands.registerCommand('codecoach.generateProgressReport', () => generateProgressReport(context)),
    vscode.commands.registerCommand('codecoach.endSession', () => endSession(context))
  );
}

export function deactivate(): void {
  // no-op
}

function getSession(context: vscode.ExtensionContext): SessionState | undefined {
  return context.workspaceState.get<SessionState>(SESSION_KEY);
}

async function setSession(context: vscode.ExtensionContext, session: SessionState | undefined): Promise<void> {
  await context.workspaceState.update(SESSION_KEY, session);
}

function getProfile(context: vscode.ExtensionContext): LearnerProfile {
  return context.globalState.get<LearnerProfile>(PROFILE_KEY, {
    sessionsCompleted: 0,
    currentStreak: 0,
    bestStreak: 0,
    weakestAreas: {}
  });
}

async function setProfile(context: vscode.ExtensionContext, profile: LearnerProfile): Promise<void> {
  await context.globalState.update(PROFILE_KEY, profile);
}

async function startSession(context: vscode.ExtensionContext): Promise<void> {
  const catalog = getChallengeCatalog();
  const picked = await vscode.window.showQuickPick(
    [
      ...catalog.map((c) => ({ label: c.id, detail: c.difficulty ?? 'beginner' })),
      { label: 'Custom challenge ID...', detail: 'enter manually' }
    ],
    { title: 'Pick a challenge' }
  );

  if (!picked) {
    return;
  }

  let challengeId = picked.label;
  let difficulty: Difficulty = normalizeDifficulty(picked.detail);

  if (picked.label === 'Custom challenge ID...') {
    const custom = await vscode.window.showInputBox({
      prompt: 'Enter challenge ID (e.g., arrays/two-sum-1)',
      placeHolder: 'topic/problem-id'
    });

    if (!custom) {
      return;
    }

    challengeId = custom;
    difficulty = 'beginner';
  }

  const session: SessionState = {
    challengeId,
    difficulty,
    startedAt: new Date().toISOString(),
    attempts: [],
    hintsUsed: [],
    hintExplanations: []
  };

  await setSession(context, session);
  vscode.window.showInformationMessage(`CodeCoach session started: ${challengeId} (${difficulty}).`);
}

async function logAttempt(context: vscode.ExtensionContext): Promise<void> {
  const session = getSession(context);
  if (!session) {
    vscode.window.showWarningMessage('Start a CodeCoach session first.');
    return;
  }

  const note = await vscode.window.showInputBox({
    prompt: 'What did you try?',
    placeHolder: 'Implemented hash map approach but duplicate edge case still failing...'
  });

  if (!note) {
    return;
  }

  session.attempts.push({ at: new Date().toISOString(), note });
  await setSession(context, session);
  vscode.window.showInformationMessage(`Attempt logged. Total attempts: ${session.attempts.length}`);
}

async function requestHint(context: vscode.ExtensionContext): Promise<void> {
  const session = getSession(context);
  if (!session) {
    vscode.window.showWarningMessage('Start a CodeCoach session first.');
    return;
  }

  const minimumAttempts = vscode.workspace.getConfiguration('codecoach').get<number>('minimumAttemptsForHint', 1);
  const requireExplanation = vscode.workspace.getConfiguration('codecoach').get<boolean>('requireExplanationForHint', true);

  if (session.attempts.length < minimumAttempts) {
    vscode.window.showWarningMessage(
      `Hint locked. Log at least ${minimumAttempts} attempt(s) before requesting hints.`
    );
    return;
  }

  if (requireExplanation) {
    const explanation = await vscode.window.showInputBox({
      prompt: 'Before hint unlock: explain what failed and what you will try next.',
      placeHolder: 'My approach fails on boundary conditions because... Next I will...'
    });

    if (!explanation || explanation.trim().length < 20) {
      vscode.window.showWarningMessage('Hint denied. Please provide a thoughtful explanation (20+ chars).');
      return;
    }

    session.hintExplanations.push(explanation.trim());
  }

  const nextHintLevel = (session.hintsUsed.length + 1) as HintLevel;
  if (nextHintLevel > 3) {
    vscode.window.showInformationMessage('Maximum hint level reached. No further hints available.');
    return;
  }

  session.hintsUsed.push(nextHintLevel);
  await setSession(context, session);

  vscode.window.showInformationMessage(`Hint L${nextHintLevel}: ${buildHint(nextHintLevel, session.challengeId)}`);
}

function buildHint(level: HintLevel, challengeId: string): string {
  if (level === 1) {
    return `Restate ${challengeId} in your own words and list hard constraints before coding.`;
  }

  if (level === 2) {
    return 'Identify the dominant operation in your current solution and replace repeated scans with a better structure.';
  }

  return 'Create targeted edge-case tests (empty, single-item, duplicates, max-size input) before rewriting logic.';
}

async function runEvaluation(context: vscode.ExtensionContext): Promise<void> {
  const session = getSession(context);
  if (!session) {
    vscode.window.showWarningMessage('Start a CodeCoach session first.');
    return;
  }

  const evaluationCommand = vscode.workspace.getConfiguration('codecoach').get<string>('evaluationCommand', 'npm test');
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    vscode.window.showWarningMessage('Open a workspace folder to run local evaluation.');
    return;
  }

  const started = Date.now();
  try {
    const { stdout, stderr } = await execAsync(evaluationCommand, { cwd: folder });
    const durationMs = Date.now() - started;
    const combinedOutput = `${stdout}\n${stderr}`;

    session.latestEvaluation = buildEvaluationSnapshot(true, evaluationCommand, combinedOutput, durationMs);
    await setSession(context, session);

    vscode.window.showInformationMessage(
      `Evaluation passed. Overall score: ${session.latestEvaluation.overallScore}`
    );
  } catch (error) {
    const durationMs = Date.now() - started;
    const output = error instanceof Error ? error.message : String(error);

    session.latestEvaluation = buildEvaluationSnapshot(false, evaluationCommand, output, durationMs);
    await setSession(context, session);

    vscode.window.showWarningMessage(
      `Evaluation failed. Overall score: ${session.latestEvaluation.overallScore}`
    );
  }
}

function buildEvaluationSnapshot(success: boolean, command: string, output: string, durationMs: number): EvaluationSnapshot {
  const correctnessScore = scoreCorrectness(success, output);
  const bruteForceSignals = detectBruteForceSignals();
  const efficiencyScore = scoreEfficiency(durationMs, bruteForceSignals.length);
  const qualityScore = scoreQuality(output, bruteForceSignals.length);
  const overallScore = Math.round((correctnessScore * 0.5) + (efficiencyScore * 0.3) + (qualityScore * 0.2));

  return {
    command,
    success,
    correctnessScore,
    efficiencyScore,
    qualityScore,
    overallScore,
    bruteForceSignals,
    outputSummary: output.trim().slice(0, 500) || 'No output',
    runAt: new Date().toISOString()
  };
}

function scoreCorrectness(success: boolean, output: string): number {
  if (!success) {
    return 0;
  }

  const parsed = output.match(/(\d+)\s+passed[^\d]+(\d+)\s+total/i);
  if (parsed) {
    const passed = Number(parsed[1]);
    const total = Number(parsed[2]);
    if (total > 0) {
      return Math.round((passed / total) * 100);
    }
  }

  return 100;
}

function scoreEfficiency(durationMs: number, bruteForceCount: number): number {
  const timeScore = durationMs < 2000 ? 100 : durationMs < 5000 ? 85 : durationMs < 10000 ? 70 : 50;
  const penalty = bruteForceCount * 10;
  return clampScore(timeScore - penalty);
}

function scoreQuality(output: string, bruteForceCount: number): number {
  let score = 100;

  if (/lint|format|type error/i.test(output)) {
    score -= 20;
  }

  score -= bruteForceCount * 15;
  return clampScore(score);
}

function detectBruteForceSignals(): string[] {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return [];
  }

  const text = editor.document.getText();
  const signals: string[] = [];

  if (/for\s*\([^)]*\)\s*\{[\s\S]{0,200}for\s*\(/m.test(text)) {
    signals.push('nested_loops');
  }
  if (/while\s*\([^)]*\)\s*\{[\s\S]{0,200}while\s*\(/m.test(text)) {
    signals.push('nested_while_loops');
  }
  if (/\.includes\([^)]*\)/.test(text) && /for\s*\(/.test(text)) {
    signals.push('includes_inside_loop');
  }

  return signals;
}

async function showProgress(context: vscode.ExtensionContext): Promise<void> {
  const session = getSession(context);
  if (!session) {
    vscode.window.showInformationMessage('No active CodeCoach session.');
    return;
  }

  const latest = session.latestEvaluation;
  const profile = getProfile(context);
  const message = [
    `Challenge: ${session.challengeId}`,
    `Difficulty: ${session.difficulty}`,
    `Attempts: ${session.attempts.length}`,
    `Hints used: ${session.hintsUsed.length}`,
    `Overall score: ${latest ? latest.overallScore : 'N/A'}`,
    `Streak: ${profile.currentStreak}`
  ].join(' | ');

  vscode.window.showInformationMessage(message);
}

async function generateProgressReport(context: vscode.ExtensionContext): Promise<void> {
  const session = getSession(context);
  const profile = getProfile(context);

  if (!session) {
    vscode.window.showWarningMessage('No active session. Start one before generating a report.');
    return;
  }

  const latest = session.latestEvaluation;
  const lines = [
    '# CodeCoach Progress Report',
    '',
    `- Challenge: ${session.challengeId}`,
    `- Difficulty: ${session.difficulty}`,
    `- Attempts: ${session.attempts.length}`,
    `- Hints used: ${session.hintsUsed.length}`,
    `- Sessions completed: ${profile.sessionsCompleted}`,
    `- Current streak: ${profile.currentStreak}`,
    '',
    '## Latest Evaluation',
    latest
      ? `- Correctness: ${latest.correctnessScore}\n- Efficiency: ${latest.efficiencyScore}\n- Quality: ${latest.qualityScore}\n- Overall: ${latest.overallScore}\n- Brute-force signals: ${latest.bruteForceSignals.join(', ') || 'none'}`
      : '- Not run yet'
  ];

  const doc = await vscode.workspace.openTextDocument({
    content: lines.join('\n'),
    language: 'markdown'
  });

  await vscode.window.showTextDocument(doc, { preview: false });
}

async function endSession(context: vscode.ExtensionContext): Promise<void> {
  const session = getSession(context);
  if (!session) {
    vscode.window.showInformationMessage('No active CodeCoach session.');
    return;
  }

  const profile = getProfile(context);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const last = profile.lastSessionDate;

  profile.sessionsCompleted += 1;
  if (!last) {
    profile.currentStreak = 1;
  } else {
    const daysDiff = Math.floor((Date.parse(today) - Date.parse(last)) / (1000 * 60 * 60 * 24));
    profile.currentStreak = daysDiff <= 1 ? profile.currentStreak + 1 : 1;
  }
  profile.bestStreak = Math.max(profile.bestStreak, profile.currentStreak);
  profile.lastSessionDate = today;
  profile.weakestAreas[session.challengeId.split('/')[0] ?? 'general'] = session.latestEvaluation?.overallScore ?? 0;

  await setProfile(context, profile);
  await setSession(context, undefined);

  vscode.window.showInformationMessage(
    `Session ended. Completed: ${profile.sessionsCompleted}, streak: ${profile.currentStreak}, best: ${profile.bestStreak}.`
  );
}

function getChallengeCatalog(): ChallengeCatalogItem[] {
  const raw = vscode.workspace.getConfiguration('codecoach').get<unknown[]>('challengeCatalog', []);
  const parsed = raw
    .filter((item): item is ChallengeCatalogItem => typeof item === 'object' && item !== null && 'id' in item)
    .map((item) => ({
      id: String(item.id),
      difficulty: normalizeDifficulty(typeof item.difficulty === 'string' ? item.difficulty : undefined)
    }));

  return parsed.length > 0 ? parsed : [{ id: 'arrays/two-sum-1', difficulty: 'beginner' }];
}

function normalizeDifficulty(value: string | undefined): Difficulty {
  if (value === 'advanced' || value === 'intermediate' || value === 'beginner') {
    return value;
  }

  return 'beginner';
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
