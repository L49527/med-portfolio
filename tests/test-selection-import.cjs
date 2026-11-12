const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scriptFiles = ['import.js', 'app.js'];

function makeElement() {
    const classes = new Set();
    return {
        innerHTML: '',
        textContent: '',
        value: 'all',
        hidden: false,
        dataset: {},
        className: '',
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            contains: name => classes.has(name)
        },
        addEventListener() {},
        appendChild() {},
        click() {},
        remove() {}
    };
}

function makeFile(name, content, onText) {
    return {
        name,
        async text() {
            if (onText) onText();
            return content;
        }
    };
}

function createHarness() {
    const elements = new Map();
    const alerts = [];
    const document = {
        body: { children: [], appendChild() {}, removeChild() {} },
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, makeElement());
            return elements.get(id);
        },
        querySelectorAll() { return []; },
        createElement() { return makeElement(); }
    };
    elements.set('progressOverlay', makeElement());
    elements.get('progressOverlay').hidden = true;
    elements.set('importStatus', makeElement());
    const context = {
        console,
        document,
        window: {},
        confirm: () => true,
        alert: message => alerts.push(message),
        setTimeout: () => 1,
        clearTimeout() {},
        Math,
        Date,
        JSON,
        Promise,
        Array,
        Set,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        parseFloat,
        isNaN,
        Chart: function Chart() {}
    };
    context.globalThis = context;
    vm.createContext(context);
    for (const filename of scriptFiles) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), context, { filename });
    }
    vm.runInContext('switchView = function () {}; generateExhibitionDashboard = function () {};', context);
    return { context, elements, alerts };
}

function selectedIds(context) {
    return JSON.parse(vm.runInContext('JSON.stringify(Array.from(selectedChartItems))', context));
}

function formattedSummary(context, summary) {
    context.summaryForTest = summary;
    return vm.runInContext('formatImportSummary(summaryForTest)', context);
}

async function importFiles(context, files) {
    context.files = files;
    return vm.runInContext('handleFiles(files)', context);
}

async function run() {
    const { context, elements, alerts } = createHarness();
    const parseResults = new Map([
        ['same-a', { id: 'record-a', type: 'DOPS', studentName: '甲', scoreRaw: '90', details: ['generated-a'] }],
        ['same-b', { id: 'record-b', type: 'DOPS', studentName: '甲', scoreRaw: '90', details: ['generated-b'] }],
        ['different', { id: 'record-c', type: 'DOPS', studentName: '甲', scoreRaw: '91', details: ['generated-c'] }],
        ['after-clear', { id: 'record-d', type: 'EPA', studentName: '乙', scoreRaw: '88', details: ['generated-d'] }],
        ['later', { id: 'record-e', type: 'Milestone', studentName: '丙', scoreRaw: '80', details: ['generated-e'] }]
    ]);
    context.analyzeCSV = content => {
        if (content === 'parse-error') throw new Error('fixture parse error');
        return parseResults.get(content) || null;
    };

    let importStartedState;
    let summary = await importFiles(context, [makeFile('same-a.csv', 'same-a', () => {
        importStartedState = {
            overlayHidden: elements.get('progressOverlay').hidden,
            statusText: elements.get('importStatus').textContent
        };
    })]);
    assert.strictEqual(summary.added, 1);
    assert.strictEqual(vm.runInContext('historyData.length', context), 1);
    assert.deepStrictEqual(selectedIds(context), ['record-a']);
    assert.deepStrictEqual(importStartedState, { overlayHidden: false, statusText: '' });
    assert.strictEqual(elements.get('importStatus').dataset.state, 'success');
    assert.strictEqual(elements.get('importStatus').textContent, formattedSummary(context, summary));

    // Repeating the same file does not add a second record.
    summary = await importFiles(context, [makeFile('same-a.csv', 'same-a')]);
    assert.strictEqual(summary.added, 0);
    assert.strictEqual(summary.duplicates, 1);
    assert.strictEqual(vm.runInContext('historyData.length', context), 1);

    // Different id/generated details are still duplicates when actual content matches.
    summary = await importFiles(context, [makeFile('same-b.csv', 'same-b')]);
    assert.strictEqual(summary.added, 0);
    assert.strictEqual(summary.duplicates, 1);
    assert.strictEqual(vm.runInContext('historyData.length', context), 1);

    // A real content change is preserved.
    summary = await importFiles(context, [makeFile('different.csv', 'different')]);
    assert.strictEqual(summary.added, 1);
    assert.strictEqual(vm.runInContext('historyData.length', context), 2);

    // All-none remains none after redraw/filter changes.
    vm.runInContext('selectAllChartItems(false); populateChartItemSelector(); setFilter("DOPS"); populateChartItemSelector();', context);
    assert.deepStrictEqual(selectedIds(context), []);

    // Newly imported records are selected even after an all-none state.
    summary = await importFiles(context, [makeFile('after-clear.csv', 'after-clear')]);
    assert.strictEqual(summary.added, 1);
    assert.deepStrictEqual(selectedIds(context), ['record-d']);

    // Deletion also removes the record from the selection set.
    vm.runInContext('deleteItem("record-d")', context);
    assert.strictEqual(vm.runInContext('historyData.some(item => item.id === "record-d")', context), false);
    assert.strictEqual(vm.runInContext('selectedChartItems.has("record-d")', context), false);

    // A failed file does not cancel a later valid file; the native overlay is hidden,
    // the summary is inline, and imports do not use alerts.
    summary = await importFiles(context, [
        makeFile('broken.csv', 'parse-error'),
        makeFile('later.csv', 'later')
    ]);
    assert.strictEqual(summary.added, 1);
    assert.strictEqual(summary.failedFiles.length, 1);
    assert.ok(summary.failedFiles.includes('broken.csv'));
    assert.strictEqual(elements.get('progressOverlay').hidden, true);
    assert.strictEqual(elements.get('importStatus').dataset.state, 'partial');
    assert.strictEqual(elements.get('importStatus').textContent, formattedSummary(context, summary));
    assert.strictEqual(elements.get('fileInput').value, '');

    // Duplicate-only imports are successful, not partial or error outcomes.
    summary = await importFiles(context, [makeFile('same-a.csv', 'same-a')]);
    assert.strictEqual(summary.added, 0);
    assert.strictEqual(summary.duplicates, 1);
    assert.strictEqual(elements.get('importStatus').dataset.state, 'success');
    assert.strictEqual(elements.get('importStatus').textContent, formattedSummary(context, summary));

    // A batch with no valid records is an error outcome.
    summary = await importFiles(context, [makeFile('broken-again.csv', 'parse-error')]);
    assert.strictEqual(summary.added, 0);
    assert.strictEqual(summary.duplicates, 0);
    assert.strictEqual(summary.failedFiles.length, 1);
    assert.strictEqual(elements.get('importStatus').dataset.state, 'error');
    assert.strictEqual(elements.get('importStatus').textContent, formattedSummary(context, summary));
    assert.deepStrictEqual(alerts, []);

    // Clear resets filters and selection so the app can be reused.
    vm.runInContext('currentFilter = "DOPS"; currentTrainingFilter = "訓練A"; currentInstrumentFilter = "CT"; selectedChartItems.add("record-a"); clearHistory();', context);
    assert.strictEqual(vm.runInContext('historyData.length', context), 0);
    assert.deepStrictEqual(selectedIds(context), []);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify([currentFilter, currentTrainingFilter, currentInstrumentFilter, chartSelectionInitialized])', context)), ['all', 'all', 'all', false]);
    assert.strictEqual(elements.get('importStatus').textContent, '');
    assert.strictEqual(elements.get('importStatus').dataset.state, undefined);
    assert.deepStrictEqual(alerts, []);

    console.log('selection/import tests passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
