let autoRunning = false;

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function visible(el) {
  if (!el) return false;
  const s = getComputedStyle(el), r = el.getBoundingClientRect();
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0;
}
function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function clickByText(text, timeout = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const candidates = [...document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')]
        .filter(visible)
        .filter(el => clean(el.innerText || el.textContent || el.value).toLowerCase() === text.toLowerCase());
      if (candidates.length) { candidates[0].click(); resolve(true); return; }
      if (Date.now() - started > timeout) { reject(new Error(`Could not find visible "${text}" button.`)); return; }
      setTimeout(tick, 150);
    };
    tick();
  });
}

function currentQuestionNumber() {
  const text = clean(document.body.innerText);
  const m = text.match(/Question\s*No\.\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function solutionVisible() {
  const text = clean(document.body.innerText);
  if (/correct answer is\s*["']?Option\s*\d+/i.test(text)) return true;
  if (/BODMAS|Hence,? the correct answer/i.test(text) && /Solution/i.test(text)) return true;
  return [...document.querySelectorAll('li[ng-repeat*="option in getOptions"]')]
    .some(li => visible(li) && /correct-option/.test(String(li.className || '')));
}

function viewSolutionButtonExists() {
  return [...document.querySelectorAll('button, a, [role="button"]')]
    .some(el => visible(el) && /view\s+solution/i.test(clean(el.innerText || el.textContent)));
}

function nextButtonExists() {
  return [...document.querySelectorAll('button, a, [role="button"]')]
    .some(el => visible(el) && clean(el.innerText || el.textContent).toLowerCase() === 'next');
}

async function waitForQuestionChange(oldNumber, timeout = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const n = currentQuestionNumber();
    if (n && n !== oldNumber) return n;
    await wait(150);
  }
  return currentQuestionNumber();
}

async function ensureSolution() {
  if (solutionVisible()) return true;
  if (viewSolutionButtonExists()) {
    try { await clickByText('View Solution', 2500); } catch (_) {}
    const started = Date.now();
    while (!solutionVisible() && Date.now() - started < 5000) await wait(150);
    return solutionVisible();
  }
  const started = Date.now();
  while (!solutionVisible() && Date.now() - started < 2500) await wait(150);
  return solutionVisible();
}

// Section/question navigation is owned by extractor.js so both manual and
// automatic extraction use the same DOM heuristics.
function getSectionTabs() {
  return window.TestbookAnalyzer?.getSectionTabs?.() || [];
}
function currentSectionName() {
  return window.TestbookAnalyzer?.currentSectionName?.() || '';
}
function currentSectionQuestionCount() {
  return window.TestbookAnalyzer?.currentSectionQuestionCount?.() || null;
}

async function moveToNextSection(currentNumber) {
  const tabs = getSectionTabs();
  if (tabs.length < 2) return false;

  const sectionName = currentSectionName();
  let currentIndex = sectionName
    ? tabs.findIndex(tab => clean(tab.innerText || tab.textContent).toLowerCase() === sectionName.toLowerCase())
    : -1;

  if (currentIndex < 0) currentIndex = tabs.findIndex(tab => /active|selected|current/i.test(String(tab.className || '').toLowerCase()) || tab.getAttribute('aria-selected') === 'true');
  if (currentIndex < 0) currentIndex = 0;

  const nextTab = tabs[currentIndex + 1];
  if (!nextTab) return false;

  const oldSection = sectionName.toLowerCase();
  const oldQuestion = currentNumber;
  nextTab.click();

  const started = Date.now();
  while (Date.now() - started < 8000) {
    await wait(150);
    const newSection = currentSectionName().toLowerCase();
    const n = currentQuestionNumber();
    if ((newSection && newSection !== oldSection) || (n && n !== oldQuestion)) return true;
  }
  return false;
}

async function autoExtract(sendProgress) {
  if (autoRunning) throw new Error('An automatic scan is already running.');
  autoRunning = true;
  const all = [];
  const seen = new Set();
  let sectionIndex = 0;
  let previousSectionName = currentSectionName();

  try {
    for (let guard = 0; guard < 140; guard++) {
      const localQn = currentQuestionNumber();
      if (!localQn) throw new Error('Could not detect the current question number.');

      const sectionName = currentSectionName() || `Section ${sectionIndex + 1}`;
      if (previousSectionName && sectionName !== previousSectionName) {
        sectionIndex++;
        previousSectionName = sectionName;
      } else if (!previousSectionName) {
        previousSectionName = sectionName;
      }

      const key = `${sectionIndex}:${localQn}`;
      if (!seen.has(key)) {
        const solutionFound = await ensureSolution();
        await wait(250);
        const record = window.TestbookAnalyzer?.extract(sectionName);
        const q = record?.questions?.find(x => x.questionNumber === localQn);

        if (q) {
          q.section = sectionName;
          q.sectionIndex = sectionIndex + 1;
          q.sectionQuestionNumber = localQn;
          q.globalQuestionNumber = all.length + 1;
          q.questionNumber = all.length + 1;
          q.solutionDetected = q.solutionDetected || solutionFound;
          all.push(q);
          seen.add(key);
          sendProgress?.({ done: all.length, questionNumber: q.globalQuestionNumber, section: sectionName, sectionQuestionNumber: localQn });
        } else {
          // Do not silently count a question that was not actually extracted.
          sendProgress?.({ done: all.length, questionNumber: all.length + 1, section: sectionName, sectionQuestionNumber: localQn, warning: `Question ${localQn} could not be extracted.` });
        }
      }

      const sectionCount = currentSectionQuestionCount();
      const atSectionEnd = sectionCount && localQn >= sectionCount;

      if (atSectionEnd || !nextButtonExists()) {
        const moved = await moveToNextSection(localQn);
        if (!moved) break;
        sectionIndex++;
        previousSectionName = currentSectionName();
        await wait(700);
        continue;
      }

      await clickByText('Next', 5000);
      const nextQ = await waitForQuestionChange(localQn, 7000);
      await wait(300);

      if (nextQ && nextQ > localQn) continue;

      const moved = await moveToNextSection(localQn);
      if (!moved) break;
      sectionIndex++;
      previousSectionName = currentSectionName();
      await wait(700);
    }

    all.sort((a, b) => a.globalQuestionNumber - b.globalQuestionNumber);
    const base = window.TestbookAnalyzer?.extract();
    const expected = Number(base?.test?.totalQuestions) || null;
    const missing = expected
      ? Array.from({ length: expected }, (_, i) => i + 1).filter(n => !all.some(q => q.globalQuestionNumber === n))
      : [];
    const duplicateGlobals = all.map(q => q.globalQuestionNumber).filter((n, i, arr) => arr.indexOf(n) !== i);
    const warnings = [...(base?.extraction?.warnings || [])];
    if (missing.length) warnings.push(`Automatic scan missing global question numbers: ${missing.join(', ')}.`);
    if (duplicateGlobals.length) warnings.push(`Automatic scan produced duplicate global question numbers: ${[...new Set(duplicateGlobals)].join(', ')}.`);
    if (!all.length) warnings.push('Automatic scan captured no question records.');

    const sectionNames = [...new Set(all.map(q => q.section || 'Unknown'))];
    const sections = sectionNames.map((name, index) => {
      const qs = all.filter(q => (q.section || 'Unknown') === name);
      const attempted = qs.filter(q => q.selectedOption != null).length;
      const correct = qs.filter(q => q.result === 'correct').length;
      const incorrect = qs.filter(q => q.result === 'incorrect').length;
      const skipped = qs.filter(q => q.result === 'skipped').length;
      const times = qs.map(q => q.timeSeconds).filter(Number.isFinite);
      const marks = qs.map(q => q.marks).filter(Number.isFinite);
      return {
        index: index + 1,
        name,
        questionCount: qs.length,
        attempted,
        correct,
        incorrect,
        skipped,
        accuracyPercent: attempted ? Number(((correct / attempted) * 100).toFixed(2)) : null,
        timeSeconds: times.length ? times.reduce((a, b) => a + b, 0) : null,
        marks: marks.length ? marks.reduce((a, b) => a + b, 0) : null
      };
    });

    return {
      schemaVersion: '1.5.1',
      extractedAt: new Date().toISOString(),
      pageTitle: document.title,
      url: location.href,
      test: base?.test || null,
      performance: base?.performance || null,
      sections,
      extraction: {
        expectedQuestions: expected,
        capturedQuestions: all.length,
        missingQuestionNumbers: missing,
        duplicateQuestionNumbers: [...new Set(duplicateGlobals)],
        incompleteQuestionNumbers: all.filter(q => !q.question || q.options.length < 4).map(q => q.globalQuestionNumber),
        answerCoveragePercent: Number(((all.filter(q => q.correctAnswer || q.result).length / Math.max(all.length, 1)) * 100).toFixed(2)),
        timingCoveragePercent: Number(((all.filter(q => q.timeSeconds != null).length / Math.max(all.length, 1)) * 100).toFixed(2)),
        qualityScore: expected ? Math.round((Math.min(1, all.length / expected) * 70 + (all.filter(q => q.question && q.options.length >= 4).length / Math.max(all.length, 1)) * 20 + (all.filter(q => q.correctAnswer || q.result).length / Math.max(all.length, 1)) * 10) * 100 / 100) : null,
        warnings: [...new Set(warnings)]
      },
      count: all.length,
      questions: all
    };
  } finally {
    autoRunning = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'EXTRACT_TEST') {
    try { sendResponse({ ok: true, data: window.TestbookAnalyzer?.extract() }); }
    catch (error) { sendResponse({ ok: false, error: error.message }); }
    return true;
  }
  if (message?.type === 'AUTO_EXTRACT_TEST') {
    autoExtract(progress => chrome.runtime.sendMessage({ type: 'AUTO_PROGRESS', progress }).catch(() => {}))
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
