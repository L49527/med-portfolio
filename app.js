/* Global State */
let historyData = [];
let currentFilter = 'all';
let currentTrainingFilter = 'all';
let currentInstrumentFilter = 'all';
let currentStudentFilter = 'all';
// Report parts the user chose to show and print; the cover page is always included.
const REPORT_SECTIONS = ['overview', 'charts', 'feedback', 'counseling', 'records'];
let reportSections = new Set(REPORT_SECTIONS);
let sortDirection = 'asc';
let charts = {};
let selectedChartItems = new Set(); // Track selected items for chart view
let chartSelectionInitialized = false;
let importStatusTimer = null;

/* Display constants and helpers */
// Report palette: calm colours that still separate in a black-and-white photocopy.
// Repeated attempts use one teal ramp from light (first) to dark (latest).
const ATTEMPT_LIGHT = [167, 216, 210]; // #a7d8d2
const ATTEMPT_DARK = [17, 94, 89];     // #115e59
const LATEST_BORDER = '#0b3d3a';
const ATTEMPT_DARK_HEX = '#115e59';
// Separate series (OPA 1–3, core competencies, instruments) use these, in this order.
const SERIES_COLORS = ['#115e59', '#2563eb', '#b45309', '#64748b', '#9f1239', '#0e7490',
    '#4d7c0f', '#6d28d9', '#a16207', '#1e3a8a', '#7c2d12', '#be123c'];

function attemptColor(index, total) {
    const t = total <= 1 ? 1 : index / (total - 1);
    const mix = ATTEMPT_LIGHT.map((light, channel) => Math.round(light + (ATTEMPT_DARK[channel] - light) * t));
    return `#${mix.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

// Each instrument keeps one colour across the whole report, given in order of first appearance.
const instrumentColorCache = new Map();
function instrumentColor(name) {
    const key = String(name || '');
    if (!instrumentColorCache.has(key)) instrumentColorCache.set(key, SERIES_COLORS[instrumentColorCache.size % SERIES_COLORS.length]);
    return instrumentColorCache.get(key);
}

/* Helper Functions */
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getGradeStyle(val) {
    if (!val) return 'bg-slate-50 text-slate-300';
    const v = val.toString().toUpperCase().trim().replace(/^L/, '');
    const styles = {
        '5': 'bg-indigo-600 text-white',
        '4': 'bg-emerald-500 text-white',
        '3': 'bg-sky-500 text-white',
        '3C': 'bg-sky-500 text-white',
        '3B': 'bg-blue-400 text-white',
        '3A': 'bg-cyan-400 text-slate-800',
        '2': 'bg-amber-500 text-white',
        '2B': 'bg-amber-500 text-white',
        '2A': 'bg-orange-300 text-slate-800',
        '1': 'bg-teal-500 text-white',
        'N/A': 'bg-slate-300 text-slate-600'
    };
    return styles[v] || 'bg-slate-100 text-slate-500';
}

/* Selection and import helpers */
function stableImportValue(value) {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableImportValue).join(',')}]`;
    return `{${Object.keys(value)
        .filter(key => key !== 'id' && key !== 'details')
        .sort()
        .map(key => `${JSON.stringify(key)}:${stableImportValue(value[key])}`)
        .join(',')}}`;
}

function getRecordContentKey(record) {
    return stableImportValue(record);
}

function createImportedRecordId() {
    return `record_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function initializeChartSelection() {
    if (chartSelectionInitialized || historyData.length === 0) return;
    historyData.forEach(item => {
        if (item && item.id !== undefined && item.id !== null) selectedChartItems.add(item.id);
    });
    chartSelectionInitialized = true;
}

function addImportedRecordsToChartSelection(records) {
    if (!chartSelectionInitialized) initializeChartSelection();
    records.forEach(item => {
        if (item && item.id !== undefined && item.id !== null) selectedChartItems.add(item.id);
    });
}

function recordsFromImportResult(result) {
    const records = Array.isArray(result) ? result : [result];
    if (records.length === 0 || records.some(record => !record || typeof record !== 'object' || Array.isArray(record))) {
        throw new Error('檔案無可用評量資料');
    }
    return records;
}

function formatImportSummary(summary) {
    const parts = [];
    if (summary.added > 0) parts.push(`已匯入 ${summary.added} 筆`);
    else if (!summary.failedFiles.length) parts.push('本次無新增紀錄');
    if (summary.duplicates > 0) parts.push(`略過 ${summary.duplicates} 筆重複紀錄`);
    if (summary.failedFiles.length) {
        parts.push(`${summary.failedFiles.length} 個檔案匯入失敗（${summary.failedFiles.join('、')}）`);
    }
    return parts.join('，');
}

function getImportSummaryState(summary) {
    if (summary.failedFiles.length === 0) return 'success';
    return summary.added > 0 || summary.duplicates > 0 ? 'partial' : 'error';
}

function clearImportStatus() {
    if (importStatusTimer !== null) clearTimeout(importStatusTimer);
    importStatusTimer = null;
    const status = document.getElementById('importStatus');
    status.textContent = '';
    delete status.dataset.state;
    document.getElementById('dismissImportStatus').hidden = true;
}

function showImportStatus(summary) {
    clearImportStatus();
    const status = document.getElementById('importStatus');
    status.textContent = formatImportSummary(summary);
    status.dataset.state = getImportSummaryState(summary);
    if (summary.failedFiles.length) {
        document.getElementById('dismissImportStatus').hidden = false;
    } else {
        importStatusTimer = setTimeout(clearImportStatus, 4000);
    }
}

/* Report helpers */
const CHART_FONT_FAMILY = "'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', 'Segoe UI', sans-serif";
const CHART_FONT_SIZE = { screen: 12, print: 16 };
const PRINT_CHART_SIZE = { width: 1000, height: 420 };
// Types drawn as charts; every other type is printed as a text record.
const CHART_TYPES = new Set(['Milestone', 'EPA', 'DOPS', 'Mini-CEX', 'CbD', '筆試成績', '問卷調查']);
const SCORE_TYPES = new Set(['DOPS', 'Mini-CEX', 'CbD', '實習總評量表', '筆試成績', '問卷調查']);
const FEEDBACK_TYPES = ['DOPS', 'Mini-CEX', 'CbD', '實習總評量表'];
const OVERVIEW_TYPE_ORDER = ['Milestone', 'EPA', 'DOPS', 'Mini-CEX', 'CbD', '實習總評量表', '筆試成績', '問卷調查', '單站評量', '輔導紀錄'];

if (typeof Chart !== 'undefined' && Chart.defaults?.font) {
    Chart.defaults.font.family = CHART_FONT_FAMILY;
    Chart.defaults.color = '#334155';
}

function scoreOrNull(raw) {
    const text = String(raw ?? '').trim().replace(/\s*分$/, '');
    if (!text) return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
}

function opaValue(raw) {
    const value = OPA_VALUE_MAP[String(raw ?? '').trim().toUpperCase()];
    return value === undefined ? null : value;
}

function averageOrNull(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length * 10) / 10 : null;
}

function milestoneLevel(record, index) {
    return parseFloat(record.milestoneLevels?.[TARGET_MILESTONES[index]]);
}

function milestoneCoreValues(record) {
    return CORE_COMPETENCIES.map(name => averageOrNull(CORE_MAP[name].map(index => milestoneLevel(record, index))));
}

function milestoneOverall(record) {
    return averageOrNull(TARGET_MILESTONES.map((_, index) => milestoneLevel(record, index)));
}

function isValidDate(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date || '') && date !== '1900-01-01';
}

function shortDate(date) {
    return isValidDate(date) ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : '日期未提供';
}

function byDate(a, b) {
    return String(a.date ?? '').localeCompare(String(b.date ?? ''));
}

function groupBy(items, keyOf) {
    const groups = {};
    items.forEach(item => {
        const key = keyOf(item);
        (groups[key] ||= []).push(item);
    });
    return groups;
}

function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatScore(value) {
    return `${formatNumber(value)} 分`;
}

function formatLevel(value) {
    return `L${formatNumber(value)}`;
}

function formatOpa(value) {
    return OPA_LABEL_MAP[Math.round(value)] ?? formatNumber(value);
}

function formatChange(diff) {
    const rounded = Math.round(diff * 10) / 10;
    return rounded === 0 ? '持平' : `${rounded > 0 ? '+' : ''}${formatNumber(rounded)}`;
}

const VALUE_FORMATS = { number: formatNumber, level: formatLevel, opa: formatOpa };

function attemptName(index, record) {
    return `第 ${index + 1} 次（${shortDate(record.date)}）`;
}

// "第 N 次" labels; the date goes on a second line when every record of that attempt shares it.
function attemptLabels(groups) {
    const length = Math.max(0, ...groups.map(group => group.length));
    return Array.from({ length }, (_, index) => {
        const dates = new Set(groups.map(group => group[index]?.date).filter(Boolean));
        const [date] = dates;
        return dates.size === 1 && isValidDate(date) ? [`第 ${index + 1} 次`, shortDate(date)] : `第 ${index + 1} 次`;
    });
}

// Point labels show the score, plus the date when the axis label cannot carry it.
function scorePointLabels(records, axisLabels) {
    return records.map((record, index) => {
        const score = record ? scoreOrNull(record.scoreRaw) : null;
        if (score === null) return '';
        return Array.isArray(axisLabels?.[index]) ? formatNumber(score) : [formatNumber(score), shortDate(record.date)];
    });
}

function seriesEnds(records, getValue) {
    const points = records
        .map((record, index) => ({ record, index, value: getValue(record) }))
        .filter(point => point.value !== null && Number.isFinite(point.value));
    return points.length ? { first: points[0], last: points[points.length - 1], count: points.length } : null;
}

// Earlier attempts fade out so the newest outline stands out on radar charts.
function progressionStyle(index, total, color) {
    if (index === total - 1) {
        return { borderColor: color, backgroundColor: hexToRgba(color, 0.2), pointBackgroundColor: color, borderWidth: 3, pointRadius: 4, fill: true };
    }
    if (index === 0) {
        return { borderColor: '#94a3b8', backgroundColor: 'rgba(0, 0, 0, 0)', pointBackgroundColor: '#94a3b8', borderDash: [6, 4], borderWidth: 2, pointRadius: 2, fill: false };
    }
    const alpha = 0.3 + 0.4 * (index / (total - 1));
    return { borderColor: hexToRgba(color, alpha), backgroundColor: 'rgba(0, 0, 0, 0)', pointBackgroundColor: hexToRgba(color, alpha), borderWidth: 1.5, pointRadius: 2, fill: false };
}

// 實習總評量表 holds different forms (到職訓練評量表, 職前自我評估表 …); each form is its own item,
// so two forms on the same day are not shown as a 1st and 2nd attempt.
function reportGroupName(record) {
    if (record.type === '實習總評量表') return (record.title || '').replace(/\s*-\s*[^-]*科$/, '').trim() || getSmartGroupName(record);
    return getSmartGroupName(record);
}

// DOPS parts repeat across instruments (CT 胸腹部, MRI 胸腹部); the tables keep them apart like the charts do.
function reportItemName(record) {
    const name = reportGroupName(record);
    const inst = record.instrumentType || '';
    return record.type === 'DOPS' && inst && !name.includes(inst) ? `${inst} ${name}` : name;
}

// Splits a long axis label into short lines (at most 3) so it fits under one bar.
function wrapLabel(text, width = 12, maxLines = 3) {
    const lines = [];
    for (let rest = String(text); rest && lines.length < maxLines; rest = rest.slice(width)) lines.push(rest.slice(0, width));
    if (String(text).length > width * maxLines) lines[maxLines - 1] = lines[maxLines - 1].slice(0, width - 1) + '…';
    return lines;
}

// Long decimals from the source forms (80.83333129882812) are shown with one decimal.
// Some source forms put markup in the score (8/8 <span>通過</span>); only the text is shown.
function displayScore(raw) {
    const text = String(raw ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return /^-?\d+\.\d{2,}$/.test(text) ? Number(text).toFixed(1) : text;
}

function renderSingleScoreGroups(studentName, type, records) {
    const groups = new Map();
    for (const record of records) {
        const detail = reportGroupName(record);
        const instrument = record.type === '實習總評量表' ? '' : (record.instrumentType || '');
        const key = JSON.stringify([detail, instrument]);
        if (!groups.has(key)) groups.set(key, { detail, instrument, records: [] });
        groups.get(key).records.push(record);
    }

    const singles = [];
    for (const group of groups.values()) {
        // Keep the existing before/after displays for assessments with a stage label.
        if (group.records.some(record => /學前|學後|前測|後測/.test(record.title))) continue;
        const scores = [];
        for (const record of group.records) {
            const score = scoreOrNull(record.scoreRaw);
            if (score !== null) scores.push({ record, score });
        }
        if (scores.length !== 1) continue;
        const label = [...new Set([group.detail, group.instrument].filter(Boolean))].join('／') || type;
        singles.push({ ...scores[0], label, group });
    }
    if (!singles.length) return records;

    const rendered = new Set(singles.flatMap(single => single.group.records));
    const top = Math.max(100, ...singles.map(single => single.score));
    const bottom = Math.min(0, ...singles.map(single => single.score));
    if (singles.length === 1) {
        const [{ record, score, label }] = singles;
        const title = `【${studentName}】${type} 評量分數${label !== type ? ` - ${label}` : ''}`;
        const dataset = { label: '評量分數', data: [score], backgroundColor: '#0f766e', maxBarThickness: 68 };
        createChart(title, 'bar', [['第 1 次', shortDate(record.date)]], [dataset], { y: { min: bottom, max: top } },
            { singleScore: true });
    } else {
        // Items assessed only once share one chart instead of one page each.
        const dataset = { label: '評量分數', data: singles.map(single => single.score), backgroundColor: '#0f766e', maxBarThickness: 56 };
        // Long form names wrap onto a second line; the date stays whole at the end of the last line.
        const labels = singles.map(single => {
            const lines = wrapLabel(single.label, 24, 2);
            lines[lines.length - 1] += `（${shortDate(single.record.date)}）`;
            return lines;
        });
        createChart(`【${studentName}】${type} 評量分數`, 'bar', labels, [dataset],
            { x: { min: bottom, max: top }, y: { ticks: { autoSkip: false } } }, {
            singleScore: true, horizontal: true
        });
    }
    return records.filter(record => !rendered.has(record));
}

/* UI Logic */
function switchView(mode) {
    const hCont = document.getElementById('historyContainer');
    const cCont = document.getElementById('compareContainer');
    const chartCont = document.getElementById('chartContainer');
    if (!hCont || !cCont || !chartCont) return;

    hCont.classList.add('hidden'); cCont.classList.add('hidden'); chartCont.classList.add('hidden');
    // The report is always in date order, so sorting only applies to the other two views.
    const sortButton = document.getElementById('sortButton');
    if (sortButton) sortButton.hidden = mode === 'chart';
    if (mode !== 'chart') togglePresentationMode(false);
    const btns = { card: 'cardModeBtn', compare: 'compareModeBtn', chart: 'chartModeBtn' };
    Object.values(btns).forEach(id => { if (document.getElementById(id)) document.getElementById(id).classList.remove('mode-active'); });

    if (mode === 'card') { hCont.classList.remove('hidden'); document.getElementById('cardModeBtn').classList.add('mode-active'); renderCards(); }
    else if (mode === 'compare') { cCont.classList.remove('hidden'); document.getElementById('compareModeBtn').classList.add('mode-active'); generateCompareTables(); }
    else if (mode === 'chart') { chartCont.classList.remove('hidden'); document.getElementById('chartModeBtn').classList.add('mode-active'); setTimeout(() => { generateExhibitionDashboard(); }, 100); }
}

/* --- Common Functions --- */
function deleteItem(id) {
    if (confirm('確定要刪除此筆評量紀錄嗎？')) {
        historyData = historyData.filter(item => item.id !== id);
        selectedChartItems.delete(id);
        updateFilterOptions();
        switchView(currentViewMode());
    }
}

function resetData() {
    historyData = [];
    selectedChartItems.clear();
    chartSelectionInitialized = false;
    currentFilter = 'all';
    currentTrainingFilter = currentInstrumentFilter = currentStudentFilter = 'all';
    clearImportStatus();
    updateFilterOptions();
    document.getElementById('typeFilter').value = 'all';
}

function clearHistory() {
    closeImportMenu();
    if (!historyData.length) return;
    if (confirm('確定要清空所有資料嗎？此動作無法復原。')) {
        resetData();
        switchView('card');
    }
}

// Next student: pick the new folder first; the current data is cleared only once a folder is chosen,
// so cancelling the picker keeps everything as it was.
function startNextStudent() {
    closeImportMenu();
    const input = document.getElementById('folderImportInput');
    if (!input) return;
    input.dataset.replace = historyData.length ? '1' : '';
    input.click();
}

function closeImportMenu() {
    const menu = document.getElementById('importMenu');
    if (menu) menu.open = false;
}

// Header summary of what is loaded, e.g. "王小明 · 165 筆".
function updateDataSummary() {
    const summary = document.getElementById('dataSummary');
    if (!summary) return;
    const students = [...new Set(historyData.map(record => record.studentName).filter(Boolean))];
    summary.hidden = !historyData.length;
    summary.textContent = !historyData.length ? ''
        : `${students.length === 1 ? students[0] : `${students.length} 位學員`} · ${historyData.length} 筆`;
}

function setClass(element, className, on) {
    if (!element?.classList) return;
    if (on) element.classList.add(className);
    else element.classList.remove(className);
}

function setReportSection(key, checked) {
    if (checked) reportSections.add(key);
    else reportSections.delete(key);
    generateExhibitionDashboard({ refreshSelector: false });
}

function generateExhibitionDashboard({ refreshSelector = true, reportRecords } = {}) {
    const grid = document.getElementById('chartGrid');
    Object.values(charts).forEach(chart => chart.destroy());
    charts = {};
    grid.innerHTML = '';
    const candidates = getFilteredData();
    initializeChartSelection();
    if (refreshSelector) populateChartItemSelector(candidates);
    const filtered = reportRecords ?? getIncludedRecords(candidates);
    const studentNamesInReport = [...new Set(filtered.map(record => record.studentName))];
    const studentCount = studentNamesInReport.length;
    const scope = document.getElementById('reportScopeCount');
    scope.textContent = studentCount > 1
        ? `含 ${studentCount} 位學員，請先在上方「學員」選擇一位（已納入 ${filtered.length} 筆）`
        : `${studentNamesInReport[0] ? `${studentNamesInReport[0]} · ` : ''}已納入 ${filtered.length} 筆（符合篩選 ${candidates.length} 筆）`;
    setClass(scope, 'needs-student', studentCount > 1);
    setClass(document.getElementById('printReportButton'), 'is-blocked', studentCount > 1 || !filtered.length);
    document.getElementById('chartSelectorPanel').hidden = candidates.length === 0;

    if (!filtered.length) {
        const message = !historyData.length ? '請先匯入資料'
            : !candidates.length ? '沒有符合目前篩選條件的紀錄'
            : '目前篩選結果尚未納入報告';
        grid.innerHTML = `<p class="record-empty">${message}</p>`;
        return;
    }

    // Report order per student: overview → charts → feedback tracking → text records.
    const studentGroups = groupBy(filtered, record => record.studentName);
    const studentNames = Object.keys(studentGroups).sort();
    studentNames.forEach(sName => {
        // 依日期從舊到新排序，「第 N 次」才會和評量順序一致
        const sData = [...studentGroups[sName]].sort(byDate);
        if (reportSections.has('overview')) createOverviewPage(sName, sData);
        if (reportSections.has('charts')) {
            renderMilestoneCharts(sName, sData);
            renderEpaCharts(sName, sData);
            renderDopsCharts(sName, sData);
            ['Mini-CEX', 'CbD', '實習總評量表'].forEach(type =>
                renderSkillCharts(sName, type, sData.filter(record => record.type === type)));
            renderExamCharts(sName, sData);
            renderBasicCourseCharts(sName, sData);
            renderSurveyCharts(sName, sData);
            renderStageCharts(sName, sData);
        }
        if (reportSections.has('feedback')) createFeedbackTrackingPage(sName, sData);
        sData.filter(record => !CHART_TYPES.has(record.type))
            .filter(record => reportSections.has(record.type === '輔導紀錄' ? 'counseling' : 'records'))
            .forEach(createRecordSummary);
    });
    if (studentNames.length > 1 && reportSections.has('charts')) renderAllSurveyOverview(filtered);
    if (!grid.children.length) grid.innerHTML = '<p class="record-empty">請在上方「報告內容」至少勾選一項</p>';

    const chartCards = grid.querySelectorAll('.chart-card');
    grid.className = (chartCards.length === 1) ? "grid grid-cols-1 gap-8" : "grid grid-cols-1 lg:grid-cols-2 gap-8";
}

// Each rotation (instrument) starts its own Milestone series, so progress is read within a rotation.
function renderMilestoneCharts(sName, sData) {
    const records = sData.filter(record => record.type === 'Milestone');
    if (!records.length) return;
    const instGroups = groupBy(records, record => record.instrumentType || '未指定儀器');
    const instNames = Object.keys(instGroups);
    const suffix = inst => (instNames.length > 1 ? ` - ${inst}` : '');

    instNames.forEach((inst, groupIndex) => {
        const list = instGroups[inst];
        const color = ATTEMPT_DARK_HEX;
        const radar = list.map((record, index) => ({
            label: attemptName(index, record),
            data: milestoneCoreValues(record),
            ...progressionStyle(index, list.length, color)
        }));
        createChart(`【${sName}】Milestone 核心能力成長${suffix(inst)}`, 'radar', CORE_COMPETENCIES, radar,
            { r: { min: 0, max: 5, ticks: { stepSize: 1 } } });

        if (list.length < 2) return;
        const trend = CORE_COMPETENCIES.map((name, index) => {
            const lineColor = SERIES_COLORS[index % SERIES_COLORS.length];
            return {
                label: name,
                data: list.map(record => milestoneCoreValues(record)[index]),
                borderColor: lineColor, backgroundColor: lineColor,
                tension: 0.1, pointRadius: 5, spanGaps: true
            };
        });
        createChart(`【${sName}】Milestone 核心能力歷次趨勢${suffix(inst)}`, 'line', attemptLabels([list]), trend,
            { y: { min: 0, max: 5, ticks: { stepSize: 1 } } }, {
                valueFormat: 'level', labelPoints: 'ends'
            });
    });
}

function renderEpaCharts(sName, sData) {
    const records = sData.filter(record => record.type === 'EPA');
    if (!records.length) return;
    const opaAxis = { min: 0, max: 8, ticks: { stepSize: 1, callback: value => OPA_LABEL_MAP[Math.round(value)] || '' } };
    const opaLabels = ['OPA 1', 'OPA 2', 'OPA 3'];
    const instGroups = groupBy(records, record => record.instrumentType || '未指定儀器');

    // One trend chart per instrument (OPA 1–3 over the attempts), then the latest level of each instrument.
    Object.entries(instGroups).forEach(([inst, list]) => {
        const trend = [1, 2, 3].map(j => ({
            label: `OPA ${j}`,
            data: list.map(record => opaValue(record.opaScores?.[j])),
            borderColor: SERIES_COLORS[j - 1], backgroundColor: SERIES_COLORS[j - 1],
            tension: 0.1, pointRadius: 5, spanGaps: true
        }));
        createChart(`【${sName}】EPA 信賴等級歷次趨勢 - ${inst}`, 'line', attemptLabels([list]), trend, { y: opaAxis }, {
            valueFormat: 'opa', labelPoints: 'ends'
        });
    });

    const instNames = Object.keys(instGroups);
    if (instNames.length < 2) return;
    const labels = instNames.map(inst => {
        const list = instGroups[inst];
        return [inst, `第 ${list.length} 次 ${shortDate(list[list.length - 1].date)}`];
    });
    const latest = [1, 2, 3].map(j => ({
        label: `OPA ${j}`,
        data: instNames.map(inst => { const list = instGroups[inst]; return opaValue(list[list.length - 1].opaScores?.[j]); }),
        backgroundColor: SERIES_COLORS[j - 1], borderColor: SERIES_COLORS[j - 1],
        borderWidth: 1, borderRadius: 5, maxBarThickness: 30
    }));
    createChart(`【${sName}】EPA 各儀器最近一次信賴等級`, 'bar', labels, latest, { y: opaAxis }, { valueFormat: 'opa' });
}

function renderAttemptBarChart(title, groups, { min = 60 } = {}) {
    const names = Object.keys(groups);
    if (!names.length) return;
    const maxAttempts = Math.max(...Object.values(groups).map(list => list.length));
    // Score and date fit above up to three bars per group; with more bars only the score is shown.
    const withDates = maxAttempts <= 3;
    const datasets = Array.from({ length: maxAttempts }, (_, index) => {
        const color = attemptColor(index, maxAttempts);
        const latest = index === maxAttempts - 1;
        const items = names.map(name => groups[name][index]);
        return {
            label: `第 ${index + 1} 次`,
            data: items.map(record => (record ? scoreOrNull(record.scoreRaw) : null)),
            ...(withDates ? { valueLabels: scorePointLabels(items) } : {}),
            backgroundColor: color, borderColor: latest && maxAttempts > 1 ? LATEST_BORDER : color,
            borderWidth: latest && maxAttempts > 1 ? 2 : 1, borderRadius: 6, maxBarThickness: 30
        };
    });
    createChart(title, 'bar', names, datasets, { y: { min, max: 100 } }, {
    });
}

function renderDopsCharts(sName, sData) {
    const records = sData.filter(record => record.type === 'DOPS');
    Object.entries(groupBy(records, record => record.instrumentType || '未分類儀器')).forEach(([inst, list]) => {
        renderAttemptBarChart(`【${sName}】DOPS 部位細項成績 - ${inst}`, groupBy(list, getSmartGroupName));
    });
}

function renderSkillCharts(sName, type, records) {
    const remaining = renderSingleScoreGroups(sName, type, records);
    if (!remaining.length) return;
    const groups = groupBy(remaining, reportGroupName);
    const names = Object.keys(groups);
    const labels = attemptLabels(Object.values(groups));
    const datasets = names.map(name => {
        const color = instrumentColor(name);
        return {
            label: name,
            data: groups[name].map(record => scoreOrNull(record.scoreRaw)),
            valueLabels: scorePointLabels(groups[name], labels),
            borderColor: color, backgroundColor: color,
            tension: 0.1, fill: false, pointRadius: 6, spanGaps: true
        };
    });
    // With many lines the point labels overlap; the scores are on the bar chart that follows.
    const crowded = names.length > 3;
    createChart(`【${sName}】${type} 成長曲線（細項／儀器互比）`, 'line', labels, datasets, { y: { min: 60, max: 100 } }, {
        labelPoints: crowded ? 'none' : 'all'
    });
    renderAttemptBarChart(`【${sName}】${type} 細項成績對照`, groups);
}

function examStage(record) {
    const text = `${record.title || ''} ${record.instrumentType || ''}`;
    if (text.includes('學前')) return '學前';
    if (text.includes('學後')) return '學後';
    return null;
}

function renderExamCharts(sName, sData) {
    const records = sData.filter(record => record.type === '筆試成績' && record.instrumentType !== '基礎課程');
    if (!records.length) return;
    const stages = ['學前', '學後'];
    const instStageMap = {};
    records.forEach(record => {
        // 規範化儀器名稱 (學前總評估 / 學後總評估 -> 總評估)
        let inst = record.instrumentType || '未分類儀器';
        if (inst.includes('總評估')) inst = '總評估';
        instStageMap[inst] ||= { 學前: [], 學後: [] };
        const stage = examStage(record);
        const score = scoreOrNull(record.scoreRaw);
        if (stage && score !== null) instStageMap[inst][stage].push({ record, score });
    });

    // Records are sorted by date, so the last entry of each stage is the latest attempt.
    const latest = (inst, stage) => instStageMap[inst][stage][instStageMap[inst][stage].length - 1] ?? null;
    const instruments = Object.keys(instStageMap);
    const datasets = stages.map((stage, index) => {
        const points = instruments.map(inst => latest(inst, stage));
        return {
            label: stage,
            data: points.map(point => point?.score ?? null),
            valueLabels: points.map(point => (point ? [formatNumber(point.score), shortDate(point.record.date)] : '')),
            backgroundColor: attemptColor(index, stages.length), borderColor: attemptColor(index, stages.length),
            borderWidth: 1, borderRadius: 6, maxBarThickness: 30
        };
    });
    createChart(`【${sName}】筆試成績：學前 vs 學後`, 'bar', instruments, datasets, { y: { min: 60, max: 100 } });
}

function basicCourseName(record) {
    return String(record.title || '').replace(/^基礎課程[：:]\s*/, '').replace(/-\d+$/, '').trim() || '基礎課程';
}

function renderBasicCourseCharts(sName, sData) {
    const records = sData.filter(record => record.type === '筆試成績' && record.instrumentType === '基礎課程');
    if (!records.length) return;
    renderAttemptBarChart(`【${sName}】基礎課程細項成績`, groupBy(records, basicCourseName));
}

// One chart for all satisfaction surveys: instruments side by side, attempts from light to dark.
function renderSurveyCharts(sName, sData) {
    const records = sData.filter(record => record.type === '問卷調查');
    if (!records.length) return;
    const groups = groupBy(records, record => record.instrumentType || '未分類儀器');
    renderAttemptBarChart(`【${sName}】學習滿意度調查`, groups, { min: 70 });
}

// 學前/學後 階段對比 (按評量類型分別做儀器互比)
function renderStageCharts(sName, sData) {
    FEEDBACK_TYPES.forEach(type => {
        const stageData = sData.filter(record => record.type === type && /學前|學後/.test(record.title || ''));
        if (!stageData.length) return;
        const instStageMap = {};
        stageData.forEach(record => {
            const inst = record.instrumentType || '未分類儀器';
            instStageMap[inst] ||= { 學前: [], 學後: [] };
            const score = scoreOrNull(record.scoreRaw);
            if (score !== null) instStageMap[inst][record.title.includes('學前') ? '學前' : '學後'].push(score);
        });
        const stages = ['學前', '學後'].filter(stage => Object.values(instStageMap).some(map => map[stage].length));
        if (!stages.length) return;
        const instruments = Object.keys(instStageMap);
        const averages = Object.fromEntries(instruments.map(inst => [inst, {
            學前: averageOrNull(instStageMap[inst].學前), 學後: averageOrNull(instStageMap[inst].學後)
        }]));
        const datasets = instruments.map(inst => ({
            label: inst,
            data: stages.map(stage => averages[inst][stage]),
            backgroundColor: instrumentColor(inst),
            borderColor: instrumentColor(inst),
            borderWidth: 1, borderRadius: 4, maxBarThickness: 40
        }));
        createChart(`【${sName}】${type} 學前／學後對比（儀器互比）`, 'bar', stages, datasets, { y: { min: 60, max: 100 } });
    });
}

// 全部學員問卷總覽：只在報告含多位學員時才有意義
function renderAllSurveyOverview(records) {
    const surveys = records.filter(record => record.type === '問卷調查').sort(byDate);
    if (!surveys.length) return;
    const labels = surveys.map(record => [record.studentName, shortDate(record.date)]);
    createChart('全部學員學習滿意度調查總覽（依日期排列）', 'bar', labels, [{
        label: '滿意度分數',
        data: surveys.map(record => scoreOrNull(record.scoreRaw)),
        backgroundColor: ATTEMPT_DARK_HEX,
        borderColor: ATTEMPT_DARK_HEX,
        borderWidth: 1, borderRadius: 6, maxBarThickness: 25
    }], { y: { min: 70, max: 100 } });
}

/* Overview and feedback pages */
function createReportPage(className, html) {
    const card = document.createElement('section');
    card.className = `chart-card record-summary report-page ${className}`;
    card.innerHTML = html;
    document.getElementById('chartGrid').appendChild(card);
    return card;
}

function overviewGroupName(record) {
    if (record.type === '筆試成績') {
        if (record.instrumentType === '基礎課程') return basicCourseName(record);
        const inst = record.instrumentType || '未分類儀器';
        return inst.includes('總評估') ? '總評估' : inst;
    }
    if (record.type === '問卷調查') return record.instrumentType || '學習滿意度';
    return reportItemName(record);
}

function overviewCell(point, format) {
    return point ? `第 ${point.index + 1} 次：${format(point.value)}（${shortDate(point.record.date)}）` : '—';
}

function seriesRow(type, item, records, getValue, format) {
    const ends = seriesEnds(records, getValue);
    const repeated = Boolean(ends && ends.count > 1);
    return {
        type, item, count: records.length,
        first: overviewCell(ends?.first, format),
        last: repeated ? overviewCell(ends.last, format) : '—',
        change: repeated ? formatChange(ends.last.value - ends.first.value) : '—'
    };
}

function buildOverviewRows(records) {
    const rows = [];
    const types = [...new Set([...OVERVIEW_TYPE_ORDER, ...records.map(record => record.type)])];
    types.forEach(type => {
        const list = records.filter(record => record.type === type);
        if (!list.length) return;
        if (type === 'Milestone') {
            const groups = groupBy(list, record => record.instrumentType || '未指定儀器');
            Object.entries(groups).forEach(([inst, group]) => rows.push(seriesRow(type,
                Object.keys(groups).length > 1 ? `${inst}（核心能力平均）` : '核心能力平均', group, milestoneOverall, formatLevel)));
        } else if (type === 'EPA') {
            Object.entries(groupBy(list, record => record.instrumentType || '未指定儀器')).forEach(([inst, group]) => {
                const describe = (record, index) => `第 ${index + 1} 次：${[1, 2, 3]
                    .map(j => `OPA${j} ${record.opaScores?.[j] || '-'}`).join('／')}（${shortDate(record.date)}）`;
                rows.push({
                    type, item: inst, count: group.length,
                    first: describe(group[0], 0),
                    last: group.length > 1 ? describe(group[group.length - 1], group.length - 1) : '—',
                    change: '—'
                });
            });
        } else if (SCORE_TYPES.has(type)) {
            Object.entries(groupBy(list, overviewGroupName)).forEach(([item, group]) =>
                rows.push(seriesRow(type, item, group, record => scoreOrNull(record.scoreRaw), formatScore)));
        } else {
            rows.push({ type, item: '文字紀錄', count: list.length, first: '—', last: '—', change: '—' });
        }
    });
    return rows;
}

function createOverviewPage(studentName, records) {
    const rows = buildOverviewRows(records);
    if (!rows.length) return;
    const esc = escapeAssessmentText;
    const period = getReportMetadata(records).period;
    createReportPage('report-overview', `<div class="record-summary-inner">
        <h3 class="adaptive-title">【${esc(studentName)}】評量總覽</h3>
        <p class="report-page-lead">共 ${records.length} 筆紀錄 · 期間 ${esc(period)} · 「第 N 次」依評量日期由舊到新排列</p>
        <div class="report-table-wrap"><table class="report-table">
            <thead><tr><th>評量類型</th><th>項目</th><th>次數</th><th>第 1 次</th><th>最近一次</th><th>變化</th></tr></thead>
            <tbody>${rows.map(row => `<tr>${[row.type, row.item, row.count, row.first, row.last, row.change]
                .map(value => `<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div></div>`);
}

function buildFeedbackRows(records) {
    const rows = [];
    FEEDBACK_TYPES.forEach(type => {
        const groups = groupBy(records.filter(record => record.type === type), reportItemName);
        Object.entries(groups).forEach(([item, list]) => {
            list.forEach((prev, index) => {
                const next = list[index + 1];
                if (next && String(prev.feedbackNeeds ?? '').trim()) rows.push({ type, item, index: index + 1, prev, next });
            });
        });
    });
    return rows;
}

function createFeedbackTrackingPage(studentName, records) {
    const rows = buildFeedbackRows(records);
    if (!rows.length) return;
    const esc = escapeAssessmentText;
    const head = (index, record) => {
        const score = scoreOrNull(record.scoreRaw);
        return `<div class="report-cell-head">第 ${index} 次（${esc(shortDate(record.date))}）${score === null ? '' : ` · ${esc(formatScore(score))}`}</div>`;
    };
    const labelled = (label, tone, text) => `<div class="report-feedback-line"><span class="report-label ${tone}">${label}</span>${esc(text)}</div>`;
    createReportPage('report-feedback', `<div class="record-summary-inner">
        <h3 class="adaptive-title">【${esc(studentName)}】回饋與改善追蹤</h3>
        <p class="report-page-lead">左欄為教師在第 N 次提出的「建議加強」，右欄為同一項目下一次評量的結果。</p>
        <div class="report-table-wrap"><table class="report-table report-feedback-table">
            <thead><tr><th>評量／項目</th><th>第 N 次：建議加強</th><th>第 N+1 次：結果</th></tr></thead>
            <tbody>${rows.map(({ type, item, index, prev, next }) => `<tr>
                <td><strong>${esc(type)}</strong><br>${esc(item)}</td>
                <td>${head(index, prev)}${labelled('建議加強', 'needs', prev.feedbackNeeds)}</td>
                <td>${head(index + 1, next)}${next.feedbackGood ? labelled('表現良好', 'good', next.feedbackGood) : ''}${next.feedbackNeeds ? labelled('仍需加強', 'needs', next.feedbackNeeds) : ''}${!next.feedbackGood && !next.feedbackNeeds ? '<div class="report-feedback-line">未提供回饋</div>' : ''}</td>
            </tr>`).join('')}</tbody>
        </table></div></div>`);
}

function getIncludedRecords(candidates = getFilteredData()) {
    return candidates.filter(record => selectedChartItems.has(record.id));
}

function populateChartItemSelector(candidates = getFilteredData()) {
    const selector = document.getElementById('chartItemSelector');
    initializeChartSelection();
    const previousScrollTop = selector.scrollTop;
    selector.innerHTML = sortDataList([...candidates]).map(record => `
        <label class="chart-item-checkbox">
            <input type="checkbox" data-record-id="${escapeAssessmentText(record.id)}" ${selectedChartItems.has(record.id) ? 'checked' : ''}>
            <span class="record-type" data-type="${escapeAssessmentText(record.type)}">${escapeAssessmentText(record.type)}</span>
            <span>${escapeAssessmentText(record.title || '未命名評量')}</span>
            <span class="text-slate-600">${escapeAssessmentText(record.instrumentType || '未分類')} · ${escapeAssessmentText(record.date)}</span>
        </label>
    `).join('');
    selector.scrollTop = previousScrollTop;
    selector.onchange = ({ target }) => {
        if (!target.dataset.recordId) return;
        const id = target.dataset.recordId;
        if (target.checked) selectedChartItems.add(id);
        else selectedChartItems.delete(id);
        generateExhibitionDashboard({ refreshSelector: false });
    };
}

function selectAllChartItems(include) {
    initializeChartSelection();
    for (const record of getFilteredData()) {
        if (include) selectedChartItems.add(record.id);
        else selectedChartItems.delete(record.id);
    }
    generateExhibitionDashboard();
}

// Draws the value above each bar or point. A dataset may supply `valueLabels`
// (a string or [score, date] lines per point); otherwise the value is formatted.
const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(chart, _args, options) {
        const format = VALUE_FORMATS[options.format] || formatNumber;
        const size = options.fontSize || CHART_FONT_SIZE.screen;
        const smallSize = Math.round(size * 0.85);
        const isBar = chart.config.type === 'bar';
        const horizontal = chart.options.indexAxis === 'y';
        const { ctx } = chart;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#0f172a';
        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (!chart.isDatasetVisible(datasetIndex)) return;
            const valid = dataset.data.map((value, index) => (Number.isFinite(value) ? index : -1)).filter(index => index >= 0);
            const ends = new Set([valid[0], valid[valid.length - 1]]);
            chart.getDatasetMeta(datasetIndex).data.forEach((point, index) => {
                const value = dataset.data[index];
                if (!Number.isFinite(value)) return;
                if (options.labelPoints === 'none') return;
                if (options.labelPoints === 'last' && index !== valid[valid.length - 1]) return;
                if (options.labelPoints === 'ends' && !ends.has(index)) return;
                const custom = dataset.valueLabels?.[index];
                const lines = custom === undefined ? [format(value)] : [].concat(custom);
                if (!lines[0]) return;
                if (horizontal) {
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.font = `700 ${size}px ${CHART_FONT_FAMILY}`;
                    ctx.fillText(lines.join(' '), point.x + 6, point.y);
                    return;
                }
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                let y = isBar ? Math.min(point.y, point.base) - 4 : point.y - 8;
                for (let line = lines.length - 1; line >= 0; line--) {
                    const lineSize = line === 0 ? size : smallSize;
                    ctx.font = `${line === 0 ? 700 : 500} ${lineSize}px ${CHART_FONT_FAMILY}`;
                    ctx.fillText(lines[line], point.x, y);
                    y -= lineSize + 2;
                }
            });
        });
        ctx.restore();
    }
};

function createChart(title, type, labels, datasets, scales = {}, { singleScore = false, valueFormat = 'number', labelPoints = 'all', horizontal = false } = {}) {
    const id = `chart_${Math.random().toString(36).slice(2, 11)}`;
    const card = document.createElement('div');
    card.className = singleScore ? 'chart-card single-score-chart' : 'chart-card slide-up';
    card.innerHTML = `<div class="chart-card-inner"><h3 class="adaptive-title text-slate-800 mb-6 text-center">${escapeAssessmentText(title)}</h3><div class="chart-canvas-wrap w-full"><canvas id="${id}"></canvas></div></div>`;
    document.getElementById('chartGrid').appendChild(card);
    const font = { size: CHART_FONT_SIZE.screen, weight: 'bold' };
    const axes = type === 'radar' ? scales : { x: {}, ...(horizontal ? { y: {} } : {}), ...scales };
    charts[id] = new Chart(document.getElementById(id).getContext('2d'), {
        type,
        data: { labels, datasets },
        plugins: type === 'radar' ? [] : [valueLabels],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: horizontal ? 'y' : 'x',
            devicePixelRatio: 2,
            barPercentage: 0.5, // 讓長條圖變細
            categoryPercentage: 0.8,
            layout: { padding: horizontal ? { top: 8, right: 60 } : { top: type === 'radar' ? 4 : 40 } },
            ...(singleScore ? { animation: false } : {}),
            plugins: {
                legend: { display: !singleScore, position: 'bottom', labels: { font, padding: 12, boxWidth: 14 } },
                tooltip: { titleFont: font, bodyFont: font },
                valueLabels: { format: valueFormat, fontSize: CHART_FONT_SIZE.screen, labelPoints }
            },
            scales: Object.fromEntries(Object.entries(axes).map(([key, value]) => [key, {
                ...value,
                ticks: { ...value.ticks, font },
                ...(type === 'radar' ? { pointLabels: { font } } : {})
            }]))
        }
    });
}

// Larger text and a fixed landscape size so printed charts are readable and not stretched.
function prepareChartsForPrint() {
    const font = { size: CHART_FONT_SIZE.print, weight: 'bold' };
    Object.values(charts).forEach(chart => {
        const { options } = chart;
        options.animation = false;
        options.responsive = false;
        if (options.plugins?.legend?.labels) options.plugins.legend.labels.font = font;
        if (options.plugins?.valueLabels) options.plugins.valueLabels.fontSize = CHART_FONT_SIZE.print;
        Object.values(options.scales || {}).forEach(scale => {
            if (scale.ticks) scale.ticks.font = font;
            if (scale.pointLabels) scale.pointLabels.font = font;
        });
        // Chart.js caps the size at its container, which is a half-width column on screen.
        // Horizontal charts get a little more height per bar so wrapped names do not overlap.
        const bars = options.indexAxis === 'y' ? chart.data.labels.length : 0;
        const height = Math.max(PRINT_CHART_SIZE.height, Math.min(560, bars * 52));
        const wrap = chart.canvas?.parentElement;
        if (wrap) {
            wrap.style.width = `${PRINT_CHART_SIZE.width}px`;
            wrap.style.height = `${height}px`;
        }
        chart.stop();
        chart.update('none');
        chart.resize(PRINT_CHART_SIZE.width, height);
    });
}

function renderCards() {
    const container = document.getElementById('historyContainer');
    if (!container) return;
    let filtered = getFilteredData();
    filtered.sort((a, b) => sortDirection === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
    if (filtered.length === 0) {
        container.innerHTML = historyData.length
            ? '<div class="empty-start"><i class="fas fa-filter"></i><p class="empty-start-title">目前沒有符合篩選條件的紀錄</p><p class="empty-start-hint">請調整上方的評量類型、訓練別、儀器別或學員篩選。</p></div>'
            : emptyStartMarkup();
        return;
    }
    const showStudent = new Set(historyData.map(record => record.studentName)).size > 1;
    container.innerHTML = `<div class="record-grid">${filtered.map(d => recordCardHtml(d, showStudent)).join('')}</div>`;
    setupClampToggles(container);
}

const SCORED_TYPES = new Set(['DOPS', 'Mini-CEX', 'CbD', '實習總評量表', '筆試成績', '問卷調查', '單站評量', '基礎課程']);
const TYPE_BADGE = {
    EPA: 'bg-blue-600', Milestone: 'bg-teal-600', DOPS: 'bg-purple-600', CbD: 'bg-emerald-600',
    'Mini-CEX': 'bg-orange-500', 筆試成績: 'bg-indigo-600', 問卷調查: 'bg-pink-500'
};
// Form fields that describe the case (skill, diagnosis) are shown before the feedback.
const CONTEXT_FIELD = /技能名稱|主要診斷|診斷|報告題目|討論項目/;

// One block in a card: a coloured label and text that collapses after four lines.
function recordSection(label, text, tone = 'other') {
    if (!String(text ?? '').trim()) return '';
    return `<section class="record-section tone-${tone}"><h4>${escapeAssessmentText(label)}</h4>
        <p class="clamp">${escapeAssessmentText(String(text).trim())}</p>
        <button type="button" class="clamp-toggle" data-clamp-toggle hidden>展開</button></section>`;
}

function stationRows(record) {
    const stations = String(record.stationDetails || '').split(';')
        .map(part => part.split(':')).filter(([label, value]) => label?.trim() && value?.trim());
    if (!stations.length) return '';
    return `<section class="record-section tone-other"><h4>各站成績</h4><dl class="record-stations">${stations.map(([label, value]) =>
        `<div><dt>${escapeAssessmentText(label.trim())}</dt><dd>${escapeAssessmentText(value.trim())}</dd></div>`).join('')}</dl></section>`;
}

function recordScoreHtml(d) {
    if (d.type === 'EPA') {
        return `<div class="record-opa">${[1, 2, 3].map(i => `<span class="${getGradeStyle(d.opaScores?.[i])}"><small>OPA${i}</small>${escapeAssessmentText(d.opaScores?.[i] || '-')}</span>`).join('')}</div>`;
    }
    const score = displayScore(d.scoreRaw);
    if (!SCORED_TYPES.has(d.type) || !score || score === '--') return '';
    if (!/^-?\d+(\.\d+)?$/.test(score)) return `<div class="record-score is-text">${escapeAssessmentText(score)}</div>`;
    return `<div class="record-score"><strong>${escapeAssessmentText(score)}</strong><span>分</span></div>`;
    return '';
}

function recordBodyHtml(d) {
    const fields = d.formFields || [];
    const context = fields.filter(field => CONTEXT_FIELD.test(field.label));
    const others = fields.filter(field => !CONTEXT_FIELD.test(field.label));
    const parts = [];
    if (['DOPS', 'Mini-CEX', 'CbD'].includes(d.type) && d.skillName && !context.length) parts.push(recordSection('項目', d.skillName, 'context'));
    context.forEach(field => parts.push(recordSection(field.label, field.content, 'context')));
    parts.push(recordSection('表現良好', d.feedbackGood, 'good'));
    parts.push(recordSection('建議加強', d.feedbackNeeds, 'needs'));
    parts.push(recordSection('學員回饋', d.studentFeedback, 'student'));
    if (d.type === 'EPA') {
        [1, 2, 3].forEach(i => { if (d.opaScores?.[i]) parts.push(recordSection(`OPA ${i}（${d.opaScores[i]}）`, d.opaFeedbacks?.[i] || '無具體建議', 'context')); });
    }
    others.forEach(field => parts.push(recordSection(field.label, field.content, 'other')));
    parts.push(stationRows(d));
    if (d.type === 'Milestone') {
        const levels = TARGET_MILESTONES.filter(target => d.milestoneLevels?.[target]);
        if (levels.length) parts.push(`<section class="record-section tone-other"><h4>Milestone 等級</h4><dl class="record-stations">${levels.map(target =>
            `<div><dt>${escapeAssessmentText(target)}</dt><dd><span class="level-chip ${getGradeStyle(d.milestoneLevels[target])}">L${escapeAssessmentText(d.milestoneLevels[target])}</span></dd></div>`).join('')}</dl></section>`);
    }
    return parts.join('');
}

function recordCardHtml(d, showStudent) {
    const sub = [`評量教師：${d.teacherName || '未註明'}`, d.trainingType ? `訓練別：${d.trainingType}` : '', showStudent ? `學員：${d.studentName}` : '']
        .filter(Boolean).map(escapeAssessmentText).join('<span aria-hidden="true"> · </span>');
    return `<article class="record-card slide-up">
        <div class="record-card-head">
            <div class="record-card-meta">
                <span class="record-type ${TYPE_BADGE[d.type] || 'bg-slate-600'}">${escapeAssessmentText(d.type)}</span>
                <span class="record-date"><i class="far fa-calendar-check" aria-hidden="true"></i> ${escapeAssessmentText(d.date)}</span>
            </div>
            ${recordScoreHtml(d)}
            <button type="button" onclick="deleteItem('${escapeAssessmentText(d.id)}')" aria-label="刪除這筆紀錄" title="刪除這筆紀錄" class="record-delete"><i class="fas fa-circle-xmark" aria-hidden="true"></i></button>
        </div>
        <h3 class="record-card-title">${escapeAssessmentText(d.title)}</h3>
        <p class="record-card-sub">${sub}</p>
        <div class="record-sections">${recordBodyHtml(d)}</div>
    </article>`;
}

// Shows "展開" only under text that is actually cut off at four lines.
function setupClampToggles(container) {
    if (!container?.querySelectorAll) return;
    container.querySelectorAll('[data-clamp-toggle]').forEach(button => {
        const text = button.previousElementSibling;
        if (text && text.scrollHeight > text.clientHeight + 1) button.hidden = false;
    });
}

if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-clamp-toggle]');
        if (!button) return;
        const text = button.previousElementSibling;
        const open = text.classList.toggle('expanded');
        button.textContent = open ? '收合' : '展開';
    });
}

// 歷次對照表: one table per item (type + instrument/part), one column per attempt in date order.
const COMPARE_TYPES = ['Milestone', 'EPA', 'DOPS', 'Mini-CEX', 'CbD', '實習總評量表', '筆試成績', '問卷調查'];

function compareText(text) {
    if (!String(text ?? '').trim()) return '<span class="cmp-empty">—</span>';
    return `<p class="clamp">${escapeAssessmentText(String(text).trim())}</p><button type="button" class="clamp-toggle" data-clamp-toggle hidden>展開</button>`;
}

function compareRow(label, tone, cells) {
    return `<tr class="cmp-row cmp-${tone}"><th scope="row">${escapeAssessmentText(label)}</th>${cells.join('')}</tr>`;
}

function compareChange(type, chronological) {
    const value = type === 'Milestone' ? milestoneOverall : record => scoreOrNull(record.scoreRaw);
    if (type === 'EPA' || chronological.length < 2) return '';
    const ends = seriesEnds(chronological, value);
    if (!ends || ends.count < 2) return '';
    const diff = ends.last.value - ends.first.value;
    const tone = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    return `<span class="cmp-change ${tone}">第 1 次 → 最近一次 ${escapeAssessmentText(formatChange(diff))}</span>`;
}

function compareGroupHtml(type, item, list, anchor) {
    const chronological = [...list].sort(byDate);
    const attempt = record => chronological.indexOf(record) + 1;
    const head = list.map(d => `<th scope="col"><span class="cmp-attempt">第 ${attempt(d)} 次</span><span class="cmp-date">${escapeAssessmentText(d.date)}</span><span class="cmp-teacher">${escapeAssessmentText(d.teacherName || '')}</span></th>`).join('');
    const rows = [];
    const has = getText => list.some(d => String(getText(d) ?? '').trim());
    if (type === 'Milestone') {
        rows.push(compareRow('核心能力平均', 'score', list.map(d => {
            const avg = milestoneOverall(d);
            return `<td class="cmp-score">${avg === null ? '<span class="cmp-empty">—</span>' : escapeAssessmentText(formatLevel(avg))}</td>`;
        })));
        TARGET_MILESTONES.forEach(target => rows.push(compareRow(target, 'level', list.map(d => {
            const level = d.milestoneLevels?.[target];
            return `<td>${level ? `<span class="level-chip ${getGradeStyle(level)}">L${escapeAssessmentText(String(level).replace(/^L/i, ''))}</span>` : '<span class="cmp-empty">—</span>'}</td>`;
        }))));
    } else if (type === 'EPA') {
        [1, 2, 3].forEach(i => {
            rows.push(compareRow(`OPA ${i} 等級`, 'score', list.map(d => `<td>${d.opaScores?.[i]
                ? `<span class="level-chip ${getGradeStyle(d.opaScores[i])}">${escapeAssessmentText(d.opaScores[i])}</span>` : '<span class="cmp-empty">—</span>'}</td>`)));
            if (has(d => d.opaFeedbacks?.[i])) rows.push(compareRow(`OPA ${i} 回饋`, 'other', list.map(d => `<td>${compareText(d.opaFeedbacks?.[i])}</td>`)));
        });
    } else {
        rows.push(compareRow('分數', 'score', list.map(d => {
            const score = displayScore(d.scoreRaw);
            const value = scoreOrNull(d.scoreRaw);
            const previous = chronological[attempt(d) - 2];
            const prevValue = previous ? scoreOrNull(previous.scoreRaw) : null;
            const delta = value !== null && prevValue !== null && value !== prevValue
                ? `<span class="cmp-delta ${value > prevValue ? 'up' : 'down'}">${escapeAssessmentText(formatChange(value - prevValue))}</span>` : '';
            return `<td class="cmp-score">${score && score !== '--' ? `${escapeAssessmentText(score)}${delta}` : '<span class="cmp-empty">—</span>'}</td>`;
        })));
        const contextOf = d => (d.formFields || []).filter(field => CONTEXT_FIELD.test(field.label)).map(field => field.content).join('\n');
        if (has(contextOf)) rows.push(compareRow('評量內容', 'context', list.map(d => `<td>${compareText(contextOf(d))}</td>`)));
        if (has(d => d.feedbackGood)) rows.push(compareRow('表現良好', 'good', list.map(d => `<td>${compareText(d.feedbackGood)}</td>`)));
        if (has(d => d.feedbackNeeds)) rows.push(compareRow('建議加強', 'needs', list.map(d => `<td>${compareText(d.feedbackNeeds)}</td>`)));
        if (has(d => d.studentFeedback)) rows.push(compareRow('學員回饋', 'student', list.map(d => `<td>${compareText(d.studentFeedback)}</td>`)));
    }
    return `<section class="cmp-group" id="${anchor}">
        <header class="cmp-head">
            <span class="record-type ${TYPE_BADGE[type] || 'bg-slate-600'}">${escapeAssessmentText(type)}</span>
            <h3>${escapeAssessmentText(item)}</h3>
            <span class="cmp-count">${list.length} 次</span>
            ${compareChange(type, chronological)}
        </header>
        <div class="cmp-scroll"><table class="cmp-table"><thead><tr><th scope="col" class="cmp-corner">項目</th>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>
    </section>`;
}

function generateCompareTables() {
    const container = document.getElementById('compareContainer');
    if (!container) return;
    const sorted = sortDataList([...getFilteredData()]);
    if (!sorted.length) {
        container.innerHTML = historyData.length
            ? '<div class="empty-start"><i class="fas fa-filter"></i><p class="empty-start-title">目前沒有符合篩選條件的紀錄</p></div>'
            : emptyStartMarkup();
        return;
    }
    const showStudent = new Set(historyData.map(record => record.studentName)).size > 1;
    const groups = [];
    COMPARE_TYPES.forEach(type => {
        const records = sorted.filter(record => record.type === type);
        // Milestone and EPA are compared within one rotation; other types per instrument and part.
        const itemOf = record => (type === 'Milestone' || type === 'EPA') ? (record.instrumentType || '未指定儀器') : reportItemName(record);
        Object.entries(groupBy(records, record => `${showStudent ? `${record.studentName}｜` : ''}${itemOf(record)}`))
            .forEach(([item, list]) => groups.push({ type, item, list }));
    });
    // Items assessed only once have nothing to compare; they stay in 逐筆紀錄.
    const singles = groups.filter(group => group.list.length < 2).length;
    groups.splice(0, groups.length, ...groups.filter(group => group.list.length >= 2));
    if (!groups.length) {
        container.innerHTML = '<div class="empty-start"><i class="fas fa-table"></i><p class="empty-start-title">目前篩選的紀錄沒有可對照的評量</p><p class="empty-start-hint">輔導紀錄、單站評量等文字紀錄請在「逐筆紀錄」查看。</p></div>';
        return;
    }
    const nav = COMPARE_TYPES.map(type => {
        const index = groups.findIndex(group => group.type === type);
        return index < 0 ? '' : `<a href="#cmp-${index}">${escapeAssessmentText(type)} <span>${groups.filter(group => group.type === type).length}</span></a>`;
    }).join('');
    container.innerHTML = `<div class="cmp-wrap">
        <div class="cmp-intro"><h2>歷次對照表</h2><p>同一項目的每次評量並排比較，欄位依日期排列；分數旁的 ± 為與前一次的差異。${singles ? `另有 ${singles} 個項目只評量過一次，請在「逐筆紀錄」查看。` : ''}</p><nav class="cmp-nav" aria-label="跳到評量類型">${nav}</nav></div>
        ${groups.map((group, index) => compareGroupHtml(group.type, group.item, group.list, `cmp-${index}`)).join('')}
    </div>`;
    setupClampToggles(container);
}

function setFilter(value) {
    currentFilter = value;
    switchView(currentViewMode());
}

function setTrainingFilter(val) { currentTrainingFilter = val; switchView(currentViewMode()); }
function setInstrumentFilter(value) {
    currentInstrumentFilter = value;
    switchView(currentViewMode());
}
function setStudentFilter(value) {
    currentStudentFilter = value;
    switchView(currentViewMode());
}

function emptyStartMarkup() {
    return `<div class="empty-start">
        <i class="fas fa-layer-group" aria-hidden="true"></i>
        <p class="empty-start-title">尚未匯入評量資料</p>
        <p class="empty-start-hint">選擇 e-Portfolio 匯出的 HTML 評量表或 CSV 檔，也可以直接把檔案或資料夾拖進視窗。</p>
        <div class="empty-start-actions">
            <button type="button" class="empty-start-primary" onclick="openFilePicker()"><i class="fas fa-file-arrow-up" aria-hidden="true"></i> 選擇檔案</button>
            <button type="button" class="empty-start-secondary" onclick="openFolderPicker()"><i class="fas fa-folder-open" aria-hidden="true"></i> 選擇資料夾</button>
        </div>
    </div>`;
}
function openFilePicker() {
    closeImportMenu();
    document.getElementById('fileInput')?.click();
}

function openFolderPicker() {
    closeImportMenu();
    const input = document.getElementById('folderImportInput');
    if (!input) return;
    input.dataset.replace = '';
    input.click();
}

function toggleSort() { sortDirection = sortDirection === 'desc' ? 'asc' : 'desc'; const icon = document.getElementById('sortIcon'); if (icon) icon.className = `fas fa-sort-amount-${sortDirection === 'desc' ? 'down' : 'up'} text-teal-500`; const txt = document.getElementById('sortText'); if (txt) txt.innerText = `日期：${sortDirection === 'desc' ? '新到舊' : '舊到新'}`; switchView(currentViewMode()); }
function currentViewMode() { if (document.getElementById('cardModeBtn')?.classList.contains('mode-active')) return 'card'; if (document.getElementById('compareModeBtn')?.classList.contains('mode-active')) return 'compare'; return 'chart'; }
function sortDataList(list) {
    return list.sort((a, b) => {
        const order = String(a.date ?? '').localeCompare(String(b.date ?? ''));
        return sortDirection === 'desc' ? -order : order;
    });
}

/* Initialization and Event Listeners */
const fileInput = document.getElementById('fileInput');
const folderImportInput = document.getElementById('folderImportInput');
let pendingImport = Promise.resolve();

function queuePortfolioImport(collectFiles, emptyLabel) {
    // Start collecting immediately while the picker or drop still exposes the files.
    const filesReady = Promise.resolve(collectFiles()).then(files => ({ files }), error => ({ error }));
    pendingImport = pendingImport.catch(console.error).then(async () => {
        const { files, error } = await filesReady;
        if (error || (!files.length && emptyLabel)) {
            if (error) console.error('無法讀取拖放資料：', error);
            showImportStatus({ added: 0, duplicates: 0, failedFiles: [emptyLabel || '拖放的檔案'] });
            return;
        }
        return handleFiles(files);
    });
    return pendingImport;
}

// The whole window accepts dropped files and folders; an overlay shows while files are dragged over it.
let dragDepth = 0;
const dropOverlay = document.getElementById('dropOverlay');
const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files');
const showDropOverlay = on => { if (dropOverlay) dropOverlay.hidden = !on; };
if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('dragenter', event => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepth += 1;
        showDropOverlay(true);
    });
    window.addEventListener('dragover', event => { if (isFileDrag(event)) event.preventDefault(); });
    window.addEventListener('dragleave', event => {
        if (!isFileDrag(event)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) showDropOverlay(false);
    });
    window.addEventListener('drop', event => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepth = 0;
        showDropOverlay(false);
        queuePortfolioImport(() => readPortfolioDrop(event.dataTransfer), '拖放項目中沒有可讀取的 HTML 或 CSV');
    });
}
if (typeof document !== 'undefined' && document.addEventListener) {
    // Clicking outside the import menu closes it.
    document.addEventListener('click', event => {
        const menu = document.getElementById('importMenu');
        if (menu?.open && !menu.contains(event.target)) menu.open = false;
    });
}
fileInput?.addEventListener('change', () => {
    const files = Array.from(fileInput.files);
    fileInput.value = '';
    queuePortfolioImport(() => files);
});
folderImportInput?.addEventListener('change', () => {
    const files = Array.from(folderImportInput.files);
    const supported = files.filter(file => PORTFOLIO_FILE_EXTENSION.test(file.name));
    const folderName = files[0]?.webkitRelativePath.split('/')[0] || '選取的資料夾';
    folderImportInput.value = '';
    if (folderImportInput.dataset.replace === '1' && files.length) resetData();
    folderImportInput.dataset.replace = '';
    queuePortfolioImport(() => supported, folderName);
});
folderImportInput?.addEventListener('cancel', () => { folderImportInput.dataset.replace = ''; });
initializeEPortfolioTransfer();

async function handleFiles(files) {
    if (!files || files.length === 0) return;
    const summary = { added: 0, duplicates: 0, failedFiles: [] };
    const knownContent = new Set(historyData.map(getRecordContentKey));
    const usedIds = new Set(historyData.map(item => item && item.id).filter(id => id !== undefined && id !== null));
    const overlay = typeof document !== 'undefined' ? document.getElementById('progressOverlay') : null;
    if (overlay) overlay.hidden = false;
    clearImportStatus();

    try {
        for (const file of Array.from(files)) {
            const fileName = file && file.name ? file.name : '未命名檔案';
            try {
                if (!file || typeof file.text !== 'function' || !PORTFOLIO_FILE_EXTENSION.test(fileName)) {
                    throw new Error('僅支援 HTML 或 CSV 檔案');
                }

                const records = recordsFromImportResult(readPortfolioFile(await file.text(), fileName));
                const addedRecords = [];
                records.forEach(record => {
                    const contentKey = getRecordContentKey(record);
                    if (knownContent.has(contentKey)) {
                        summary.duplicates += 1;
                        return;
                    }

                    if (record.id === undefined || record.id === null || usedIds.has(record.id)) {
                        record.id = createImportedRecordId();
                        while (usedIds.has(record.id)) record.id = createImportedRecordId();
                    }
                    usedIds.add(record.id);
                    knownContent.add(contentKey);
                    historyData.push(record);
                    addedRecords.push(record);
                    summary.added += 1;
                });
                addImportedRecordsToChartSelection(addedRecords);
            } catch (error) {
                console.error(`匯入失敗（${fileName}）:`, error);
                summary.failedFiles.push(fileName);
            }
        }
    } finally {
        if (overlay) overlay.hidden = true;
        if (fileInput) fileInput.value = '';
    }

    updateFilterOptions();
    switchView('card');
    showImportStatus(summary);
    return summary;
}

function updateFilterOptions() {
    const trainings = [...new Set(historyData.map(record => record.trainingType))].sort();
    const instruments = [...new Set(historyData.map(record => record.instrumentType).filter(Boolean))].sort();
    if (!trainings.includes(currentTrainingFilter)) currentTrainingFilter = 'all';
    if (!instruments.includes(currentInstrumentFilter)) currentInstrumentFilter = 'all';
    const students = [...new Set(historyData.map(record => record.studentName).filter(Boolean))].sort();
    if (!students.includes(currentStudentFilter)) currentStudentFilter = 'all';
    // One report holds one student: with a single student the choice is made for the user and the
    // field stays hidden; it only appears when imported data mixes several students.
    if (students.length === 1) currentStudentFilter = students[0];
    const studentField = document.getElementById('studentFilterField');
    if (studentField) studentField.hidden = students.length < 2;
    updateDataSummary();
    setSelectOptions('studentFilter', ['all', '所有學員'], students, currentStudentFilter);
    setSelectOptions('trainingFilter', ['all', '所有訓練別'], trainings, currentTrainingFilter);
    setSelectOptions('instrumentFilter', ['all', '所有儀器別'], instruments, currentInstrumentFilter);
}

function setSelectOptions(id, defaultOption, values, selected) {
    const select = document.getElementById(id);
    select.innerHTML = '';
    for (const [value, label] of [defaultOption, ...values.map(value => [value, value])]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    }
    select.value = selected;
}

function getFilteredData() {
    let data = currentFilter === 'all' ? historyData : historyData.filter(d => d.type === currentFilter);
    if (currentTrainingFilter !== 'all') data = data.filter(d => d.trainingType === currentTrainingFilter);
    if (currentInstrumentFilter !== 'all') data = data.filter(d => d.instrumentType === currentInstrumentFilter);
    if (currentStudentFilter !== 'all') data = data.filter(d => d.studentName === currentStudentFilter);
    return data;
}

function createRecordSummary(item) {
    const card = document.createElement('section');
    card.className = 'chart-card record-summary';
    card.dataset.recordId = item.id;
    const fields = [
        ['學員', item.studentName], ['評量日期', item.date],
        ['教師／主持人', item.teacherName], ['訓練別', item.trainingType],
        ['分數／結果', displayScore(item.scoreRaw) || (SCORED_TYPES.has(item.type) ? '未提供' : '')], ['各站成績', item.stationDetails],
        ['表現良好項目', item.feedbackGood], ['建議加強項目', item.feedbackNeeds],
        ['學員回饋／紀錄內容', item.studentFeedback],
        ...(item.formFields || []).map(field => [field.label, field.content])
    ];
    card.innerHTML = `<div class="record-summary-inner"><h3 class="adaptive-title">${escapeAssessmentText(item.type)}｜${escapeAssessmentText(item.title)}</h3>
        <dl>${fields.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) =>
            `<div class="record-field"><dt>${escapeAssessmentText(label)}</dt><dd>${escapeAssessmentText(value)}</dd></div>`).join('')}</dl></div>`;
    document.getElementById('chartGrid').appendChild(card);
}

function getReportMetadata(records) {
    const dates = records.map(d => d.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== '1900-01-01').sort();
    const programs = new Set(records.map(record => normalizeTrainingProgram(record.trainingProgram)));
    let title = '醫事放射成果展示報告';
    if (!programs.has('')) {
        if (programs.size === 2) title = '醫事放射UGY／PGY成果展示報告';
        else if (programs.has('UGY')) title = '醫事放射UGY成果展示報告';
        else if (programs.has('PGY')) title = '醫事放射師PGY成果展示報告';
    }
    return {
        title,
        studentNames: [...new Set(records.map(d => d.studentName))].sort().join('、') || '未知學員',
        period: dates.length ? `${dates[0]} 至 ${dates[dates.length - 1]}` : '未提供',
        count: records.length
    };
}

// Cover page shared by the printout and presentation mode.
function buildReportCover(reportData) {
    const report = getReportMetadata(reportData);
    const cover = document.createElement('div');
    cover.className = 'print-header chart-card';
    cover.innerHTML = `
            <div class="print-header-inner">
                <img class="print-logo" src="logo.png" alt="輔仁大學附設醫院">
                <h1>${escapeAssessmentText(report.title)}</h1>
                <p>受評學員：${escapeAssessmentText(report.studentNames)}</p>
                <p>評量資料涵蓋期間：${escapeAssessmentText(report.period)}</p>
                <p>納入紀錄：${report.count} 筆</p>
                <p class="print-sub">評量展示助手 產出 | 本報告依目前篩選及勾選的評量紀錄產出</p>
            </div>
        `;
    return cover;
}

// Presentation mode hides every control so reviewers see only the report.
function togglePresentationMode(force) {
    if (typeof document === 'undefined' || !document.body?.classList) return;
    const on = force ?? !document.body.classList.contains('presenting');
    if (on === document.body.classList.contains('presenting')) return;
    document.body.classList.toggle('presenting', on);
    const exitButton = document.getElementById('exitPresentButton');
    if (exitButton) exitButton.hidden = !on;
    const grid = document.getElementById('chartGrid');
    grid?.querySelectorAll?.('.presentation-cover').forEach(el => el.remove());
    if (on && grid) {
        const records = getIncludedRecords();
        if (records.length) {
            const cover = buildReportCover(records);
            cover.classList.add('presentation-cover');
            grid.insertBefore(cover, grid.firstChild);
        }
        grid.parentElement?.scrollTo?.({ top: 0 });
    }
}

if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') togglePresentationMode(false);
    });
}

function printAccreditationReport() {
    if (historyData.length === 0) {
        alert('目前沒有資料可列印，請先匯入評量表單');
        return;
    }

    initializeChartSelection();
    const reportData = getIncludedRecords();
    if (!reportData.length) {
        alert('目前沒有納入可列印的紀錄。請調整篩選條件或報告勾選。');
        return;
    }
    if (!reportSections.size) {
        alert('請在「報告內容」至少勾選一項（評量總覽、圖表、回饋與改善追蹤、導師輔導紀錄或其他文字紀錄）。');
        return;
    }
    const studentCount = new Set(reportData.map(record => record.studentName)).size;
    if (studentCount > 1) {
        alert(`目前納入的紀錄包含 ${studentCount} 位學員。一份報告只放一位學員，請先在「學員」篩選選擇一位再列印。`);
        return;
    }

    togglePresentationMode(false);
    switchView('chart');

    // Wait for charts to render
    setTimeout(async () => {
        if (document.getElementById('printContainer')) return;
        const chartGrid = document.getElementById('chartGrid');
        if (!chartGrid) return;

        // 移除舊的 header / footer（避免重複）
        document.querySelectorAll('.print-header, .print-footer').forEach(el => el.remove());

        const printHeader = buildReportCover(reportData);

        // Wait for the large cover logo to decode while the current UI remains visible.
        const printLogo = printHeader.querySelector('.print-logo');
        if (printLogo) {
            try {
                if (typeof printLogo.decode === 'function') {
                    await printLogo.decode();
                } else if (!printLogo.complete) {
                    await new Promise((resolve, reject) => {
                        printLogo.addEventListener('load', resolve, { once: true });
                        printLogo.addEventListener('error', reject, { once: true });
                    });
                }
            } catch {
                printLogo.remove();
            }
        }

        if (document.getElementById('printContainer')) return;
        generateExhibitionDashboard({ refreshSelector: false, reportRecords: reportData });
        prepareChartsForPrint();
        chartGrid.insertBefore(printHeader, chartGrid.firstChild);

        // === 核彈級做法：把 chartGrid 搬到 body 下面，隱藏其他所有東西 ===
        const originalParent = chartGrid.parentElement;
        const originalNext = chartGrid.nextSibling;

        // 隱藏 body 下所有直接子元素
        const bodyChildren = [...document.body.children];
        bodyChildren.forEach(el => { el.dataset.printHidden = el.style.display; el.style.display = 'none'; });

        // 建立一個乾淨的列印容器，直接放到 body
        const printContainer = document.createElement('div');
        printContainer.id = 'printContainer';
        printContainer.style.cssText = 'display:block;width:100%;margin:0;padding:0;background:white;';
        printContainer.appendChild(chartGrid);
        document.body.appendChild(printContainer);

        // 列印完畢後還原
        window.onafterprint = () => {
            // 把 chartGrid 搬回原本的位置
            if (originalNext) {
                originalParent.insertBefore(chartGrid, originalNext);
            } else {
                originalParent.appendChild(chartGrid);
            }
            // 移除列印容器
            printHeader.remove();
            printContainer.remove();
            // 還原 body 子元素
            bodyChildren.forEach(el => {
                el.style.display = el.dataset.printHidden || '';
                delete el.dataset.printHidden;
            });
            window.onafterprint = null;
            if (currentViewMode() === 'chart') generateExhibitionDashboard();
        };

        // Trigger print
        window.print();
    }, 500);
}

