import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { handleChatRequest } from './chatHandler';

const execAsync = promisify(exec);
const SESSION_KEY = 'codecoach.session';
const PROFILE_KEY = 'codecoach.profile';

let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

export type HintLevel = 1 | 2 | 3;
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export interface Attempt {
  at: string;
  note: string;
}

export interface EvaluationSnapshot {
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

export interface SessionState {
  challengeId: string;
  difficulty: Difficulty;
  startedAt: string;
  attempts: Attempt[];
  hintsUsed: HintLevel[];
  hintExplanations: string[];
  latestEvaluation?: EvaluationSnapshot;
}

export interface LearnerProfile {
  sessionsCompleted: number;
  currentStreak: number;
  bestStreak: number;
  lastSessionDate?: string;
  weakestAreas: Record<string, number>;
}

export interface ChallengeCatalogItem {
  id: string;
  difficulty?: Difficulty;
}

export function activate(context: vscode.ExtensionContext): void {
  // Initialize Output Channel
  outputChannel = vscode.window.createOutputChannel('CodeCoach');

  // Initialize Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'codecoach.showProgress';
  context.subscriptions.push(statusBarItem);

  updateStatusBar(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('codecoach.startSession', () => startSession(context)),
    vscode.commands.registerCommand('codecoach.logAttempt', () => logAttempt(context)),
    vscode.commands.registerCommand('codecoach.requestHint', () => requestHint(context)),
    vscode.commands.registerCommand('codecoach.runEvaluation', () => runEvaluation(context)),
    vscode.commands.registerCommand('codecoach.showProgress', () => showProgress(context)),
    vscode.commands.registerCommand('codecoach.generateProgressReport', () => generateProgressReport(context)),
    vscode.commands.registerCommand('codecoach.endSession', () => endSession(context))
  );

  // Register Chat Participant
  if (vscode.chat && (vscode.chat as any).createChatParticipant) {
    const participant = vscode.chat.createChatParticipant('codecoach', (request, chatContext, stream, token) => {
      return handleChatRequest(request, chatContext, stream, token, context);
    });
  }
}

export function deactivate(): void {
  // no-op
}

export function getSession(context: vscode.ExtensionContext): SessionState | undefined {
  return context.workspaceState.get<SessionState>(SESSION_KEY);
}

export async function setSession(context: vscode.ExtensionContext, session: SessionState | undefined): Promise<void> {
  await context.workspaceState.update(SESSION_KEY, session);
}

export function getProfile(context: vscode.ExtensionContext): LearnerProfile {
  return context.globalState.get<LearnerProfile>(PROFILE_KEY, {
    sessionsCompleted: 0,
    currentStreak: 0,
    bestStreak: 0,
    weakestAreas: {}
  });
}

export async function setProfile(context: vscode.ExtensionContext, profile: LearnerProfile): Promise<void> {
  await context.globalState.update(PROFILE_KEY, profile);
}

export async function startSession(context: vscode.ExtensionContext, customChallenge?: { id: string, difficulty?: Difficulty }): Promise<void> {
  if (customChallenge) {
    await internalStartSession(context, customChallenge.id, customChallenge.difficulty ?? 'beginner');
    return;
  }

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

  await internalStartSession(context, challengeId, difficulty);
}

async function internalStartSession(context: vscode.ExtensionContext, challengeId: string, difficulty: Difficulty): Promise<void> {
  const session: SessionState = {
    challengeId,
    difficulty,
    startedAt: new Date().toISOString(),
    attempts: [],
    hintsUsed: [],
    hintExplanations: []
  };

  await setSession(context, session);
  updateStatusBar(context);
  logToOutput(`🚀 Session started: ${challengeId} (${difficulty})`);

  // Setup files for the user
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (folder) {
    const baseName = challengeId.split('/').pop() || 'challenge';
    const coachFolder = vscode.Uri.joinPath(folder, 'codecoach');

    // Create folder if it doesn't exist
    await vscode.workspace.fs.createDirectory(coachFolder);

    const solutionPath = vscode.Uri.joinPath(coachFolder, `${baseName}.ts`);
    const briefingPath = vscode.Uri.joinPath(coachFolder, `${baseName}.md`);

    // Create solution file if it doesn't exist
    try {
      await vscode.workspace.fs.stat(solutionPath);
    } catch {
      const initialCode = `// Challenge: ${challengeId}\n// Difficulty: ${difficulty}\n\nexport function solve() {\n  // Implement your solution here\n}\n`;
      await vscode.workspace.fs.writeFile(solutionPath, Buffer.from(initialCode));
    }

    // Always create/update briefing file
    const briefingContent = buildBriefingContent(challengeId, difficulty);
    await vscode.workspace.fs.writeFile(briefingPath, Buffer.from(briefingContent));

    // Open files
    const briefingDoc = await vscode.workspace.openTextDocument(briefingPath);
    await vscode.window.showTextDocument(briefingDoc, { viewColumn: vscode.ViewColumn.Beside, preview: false });

    const solutionDoc = await vscode.workspace.openTextDocument(solutionPath);
    await vscode.window.showTextDocument(solutionDoc, { viewColumn: vscode.ViewColumn.One, preview: false });
  }

  vscode.window.showInformationMessage(`CodeCoach session started: ${challengeId} (${difficulty}). Check the briefing and start coding!`);
}

function buildBriefingContent(challengeId: string, difficulty: Difficulty): string {
  return `# CodeCoach Mission: ${challengeId}
**Difficulty:** ${difficulty}
**Status:** ACTIVE

## Problem Description
You have been assigned the challenge: \`${challengeId}\`. 

Your goal is to implement an efficient solution in the companion file. CodeCoach will monitor your progress and provide hints if you get stuck (after you document your attempts).

## Rules of Discipline
1. **No Copy-Pasting:** Write every line yourself to build muscle memory.
2. **Log Your Attempts:** Use \`@codecoach /log\` or the "Log Attempt" command to describe what you've tried.
3. **Staged Hints:** Hints are earned through persistence, not requested immediately.

## Getting Started
1. Open the implementation file.
2. Draft your strategy in comments.
3. Run \`@codecoach /evaluate\` once you have a working solution.
`;
}

export async function logAttempt(context: vscode.ExtensionContext): Promise<void> {
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
  logToOutput(`📝 Attempt logged: "${note}"`);
  vscode.window.showInformationMessage(`Attempt logged. Total attempts: ${session.attempts.length}`);
}

export async function requestHint(context: vscode.ExtensionContext): Promise<void> {
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

  logToOutput(`💡 Hint requested: Level ${nextHintLevel}`);
  vscode.window.showInformationMessage(`Hint L${nextHintLevel}: ${buildHint(nextHintLevel, session.challengeId)}`);
}

export function buildHint(level: HintLevel, challengeId: string): string {
  if (level === 1) {
    return `Restate ${challengeId} in your own words and list hard constraints before coding.`;
  }

  if (level === 2) {
    return 'Identify the dominant operation in your current solution and replace repeated scans with a better structure.';
  }

  return 'Create targeted edge-case tests (empty, single-item, duplicates, max-size input) before rewriting logic.';
}

export async function runEvaluation(context: vscode.ExtensionContext): Promise<void> {
  const session = getSession(context);
  if (!session) {
    vscode.window.showWarningMessage('Start a CodeCoach session first.');
    return;
  }

  const evaluationCommand = vscode.workspace.getConfiguration('codecoach').get<string>('evaluationCommand', 'npm test');
  const started = Date.now();
  try {
    const editor = vscode.window.activeTextEditor;
    let folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (editor) {
      const fileUri = editor.document.uri;
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
      if (workspaceFolder) {
        folder = workspaceFolder.uri.fsPath;
      }
    }

    if (!folder) {
      throw new Error('Open a workspace folder to run local evaluation.');
    }

    const { stdout, stderr } = await execAsync(evaluationCommand, { cwd: folder });
    const durationMs = Date.now() - started;
    const combinedOutput = `${stdout}\n${stderr}`;

    session.latestEvaluation = buildEvaluationSnapshot(true, evaluationCommand, combinedOutput, durationMs);
    await setSession(context, session);

    logToOutput(`✅ Evaluation PASSED: ${session.challengeId}`);
    logToOutput(`   Score: ${session.latestEvaluation.overallScore}/100`);
    if (session.latestEvaluation.bruteForceSignals.length > 0) {
      logToOutput(`   ⚠️ Signals: ${session.latestEvaluation.bruteForceSignals.join(', ')}`);
    }

    vscode.window.showInformationMessage(
      `Evaluation passed. Overall score: ${session.latestEvaluation.overallScore}`
    );
  } catch (error) {
    const durationMs = Date.now() - started;
    const output = error instanceof Error ? error.message : String(error);

    session.latestEvaluation = buildEvaluationSnapshot(false, evaluationCommand, output, durationMs);
    await setSession(context, session);

    logToOutput(`❌ Evaluation FAILED: ${session.challengeId}`);
    logToOutput(`   Score: ${session.latestEvaluation.overallScore}/100`);
    logToOutput(`   Error: ${output.slice(0, 200)}...`);

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

  // Look for nested loops (O(n^2) or worse)
  if (/(for|while|foreach|loop|map).+[\s\S]{0,300}(for|while|foreach|loop|map)/im.test(text)) {
    signals.push('nested_logic');
  }

  // Look for linear search inside a loop (often should be a hash map)
  if (/\.includes\(|\.find\(|\.contains\(/.test(text) && /(for|while|loop)/i.test(text)) {
    signals.push('search_inside_loop');
  }

  // Look for recursion (could be brute-force depth-first search)
  const fnMatch = text.match(/function\s+(\w+)|const\s+(\w+)\s*=\s*\(.*?\)\s*=>/);
  if (fnMatch) {
    const fnName = fnMatch[1] || fnMatch[2];
    if (fnName && new RegExp(`\\b${fnName}\\s*\\(`, 'g').test(text.replace(fnMatch[0], ''))) {
      signals.push('recursion_detected');
    }
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

export async function endSession(context: vscode.ExtensionContext): Promise<void> {
  const session = getSession(context);
  if (!session) {
    vscode.window.showInformationMessage('No active CodeCoach session.');
    return;
  }

  const profile = getProfile(context);
  const now = new Date();

  // Use local date for streak calculation to avoid UTC rollover issues
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const lastDateStr = profile.lastSessionDate;

  profile.sessionsCompleted += 1;

  if (!lastDateStr) {
    profile.currentStreak = 1;
  } else {
    const lastDateParts = lastDateStr.split('-').map(Number);
    const lastDate = new Date(lastDateParts[0], lastDateParts[1] - 1, lastDateParts[2]).getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const diffDays = Math.round((today - lastDate) / oneDayMs);

    if (diffDays === 1) {
      profile.currentStreak += 1;
    } else if (diffDays > 1) {
      profile.currentStreak = 1;
    }
    // If diffDays === 0, streak stays the same (already practiced today)
  }

  const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  profile.bestStreak = Math.max(profile.bestStreak, profile.currentStreak);
  profile.lastSessionDate = dateString;
  profile.weakestAreas[session.challengeId.split('/')[0] ?? 'general'] = session.latestEvaluation?.overallScore ?? 0;

  await setProfile(context, profile);
  await setSession(context, undefined);

  updateStatusBar(context);
  logToOutput(`🏁 Session ended: ${session.challengeId}`);
  logToOutput(`   Final Streak: ${profile.currentStreak}`);

  vscode.window.showInformationMessage(
    `Session ended. Completed: ${profile.sessionsCompleted}, streak: ${profile.currentStreak}, best: ${profile.bestStreak}.`
  );
}

function getChallengeCatalog(): ChallengeCatalogItem[] {
  const raw = vscode.workspace.getConfiguration('codecoach').get<unknown[]>('challengeCatalog', []);
  const parsed = raw
    .filter((item: unknown): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && 'id' in item
    )
    .map((item: Record<string, unknown>) => ({
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

function updateStatusBar(context: vscode.ExtensionContext): void {
  const session = getSession(context);
  const profile = getProfile(context);

  const streakText = `🔥 ${profile.currentStreak}`;
  const missionText = session ? ` | 🛡️ ${session.challengeId.split('/').pop()}` : '';

  statusBarItem.text = `CodeCoach: ${streakText}${missionText}`;
  statusBarItem.tooltip = session
    ? `Active Mission: ${session.challengeId}\nStreak: ${profile.currentStreak} days`
    : `No active mission\nStreak: ${profile.currentStreak} days`;
  statusBarItem.show();
}

export function logToOutput(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);
}
