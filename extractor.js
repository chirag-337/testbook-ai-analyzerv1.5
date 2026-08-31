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

  function firstMatch(patterns, source = document.body.innerText) {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match?.[1] != null) return clean(match[1]);
    }
    return null;
  }

  function parseNumber(value) {
    if (value == null) return null;
    const normalized = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return normalized ? Number(normalized[0]) : null;
  }

  function parseTimeToSeconds(value) {
    if (!value) return null;
    const match = String(value).match(/(?:(\d{1,3}):)?(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
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
        return {
          index: index + 1,
          text,
          selected: /first-attempt-option|selected|your-answer/.test(cls) || /your answer|selected/.test(aria),
          correct: /correct-option/.test(cls) && !/incorrect-option/.test(cls),
          incorrect: /incorrect-option/.test(cls)
        };
      })
      .filter((o) => o.text);
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
          if (/Question\s*No\.\s*\d+/i.test(txt) || /Your:\s*\d{1,2}:\d{2}/i.test(txt) || /correct answer is/i.test(txt)) {
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
    const explicit = raw.match(/(?:correct answer is|correct answer[:\-])\s*["']?Option\s*(\d+)/i);
    if (!explicit) return null;
    return Number(explicit[1]);
  }

  function cleanQuestionText(raw, options) {
    let question = raw;
    question = question
      .replace(/Question\s*No\.\s*\d+/gi, '')
      .replace(/\bCorrect\b|\bIncorrect\b|\bSkipped\b/gi, '')
      .replace(/Your:\s*\d{1,3}:\d{2}\s*Avg:\s*\d{1,3}:\d{2}/gi, '')
      .replace(/Marks\s*[\d.]+/gi, '')
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

    const classCorrectIndex = options.findIndex((o) => o.correct);
    const solutionIndex = extractSolution(raw);
    const correctOption = classCorrectIndex >= 0 ? classCorrectIndex + 1 : solutionIndex;
    const selectedIndex = options.findIndex((o) => o.selected);

    let result = null;
    if (/\bIncorrect\b/i.test(raw)) result = 'incorrect';
    else if (/\bSkipped\b/i.test(raw)) result = 'skipped';
    else if (/\bCorrect\b/i.test(raw)) result = 'correct';
    else if (selectedIndex >= 0 && correctOption) result = selectedIndex + 1 === correctOption ? 'correct' : 'incorrect';

    const selectedOption = selectedIndex >= 0 ? selectedIndex + 1 : null;
    const questionNumber = numMatch ? Number(numMatch[1]) : index + 1;

    return {
      questionNumber,
      section: null,
      sectionIndex: null,
      sectionQuestionNumber: questionNumber,
      globalQuestionNumber: questionNumber,
      question: cleanQuestionText(raw, options),
      options: options.map((o) => ({
        index: o.index,
        text: o.text,
        selected: o.selected,
        correct: o.correct || false
      })),
      selectedAnswer: selectedIndex >= 0 ? options[selectedIndex].text : null,
      selectedOption,
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
    const totalQuestions = firstMatch([/Total\s*(?:Questions|Ques)\s*[:\-]?\s*(\d+)/i, /(?:of|\/)\s*(\d+)\s*(?:questions|ques)/i]);
    const duration = firstMatch([/Duration\s*[:\-]?\s*([\d:]+(?:\s*(?:min|mins|minutes|hr|hours))?)/i]);
    const accuracy = firstMatch([/Accuracy\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*%/i]);
    const negativeMarks = firstMatch([/(?:Negative\s*(?:Marks|Marking)|Negative)\s*[:\-]?\s*(-?\d+(?:\.\d+)?)/i]);

    let inferredTotal = Number(totalQuestions) || null;
    const qNodes = document.querySelectorAll(OPTION_SELECTOR);
    if (!inferredTotal && qNodes.length >= 4) inferredTotal = null;

    const testName = firstMatch([
      /(?:Test\s*Name|Mock\s*Name|Test)\s*[:\-]\s*([^\n]{3,120})/i,
      /(?:SSC\s+CHSL|SSC\s+CGL|SSC\s+MTS|SSC\s+GD)[^\n]{0,100}/i
    ]) || title || null;

    return {
      name: testName,
      title,
      score: parseNumber(score),
      maxMarks: score?.match(/\/\s*([\d.]+)/)?.[1] ? Number(score.match(/\/\s*([\d.]+)/)[1]) : null,
      totalQuestions: inferredTotal,
      attempted: parseNumber(attempted),
      correct: parseNumber(correct),
      incorrect: parseNumber(incorrect),
      skipped: parseNumber(skipped),
      accuracyPercent: parseNumber(accuracy),
      negativeMarks: parseNumber(negativeMarks),
      durationText: duration || null,
      durationSeconds: parseTimeToSeconds(duration),
      detectedFromText: body.slice(0, 1200)
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
      const skipped = qs.filter(q => q.result === 'skipped' || q.selectedOption == null).length;
      const timeValues = qs.map(q => q.timeSeconds).filter(v => Number.isFinite(v));
      const marksValues = qs.map(q => q.marks).filter(v => Number.isFinite(v));
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
    const numbers = questions.map(q => q.questionNumber).filter(Number.isFinite);
    const uniqueNumbers = [...new Set(numbers)].sort((a, b) => a - b);
    const maxNumber = uniqueNumbers.length ? uniqueNumbers[uniqueNumbers.length - 1] : 0;
    const expected = Number(metadata.totalQuestions) || maxNumber || null;
    const missing = expected ? Array.from({ length: expected }, (_, i) => i + 1).filter(n => !uniqueNumbers.includes(n)) : [];
    const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    const incomplete = questions.filter(q => !q.question || q.options.length < 4).map(q => q.questionNumber);
    const noAnswerData = questions.filter(q => !q.selectedAnswer && !q.correctAnswer && !q.result).map(q => q.questionNumber);
    const noTiming = questions.filter(q => q.timeSeconds == null).map(q => q.questionNumber);

    if (expected && questions.length !== expected) warnings.push(`Captured ${questions.length} of ${expected} expected questions.`);
    if (missing.length) warnings.push(`Missing question numbers: ${missing.join(', ')}.`);
    if (duplicates.length) warnings.push(`Duplicate question numbers detected: ${[...new Set(duplicates)].join(', ')}.`);
    if (incomplete.length) warnings.push(`Incomplete question records: ${incomplete.join(', ')}.`);
    if (noAnswerData.length) warnings.push(`Answer/result data unavailable for: ${noAnswerData.join(', ')}.`);
    if (noTiming.length) warnings.push(`Timing unavailable for ${noTiming.length} question(s).`);

    const expectedForQuality = expected || questions.length || 1;
    const completeness = Math.min(1, questions.length / expectedForQuality);
    const completeRecords = questions.filter(q => q.question && q.options.length >= 4).length / Math.max(questions.length, 1);
    const answerCoverage = questions.filter(q => q.selectedAnswer || q.correctAnswer || q.result).length / Math.max(questions.length, 1);
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
    const seenNumbers = new Set();

    for (const q of parsed) {
      const key = q.questionNumber;
      if (seenNumbers.has(key)) continue;
      seenNumbers.add(key);
      if (sectionOverride) q.section = sectionOverride;
      unique.push(q);
    }

    const metadata = extractTestMetadata();
    const validation = validate(unique, metadata);

    return {
      schemaVersion: '1.5.0',
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

  window.TestbookAnalyzer = { extract };
})();
