(() => {
  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const textOf = (el) => clean(el?.innerText || el?.textContent || '');
  const visible = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0;
  };

  const OPTION_SELECTOR = 'li[ng-repeat*="option in getOptions"]';
  const KNOWN_SECTIONS = ['General Intelligence', 'General Awareness', 'Quantitative Aptitude', 'English Language'];

  function firstMatch(patterns, source = document.body.innerText) {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match?.[1] != null) return clean(match[1]);
    }
    return null;
  }

  function parseNumber(value) {
    if (value == null) return null;
    const m = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  function parseTimeToSeconds(value) {
    if (!value) return null;
    const s = String(value).trim();
    const hms = s.match(/^(\d{1,3}):(\d{1,2}):(\d{2})$/);
    if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
    const ms = s.match(/^(\d{1,3}):(\d{2})$/);
    if (ms) return Number(ms[1]) * 60 + Number(ms[2]);
    const min = s.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minutes)/i);
    if (min) return Math.round(Number(min[1]) * 60);
    return null;
  }

  function normalizeSectionName(value) {
    const text = clean(value);
    if (!text) return '';
    for (const known of KNOWN_SECTIONS) {
      if (new RegExp(`^${known.replace(/\s+/g, '\\s+')}(?:\\s+\\d+)+$`, 'i').test(text)) return known;
      if (text.toLowerCase() === known.toLowerCase()) return known;
    }
    // Generic fallback: remove a navigation suffix such as "1 2 3 ... 25".
    const stripped = text.replace(/(?:\s+\d+){2,}\s*$/, '').trim();
    return stripped || text;
  }

  function getSectionTabs() {
    const candidates = [...document.querySelectorAll('button, a, [role="button"], div, span')]
      .filter(visible)
      .map(el => ({ el, text: normalizeSectionName(textOf(el)), raw: textOf(el), r: el.getBoundingClientRect() }))
      .filter(x => x.text && x.text.length >= 3 && x.text.length <= 45)
      .filter(x => x.r.top >= 120 && x.r.top <= 260 && x.r.left >= 40 && x.r.left < window.innerWidth * 0.8)
      .filter(x => !/^sections$/i.test(x.text));

    const byText = new Map();
    for (const x of candidates) {
      const old = byText.get(x.text.toLowerCase());
      // Prefer the smallest element whose text is exactly the section name.
      const exact = x.raw.toLowerCase() === x.text.toLowerCase();
      const score = (exact ? 1000000 : 0) - (x.r.width * x.r.height);
      if (!old || score > old.score) byText.set(x.text.toLowerCase(), { ...x, score });
    }
    return [...byText.values()].sort((a, b) => a.r.left - b.r.left).map(x => x.el);
  }

  function currentSectionName() {
    const tabs = getSectionTabs();
    const active = tabs.find(el => {
      const cls = String(el.className || '').toLowerCase();
      return /active|selected|current/.test(cls) || el.getAttribute('aria-selected') === 'true';
    });
    if (active) return normalizeSectionName(textOf(active));

    // Strong fallback for the four standard SSC Testbook sections.
    const body = document.body.innerText || '';
    for (const name of KNOWN_SECTIONS) {
      const matches = [...tabs].filter(t => normalizeSectionName(textOf(t)).toLowerCase() === name.toLowerCase());
      if (matches.length && new RegExp(`(?:^|\\n)${name.replace(/\s+/g, '\\s+')}(?:\\s|$)`, 'i').test(body)) {
        // Prefer a tab carrying an active/selected marker if available.
        const marked = matches.find(el => /active|selected|current/i.test(String(el.className || '').toLowerCase()));
        if (marked) return name;
      }
    }

    // Use a visible "SECTION:" heading only if it is genuinely a heading, not a container.
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,[class*="section-title"],[class*="section-name"]')]
      .find(el => visible(el) && /^SECTION\s*:/i.test(textOf(el)));
    return heading ? normalizeSectionName(textOf(heading).replace(/^SECTION\s*:\s*/i, '')) : '';
  }

  function currentSectionQuestionCount() {
    // Testbook renders question navigation as individual numeric controls.
    // Find the largest contiguous 1..N run rather than trusting arbitrary page numbers.
    const nums = [...document.querySelectorAll('button, a, [role="button"]')]
      .filter(visible)
      .map(el => Number(clean(el.innerText || el.textContent)))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 100);
    const set = new Set(nums);
    let best = 0;
    for (let n = 1; n <= 100 && set.has(n); n++) best = n;
    return best >= 5 ? best : null;
  }

  function getOptions(card) {
    return [...card.querySelectorAll(OPTION_SELECTOR)]
      .filter(visible)
      .map((li, index) => {
        const valueEl = li.querySelector('.ans-view-box, [ng-bind-html*="parseDesc"], [ng-bind-html]');
        const text = textOf(valueEl || li)
          .replace(/Your first attempt/gi, '')
          .replace(/\d+% answered correctly/gi, '')
          .trim();
        const cls = String(li.className || '').toLowerCase();
        const aria = String(li.getAttribute('aria-label') || '').toLowerCase();
        const dataState = Object.entries(li.dataset || {}).map(([k, v]) => `${k}:${v}`).join(' ').toLowerCase();
        const input = li.querySelector('input[type="radio"], input[type="checkbox"]');
        const ariaChecked = li.getAttribute('aria-checked') === 'true' || li.querySelector('[aria-checked="true"]');
        return {
          index: index + 1,
          text,
          selected: Boolean(input?.checked || ariaChecked || /first-attempt-option|your-answer|your_answer|selected-option|selectedanswer|attempted-option/.test(cls) || /your answer|selected|chosen/.test(aria) || /selected|your.?answer|attempted/.test(dataState)),
          correct: /correct-option/.test(cls) && !/incorrect-option/.test(cls),
          incorrect: /incorrect-option/.test(cls)
        };
      })
      .filter(o => o.text);
  }

  function findQuestionCards() {
    const result = [];
    const seen = new Set();
    for (const li of document.querySelectorAll(OPTION_SELECTOR)) {
      if (!visible(li)) continue;
      let node = li.parentElement;
      let best = null;
      for (let depth = 0; node && depth < 14; depth++, node = node.parentElement) {
        if (!visible(node)) continue;
        const opts = [...node.querySelectorAll(OPTION_SELECTOR)].filter(visible);
        if (opts.length >= 4 && opts.length <= 6) {
          const txt = textOf(node);
          if (/Question\s*No\.\s*\d+/i.test(txt) || /Your:\s*\d{1,3}:\d{2}/i.test(txt) || /correct answer is/i.test(txt)) {
            best = node;
            break;
          }
        }
      }
      if (best && !seen.has(best)) {
        seen.add(best);
        result.push(best);
      }
    }
    return result;
  }

  function extractSolution(raw) {
    const m = raw.match(/(?:correct answer is|correct answer[:\-])\s*["']?Option\s*(\d+)/i);
    return m ? Number(m[1]) : null;
  }

  function cleanQuestionText(raw, options) {
    let question = raw
      .replace(/Question\s*No\.\s*\d+/gi, '')
      .replace(/\bCorrect\b|\bIncorrect\b|\bSkipped\b/gi, '')
      .replace(/Your:\s*\d{1,3}:\d{2}\s*Avg:\s*\d{1,3}:\d{2}/gi, '')
      .replace(/Marks\s*[-\d.]+/gi, '')
      .replace(/\d+%\s*answered correctly/gi, '')
      .replace(/Re-attempt mode:\s*ON/gi, '')
      .replace(/Now You can re-attempt the question/gi, '')
      .replace(/View Solution.*?(?=Previous|Next|$)/gi, '')
      .replace(/Previous\s+Next.*/i, '')
      .trim();
    for (const option of options) {
      if (option.text) {
        const pos = question.indexOf(option.text);
        if (pos > 0) {
          question = question.slice(0, pos).trim();
          break;
        }
      }
    }
    return question;
  }

  function parseQuestion(card, index) {
    const raw = textOf(card);
    const numMatch = raw.match(/Question\s*No\.\s*(\d+)/i);
    const options = getOptions(card);
    if (options.length < 4) return null;

    const timeText = firstMatch([/You:\s*([\d:]+)/i], raw);
    const avgTimeText = firstMatch([/Avg:\s*([\d:]+)/i], raw);
    const marksText = firstMatch([/Marks\s*([-\d.]+)/i], raw);
    const pctText = firstMatch([/(\d+)%\s*answered correctly/i], raw);
    const classCorrectIndex = options.findIndex(o => o.correct);
    const solutionIndex = extractSolution(raw);
    const correctOption = classCorrectIndex >= 0 ? classCorrectIndex + 1 : solutionIndex;
    const selectedIndex = options.findIndex(o => o.selected);

    let result = null;
    if (/\bSkipped\b/i.test(raw)) result = 'skipped';
    else if (/\bIncorrect\b/i.test(raw)) result = 'incorrect';
    else if (/\bCorrect\b/i.test(raw)) result = 'correct';
    else if (selectedIndex >= 0 && correctOption) result = selectedIndex + 1 === correctOption ? 'correct' : 'incorrect';

    const questionNumber = numMatch ? Number(numMatch[1]) : index + 1;
    return {
      questionNumber,
      section: null,
      sectionIndex: null,
      sectionQuestionNumber: questionNumber,
      globalQuestionNumber: questionNumber,
      question: cleanQuestionText(raw, options),
      options: options.map(o => ({ index: o.index, text: o.text, selected: o.selected, correct: o.correct || false })),
      selectedAnswer: selectedIndex >= 0 ? options[selectedIndex].text : null,
      selectedOption: selectedIndex >= 0 ? selectedIndex + 1 : null,
      correctAnswer: correctOption && options[correctOption - 1] ? options[correctOption - 1].text : null,
      correctOption: correctOption || null,
      result,
      timeSeconds: parseTimeToSeconds(timeText),
      averageTimeSeconds: parseTimeToSeconds(avgTimeText),
      marks: parseNumber(marksText),
      answeredCorrectlyPercent: parseNumber(pctText),
      solutionDetected: Boolean(correctOption),
      source: location.href
    };
  }

  function extractTestMetadata() {
    const body = clean(document.body.innerText);
    const title = document.title || '';
    const score = firstMatch([/Score\s*[:\-]?\s*([\d.]+)\s*(?:\/\s*([\d.]+))?/i]);
    const attempted = firstMatch([/Attempted\s*[:\-]?\s*(\d+)/i, /(\d+)\s*Attempted/i]);
    const correct = firstMatch([/Correct\s*[:\-]?\s*(\d+)/i, /(\d+)\s*Correct/i]);
    const incorrect = firstMatch([/Incorrect\s*[:\-]?\s*(\d+)/i, /(\d+)\s*Incorrect/i]);
    const skipped = firstMatch([/Skipped\s*[:\-]?\s*(\d+)/i, /(\d+)\s*Skipped/i]);
    const accuracy = firstMatch([/Accuracy\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*%/i]);
    const negativeMarks = firstMatch([/(?:Negative\s*(?:Marks|Marking)|Negative)\s*[:\-]?\s*(-?\d+(?:\.\d+)?)/i]);
    const duration = firstMatch([/Duration\s*[:\-]?\s*([\d:]+(?:\s*(?:min|mins|minutes|hr|hours))?)/i]);

    const sectionTabs = getSectionTabs();
    const sectionNames = [...new Set(sectionTabs.map(t => normalizeSectionName(textOf(t))).filter(Boolean))];
    const perSection = currentSectionQuestionCount();
    const inferredTotal = perSection && sectionNames.length >= 2 ? perSection * sectionNames.length : perSection;

    const testName = firstMatch([
      /(?:Test\s*Name|Mock\s*Name)\s*[:\-]\s*([^\n]{3,120})/i,
      /Tests\s+([^\n]{10,160})/i,
      /(?:SSC\s+Selection\s+Post|SSC\s+CHSL|SSC\s+CGL|SSC\s+MTS|SSC\s+GD)[^\n]{0,120}/i
    ]) || title || null;

    const scoreMatch = body.match(/Score\s*[:\-]?\s*([\d.]+)\s*\/\s*([\d.]+)/i);
    return {
      name: testName,
      title,
      score: scoreMatch ? Number(scoreMatch[1]) : parseNumber(score),
      maxMarks: scoreMatch ? Number(scoreMatch[2]) : null,
      totalQuestions: inferredTotal || null,
      attempted: parseNumber(attempted),
      correct: parseNumber(correct),
      incorrect: parseNumber(incorrect),
      skipped: parseNumber(skipped),
      accuracyPercent: parseNumber(accuracy),
      negativeMarks: parseNumber(negativeMarks),
      durationText: duration || null,
      durationSeconds: parseTimeToSeconds(duration),
      sectionNames,
      questionsPerSection: perSection,
      detectedFromText: body.slice(0, 1600)
    };
  }

  function buildSections(questions) {
    const grouped = new Map();
    for (const q of questions) {
      const key = q.section || 'Unknown';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(q);
    }
    return [...grouped.entries()].map(([name, qs], index) => {
      const attempted = qs.filter(q => q.selectedOption != null).length;
      const correct = qs.filter(q => q.result === 'correct').length;
      const incorrect = qs.filter(q => q.result === 'incorrect').length;
      const skipped = qs.filter(q => q.result === 'skipped').length;
      const timeValues = qs.map(q => q.timeSeconds).filter(Number.isFinite);
      const marksValues = qs.map(q => q.marks).filter(Number.isFinite);
      return {
        index: index + 1,
        name,
        questionCount: qs.length,
        attempted,
        correct,
        incorrect,
        skipped,
        accuracyPercent: attempted ? Number(((correct / attempted) * 100).toFixed(2)) : null,
        timeSeconds: timeValues.length ? timeValues.reduce((a, b) => a + b, 0) : null,
        marks: marksValues.length ? marksValues.reduce((a, b) => a + b, 0) : null
      };
    });
  }

  function validate(questions, metadata) {
    const warnings = [];
    const numbers = questions.map(q => q.globalQuestionNumber || q.questionNumber).filter(Number.isFinite);
    const uniqueNumbers = [...new Set(numbers)].sort((a, b) => a - b);
    const expected = Number(metadata.totalQuestions) || null;
    const missing = expected ? Array.from({ length: expected }, (_, i) => i + 1).filter(n => !uniqueNumbers.includes(n)) : [];
    const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    const incomplete = questions.filter(q => !q.question || q.options.length < 4).map(q => q.globalQuestionNumber || q.questionNumber);
    const answerDataUnavailable = questions.filter(q => !q.correctAnswer && !q.result).map(q => q.globalQuestionNumber || q.questionNumber);
    const noTiming = questions.filter(q => q.timeSeconds == null).map(q => q.globalQuestionNumber || q.questionNumber);

    if (expected && questions.length !== expected) warnings.push(`Captured ${questions.length} of ${expected} expected questions.`);
    if (missing.length) warnings.push(`Missing question numbers: ${missing.join(', ')}.`);
    if (duplicates.length) warnings.push(`Duplicate question numbers detected: ${[...new Set(duplicates)].join(', ')}.`);
    if (incomplete.length) warnings.push(`Incomplete question records: ${incomplete.join(', ')}.`);
    if (answerDataUnavailable.length) warnings.push(`Answer/result data unavailable for: ${answerDataUnavailable.join(', ')}.`);
    if (noTiming.length) warnings.push(`Timing unavailable for ${noTiming.length} question(s).`);
    if (metadata.attempted != null && metadata.correct != null && metadata.incorrect != null && metadata.skipped != null) {
      const sum = metadata.correct + metadata.incorrect + metadata.skipped;
      if (sum !== metadata.totalQuestions && expected) warnings.push(`Performance counts do not reconcile to ${expected} questions.`);
    }

    const expectedForQuality = expected || questions.length || 1;
    const completeness = Math.min(1, questions.length / expectedForQuality);
    const completeRecords = questions.filter(q => q.question && q.options.length >= 4).length / Math.max(questions.length, 1);
    const answerCoverage = questions.filter(q => q.correctAnswer || q.result).length / Math.max(questions.length, 1);
    const timingCoverage = questions.filter(q => q.timeSeconds != null).length / Math.max(questions.length, 1);
    const qualityScore = Math.round((completeness * 0.4 + completeRecords * 0.3 + answerCoverage * 0.2 + timingCoverage * 0.1) * 100);

    return {
      expectedQuestions: expected,
      capturedQuestions: questions.length,
      missingQuestionNumbers: missing,
      duplicateQuestionNumbers: [...new Set(duplicates)],
      incompleteQuestionNumbers: incomplete,
      answerCoveragePercent: Number((answerCoverage * 100).toFixed(2)),
      timingCoveragePercent: Number((timingCoverage * 100).toFixed(2)),
      qualityScore,
      warnings
    };
  }

  function extract(sectionOverride = null) {
    const cards = findQuestionCards();
    const parsed = cards.map(parseQuestion).filter(Boolean);
    const unique = [];
    const seen = new Set();
    const detectedSection = sectionOverride || currentSectionName() || null;

    for (const q of parsed) {
      const key = q.questionNumber;
      if (seen.has(key)) continue;
      seen.add(key);
      q.section = detectedSection;
      unique.push(q);
    }

    const metadata = extractTestMetadata();
    const validation = validate(unique, metadata);
    return {
      schemaVersion: '1.5.1',
      extractedAt: new Date().toISOString(),
      pageTitle: document.title,
      url: location.href,
      test: metadata,
      performance: {
        score: metadata.score,
        maxMarks: metadata.maxMarks,
        attempted: metadata.attempted,
        correct: metadata.correct,
        incorrect: metadata.incorrect,
        skipped: metadata.skipped,
        accuracyPercent: metadata.accuracyPercent,
        negativeMarks: metadata.negativeMarks,
        totalTimeSeconds: metadata.durationSeconds
      },
      sections: buildSections(unique),
      extraction: validation,
      count: unique.length,
      questions: unique
    };
  }

  window.TestbookAnalyzer = {
    extract,
    getSectionTabs,
    currentSectionName,
    currentSectionQuestionCount,
    getSectionInfo: () => ({ name: currentSectionName(), questionCount: currentSectionQuestionCount(), tabs: getSectionTabs().map(textOf) })
  };
})();
