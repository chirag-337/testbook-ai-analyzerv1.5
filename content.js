let autoRunning = false;

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function visible(el) {
  if (!el) return false;
  const s = getComputedStyle(el), r = el.getBoundingClientRect();
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0;
}
function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function clickByText(text, timeout = 4000) {
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

function getSectionTabs() {
  const candidates = [...document.querySelectorAll('button, a, [role="button"], div, span')]
    .filter(visible)
    .map(el => ({ el, text: clean(el.innerText || el.textContent), r: el.getBoundingClientRect() }))
    .filter(x => x.text && x.text.length >= 3 && x.text.length <= 45)
    .filter(x => x.r.top >= 120 && x.r.top <= 220 && x.r.left >= 70 && x.r.left < window.innerWidth * 0.65)
    .filter(x => !/^(SECTIONS|English|Hindi|Save|Report|Analytics|Filter)$/i.test(x.text));
  const byText = new Map();
  for (const x of candidates) {
    const old = byText.get(x.text);
    if (!old || x.r.width * x.r.height > old.r.width * old.r.height) byText.set(x.text, x);
  }
  return [...byText.values()].sort((a, b) => a.r.left - b.r.left).map(x => x.el).filter(el => el.parentElement);
}

function currentSectionName() {
  const heading = [...document.querySelectorAll('body *')].find(el =>
    visible(el) && /^SECTION\s*:/i.test(clean(el.innerText || el.textContent)) && clean(el.innerText || el.textContent).length < 100
  );
  return heading ? clean(heading.innerText || heading.textContent).replace(/^SECTION\s*:\s*/i, '') : '';
}

function currentSectionQuestionCount() {
  const heading = [...document.querySelectorAll('body *')].find(el =>
    visible(el) && /^SECTION\s*:/i.test(clean(el.innerText || el.textContent)) && clean(el.innerText || el.textContent).length < 100
  );
  if (heading) {
    let root = heading.parentElement;
    for (let i = 0; i < 8 && root; i++, root = root.parentElement) {
      const nums = [...root.querySelectorAll('button, a, [role="button"], div, span')]
        .map(el => clean(el.innerText || el.textContent)).filter(t => /^\d{1,3}$/.test(t)).map(Number);
      const unique = [...new Set(nums)];
      if (unique.length >= 2 && unique.length <= 100) return Math.max(...unique);
    }
  }
  return null;
}

async function moveToNextSection(currentNumber) {
  const tabs = getSectionTabs();
  if (tabs.length < 2) throw new Error(`Reached section end at question ${currentNumber}, but could not find the section tabs.`);
  const sectionName = currentSectionName();
  let currentIndex = sectionName ? tabs.findIndex(tab => clean(tab.innerText || tab.textContent).toLowerCase().includes(sectionName.toLowerCase())) : -1;
  if (currentIndex < 0) currentIndex = tabs.findIndex(tab => /active|selected/i.test(String(tab.className || '')));
  if (currentIndex < 0) currentIndex = 0;
  const nextTab = tabs[currentIndex + 1];
  if (!nextTab) return false;
  const oldSection = sectionName.toLowerCase();
  nextTab.click();
  const started = Date.now();
  while (Date.now() - started < 8000) {
    await wait(150);
    const newSection = currentSectionName().toLowerCase();
    const n = currentQuestionNumber();
    if ((newSection && newSection !== oldSection) || (n && n !== currentNumber)) return true;
  }
  return false;
}

async function autoExtract(sendProgress) {
  if (autoRunning) throw new Error('An automatic scan is already running.');
  autoRunning = true;
  const all = [], seen = new Set();
  let sectionIndex = 0;
  let previousSectionName = currentSectionName();

  try {
    for (let guard = 0; guard < 120; guard++) {
      const localQn = currentQuestionNumber();
      if (!localQn) throw new Error('Could not detect the current question number.');

      const sectionName = currentSectionName() || `Section ${sectionIndex + 1}`;
      if (previousSectionName && sectionName !== previousSectionName) {
        sectionIndex++;
        previousSectionName = sectionName;
      } else if (!previousSectionName) previousSectionName = sectionName;

      const key = `${sectionIndex}:${localQn}`;
      if (!seen.has(key)) {
        const solutionFound = await ensureSolution();
        await wait(200);
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
        }
      }

      if (!nextButtonExists() || (currentSectionQuestionCount() && localQn === currentSectionQuestionCount())) {
        const moved = await moveToNextSection(localQn).catch(() => false);
        if (!moved) break;
        sectionIndex++;
        previousSectionName = currentSectionName();
        await wait(500);
        continue;
      }

      await clickByText('Next', 5000);
      const nextQ = await waitForQuestionChange(localQn, 7000);
      await wait(250);

      if (nextQ && nextQ > localQn) continue;
      const moved = await moveToNextSection(localQn).catch(() => false);
      if (!moved) break;
      sectionIndex++;
      previousSectionName = currentSectionName();
      await wait(500);
    }

    all.sort((a, b) => a.globalQuestionNumber - b.globalQuestionNumber);
    const base = window.TestbookAnalyzer?.extract();
    const validation = window.TestbookAnalyzer?.extract()?.extraction || null;
    return {
      schemaVersion: '1.5.0',
      extractedAt: new Date().toISOString(),
      pageTitle: document.title,
      url: location.href,
      test: base?.test || null,
      performance: base?.performance || null,
      sections: [...new Map(all.map(q => [q.section || 'Unknown', true])).keys()].map((name, index) => ({
        index: index + 1,
        name,
        questionCount: all.filter(q => (q.section || 'Unknown') === name).length,
        attempted: all.filter(q => (q.section || 'Unknown') === name && q.selectedOption != null).length,
        correct: all.filter(q => (q.section || 'Unknown') === name && q.result === 'correct').length,
        incorrect: all.filter(q => (q.section || 'Unknown') === name && q.result === 'incorrect').length,
        skipped: all.filter(q => (q.section || 'Unknown') === name && (q.result === 'skipped' || q.selectedOption == null)).length
      })),
      extraction: {
        ...(validation || {}),
        expectedQuestions: Number(base?.test?.totalQuestions) || all.length || null,
        capturedQuestions: all.length,
        missingQuestionNumbers: Number(base?.test?.totalQuestions)
          ? Array.from({ length: Number(base.test.totalQuestions) }, (_, i) => i + 1).filter(n => !all.some(q => q.globalQuestionNumber === n))
          : [],
        warnings: [
          ...(validation?.warnings || []),
          ...(all.length === 0 ? ['No question records were captured.'] : []),
          ...(base?.test?.totalQuestions && all.length < Number(base.test.totalQuestions) ? [`Automatic scan captured ${all.length} of ${base.test.totalQuestions} expected questions.`] : [])
        ]
      },
      count: all.length,
      questions: all
    };
  } finally { autoRunning = false; }
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
