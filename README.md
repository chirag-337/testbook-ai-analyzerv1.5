# Testbook AI Analyzer — V1.5

A Manifest V3 Chrome extension that extracts structured Testbook mock-test data locally and prepares it for downstream AI analysis.

## V1.5 goal

The extension is a **data acquisition layer**. It does not try to replace ChatGPT's analysis. The intended pipeline is:

```text
Testbook
   ↓
Chrome Extension V1.5
   ↓
Validated AI-ready JSON
   ↓
ChatGPT analysis
   ↓
Notion storage (future V2)
```

## What V1.5 adds

- Structured test metadata and performance fields when visible on the page
- Question-level answers, results, marks, timing and answer-rate data
- Section assignment during automatic traversal when detectable
- Automatic full-test scanning across questions/sections
- Missing-question detection
- Duplicate-question detection
- Incomplete-record detection
- Answer/timing coverage metrics
- Overall extraction-quality score
- Human-readable extraction warnings
- AI-ready JSON schema version `1.5.0`
- Popup preview of capture count, quality, score, accuracy and warnings

## Privacy

The extension does not send extracted test data to a server and does not require an API key. Data remains in the browser until the user exports or copies it.

## Install

1. Download/clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose this repository folder.
6. Open a completed Testbook mock/results page.
7. Click the extension and use **Analyze full test**.

## Testing expectations

After a full scan, check:

- Captured count vs expected count
- Quality score
- Missing question numbers
- Whether selected/correct answers are accurate
- Whether section names are assigned correctly
- Whether timing and marks match Testbook
- Whether the exported JSON contains every question you expect

If Testbook changes its DOM, extraction may fail or lose fields. Record the exact page/layout and the extraction warning before changing selectors.

## Important limitation

The extension currently uses Testbook DOM/accessibility heuristics. It cannot guarantee that a field exists when Testbook does not expose it in the rendered page. V1.5 therefore reports coverage and warnings instead of silently pretending the dataset is complete.

## Disclaimer

This is an independent utility and is not affiliated with or endorsed by Testbook. Use it only with pages/data you are authorized to access.
