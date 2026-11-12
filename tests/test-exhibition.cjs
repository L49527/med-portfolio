// Anonymous fixtures for the exhibition/report charts, overview and feedback pages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const nodes = {};
const makeNode = () => ({
    innerHTML: '', textContent: '', className: '', hidden: false, value: 'all', scrollTop: 0,
    children: [], dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    appendChild(node) { this.children.push(node); },
    querySelectorAll() { return this.children; },
    getContext() { return {}; }
});
const document = {
    getElementById(id) { return nodes[id] ||= makeNode(); },
    createElement: makeNode,
    querySelectorAll() { return []; }
};
const configs = [];
const alerts = [];
function Chart(_ctx, config) { configs.push(config); this.destroy = () => {}; }
const context = vm.createContext({ document, console, window: {}, setTimeout, clearTimeout, alert: message => alerts.push(message), Chart });
for (const file of ['import.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
}
const run = code => vm.runInContext(code, context);
const chartTitled = title => {
    const index = nodes.chartGrid.children.findIndex(card => card.innerHTML.includes(title));
    assert.ok(index >= 0, `missing chart: ${title}`);
    const before = nodes.chartGrid.children.slice(0, index).filter(card => /<canvas/.test(card.innerHTML)).length;
    return { card: nodes.chartGrid.children[index], config: configs[before] };
};

// Score parsing keeps missing values out of the charts.
assert.equal(run("scoreOrNull('85 分')"), 85);
assert.equal(run("scoreOrNull('')"), null);
assert.equal(run("scoreOrNull('未評')"), null);
console.log('PASS: scoreOrNull');

const base = { studentName: '測試學員', trainingType: 'PGY', teacherName: '老師', details: [], opaScores: {}, opaFeedbacks: {}, milestoneLevels: {} };
context.fixture = [
    { ...base, id: 'd1', type: 'DOPS', title: 'DOPS-胸腹部-影像醫學科', instrumentType: 'CT', date: '2026-03-15', scoreRaw: '78', feedbackNeeds: '擺位需再精準' },
    { ...base, id: 'd2', type: 'DOPS', title: 'DOPS-胸腹部-影像醫學科', instrumentType: 'CT', date: '2026-06-20', scoreRaw: '90', feedbackGood: '擺位正確' },
    { ...base, id: 'd3', type: 'DOPS', title: 'DOPS-學前', instrumentType: '', date: '2026-04-01', scoreRaw: '82' },
    { ...base, id: 'd4', type: 'DOPS', title: 'DOPS-胸腹部-影像醫學科', instrumentType: 'CT', date: '2026-07-01', scoreRaw: '' },
    { ...base, id: 'e1', type: '筆試成績', title: 'CT 學前測驗', instrumentType: 'CT', date: '2026-01-10', scoreRaw: '70' },
    { ...base, id: 'e2', type: '筆試成績', title: 'CT 學前測驗', instrumentType: 'CT', date: '2026-02-10', scoreRaw: '75' },
    { ...base, id: 'e3', type: '筆試成績', title: 'CT 學後測驗', instrumentType: 'CT', date: '2026-06-01', scoreRaw: '88' },
    { ...base, id: 'm1', type: 'Milestone', title: 'Milestone', instrumentType: '', date: '2026-02-01', milestoneLevels: { [run('TARGET_MILESTONES[0]')]: '2', [run('TARGET_MILESTONES[1]')]: '2' } },
    { ...base, id: 'm2', type: 'Milestone', title: 'Milestone', instrumentType: '', date: '2026-08-01', milestoneLevels: { [run('TARGET_MILESTONES[0]')]: '4', [run('TARGET_MILESTONES[1]')]: '3' } },
    { ...base, id: 'c1', type: '輔導紀錄', title: '輔導', instrumentType: '', date: '2026-05-01', studentFeedback: '紀錄內容' }
];
run('generateExhibitionDashboard({ refreshSelector: false, reportRecords: fixture })');

// DOPS: blank score is null (not 0), and the "其他項目" record is still drawn.
const dopsCT = chartTitled('DOPS 部位細項成績 - CT').config;
assert.deepEqual(Array.from(dopsCT.data.labels), ['胸腹部']);
assert.deepEqual(Array.from(dopsCT.data.datasets.map(ds => ds.data[0])), [78, 90, null]);
assert.equal(dopsCT.data.datasets[0].label, '第 1 次');
assert.deepEqual(Array.from(dopsCT.data.datasets[0].valueLabels[0]), ['78', '03/15']);
const dopsOther = chartTitled('DOPS 部位細項成績 - 未分類儀器').config;
assert.deepEqual(Array.from(dopsOther.data.labels), ['其他項目']);
assert.equal(dopsOther.data.datasets[0].data[0], 82);
assert.doesNotMatch(chartTitled('DOPS 部位細項成績 - CT').card.innerHTML, /chart-caption|chart-note/);
console.log('PASS: DOPS missing scores, 其他項目, attempt labels, no text under the chart');

// Exam: the latest of two 學前 attempts is used, not whichever happened to overwrite.
const exam = chartTitled('筆試成績：學前 vs 學後');
assert.deepEqual(Array.from(exam.config.data.datasets.map(ds => ds.data[0])), [75, 88]);
assert.deepEqual(Array.from(exam.config.data.datasets[0].valueLabels[0]), ['75', '02/10']);
console.log('PASS: exam pre/post uses latest attempt');

// Milestone: every attempt stays on the radar, newest emphasized, plus a trend line.
const radar = chartTitled('Milestone 核心能力成長');
assert.equal(radar.config.data.datasets.length, 2);
assert.equal(radar.config.data.datasets[0].label, '第 1 次（02/01）');
assert.deepEqual(Array.from(radar.config.data.datasets[0].borderDash), [6, 4]);
assert.equal(radar.config.data.datasets[1].borderWidth, 3);
const trend = chartTitled('Milestone 核心能力歷次趨勢').config;
assert.deepEqual(Array.from(trend.data.labels, label => Array.from(label)),[['第 1 次', '02/01'], ['第 2 次', '08/01']]);
assert.deepEqual(Array.from(trend.data.datasets[0].data), [2, 3.5]);
console.log('PASS: Milestone radar progression and trend line');

// Overview first, then charts, feedback tracking, and text records last.
const cards = nodes.chartGrid.children;
assert.match(cards[0].innerHTML, /評量總覽/);
assert.match(cards[0].innerHTML, /胸腹部.*第 1 次：78 分（03\/15）.*第 2 次：90 分（06\/20）.*\+12/s);
assert.match(cards[0].innerHTML, /輔導紀錄.*文字紀錄/s);
const feedbackIndex = cards.findIndex(card => card.innerHTML.includes('回饋與改善追蹤'));
assert.ok(feedbackIndex > 0);
assert.match(cards[feedbackIndex].innerHTML, /第 1 次（03\/15）.*擺位需再精準.*第 2 次（06\/20）.*擺位正確/s);
assert.match(cards[cards.length - 1].innerHTML, /輔導紀錄｜輔導/);
console.log('PASS: overview, feedback tracking and page order');

// A report may contain only one student.
run(`historyData = [
    { ...fixture[0], id: 'p1', studentName: '甲' },
    { ...fixture[1], id: 'p2', studentName: '乙' }
]; chartSelectionInitialized = false; selectedChartItems.clear(); printAccreditationReport();`);
assert.equal(alerts.length, 1);
assert.match(alerts[0], /包含 2 位學員/);
console.log('PASS: printing is blocked for multiple students');

// CSV export: text that Excel would run as a formula gets a leading apostrophe; numbers stay as they are.
let exportedBlob;
context.Blob = function Blob(parts) { this.parts = parts; };
context.URL = { createObjectURL(blob) { exportedBlob = blob; return 'blob:test'; }, revokeObjectURL() {} };
const originalCreate = document.createElement;
document.createElement = () => ({ ...makeNode(), click() {} });
run(`historyData = [{ ...fixture[0], id: 'x1', feedbackNeeds: '=HYPERLINK("http://x")', feedbackGood: '-1', studentFeedback: '@SUM(A1)' }]; exportPortfolioCSV();`);
document.createElement = originalCreate;
const csvText = exportedBlob.parts[1];
assert.match(csvText, /"'=HYPERLINK\(""http:\/\/x""\)"/);
assert.match(csvText, /"'@SUM\(A1\)"/);
assert.match(csvText, /,"-1",/);
console.log('PASS: CSV export guards against formula injection');

// Real-data cases: Milestones from different rotations are separate series;
// different 實習總評量表 forms on the same day are not 1st/2nd attempts of one item.
configs.length = 0; nodes.chartGrid.children.length = 0;
const M = i => run(`TARGET_MILESTONES[${i}]`);
context.fixture2 = [
    { ...base, id: 'r1', type: 'Milestone', title: 'Milestone', instrumentType: 'Angio', date: '2025-02-12', milestoneLevels: { [M(0)]: '3' } },
    { ...base, id: 'r2', type: 'Milestone', title: 'Milestone', instrumentType: 'MRI', date: '2025-04-18', milestoneLevels: { [M(0)]: '1' } },
    { ...base, id: 'r3', type: 'Milestone', title: 'Milestone', instrumentType: 'MRI', date: '2025-06-13', milestoneLevels: { [M(0)]: '3' } },
    { ...base, id: 't1', type: '實習總評量表', title: '到職訓練評量表-影像醫學科', instrumentType: 'X-ray', date: '2024-07-01', scoreRaw: '100' },
    { ...base, id: 't2', type: '實習總評量表', title: '職前自我評估表-影像醫學科', instrumentType: 'X-ray', date: '2024-07-01', scoreRaw: '73' }
];
run('generateExhibitionDashboard({ refreshSelector: false, reportRecords: fixture2 })');
const titles2 = nodes.chartGrid.children.map(card => card.innerHTML);
assert.ok(titles2.some(html => html.includes('Milestone 核心能力成長 - MRI')));
assert.ok(titles2.some(html => html.includes('Milestone 核心能力成長 - Angio')));
assert.deepEqual(Array.from(chartTitled('Milestone 核心能力歷次趨勢 - MRI').config.data.datasets[0].data), [1, 3]);
const singles = chartTitled('實習總評量表 評量分數');
assert.deepEqual(Array.from(singles.config.data.datasets[0].data), [100, 73]);
assert.deepEqual(Array.from(singles.config.data.labels, label => Array.from(label).join('')), ['到職訓練評量表（07/01）', '職前自我評估表（07/01）']);
assert.ok(!titles2.some(html => /-27/.test(html)));
console.log('PASS: Milestone per rotation and 實習總評量表 per form');
assert.equal(run("reportGroupName({ type: '實習總評量表', title: '3-5放射線治療技術學_學生臨床實習學期測驗及評核成績紀錄表' })"), '3-5放射線治療技術學_學生臨床實習學期測驗及評核成績紀錄表');
assert.equal(run("reportGroupName({ type: '實習總評量表', title: '醫事放射實習生總評量表-影像醫學科' })"), '醫事放射實習生總評量表');
console.log('PASS: form names keep numbered prefixes');
assert.equal(run("displayScore('80.83333129882812')"), '80.8');
assert.equal(run("displayScore('85')"), '85');
console.log('PASS: long decimals are rounded for display');
assert.equal(run("reportItemName({ type: 'DOPS', title: 'DOPS-胸腹部-影像醫學科', instrumentType: 'MRI' })"), 'MRI 胸腹部');
assert.equal(run("reportItemName({ type: 'DOPS', title: 'DOPS-學前訓練-影像醫學科', instrumentType: 'CT' })").includes('CT'), true);
console.log('PASS: DOPS table items keep instruments apart');

// Report contents chosen by the user apply to the screen and the printout.
configs.length = 0; nodes.chartGrid.children.length = 0; alerts.length = 0;
run(`reportSections.delete('charts'); reportSections.delete('counseling');
     generateExhibitionDashboard({ refreshSelector: false, reportRecords: fixture });`);
let sectionCards = nodes.chartGrid.children.map(card => card.innerHTML);
assert.ok(!sectionCards.some(html => /<canvas/.test(html)), 'charts should be hidden');
assert.ok(sectionCards.some(html => html.includes('評量總覽')));
assert.ok(sectionCards.some(html => html.includes('回饋與改善追蹤')));
assert.ok(!sectionCards.some(html => html.includes('輔導紀錄｜')));
run(`reportSections.clear(); historyData = fixture.slice(0, 2); chartSelectionInitialized = false; selectedChartItems.clear(); printAccreditationReport();`);
assert.match(alerts[0], /至少勾選一項/);
run(`REPORT_SECTIONS.forEach(key => reportSections.add(key));`);
console.log('PASS: report sections can be left out');

// A single student is selected automatically.
run(`currentStudentFilter = 'all'; historyData = fixture.slice(); updateFilterOptions();`);
assert.equal(run('currentStudentFilter'), '測試學員');
console.log('PASS: single student is selected automatically');

// Header summary and "換下一位學員": the folder picker opens first and data is only replaced after a folder is chosen.
run(`historyData = fixture.slice(); updateFilterOptions();`);
assert.equal(nodes.dataSummary.textContent, '測試學員 · 10 筆');
assert.equal(nodes.dataSummary.hidden, false);
let pickerOpened = 0;
nodes.folderImportInput.click = () => { pickerOpened += 1; };
run('startNextStudent()');
assert.equal(pickerOpened, 1);
assert.equal(nodes.folderImportInput.dataset.replace, '1');
assert.equal(run('historyData.length'), 10, 'data stays until a folder is chosen');
run('openFolderPicker()');
assert.equal(nodes.folderImportInput.dataset.replace, '');
run('resetData()');
assert.equal(nodes.dataSummary.hidden, true);
console.log('PASS: data summary and next-student import');

// Form text fields survive CSV export and import; an older CSV without the column still imports.
const fieldRecord = { ...base, id: 'f1', type: '輔導紀錄', title: '導師與學員雙向溝通紀錄表', date: '2024-07-01',
    scoreRaw: '', studentFeedback: '學員心得', formFields: [{ label: '導師意見', content: '多問多看' }, { label: '訪談記錄', content: '1.教材充足\n2.進度正常' }] };
context.Blob = function Blob(parts) { this.parts = parts; };
let roundBlob;
context.URL = { createObjectURL(blob) { roundBlob = blob; return 'blob:test'; }, revokeObjectURL() {} };
document.createElement = () => ({ ...makeNode(), click() {} });
context.fieldRecord = fieldRecord;
run('historyData = [fieldRecord]; exportPortfolioCSV();');
document.createElement = originalCreate;
const roundCsv = roundBlob.parts[1];
assert.match(roundCsv, /其他文字欄位/);
const reread = run(`analyzeCSV(${JSON.stringify(roundCsv)})`)[0];
assert.deepEqual(Array.from(reread.formFields, f => [f.label, f.content]), [['導師意見', '多問多看'], ['訪談記錄', '1.教材充足\n2.進度正常']]);
const oldCsv = '執行日期,學員姓名,教師/主持人,類型,表單標題,總分\n2024-07-01,測試學員,老師,DOPS,DOPS-胸腹部-影像醫學科,80';
assert.deepEqual(Array.from(run(`analyzeCSV(${JSON.stringify(oldCsv)})`)[0].formFields), []);
console.log('PASS: form text fields round-trip through CSV');

// Cards show every text block; the student name only appears when several students are loaded.
run(`historyData = [fieldRecord, { ...fixture[0], id: 'c2', stationDetails: '一般診斷攝影:85; 品德操守:80' }]; currentStudentFilter = 'all'; currentFilter = 'all'; currentTrainingFilter = 'all'; currentInstrumentFilter = 'all'; renderCards();`);
const cardsHtml = nodes.historyContainer.innerHTML;
assert.match(cardsHtml, /導師意見.*多問多看/s);
assert.match(cardsHtml, /訪談記錄/);
assert.match(cardsHtml, /學員回饋.*學員心得/s);
assert.match(cardsHtml, /各站成績.*一般診斷攝影.*85/s);
assert.doesNotMatch(cardsHtml, /學員：測試學員/);
console.log('PASS: cards show all text fields and station scores');
assert.equal(run(`displayScore('8/8 <span class="x">通過</span>')`), '8/8 通過');
console.log('PASS: markup in scores is stripped for display');

// 歷次對照表: one table per item; CT and MRI parts stay apart; attempts numbered by date.
run(`historyData = fixture.slice(); currentFilter = 'all'; generateCompareTables();`);
const cmpHtml = nodes.compareContainer.innerHTML;
assert.match(cmpHtml, /CT 胸腹部/);
assert.match(cmpHtml, /第 1 次.*2026-03-15.*第 2 次.*2026-06-20/s);
assert.match(cmpHtml, /cmp-delta up">\+12/);
assert.match(cmpHtml, /建議加強.*擺位需再精準/s);
assert.match(cmpHtml, /Milestone/);
console.log('PASS: comparison tables group by item and show change');

// Palette: attempts go from light to dark teal; an instrument keeps its colour; EPA has trends, no radar.
assert.equal(run('attemptColor(0, 3)'), '#a7d8d2');
assert.equal(run('attemptColor(2, 3)'), '#115e59');
assert.equal(run("instrumentColor('MRI')"), run("instrumentColor('MRI')"));
assert.notEqual(run("instrumentColor('CT')"), run("instrumentColor('MRI')"));
configs.length = 0; nodes.chartGrid.children.length = 0;
context.epaFixture = [
    { ...base, id: 'p1', type: 'EPA', title: 'EPA1-電腦斷層', instrumentType: 'CT', date: '2025-01-01', opaScores: { 1: '2A', 2: '2A', 3: '2B' } },
    { ...base, id: 'p2', type: 'EPA', title: 'EPA1-電腦斷層', instrumentType: 'CT', date: '2025-02-01', opaScores: { 1: '3B', 2: '3A', 3: '3C' } },
    { ...base, id: 'p3', type: 'EPA', title: 'EPA4-磁振造影', instrumentType: 'MRI', date: '2025-03-01', opaScores: { 1: '3A', 2: '3A', 3: '3A' } }
];
run('generateExhibitionDashboard({ refreshSelector: false, reportRecords: epaFixture })');
assert.ok(!configs.some(config => config.type === 'radar'));
assert.ok(chartTitled('EPA 信賴等級歷次趨勢 - CT'));
assert.ok(chartTitled('EPA 信賴等級歷次趨勢 - MRI'), 'a single attempt still gets a trend chart');
assert.equal(chartTitled('EPA 各儀器最近一次信賴等級').config.type, 'bar');
console.log('PASS: report palette and EPA trends');
