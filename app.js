/* Global State */
let historyData = [];
let currentFilter = 'all';
let currentTrainingFilter = 'all';
let currentInstrumentFilter = 'all';
let sortDirection = 'asc';
let charts = {};
let selectedChartItems = new Set(); // Track selected items for chart view
let chartSelectionInitialized = false;
let importStatusTimer = null;

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

function renderSingleScoreGroups(studentName, type, records) {
    const groups = new Map();
    for (const record of records) {
        const detail = getSmartGroupName(record);
        const instrument = record.instrumentType || '';
        const key = JSON.stringify([detail, instrument]);
        if (!groups.has(key)) groups.set(key, { detail, instrument, records: [] });
        groups.get(key).records.push(record);
    }

    const rendered = new Set();
    for (const group of groups.values()) {
        // Keep the existing before/after displays for assessments with a stage label.
        if (group.records.some(record => /學前|學後|前測|後測/.test(record.title))) continue;
        const scores = [];
        for (const record of group.records) {
            const raw = String(record.scoreRaw ?? '').trim().replace(/\s*分$/, '');
            if (raw && Number.isFinite(Number(raw))) scores.push({ record, score: Number(raw) });
        }
        if (scores.length !== 1) continue;

        const { record, score } = scores[0];
        const date = record.date && record.date !== '1900-01-01' ? record.date : '日期未提供';
        const groupLabel = [...new Set([group.detail, group.instrument].filter(Boolean))].join('／');
        const title = escapeAssessmentText(`【${studentName}】${type} 評量分數${groupLabel ? ` - ${groupLabel}` : ''}`);
        const dataset = { label: '評量分數', data: [score], backgroundColor: '#0f766e', maxBarThickness: 68 };
        createChart(title, 'bar', [date], [dataset], {
            y: { min: Math.min(0, score), max: Math.max(100, score) }
        }, { singleScore: true });
        group.records.forEach(item => rendered.add(item));
    }
    return records.filter(record => !rendered.has(record));
}

/* UI Logic */
function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    if (!sb) return;
    sb.classList.toggle('expanded');
    document.getElementById('sidebarIcon').className = sb.classList.contains('expanded') ? 'fas fa-angles-left text-xl' : 'fas fa-angles-right text-xl';
    document.getElementById('sidebarBtnLabel').innerText = sb.classList.contains('expanded') ? '收合匯入區' : '開啟匯入區';
}

function switchView(mode) {
    const hCont = document.getElementById('historyContainer');
    const cCont = document.getElementById('compareContainer');
    const chartCont = document.getElementById('chartContainer');
    if (!hCont || !cCont || !chartCont) return;

    hCont.classList.add('hidden'); cCont.classList.add('hidden'); chartCont.classList.add('hidden');
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

function clearHistory() {
    if (confirm('確定要清空所有資料嗎？此動作無法復原。')) {
        historyData = [];
        selectedChartItems.clear();
        chartSelectionInitialized = false;
        currentFilter = 'all';
        currentTrainingFilter = currentInstrumentFilter = 'all';
        clearImportStatus();
        updateFilterOptions();
        document.getElementById('typeFilter').value = 'all';
        switchView('card');
    }
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
    document.getElementById('reportScopeCount').textContent =
        `符合 ${candidates.length} 筆 · 已納入報告 ${filtered.length} 筆`;
    document.getElementById('chartSelectorPanel').hidden = candidates.length === 0;

    if (!filtered.length) {
        const message = !historyData.length ? '請先匯入資料'
            : !candidates.length ? '沒有符合目前篩選條件的紀錄'
            : '目前篩選結果尚未納入報告';
        grid.innerHTML = `<p class="record-empty">${message}</p>`;
        return;
    }

    const studentGroups = {};
    filtered.forEach(d => {
        if (!studentGroups[d.studentName]) studentGroups[d.studentName] = [];
        studentGroups[d.studentName].push(d);
    });

    Object.keys(studentGroups).sort().forEach(sName => {
        // 強制依日期從舊到新排序，確保成長曲線與第幾次順序合理
        const sData = [...studentGroups[sName]].sort((a, b) => a.date.localeCompare(b.date));

        // 1. Milestone (按學員區分)
        const msData = sData.filter(d => d.type === 'Milestone');
        if (msData.length > 0) {
            const ds = msData.map((d, i) => {
                const getAvg = (indices) => {
                    const vals = indices.map(idx => parseFloat(d.milestoneLevels[TARGET_MILESTONES[idx]])).filter(v => !isNaN(v));
                    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 0;
                };
                const coreValues = [getAvg(CORE_MAP["醫學影像知識"]), getAvg(CORE_MAP["團隊溝通能力"]), getAvg(CORE_MAP["病人照護核心"]), parseFloat(d.milestoneLevels[TARGET_MILESTONES[9]]) || 0, getAvg(CORE_MAP["專業素養表現"])];
                return { label: `第 ${i + 1} 次`, data: coreValues, borderColor: CHART_COLORS[i % CHART_COLORS.length], backgroundColor: hexToRgba(CHART_COLORS[i % CHART_COLORS.length], 0.15), borderWidth: 2.5 };
            });
            createChart(`【${sName}】MILESTONE 核心能力成長分析`, 'radar', CORE_COMPETENCIES, ds, { r: { min: 0, max: 5, ticks: { stepSize: 1 } } });
        }

        // 2. EPA (各儀器每次的比較)
        const epaData = sData.filter(d => d.type === 'EPA');
        if (epaData.length > 0) {
            const instGroups = {};
            epaData.forEach(d => {
                const g = d.instrumentType || '未指定儀器';
                if (!instGroups[g]) instGroups[g] = [];
                instGroups[g].push(d);
            });

            // 2a. 依據各儀器繪製每次成績的雷達圖
            for (let k in instGroups) {
                const ds = instGroups[k].map((d, i) => ({
                    label: `第 ${i + 1} 次`,
                    data: [1, 2, 3].map(j => OPA_VALUE_MAP[d.opaScores[j]?.toUpperCase()] || 0),
                    borderColor: CHART_COLORS[i % CHART_COLORS.length],
                    backgroundColor: hexToRgba(CHART_COLORS[i % CHART_COLORS.length], 0.1),
                    borderWidth: 2
                }));
                createChart(`【${sName}】EPA 信賴能力分析 (各次對比) - ${k}`, 'radar', ["OPA 1", "OPA 2", "OPA 3"], ds, { r: { min: 0, max: 8, ticks: { callback: v => OPA_LABEL_MAP[Math.round(v)] || '', font: { weight: 'bold' } } } });
            }

            // 2b. 總 EPA 成績儀器互比 (取各儀器最後一次成績)
            const latestEpaPerInst = Object.keys(instGroups).map(inst => {
                // instGroups[inst] is sorted oldest to newest, so the last element is the latest
                return {
                    instName: inst,
                    latestData: instGroups[inst][instGroups[inst].length - 1]
                };
            });

            if (latestEpaPerInst.length > 0) {
                const ds = latestEpaPerInst.map((item, i) => ({
                    label: item.instName,
                    data: [1, 2, 3].map(j => OPA_VALUE_MAP[item.latestData.opaScores[j]?.toUpperCase()] || 0),
                    borderColor: CHART_COLORS[i % CHART_COLORS.length],
                    backgroundColor: hexToRgba(CHART_COLORS[i % CHART_COLORS.length], 0.15),
                    borderWidth: 2.5
                }));
                createChart(`【${sName}】總 EPA 信賴能力 (儀器最終成績互比)`, 'radar', ["OPA 1", "OPA 2", "OPA 3"], ds, { r: { min: 0, max: 8, ticks: { callback: v => OPA_LABEL_MAP[Math.round(v)] || '', font: { weight: 'bold' } } } });
            }
        }

        // 3. DOPS (按學員+儀器區分，儀器內的部位互比)
        const dopsData = sData.filter(d => d.type === 'DOPS');
        if (dopsData.length > 0) {
            const instGroups = {};
            dopsData.forEach(d => {
                const inst = d.instrumentType || '未分類儀器';
                if (!instGroups[inst]) instGroups[inst] = [];
                instGroups[inst].push(d);
            });
            for (let inst in instGroups) {
                const instData = instGroups[inst];
                const partGroups = {};
                instData.forEach(d => {
                    const part = getSmartGroupName(d);
                    // 為了避免折線圖出現「其他項目」這種無意義的孤立點，若是其他項目則略過不過濾畫線
                    if (part === "其他項目") return;

                    if (!partGroups[part]) partGroups[part] = [];
                    partGroups[part].push(d);
                });

                // 3a. 部位細項對照 (長條圖) - 模仿筆試邏輯
                if (Object.keys(partGroups).length > 0) {
                    const partNames = Object.keys(partGroups);
                    const maxAttempts = Math.max(...Object.values(partGroups).map(arr => arr.length));
                    const barDatasets = Array.from({ length: maxAttempts }, (_, i) => ({
                        label: `第 ${i + 1} 次`,
                        data: partNames.map(name => {
                            const item = partGroups[name][i];
                            return item ? parseFloat(item.scoreRaw) || 0 : null;
                        }),
                        backgroundColor: hexToRgba(CHART_COLORS[i % CHART_COLORS.length], 0.8),
                        borderColor: CHART_COLORS[i % CHART_COLORS.length],
                        borderWidth: 1,
                        borderRadius: 6,
                        maxBarThickness: 30
                    }));
                    createChart(`【${sName}】DOPS 部位細項成績分析 - ${inst}`, 'bar', partNames, barDatasets, { y: { min: 60, max: 100 } });
                }
            }
        }

        // 4. 其他項目 (Mini-CEX, CbD, 實習總評量表) (按學員+表單類型區分，細項/儀器互比)
        const otherSkillTypes = ['Mini-CEX', 'CbD', '實習總評量表'];
        otherSkillTypes.forEach(type => {
            const skillData = renderSingleScoreGroups(sName, type, sData.filter(d => d.type === type));
            if (skillData.length > 0) {
                // 嘗試提取更細的部位分組
                const detailGroups = {};
                skillData.forEach(d => {
                    const detail = getSmartGroupName(d);
                    if (!detailGroups[detail]) detailGroups[detail] = [];
                    detailGroups[detail].push(d);
                });

                // 4a. 成長曲線 (折線圖)
                const maxLen = Math.max(...Object.values(detailGroups).map(arr => arr.length));
                const labels = Array.from({ length: maxLen }, (_, i) => `第 ${i + 1} 次`);
                const datasets = Object.keys(detailGroups).map((detail, i) => ({
                    label: detail,
                    data: detailGroups[detail].map(d => parseFloat(d.scoreRaw) || 0),
                    borderColor: CHART_COLORS[i % CHART_COLORS.length],
                    tension: 0.1, fill: false, pointRadius: 6
                }));
                createChart(`【${sName}】${type} 成長曲線 (細項/儀器互比)`, 'line', labels, datasets, { y: { min: 60, max: 100 } });

                // 4b. 細項對照 (長條圖)
                const detailNames = Object.keys(detailGroups);
                const maxAt = Math.max(...Object.values(detailGroups).map(arr => arr.length));
                const barDs = Array.from({ length: maxAt }, (_, i) => ({
                    label: `第 ${i + 1} 次`,
                    data: detailNames.map(name => {
                        const item = detailGroups[name][i];
                        return item ? parseFloat(item.scoreRaw) || 0 : null;
                    }),
                    backgroundColor: hexToRgba(CHART_COLORS[i % CHART_COLORS.length], 0.8),
                    borderColor: CHART_COLORS[i % CHART_COLORS.length],
                    borderWidth: 1,
                    borderRadius: 6,
                    maxBarThickness: 30
                }));
                createChart(`【${sName}】${type} 細項成績分析對照`, 'bar', detailNames, barDs, { y: { min: 60, max: 100 } });
            }
        });

        // 4.5 筆試成績 (按學員+儀器區分) - 使用 學前 / 學後 階段對比
        const examData = sData.filter(d => d.type === '筆試成績' && d.instrumentType !== '基礎課程');
        if (examData.length > 0) {
            const instStageMap = {};
            const stages = ['學前', '學後'];

            examData.forEach(d => {
                // 規範化儀器名稱 (學前總評估 / 學後總評估 -> 總評估)
                let inst = d.instrumentType || '未分類儀器';
                if (inst.includes('總評估')) inst = '總評估';

                if (!instStageMap[inst]) instStageMap[inst] = { '學前': null, '學後': null };

                // 根據標題或儀器別判斷階段
                if (d.title.includes('學前') || d.instrumentType.includes('學前')) {
                    instStageMap[inst]['學前'] = parseFloat(d.scoreRaw);
                } else if (d.title.includes('學後') || d.instrumentType.includes('學後')) {
                    instStageMap[inst]['學後'] = parseFloat(d.scoreRaw);
                }
            });

            const instruments = Object.keys(instStageMap);
            const datasets = [
                {
                    label: '學前',
                    data: instruments.map(inst => instStageMap[inst]['學前']),
                    backgroundColor: CHART_COLORS[0], // Indigo
                    borderColor: CHART_COLORS[0],
                    borderWidth: 1,
                    borderRadius: 6,
                    maxBarThickness: 30
                },
                {
                    label: '學後',
                    data: instruments.map(inst => instStageMap[inst]['學後']),
                    backgroundColor: CHART_COLORS[1], // Emerald
                    borderColor: CHART_COLORS[1],
                    borderWidth: 1,
                    borderRadius: 6,
                    maxBarThickness: 30
                }
            ];

            createChart(`【${sName}】筆試成績：學前 vs 學後 階段對照`, 'bar', instruments, datasets, { y: { min: 60, max: 100 } });
        }

        // 4.6 基礎課程細項分析 (特別針對筆試成績中的基礎課程)
        const basicCourseData = sData.filter(d => d.type === '筆試成績' && d.instrumentType === '基礎課程');
        if (basicCourseData.length > 0) {
            // 按課程名稱分組 (例如：醫事放射相關法規, 輻射防護與輻射安全)
            const courseGroups = {};
            basicCourseData.forEach(d => {
                // 移除「基礎課程：」前綴以及後面的「-2」等次數標記
                const courseName = d.title.replace(/^基礎課程[：:]\s*/, '').replace(/-\d+$/, '').trim();
                if (!courseGroups[courseName]) courseGroups[courseName] = [];
                courseGroups[courseName].push(d);
            });

            const labels = Object.keys(courseGroups);
            const maxAttempts = Math.max(...Object.values(courseGroups).map(arr => arr.length));
            
            const datasets = Array.from({ length: maxAttempts }, (_, i) => ({
                label: `第 ${i + 1} 次`,
                data: labels.map(name => {
                    const item = courseGroups[name][i];
                    return item ? parseFloat(item.scoreRaw) || 0 : null;
                }),
                backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                borderColor: CHART_COLORS[i % CHART_COLORS.length],
                borderWidth: 1,
                borderRadius: 4,
                maxBarThickness: 40
            }));

            createChart(`【${sName}】基礎課程細項成績分析`, 'bar', labels, datasets, { y: { min: 60, max: 100 } });
        }

        // 4.7 學習滿意度調查 (按學員+儀器區分，以日期排序呈現長條圖)
        const surveyData = sData.filter(d => d.type === '問卷調查');
        if (surveyData.length > 0) {
            const instGroups = {};
            surveyData.forEach(d => {
                const inst = d.instrumentType || '未分類儀器';
                if (!instGroups[inst]) instGroups[inst] = [];
                instGroups[inst].push(d);
            });
            for (let inst in instGroups) {
                const sorted = instGroups[inst].sort((a, b) => a.date.localeCompare(b.date));
                const labels = sorted.map(d => d.date);
                const datasets = [{
                    label: '滿意度分數',
                    data: sorted.map(d => parseFloat(d.scoreRaw) || 0),
                    backgroundColor: hexToRgba('#ec4899', 0.7),
                    borderColor: '#ec4899',
                    borderWidth: 1,
                    borderRadius: 6,
                    maxBarThickness: 30
                }];
                createChart(`【${sName}】學習滿意度調查成績 - ${inst}`, 'bar', labels, datasets, { y: { min: 70, max: 100 } });
            }
        }

        // 5. 學前/學後 階段對比 (按評量類型分別做儀器互比)
        // 只抓有「學前」或「學後」標記的表單（學中已有部位/儀器內部對比）
        const stageTypes = ['DOPS', 'Mini-CEX', 'CbD', '實習總評量表'];
        stageTypes.forEach(stageType => {
            const stageData = sData.filter(d => d.type === stageType && (d.title.includes('學前') || d.title.includes('學後')));
            if (stageData.length === 0) return;

            // 按儀器分組，每個儀器算出學前平均、學後平均
            const instStageMap = {};
            let hasPre = false, hasPost = false;

            stageData.forEach(d => {
                const inst = d.instrumentType || '未分類儀器';
                if (!instStageMap[inst]) instStageMap[inst] = { preScores: [], postScores: [] };

                const score = parseFloat(d.scoreRaw);
                if (!isNaN(score)) {
                    if (d.title.includes('學前')) { instStageMap[inst].preScores.push(score); hasPre = true; }
                    else if (d.title.includes('學後')) { instStageMap[inst].postScores.push(score); hasPost = true; }
                }
            });

            const stages = [];
            if (hasPre) stages.push('學前');
            if (hasPost) stages.push('學後');

            if (stages.length > 0) {
                const instruments = Object.keys(instStageMap);
                const datasets = instruments.map((inst, i) => {
                    const avg = arr => arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
                    const data = [];
                    if (hasPre) data.push(avg(instStageMap[inst].preScores));
                    if (hasPost) data.push(avg(instStageMap[inst].postScores));

                    return {
                        label: inst,
                        data: data,
                        backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                        borderColor: CHART_COLORS[i % CHART_COLORS.length],
                        borderWidth: 1,
                        borderRadius: 4
                    };
                });

                createChart(`【${sName}】${stageType} 學前 / 學後 階段對比 (儀器互比)`, 'bar', stages, datasets, { y: { min: 60, max: 100 } });
            }
        });
    });

    // 4.8 全部問卷總覽 (所有學員一起排列)
    const allSurveyData = filtered.filter(d => d.type === '問卷調查').sort((a, b) => a.date.localeCompare(b.date));
    if (allSurveyData.length > 0) {
        const labels = allSurveyData.map(d => `${d.date} ${d.studentName}${d.instrumentType ? ' (' + d.instrumentType + ')' : ''}`);
        const datasets = [{
            label: '滿意度分數',
            data: allSurveyData.map(d => parseFloat(d.scoreRaw) || 0),
            backgroundColor: allSurveyData.map((d, i) => hexToRgba(CHART_COLORS[i % CHART_COLORS.length], 0.7)),
            borderColor: allSurveyData.map((d, i) => CHART_COLORS[i % CHART_COLORS.length]),
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 25
        }];
        createChart('全部學員學習滿意度調查總覽 (依日期排列)', 'bar', labels, datasets, { y: { min: 70, max: 100 } });
    }

    // Preserve selected records that do not have a quantitative chart.
    const chartTypes = new Set(['Milestone', 'EPA', 'DOPS', 'Mini-CEX', 'CbD', '筆試成績', '問卷調查']);
    filtered.filter(d => !chartTypes.has(d.type))
        .sort((a, b) => a.date.localeCompare(b.date))
        .forEach(createRecordSummary);

    const chartCards = grid.querySelectorAll('.chart-card');
    grid.className = (chartCards.length === 1) ? "grid grid-cols-1 gap-8" : "grid grid-cols-1 lg:grid-cols-2 gap-8";
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

const singleScoreLabel = {
    id: 'singleScoreLabel',
    afterDatasetsDraw(chart) {
        const bar = chart.getDatasetMeta(0).data[0];
        if (!bar) return;
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = '700 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#1e293b';
        ctx.fillText(String(chart.data.datasets[0].data[0]), bar.x, Math.min(bar.y, bar.base) - 6);
        ctx.restore();
    }
};

function createChart(title, type, labels, datasets, scales, { singleScore = false } = {}) {
    const id = `chart_${Math.random().toString(36).substr(2, 9)}`;
    const card = document.createElement('div'); card.className = singleScore ? 'chart-card single-score-chart' : 'chart-card slide-up';
    card.innerHTML = `<div class="chart-card-inner"><h3 class="adaptive-title text-slate-800 mb-8 text-center font-black tracking-tighter">${escapeAssessmentText(title)}</h3><div class="chart-canvas-wrap w-full"><canvas id="${id}"></canvas></div></div>`;
    document.getElementById('chartGrid').appendChild(card);
    const ctx = document.getElementById(id).getContext('2d');
    charts[id] = new Chart(ctx, {
        type,
        data: { labels, datasets },
        ...(singleScore ? { plugins: [singleScoreLabel] } : {}),
        options: {
            responsive: true,
            maintainAspectRatio: false,
            devicePixelRatio: 2,
            barPercentage: 0.5, // 讓長條圖變細
            categoryPercentage: 0.8,
            ...(singleScore ? { animation: false, layout: { padding: { top: 26 } } } : {}),
            plugins: {
                legend: {
                    ...(singleScore ? { display: false } : {}),
                    position: 'bottom',
                    labels: { font: { size: 8, weight: 'bold' }, padding: 6, boxWidth: 8 },
                    maxHeight: 40
                }
            },
            scales: scales ? Object.fromEntries(
                Object.entries(scales).map(([key, val]) => [key, {
                    ...val,
                    ticks: { ...val.ticks, font: { size: 11, weight: 'bold' } },
                    pointLabels: { font: { size: 11, weight: 'bold' } }
                }])
            ) : {}
        }
    });
}

function renderCards() {
    const container = document.getElementById('historyContainer');
    if (!container) return;
    let filtered = getFilteredData();
    filtered.sort((a, b) => sortDirection === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
    if (filtered.length === 0) { container.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-slate-200 opacity-40 text-center"><i class="fas fa-layer-group text-[12rem] mb-10 text-slate-100"></i><p class="text-3xl font-black uppercase tracking-widest">目前無符合條件資料</p></div>`; return; }
    container.innerHTML = filtered.map(d => `<div class="bg-white rounded-3xl p-8 mb-6 shadow-xl border border-slate-200 flex justify-between gap-8 slide-up relative group">
            <button onclick="deleteItem('${d.id}')" class="absolute top-4 right-4 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all text-xl"><i class="fas fa-circle-xmark"></i></button>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-4 mb-3">
                    <span class="text-[10px] font-black px-3 py-1 rounded-lg ${d.type === 'EPA' ? 'bg-blue-600' : (d.type === 'Milestone' ? 'bg-teal-600' : (d.type === 'DOPS' ? 'bg-purple-600' : (d.type === 'CbD' ? 'bg-emerald-600' : (d.type === '筆試成績' ? 'bg-indigo-600' : (d.type === '問卷調查' ? 'bg-pink-500' : 'bg-orange-500')))))} text-white uppercase shadow-md font-bold tracking-widest">${escapeAssessmentText(d.type)}</span>
                    <span class="text-sm text-slate-500 font-bold bg-slate-50 px-2 py-1 rounded border border-slate-100 shadow-inner tracking-tighter"><i class="far fa-calendar-check mr-1 text-teal-500"></i>${escapeAssessmentText(d.date)}</span>
                    <span class="text-xs text-slate-400 font-black">【學員：${escapeAssessmentText(d.studentName)}】</span>
                </div>
                <h3 class="adaptive-title text-slate-900 mb-3 leading-tight tracking-tighter font-black">${escapeAssessmentText(d.title)}</h3>
                <div class="mb-4 inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-black border border-indigo-100 italic">
                    <i class="fas fa-user-tie"></i> 評量教師：${escapeAssessmentText(d.teacherName)}
                </div>
                <div class="space-y-2">${d.details.join('')}</div>
            </div>
            <div class="flex flex-col justify-center items-end min-w-[140px] border-l-2 border-slate-50 pl-8">
                ${d.type === 'EPA' ? `<div class="flex flex-col gap-3">${[1, 2, 3].map(i => `<div class="border-2 rounded-2xl p-2 min-w-[110px] text-center shadow-sm ${getGradeStyle(d.opaScores[i])}"><span class="text-[10px] block uppercase opacity-80 mb-1 font-bold tracking-tighter font-black">OPA ${i}</span><span class="text-4xl font-black">${escapeAssessmentText(d.opaScores[i] || '?')}</span></div>`).join('')}</div>` : (['DOPS', 'Mini-CEX', 'CbD', '實習總評量表', '筆試成績', '問卷調查'].includes(d.type) ? `<div class="text-center"><div class="adaptive-score text-blue-700 font-mono drop-shadow-xl tracking-tighter font-black">${escapeAssessmentText(d.scoreRaw || '--')}</div><div class="adaptive-label text-slate-400 uppercase italic mt-4 tracking-widest font-black text-[11px]">Total Score</div></div>` : (d.type === 'Milestone' ? '<div class="text-xs font-black text-slate-300 uppercase italic">Level Based</div>' : ''))}
            </div></div>`).join('');
}

function generateCompareTables() {
    const container = document.getElementById('compareContainer');
    if (!container) return;
    container.innerHTML = "";
    const filtered = getFilteredData();
    const sorted = sortDataList([...filtered]); if (sorted.length === 0) return;

    let html = `<div class="mb-4 border-b-2 border-slate-900 pb-1 flex justify-between items-center"><h2 class="adaptive-title text-slate-900 uppercase italic tracking-tighter"><i class="fas fa-chart-line text-teal-500 mr-2"></i>學前 / 學中 / 學後 成長對照總表 (由遠而近)</h2></div>`;
    const getTeacherRow = (list) => `<tr><td class="font-black text-indigo-600 text-center text-xs tracking-tighter bg-indigo-50/50">評量教師</td>${list.map(d => `<td class="text-center font-black text-indigo-700 bg-indigo-50/20 text-xs">${escapeAssessmentText(d.teacherName)}</td>`).join('')}</tr>`;
    const getStudentRow = (list) => `<tr><td class="font-black text-blue-600 text-center text-xs tracking-tighter bg-blue-50/50">受評學員</td>${list.map(d => `<td class="text-center font-black text-blue-700 bg-blue-50/20 text-xs">${escapeAssessmentText(d.studentName)}</td>`).join('')}</tr>`;

    const msGroups = {}; sorted.filter(d => d.type === 'Milestone').forEach(d => { if (!msGroups[d.studentName]) msGroups[d.studentName] = []; msGroups[d.studentName].push(d); });
    for (let sName in msGroups) {
        html += `<div class="bg-white rounded-3xl p-4 shadow-xl mb-8 border border-slate-200 overflow-x-auto slide-up"><h3 class="text-xs font-black text-teal-600 mb-2 border-b border-teal-100 pb-1 w-fit uppercase font-black tracking-widest italic">Milestone 成長比對：${escapeAssessmentText(sName)}</h3><table class="compare-table"><thead><tr><th class="text-slate-400 w-1/4 text-left font-black italic tracking-widest text-xs">指標 / 日期</th>${msGroups[sName].map(d => `<th class="font-black text-slate-800 bg-teal-50/50">${escapeAssessmentText(d.date)}</th>`).join('')}</tr></thead><tbody class="adaptive-text font-black">`; html += getTeacherRow(msGroups[sName]); TARGET_MILESTONES.forEach(target => { html += `<tr><td class="font-bold text-slate-600 border-r border-slate-50 tracking-tighter text-xs">${target}</td>${msGroups[sName].map(d => `<td class="text-center"><span class="px-2 py-1 rounded font-black border ${getGradeStyle(d.milestoneLevels[target])}">${escapeAssessmentText(d.milestoneLevels[target] ? 'L' + d.milestoneLevels[target].toString().replace(/^L/i, '') : '-')}</span></td>`).join('')}</tr>`; }); html += `</tbody></table></div>`;
    }

    const skillData = sorted.filter(d => ['DOPS', 'Mini-CEX', 'CbD', '實習總評量表', '筆試成績', '問卷調查'].includes(d.type));
    const skillGroups = {}; skillData.forEach(d => { const gKey = `${escapeAssessmentText(d.studentName)} | ${getSmartGroupName(d)}`; if (!skillGroups[gKey]) skillGroups[gKey] = []; skillGroups[gKey].push(d); });
    for (let gKey in skillGroups) {
        const info = gKey.split(' | ');
        html += `<div class="bg-white rounded-3xl p-4 shadow-xl mb-8 border border-slate-200 overflow-x-auto slide-up"><div class="flex items-center gap-2 mb-3 border-b border-slate-100 pb-1"><span class="text-[10px] font-black px-2 py-0.5 rounded bg-indigo-600 text-white uppercase italic shadow-sm tracking-tighter">同人進度比對</span><h3 class="text-sm font-black text-slate-800 tracking-tighter italic">學員：${escapeAssessmentText(info[0])} / 部位：${escapeAssessmentText(info[1])}</h3></div><table class="compare-table"><thead><tr><th class="w-1/6 text-slate-400 font-bold uppercase text-left tracking-tighter italic text-xs">對照項 / 日期</th>${skillGroups[gKey].map(d => `<th class="font-black text-slate-800 bg-slate-50">${escapeAssessmentText(d.date)}<br><span class="text-[10px] opacity-60">(${escapeAssessmentText(d.type)})</span></th>`).join('')}</tr></thead><tbody class="adaptive-text font-black text-slate-700">`;
        html += getStudentRow(skillGroups[gKey]); html += getTeacherRow(skillGroups[gKey]);
        html += `<tr><td class="font-black text-slate-400 text-xs tracking-tighter text-center italic">項目題目</td>${skillGroups[gKey].map(d => `<td class="font-bold text-slate-700 bg-slate-50/30 text-xs tracking-tight">${escapeAssessmentText(d.skillName)}</td>`).join('')}</tr>`;
        html += `<tr><td class="font-black text-blue-600 italic text-center text-lg">總評分</td>${skillGroups[gKey].map(d => `<td class="text-center adaptive-score text-slate-800 font-mono tracking-tighter font-black">${escapeAssessmentText(d.scoreRaw)}</td>`).join('')}</tr>`;
        html += `<tr><td class="font-black text-emerald-700 text-center tracking-tighter">表現良好</td>${skillGroups[gKey].map(d => `<td class="adaptive-feedback text-slate-700 font-bold min-w-[200px] bg-emerald-50/10 leading-snug">${escapeAssessmentText(d.feedbackGood || '-')}</td>`).join('')}</tr>`;
        html += `<tr><td class="font-black text-amber-700 text-center tracking-tighter">建議加強</td>${skillGroups[gKey].map(d => `<td class="adaptive-feedback text-slate-700 font-bold min-w-[200px] bg-amber-50/10 leading-snug">${escapeAssessmentText(d.feedbackNeeds || '-')}</td>`).join('')}</tr>`;
        html += `<tr><td class="font-black text-blue-700 text-center tracking-tighter italic">學員回饋</td>${skillGroups[gKey].map(d => `<td class="adaptive-feedback text-slate-700 font-black min-w-[200px] bg-blue-50/10 leading-snug">${escapeAssessmentText(d.studentFeedback || '-')}</td>`).join('')}</tr>`;
        html += `</tbody></table></div>`;
    }

    const epaData = sorted.filter(d => d.type === 'EPA');
    const epaGroups = {}; epaData.forEach(d => { const g = `${escapeAssessmentText(d.studentName)} | ${getSmartGroupName(d)}`; if (!epaGroups[g]) epaGroups[g] = []; epaGroups[g].push(d); });
    for (let part in epaGroups) {
        const info = part.split(' | ');
        html += `<div class="bg-white rounded-3xl p-4 shadow-xl mb-8 border border-slate-200 overflow-x-auto slide-up"><h3 class="text-xs font-black text-blue-600 mb-2 border-b border-blue-100 pb-1 w-fit uppercase italic tracking-tighter font-black tracking-widest">EPA 信賴成長：${escapeAssessmentText(info[0])} (${escapeAssessmentText(info[1])})</h3><table class="compare-table"><thead><tr><th class="w-1/6 text-slate-400 italic text-left tracking-tighter uppercase italic text-xs">日期 / 指標</th>${epaGroups[part].map(d => `<th class="font-black text-slate-800 bg-blue-50/50">${escapeAssessmentText(d.date)}</th>`).join('')}</tr></thead><tbody class="adaptive-text">`; html += getStudentRow(epaGroups[part]); html += getTeacherRow(epaGroups[part]);[1, 2, 3].forEach(i => { html += `<tr><td class="font-bold text-blue-500 border-t border-slate-50 pt-2 uppercase tracking-tighter font-black text-center text-xs">OPA ${i}</td>${epaGroups[part].map(d => `<td class="text-center pt-2 border-t border-slate-50"><span class="px-4 py-1.5 rounded-xl font-black text-2xl border-2 shadow-sm ${getGradeStyle(d.opaScores[i])}">${escapeAssessmentText(d.opaScores[i] || '-')}</span></td>`).join('')}</tr>`; html += `<tr><td class="text-xs font-black text-slate-400 border-none italic pb-2 text-center tracking-tighter">質性建議</td>${epaGroups[part].map(d => `<td class="adaptive-feedback text-slate-700 min-w-[200px] border-none pb-2 bg-slate-50/20 font-medium leading-tight">${escapeAssessmentText(d.opaFeedbacks[i] || '-')}</td>`).join('')}</tr>`; }); html += `</tbody></table></div>`;
    }
    container.innerHTML = html;
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

function toggleSort() { sortDirection = sortDirection === 'desc' ? 'asc' : 'desc'; const icon = document.getElementById('sortIcon'); if (icon) icon.className = `fas fa-sort-amount-${sortDirection === 'desc' ? 'down' : 'up'} text-teal-500`; const txt = document.getElementById('sortText'); if (txt) txt.innerText = `日期：${sortDirection === 'desc' ? '新到舊' : '舊到新'}`; switchView(currentViewMode()); }
function currentViewMode() { if (document.getElementById('cardModeBtn')?.classList.contains('mode-active')) return 'card'; if (document.getElementById('compareModeBtn')?.classList.contains('mode-active')) return 'compare'; return 'chart'; }
function sortDataList(list) {
    return list.sort((a, b) => {
        const order = String(a.date ?? '').localeCompare(String(b.date ?? ''));
        return sortDirection === 'desc' ? -order : order;
    });
}

/* Initialization and Event Listeners */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const folderImportInput = document.getElementById('folderImportInput');
const chooseImportFolder = document.getElementById('chooseImportFolder');
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
        await handleFiles(files);
    });
}

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
    dropZone?.addEventListener(name, event => {
        event.preventDefault();
        event.stopPropagation();
    });
});
dropZone?.addEventListener('drop', event => {
    queuePortfolioImport(() => readPortfolioDrop(event.dataTransfer), '拖放項目中沒有可讀取的 HTML 或 CSV');
});
if (dropZone && fileInput) dropZone.onclick = () => fileInput.click();
fileInput?.addEventListener('change', () => {
    const files = Array.from(fileInput.files);
    fileInput.value = '';
    queuePortfolioImport(() => files);
});
chooseImportFolder?.addEventListener('click', () => folderImportInput?.click());
folderImportInput?.addEventListener('change', () => {
    const files = Array.from(folderImportInput.files);
    const supported = files.filter(file => PORTFOLIO_FILE_EXTENSION.test(file.name));
    const folderName = files[0]?.webkitRelativePath.split('/')[0] || '選取的資料夾';
    folderImportInput.value = '';
    queuePortfolioImport(() => supported, folderName);
});

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
    return data;
}

function createRecordSummary(item) {
    const card = document.createElement('section');
    card.className = 'chart-card record-summary';
    card.dataset.recordId = item.id;
    const fields = [
        ['學員', item.studentName], ['評量日期', item.date],
        ['教師／主持人', item.teacherName], ['訓練別', item.trainingType],
        ['分數／結果', item.scoreRaw || '未提供'], ['各站成績', item.stationDetails],
        ['表現良好項目', item.feedbackGood], ['建議加強項目', item.feedbackNeeds],
        ['學員回饋／紀錄內容', item.studentFeedback]
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

    switchView('chart');

    // Wait for charts to render
    setTimeout(async () => {
        if (document.getElementById('printContainer')) return;
        const chartGrid = document.getElementById('chartGrid');
        if (!chartGrid) return;

        const report = getReportMetadata(reportData);

        // 移除舊的 header / footer（避免重複）
        document.querySelectorAll('.print-header, .print-footer').forEach(el => el.remove());

        // 將封面頁插入 chartGrid 內作為第一個子元素
        const printHeader = document.createElement('div');
        printHeader.className = 'print-header chart-card';
        printHeader.innerHTML = `
            <div class="print-header-inner">
                <img class="print-logo" src="logo.png" alt="輔仁大學附設醫院">
                <h1>${escapeAssessmentText(report.title)}</h1>
                <p>受評學員：${escapeAssessmentText(report.studentNames)}</p>
                <p>評量資料涵蓋期間：${escapeAssessmentText(report.period)}</p>
                <p>納入紀錄：${report.count} 筆</p>
                <p class="print-sub">評量展示助手 產出 | 本報告依目前篩選及勾選的評量紀錄產出</p>
            </div>
        `;

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
        for (const chart of Object.values(charts)) {
            chart.stop();
            chart.update('none');
        }
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

