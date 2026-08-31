let autoRunning = false;

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function visible(el) {
  if (!el) return false;
  const s = getComputedStyle(el), r = el.getBoundingClientRect();
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0;
}

const KNOWN_SECTIONS = [
  'General Intelligence',
  'General Awareness',
  'Quantitative Aptitude',
  'English Language'
];

function normalizeSectionName(value) {
  if (window.TestbookAnalyzer?.normalizeSectionName) return window.TestbookAnalyzer.normalizeSectionName(value);
  let s = clean(value).replace(/(?:\s+\d+){2,}\s*$/, '');
  return clean(s);
}

function clickByText(text, timeout = 5000) {
  const target = clean(text).toLowerCase();
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const candidates = [...document.querySelectorAll('button, a, [role="button"], [ng-click], input[type="button"], input[type="submit"]')]
        .filter(visible)
        .filter(el => clean(el.innerText || el.textContent || el.value).toLowerCase() === target);
      if (candidates.length) { candidates[0].click(); resolve(true); return; }
      if (Date.now() - started > timeout) { reject(new Error(`Could not find visible "${text}" button.`)); return; }
      setTimeout(tick, 120);
    };
    tick();
  });
}

function currentQuestionNumber() {
  const candidates = [...document.querySelectorAll('body *')]
    .filter(visible)
    .map(el => ({ el, text: clean(el.innerText || el.textContent) }))
    .filter(x => /^Question\s*No\.\s*\d+$/i.test(x.text) || /^Question\s*No\.\s*\d+\b/i.test(x.text) && x.text.length < 100);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.text.length - b.text.length);
  const m = candidates[0].text.match(/Question\s*No\.\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function solutionVisible() {
  const text = clean(document.body.innerText);
  if (/correct answer is\s*["']?Option\s*\d+/i.test(text)) return true;
  return [...document.querySelectorAll(OPTION_SELECTOR())].some(li => visible(li) && /correct-option/.test(String(li.className || '')));
}
function OPTION_SELECTOR() { return 'li[ng-repeat*="option in getOptions"]'; }
function viewSolutionButtonExists() {
  return [...document.querySelectorAll('button, a, [role="button"], [ng-click]')]
    .some(el => visible(el) && /view\s+solution/i.test(clean(el.innerText || el.textContent)));
}
async function ensureSolution() {
  if (solutionVisible()) return true;
  if (viewSolutionButtonExists()) {
    try { await clickByText('View Solution', 2500); } catch (_) {}
    const started = Date.now();
    while (!solutionVisible() && Date.now() - started < 5000) await wait(150);
  }
  return solutionVisible();
}

function getSectionTabs() {
  const candidates = [];
  for (const name of KNOWN_SECTIONS) {
    const matches = [...document.querySelectorAll('button, a, [role="button"], [ng-click], div, span')]
      .filter(visible)
      .map(el => ({ el, text: clean(el.innerText || el.textContent), r: el.getBoundingClientRect() }))
      .filter(x => x.text && x.text.length <= 80 && normalizeSectionName(x.text).toLowerCase() === name.toLowerCase())
      .filter(x => x.r.top >= 100 && x.r.top <= 260 && x.r.left >= 40 && x.r.left < window.innerWidth * 0.75);
    if (matches.length) {
      matches.sort((a, b) => (a.r.width * a.r.height) - (b.r.width * b.r.height));
      candidates.push(matches[0].el);
    }
  }
  return candidates;
}

function currentSectionName() {
  const candidates = [...document.querySelectorAll('body *')]
    .filter(visible)
    .map(el => clean(el.innerText || el.textContent))
    .filter(t => /^SECTION\s*:/i.test(t) && t.length < 100);
  if (candidates.length) return normalizeSectionName(candidates.sort((a, b) => a.length - b.length)[0].replace(/^SECTION\s*:\s*/i, ''));

  const tabs = getSectionTabs();
  const active = tabs.find(el => /active|selected/i.test(String(el.className || '')) || /active|selected/i.test(String(el.getAttribute('aria-selected') || '')));
  return active ? normalizeSectionName(active.innerText || active.textContent) : '';
}

function getQuestionNumberControls() {
  const candidates = [...document.querySelectorAll('button, a, [role="button"], [ng-click], div, span')]
    .filter(visible)
    .map(el => ({ el, text: clean(el.innerText || el.textContent), r: el.getBoundingClientRect() }))
    .filter(x => /^\d{1,3}$/.test(x.text))
    .filter(x => x.r.width >= 12 && x.r.height >= 12)
    .filter(x => x.r.right > window.innerWidth * 0.65);
  const unique = new Map();
  for (const x of candidates) {
    const n = Number(x.text);
    const old = unique.get(n);
    if (!old || x.r.width * x.r.height < old.r.width * old.r.height) unique.set(n, x);
  }
  return [...unique.entries()].sort((a, b) => a[0] - b[0]).map(([n, x]) => ({ number: n, el: x.el }));
}

function sectionQuestionCount() {
  const nums = getQuestionNumberControls().map(x => x.number);
  if (nums.length >= 2) return Math.max(...nums);
  return null;
}

async function clickSectionTab(name) {
  const target = normalizeSectionName(name).toLowerCase();
  const tabs = getSectionTabs();
  const tab = tabs.find(el => normalizeSectionName(el.innerText || el.textContent).toLowerCase() === target);
  if (!tab) throw new Error(`Could not find section tab: ${name}`);
  const before = currentQuestionNumber();
  tab.click();
  const started = Date.now();
  while (Date.now() - started < 7000) {
    await wait(150);
    const nowSection = currentSectionName().toLowerCase();
    if (nowSection === target || currentQuestionNumber() !== before) return true;
  }
  return true;
}

async function clickQuestionNumber(number) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const control = getQuestionNumberControls().find(x => x.number === number);
    if (control) {
      control.el.click();
      const changed = Date.now();
      while (Date.now() - changed < 5000) {
        await wait(120);
        if (currentQuestionNumber() === number) return true;
      }
    }
    await wait(150);
  }
  return currentQuestionNumber() === number;
}

async function waitForQuestionNumber(number, timeout = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (currentQuestionNumber() === number) return true;
    await wait(120);
  }
  return false;
}

async function clickNextAndWait(expectedNumber) {
  const next = [...document.querySelectorAll('button, a, [role="button"], [ng-click]')]
    .filter(visible)
    .find(el => clean(el.innerText || el.textContent).toLowerCase() === 'next');
  if (!next) return false;
  next.click();
  return waitForQuestionNumber(expectedNumber, 7000);
}

async function discoverSections() {
  const tabs = getSectionTabs();
  const names = tabs.map(el => normalizeSectionName(el.innerText || el.textContent)).filter(Boolean);
  const unique = [...new Set(names)];
  return unique.length ? unique : KNOWN_SECTIONS.filter(name => document.body.innerText.includes(name));
}

async function autoExtract(sendProgress) {
  if (autoRunning) throw new Error('An automatic scan is already running.');
  autoRunning = true;
  const all = [];
  const sections = [];
  let globalNumber = 0;

  try {
    const discovered = await discoverSections();
    if (!discovered.length) throw new Error('Could not detect Testbook section tabs.');

    for (let sectionIndex = 0; sectionIndex < discovered.length; sectionIndex++) {
      const sectionName = discovered[sectionIndex];
      await clickSectionTab(sectionName);
      await wait(500);

      let questionCount = sectionQuestionCount();
      if (!questionCount) {
        const first = await clickQuestionNumber(1);
        if (!first) throw new Error(`Could not access question navigation in ${sectionName}.`);
        questionCount = sectionQuestionCount() || 25;
      }
      if (questionCount < 1 || questionCount > 100) throw new Error(`Unexpected question count (${questionCount}) in ${sectionName}.`);

      let sectionCaptured = 0;
      for (let localNumber = 1; localNumber <= questionCount; localNumber++) {
        if (currentQuestionNumber() !== localNumber) {
          const reached = await clickQuestionNumber(localNumber);
          if (!reached) throw new Error(`Could not navigate to ${sectionName} question ${localNumber}.`);
        }

        const solutionFound = await ensureSolution();
        await wait(180);
        const record = window.TestbookAnalyzer?.extract(sectionName);
        const q = record?.questions?.find(x => x.questionNumber === localNumber) || record?.questions?.[0];
        if (!q) throw new Error(`Question ${localNumber} in ${sectionName} could not be extracted.`);

        q.section = normalizeSectionName(sectionName);
        q.sectionIndex = sectionIndex + 1;
        q.sectionQuestionNumber = localNumber;
        q.globalQuestionNumber = ++globalNumber;
        q.questionNumber = globalNumber;
        q.solutionDetected = q.solutionDetected || solutionFound;
        all.push(q);
        sectionCaptured++;
        sendProgress?.({ done: all.length, questionNumber: globalNumber, section: sectionName, sectionQuestionNumber: localNumber });

        if (localNumber < questionCount) {
          const moved = await clickNextAndWait(localNumber + 1);
          if (!moved) {
            const fallback = await clickQuestionNumber(localNumber + 1);
            if (!fallback) throw new Error(`Could not move from ${sectionName} question ${localNumber} to ${localNumber + 1}.`);
          }
          await wait(180);
        }
      }

      sections.push({ index: sectionIndex + 1, name: normalizeSectionName(sectionName), questionCount, captured: sectionCaptured });
    }

    const base = window.TestbookAnalyzer?.extract();
    const expected = sections.reduce((sum, s) => sum + s.questionCount, 0);
    const validation = window.TestbookAnalyzer?.validate(all, base?.test || {}, expected) || {};
    validation.warnings = [...(validation.warnings || [])];

    if (validation.capturedQuestions !== expected) {
      validation.warnings.push(`Full scan captured ${validation.capturedQuestions} of ${expected} expected questions.`);
    }

    const sectionSummaries = sections.map((s, index) => {
      const qs = all.filter(q => q.sectionIndex === index + 1);
      const attempted = qs.filter(q => q.selectedOption != null).length;
      const correct = qs.filter(q => q.result === 'correct').length;
      const incorrect = qs.filter(q => q.result === 'incorrect').length;
      const skipped = qs.filter(q => q.result === 'skipped').length;
      const times = qs.map(q => q.timeSeconds).filter(v => Number.isFinite(v));
      const marks = qs.map(q => q.marks).filter(v => Number.isFinite(v));
      return {
        index: index + 1,
        name: s.name,
        questionCount: s.questionCount,
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
      schemaVersion: '1.5.2',
      extractedAt: new Date().toISOString(),
      pageTitle: document.title,
      url: location.href,
      test: { ...(base?.test || {}), totalQuestions: base?.test?.totalQuestions || expected },
      performance: { ...(base?.performance || {}), score: base?.performance?.score ?? null, maxMarks: base?.performance?.maxMarks ?? null },
      sections: sectionSummaries,
      extraction: validation,
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