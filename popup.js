let latest = null;
const status = document.getElementById('status');
const autoButton = document.getElementById('auto');
const scanButton = document.getElementById('scan');
const exportButton = document.getElementById('export');
const copyButton = document.getElementById('copy');
const capturedEl = document.getElementById('captured');
const qualityEl = document.getElementById('qualityValue');
const scoreEl = document.getElementById('score');
const accuracyEl = document.getElementById('accuracy');
const qualityBox = document.getElementById('quality');
const warningsEl = document.getElementById('warnings');
const detailsEl = document.getElementById('details');

function setStatus(message) { status.textContent = message; }

function activeTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => tabs[0]);
}

function validTestbookTab(tab) {
  return !!tab?.id && /^https:\/\/(.*\.)?testbook\.com\//i.test(tab.url || '');
}

function showData(data) {
  latest = data;
  const extraction = data?.extraction || {};
  const performance = data?.performance || {};
  const expected = extraction.expectedQuestions;
  const captured = extraction.capturedQuestions ?? data?.count ?? 0;

  capturedEl.textContent = expected ? `${captured}/${expected}` : String(captured);
  qualityEl.textContent = extraction.qualityScore != null ? `${extraction.qualityScore}%` : '—';
  scoreEl.textContent = performance.score != null
    ? `${performance.score}${performance.maxMarks != null ? `/${performance.maxMarks}` : ''}`
    : '—';
  accuracyEl.textContent = performance.accuracyPercent != null ? `${performance.accuracyPercent}%` : '—';

  if (extraction.qualityScore != null) {
    qualityBox.textContent = `Data quality: ${extraction.qualityScore}%\nAnswer coverage: ${extraction.answerCoveragePercent ?? '—'}%\nTiming coverage: ${extraction.timingCoveragePercent ?? '—'}%`;
  } else {
    qualityBox.textContent = 'Extraction completed, but no quality score was reported.';
  }

  const warnings = extraction.warnings || [];
  warningsEl.textContent = warnings.length ? `⚠️ ${warnings.join('\n⚠️ ')}` : '✓ No extraction warnings.';

  const sections = (data?.sections || []).map(s => `${s.name}: ${s.questionCount} Q | ${s.correct ?? 0} correct | ${s.incorrect ?? 0} wrong`).join('\n');
  const missing = extraction.missingQuestionNumbers?.length ? `Missing: ${extraction.missingQuestionNumbers.join(', ')}` : 'Missing: none detected';
  detailsEl.textContent = `Schema: ${data?.schemaVersion || 'unknown'}\nQuestions: ${captured}\n${missing}\nSections:\n${sections || 'No section metadata detected.'}`;

  exportButton.disabled = !latest;
  copyButton.disabled = !latest;
}

async function scanCurrentPage() {
  const tab = await activeTab();
  if (!validTestbookTab(tab)) throw new Error('Open the Testbook completed-test page first.');
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_TEST' });
  if (!response?.ok) throw new Error(response?.error || 'Extraction failed');
  showData(response.data);
  return response.data;
}

scanButton.addEventListener('click', async () => {
  try {
    setStatus('Scanning current page...');
    const data = await scanCurrentPage();
    setStatus(`Scan complete. Captured ${data.count} question record(s).`);
  } catch (error) {
    setStatus(`Could not scan this page.\n${error.message}`);
  }
});

autoButton.addEventListener('click', async () => {
  autoButton.disabled = true;
  scanButton.disabled = true;
  setStatus('Starting automatic scan...\nKeep the Testbook tab open.');
  try {
    const tab = await activeTab();
    if (!validTestbookTab(tab)) throw new Error('Open the Testbook completed-test page first.');
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'AUTO_EXTRACT_TEST' });
    if (!response?.ok) throw new Error(response?.error || 'Automatic scan failed');
    showData(response.data);
    const warnings = response.data?.extraction?.warnings?.length || 0;
    setStatus(`DONE. Captured ${response.data.count} question(s).${warnings ? `\n${warnings} warning(s) — inspect the report.` : '\nNo extraction warnings.'}`);
  } catch (error) {
    setStatus(`Automatic scan stopped.\n${error.message}`);
  } finally {
    autoButton.disabled = false;
    scanButton.disabled = false;
  }
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'AUTO_PROGRESS') {
    const p = message.progress || {};
    setStatus(`Scanning automatically...\nQuestion ${p.questionNumber || '—'}\nCaptured: ${p.done || 0}${p.section ? `\nSection: ${p.section}` : ''}`);
  }
});

exportButton.addEventListener('click', () => {
  if (!latest) return;
  const blob = new Blob([JSON.stringify(latest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename: `testbook-analysis-v1.5-${Date.now()}.json`,
    saveAs: true
  }, () => setTimeout(() => URL.revokeObjectURL(url), 5000));
});

copyButton.addEventListener('click', async () => {
  if (!latest) return;
  const prompt = [
    'Analyze this Testbook mock-test dataset for an SSC student.',
    'Use only the supplied data. Do not invent missing values.',
    'Separate observed facts from inference.',
    'Analyze overall performance, section performance, question-level mistakes, timing, repeated patterns, weak topics when identifiable, and concrete next-study actions.',
    'Return a structured analysis suitable for later storage in Notion.',
    '',
    JSON.stringify(latest, null, 2)
  ].join('\n');
  try {
    await navigator.clipboard.writeText(prompt);
    setStatus('AI-ready dataset + analysis instructions copied.');
  } catch (error) {
    setStatus(`Could not copy to clipboard.\n${error.message}`);
  }
});
