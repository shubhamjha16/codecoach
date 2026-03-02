import * as vscode from 'vscode';
import {
    SessionState,
    LearnerProfile,
    getSession,
    setSession,
    getProfile,
    buildHint,
    runEvaluation,
    logAttempt,
    startSession,
    logToOutput
} from './extension';

export async function handleChatRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    extensionContext: vscode.ExtensionContext
) {
    const session = getSession(extensionContext);
    const command = request.command;

    if (command === 'start') {
        logToOutput('🤖 Chat command: /start');
        stream.markdown('### 🚀 Starting CodeCoach Session\n\nI\'m opening the challenge catalog for you. Please select a challenge from the list at the top of your editor window.');
        await vscode.commands.executeCommand('codecoach.startSession');

        const updatedSession = getSession(extensionContext);
        if (updatedSession) {
            stream.markdown(`\n\n### ✅ Session Active: ${updatedSession.challengeId}\n\nI have created a dedicated folder for your mission. You should see two files opened:\n1.  **Mission Briefing (.md):** Read this for problem details and constraints.\n2.  **Implementation File (.ts):** This is where you will write your code.\n\nGood luck, and remember: **Discipline over speed.**`);
        }
        return;
    }

    if (!session && command !== 'status') {
        stream.markdown('### 🛑 Session Required\n\nTo provide focused coaching, I need you to be in an active session. \n\nUse `@codecoach /start` to pick a challenge and begin your journey.');
        return;
    }

    if (command === 'hint') {
        logToOutput('🤖 Chat command: /hint');
        await handleHintRequest(session!, stream, extensionContext);
        return;
    }

    if (command === 'evaluate') {
        logToOutput('🤖 Chat command: /evaluate');
        stream.markdown('### 🔍 Evaluating Your Discipline...\n\nI\'m running your local tests and analyzing your code structure. This will take just a moment.');
        await vscode.commands.executeCommand('codecoach.runEvaluation');
        const updatedSession = getSession(extensionContext);
        if (updatedSession?.latestEvaluation) {
            const score = updatedSession.latestEvaluation.overallScore;
            stream.markdown(`### 📊 Evaluation Results\n\n**Overall Discipline Score: ${score}/100**\n\n| Metric | Score |\n| :--- | :--- |\n| Correctness | ${updatedSession.latestEvaluation.correctnessScore} |\n| Efficiency | ${updatedSession.latestEvaluation.efficiencyScore} |\n| Code Quality | ${updatedSession.latestEvaluation.qualityScore} |\n`);

            if (updatedSession.latestEvaluation.bruteForceSignals.length > 0) {
                stream.markdown(`\n> [!WARNING]\n> **Discipline Alert:** I detected patterns that might indicate a "brute-force" mindset: **${updatedSession.latestEvaluation.bruteForceSignals.join(', ')}**. \n> \n> Try to rethink the core data structure or algorithm to improve efficiency.`);
            } else if (score >= 90) {
                stream.markdown(`\n> [!TIP]\n> **Excellent work!** Your solution is both correct and maintains high standards of discipline.`);
            }
        }
        return;
    }

    if (command === 'status') {
        logToOutput('🤖 Chat command: /status');
        const profile = getProfile(extensionContext);
        if (session) {
            stream.markdown(`### 🛡️ Mission Status: ${session.challengeId}\n\n* **Difficulty:** ${session.difficulty}\n* **Attempts Logged:** ${session.attempts.length}\n* **Hints Revealed:** ${session.hintsUsed.length}\n* **Current Daily Streak:** 🔥 ${profile.currentStreak} days\n\nKeep pushing. Every line you write is a step toward mastery.`);
        } else {
            stream.markdown(`### 🏛️ CodeCoach Profile\n\n* **Missions Accomplished:** ${profile.sessionsCompleted}\n* **Current Daily Streak:** 🔥 ${profile.currentStreak} days\n* **All-Time Best Streak:** 🏆 ${profile.bestStreak} days\n\nReady for your next mission? Use \`@codecoach /start\`.`);
        }
        return;
    }

    // Default conversational response
    stream.markdown('I am your CodeCoach. I help you build better coding discipline. \n\nInstead of giving you the solution, I will provide staged hints and evaluate your code quality. \n\n**Try these commands:**\n- `/start` to begin a challenge\n- `/hint` for conceptual guidance\n- `/evaluate` to check your current progress');
}

async function handleHintRequest(
    session: SessionState,
    stream: vscode.ChatResponseStream,
    context: vscode.ExtensionContext
) {
    const minAttempts = vscode.workspace.getConfiguration('codecoach').get<number>('minimumAttemptsForHint', 1);

    if (session.attempts.length < minAttempts) {
        stream.markdown(`### ⚠️ Hint Locked\nTo build discipline, you must log at least **${minAttempts} attempt(s)** before I provide a hint.\n\nUse \`CodeCoach: Log Attempt\` to document what you've tried.`);
        return;
    }

    stream.markdown('### 💡 Thinking about a hint...\nTo unlock the next level of guidance, please explain what you are struggling with and what you plan to try next. (The more detail, the better I can coach you!)');

    // In a real implementation with Chat API, we might wait for the user's next message.
    // For now, we bridge to the existing native input box logic to ensure we get the explanation.
    await vscode.commands.executeCommand('codecoach.requestHint');

    // Get updated session to show the level
    const updated = getSession(context);
    if (updated && updated.hintsUsed.length > session.hintsUsed.length) {
        const level = updated.hintsUsed[updated.hintsUsed.length - 1];
        stream.markdown(`\n\n**Level ${level} Guidance provided!** Check the notification for your specific hint.`);
    }
}
