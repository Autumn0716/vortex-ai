const baseUrl = (process.env.FLOWAGENT_API_BASE_URL || 'http://127.0.0.1:3850').replace(/\/+$/, '');
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 2500);

try {
  const response = await fetch(`${baseUrl}/api/automations/code_review/run`, {
    method: 'POST',
    signal: controller.signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.warn(`[flowagent] code review automation skipped: HTTP ${response.status}`);
    process.exit(0);
  }

  const summary = payload?.state?.lastRunSummary;
  const changedFiles = Number(summary?.changedFiles?.length ?? summary?.processedAgents ?? 0);
  const notes = Array.isArray(summary?.reviewNotes) ? summary.reviewNotes : [];
  console.log(`[flowagent] code review automation recorded ${changedFiles} changed file(s).`);
  notes.slice(0, 3).forEach((note) => console.log(`[flowagent] review note: ${note}`));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[flowagent] code review automation skipped: ${message}`);
} finally {
  clearTimeout(timeout);
}
