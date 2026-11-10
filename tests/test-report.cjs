const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const nodes = {};
const makeNode = () => ({ innerHTML: '', children: [], dataset: {}, classList: { add() {}, remove() {} }, addEventListener() {}, querySelectorAll() { return this.children; }, appendChild(node) { this.children.push(node); } });
const document = { getElementById(id) { return nodes[id] ||= makeNode(); }, createElement: makeNode, querySelectorAll() { return []; } };
const context = vm.createContext({ document, console, window: {}, setTimeout, alert() {} });
for (const file of ['parser.js', 'legacy-html-parser.js', 'portfolio-import.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
vm.runInContext(`
const samples = [
 {id:'a',type:'實習總評量表',title:'總評量',date:'2024-07-01',studentName:'甲',scoreRaw:'85',studentFeedback:'原文'},
 {id:'b',type:'輔導紀錄',title:'輔導',date:'2025-12-29',studentName:'乙',studentFeedback:'<img src=x onerror=alert(1)>\\n第二行'},
 {id:'c',type:'單站評量',title:'單站',date:'2025-11-01',studentName:'乙',scoreRaw:''}
];
const metadata = getReportMetadata(samples);
const subset = getReportMetadata([samples[1]]);
samples.forEach(createRecordSummary);
`, context);
assert.equal(vm.runInContext('metadata.period', context), '2024-07-01 至 2025-12-29');
assert.equal(vm.runInContext('subset.studentNames', context), '乙');
assert.equal(vm.runInContext('subset.count', context), 1);
assert.equal(vm.runInContext('subset.period', context), '2025-12-29 至 2025-12-29');
assert.equal(nodes.chartGrid.children.length, 3);
assert.match(nodes.chartGrid.children[0].innerHTML, /85/);
assert.match(nodes.chartGrid.children[1].innerHTML, /&lt;img/);
assert.doesNotMatch(nodes.chartGrid.children[1].innerHTML, /<img/);
assert.match(nodes.chartGrid.children[2].innerHTML, /未提供/);
assert.equal(vm.runInContext("getReportMetadata([{date:'1900-01-01',studentName:'甲'}]).period",context), '未提供');
console.log('PASS: report dates, selected-person scope, record summaries, missing result, escaped text');

const parsedEmpty = vm.runInContext(`analyzeCSV('執行日期,學員姓名,類型,總分,各站成績\\n"2025-12-29","測試學員","單站評量","",""')`, context);
assert.equal(parsedEmpty[0].scoreRaw, '');
assert.equal(parsedEmpty[0].stationDetails, '');
const escapedQuote = vm.runInContext(`analyzeCSV('執行日期,學員姓名,類型,學員回饋意見\\n"2025-12-29","測試學員","輔導紀錄","回饋：""保留引號"""')`, context);
assert.equal(escapedQuote[0].studentFeedback, '回饋："保留引號"');
console.log('PASS: CSV quoted empty fields and escaped quotes');

vm.runInContext(`
const trainingRecords = readPortfolioFile(
    '執行日期,學員姓名,類型,訓練類別\\n2025-01-01,甲,單站評量,醫事放射ＵＧＹ\\n2025-01-02,乙,單站評量,醫事放射PGY',
    'records.csv'
);
const trainingTitles = [
    getReportMetadata([trainingRecords[0]]).title,
    getReportMetadata([trainingRecords[1]]).title,
    getReportMetadata(trainingRecords).title,
    getReportMetadata([trainingRecords[0], samples[0]]).title,
    getReportMetadata(samples).title
];
`, context);
assert.deepEqual(Array.from(vm.runInContext('trainingTitles', context)), [
    '醫事放射UGY成果展示報告',
    '醫事放射師PGY成果展示報告',
    '醫事放射UGY／PGY成果展示報告',
    '醫事放射成果展示報告',
    '醫事放射成果展示報告'
]);
console.log('PASS: report titles for UGY, PGY, mixed, and unclassified records');
