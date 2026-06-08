/* Global State */
let historyData = [];
let currentFilter = 'all';
let currentStudentFilter = 'all';
let currentTrainingFilter = 'all';
let sortDirection = 'asc';
let charts = {};
let selectedChartItems = new Set(); // Track selected items for chart view

/* UI Logic */
function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    if (!sb) return;
    sb.classList.toggle('expanded');
    document.getElementById('sidebarIcon').className = sb.classList.contains('expanded') ? 'fas fa-angles-left text-xl' : 'fas fa-angles-right text-xl';
    document.getElementById('sidebarBtnLabel').innerText = sb.classList.contains('expanded') ? '收合匯入區' : '開啟匯入區';
}

function toggleChartSelector() {
    const content = document.getElementById('chartSelectorContent');
    const icon = document.getElementById('chartSelectorIcon');
    if (!content || !icon) return;

    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.classList.remove('-rotate-90');
    } else {
        content.classList.add('hidden');
        icon.classList.add('-rotate-90');
    }
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
        updateFilterOptions();
        switchView(currentViewMode());
    }
}

function clearHistory() {
    if (confirm('確定要清空所有資料嗎？此動作無法復原。')) {
        historyData = [];
        updateFilterOptions();
        switchView('card');
    }
}

function generateExhibitionDashboard() {
    const grid = document.getElementById('chartGrid'); grid.innerHTML = '';
    Object.values(charts).forEach(c => { if (c) c.destroy(); }); charts = {};

    // Populate item selector
    populateChartItemSelector();

    // Get data filtered by both the main filters and the selected items
    const filtered = getFilteredData().filter(d => selectedChartItems.has(d.id));
    if (filtered.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-20 text-slate-400"><i class="fas fa-chart-pie text-6xl mb-4 opacity-30"></i><p class="text-lg font-bold">請先選擇要納入成果展的項目</p></div>';
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
            const skillData = sData.filter(d => d.type === type);
            if (skillData.length > 0) {
                const instGroups = {};
                skillData.forEach(d => {
                    const inst = d.instrumentType || '未分類儀器';
                    if (!instGroups[inst]) instGroups[inst] = [];
                    instGroups[inst].push(d);
                });
                
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

    const chartCards = grid.querySelectorAll('.chart-card');
    grid.className = (chartCards.length === 1) ? "grid grid-cols-1 gap-8" : "grid grid-cols-1 lg:grid-cols-2 gap-8";
}

function populateChartItemSelector() {
    const selector = document.getElementById('chartItemSelector');
    const instrumentBtns = document.getElementById('instrumentFilterBtns');
    const typeBtns = document.getElementById('typeFilterBtns');
    const studentBtns = document.getElementById('studentFilterBtns');
    if (!selector) return;

    const filtered = getFilteredData();
    if (filtered.length === 0) {
        selector.innerHTML = '<div class="text-slate-400 text-sm italic">請先匯入評量資料</div>';
        if (instrumentBtns) instrumentBtns.innerHTML = '';
        if (typeBtns) typeBtns.innerHTML = '';
        if (studentBtns) studentBtns.innerHTML = '';
        return;
    }

    // Initialize all items as selected if set is empty
    if (selectedChartItems.size === 0) {
        filtered.forEach(d => selectedChartItems.add(d.id));
    }

    // Extract unique categories - use instrumentType for instruments
    const instruments = [...new Set(filtered.map(d => d.instrumentType).filter(i => i && i.trim()))].sort();
    const types = [...new Set(filtered.map(d => d.type))].sort();
    const students = [...new Set(filtered.map(d => d.studentName))].sort();

    // Type colors
    const typeColors = {
        'DOPS': 'bg-purple-500 text-white',
        'Mini-CEX': 'bg-orange-500 text-white',
        'CbD': 'bg-emerald-500 text-white',
        'EPA': 'bg-blue-500 text-white',
        'Milestone': 'bg-teal-500 text-white',
        '實習總評量表': 'bg-teal-600 text-white',
        '筆試成績': 'bg-indigo-500 text-white',
        'Basic Course': 'bg-indigo-500 text-white',
        '問卷調查': 'bg-pink-500 text-white',
        'Unknown': 'bg-slate-400 text-white'
    };

    // Generate instrument filter buttons
    if (instrumentBtns) {
        instrumentBtns.innerHTML = instruments.length > 0 ? instruments.map(inst =>
            `<button onclick="selectByCategory('instrument', '${inst}')" class="text-[10px] px-2 py-0.5 rounded bg-cyan-100 hover:bg-cyan-200 text-cyan-700 font-bold transition">${inst}</button>`
        ).join('') : '<span class="text-slate-400 text-[10px]">無</span>';
    }

    // Generate type filter buttons
    if (typeBtns) {
        typeBtns.innerHTML = types.map(t => {
            const color = typeColors[t] || 'bg-slate-400 text-white';
            return `<button onclick="selectByCategory('type', '${t}')" class="text-[10px] px-2 py-0.5 rounded ${color} hover:opacity-80 font-bold transition">${t}</button>`;
        }).join('');
    }

    // Generate student filter buttons
    if (studentBtns) {
        studentBtns.innerHTML = students.map(s =>
            `<button onclick="selectByCategory('student', '${s}')" class="text-[10px] px-2 py-0.5 rounded bg-blue-100 hover:bg-blue-200 text-blue-700 font-bold transition">${s}</button>`
        ).join('');
    }

    // Generate item checkboxes
    selector.innerHTML = filtered.map(d => {
        const isSelected = selectedChartItems.has(d.id);
        const typeColor = typeColors[d.type] || typeColors['Unknown'];
        const instrumentLabel = d.instrumentType || '未分類';
        return `
            <label class="chart-item-checkbox ${isSelected ? 'selected' : ''}" onclick="toggleChartItem('${d.id}', this)">
                <span class="type-tag ${typeColor}">${d.type}</span>
                <span class="text-cyan-600">${instrumentLabel}</span>
                <span>${d.studentName}</span>
                <span class="text-slate-400">${d.date}</span>
            </label>
        `;
    }).join('');
}

function selectByCategory(category, value) {
    const filtered = getFilteredData();
    // Clear current selection
    selectedChartItems.clear();
    // Add items matching the category
    filtered.forEach(d => {
        if (category === 'instrument' && d.instrumentType === value) {
            selectedChartItems.add(d.id);
        } else if (category === 'type' && d.type === value) {
            selectedChartItems.add(d.id);
        } else if (category === 'student' && d.studentName === value) {
            selectedChartItems.add(d.id);
        }
    });
    generateExhibitionDashboard();
}

function toggleChartItem(id, element) {
    if (selectedChartItems.has(id)) {
        selectedChartItems.delete(id);
        element.classList.remove('selected');
    } else {
        selectedChartItems.add(id);
        element.classList.add('selected');
    }
    // Regenerate charts after selection change
    setTimeout(() => generateExhibitionDashboard(), 50);
}

function selectAllChartItems(selectAll) {
    const filtered = getFilteredData();
    if (selectAll) {
        filtered.forEach(d => selectedChartItems.add(d.id));
    } else {
        selectedChartItems.clear();
    }
    generateExhibitionDashboard();
}

function createChart(title, type, labels, datasets, scales) {
    const id = `chart_${Math.random().toString(36).substr(2, 9)}`;
    const card = document.createElement('div'); card.className = 'chart-card slide-up';
    card.innerHTML = `<div class="chart-card-inner"><h3 class="adaptive-title text-slate-800 mb-8 text-center font-black tracking-tighter">${title}</h3><div class="chart-canvas-wrap w-full"><canvas id="${id}"></canvas></div></div>`;
    document.getElementById('chartGrid').appendChild(card);
    const ctx = document.getElementById(id).getContext('2d');
    charts[id] = new Chart(ctx, {
        type,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            devicePixelRatio: 2,
            barPercentage: 0.5, // 讓長條圖變細
            categoryPercentage: 0.8,
            plugins: {
                legend: {
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
                    <span class="text-[10px] font-black px-3 py-1 rounded-lg ${d.type === 'EPA' ? 'bg-blue-600' : (d.type === 'Milestone' ? 'bg-teal-600' : (d.type === 'DOPS' ? 'bg-purple-600' : (d.type === 'CbD' ? 'bg-emerald-600' : (d.type === '筆試成績' ? 'bg-indigo-600' : (d.type === '問卷調查' ? 'bg-pink-500' : 'bg-orange-500')))))} text-white uppercase shadow-md font-bold tracking-widest">${d.type}</span>
                    <span class="text-sm text-slate-500 font-bold bg-slate-50 px-2 py-1 rounded border border-slate-100 shadow-inner tracking-tighter"><i class="far fa-calendar-check mr-1 text-teal-500"></i>${d.date}</span>
                    <span class="text-xs text-slate-400 font-black">【學員：${d.studentName}】</span>
                </div>
                <h3 class="adaptive-title text-slate-900 mb-3 leading-tight tracking-tighter font-black">${d.title}</h3>
                <div class="mb-4 inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-black border border-indigo-100 italic">
                    <i class="fas fa-user-tie"></i> 評量教師：${d.teacherName}
                </div>
                <div class="space-y-2">${d.details.join('')}</div>
            </div>
            <div class="flex flex-col justify-center items-end min-w-[140px] border-l-2 border-slate-50 pl-8">
                ${d.type === 'EPA' ? `<div class="flex flex-col gap-3">${[1, 2, 3].map(i => `<div class="border-2 rounded-2xl p-2 min-w-[110px] text-center shadow-sm ${getGradeStyle(d.opaScores[i])}"><span class="text-[10px] block uppercase opacity-80 mb-1 font-bold tracking-tighter font-black">OPA ${i}</span><span class="text-4xl font-black">${d.opaScores[i] || '?'}</span></div>`).join('')}</div>` : (['DOPS', 'Mini-CEX', 'CbD', '實習總評量表', '筆試成績', '問卷調查'].includes(d.type) ? `<div class="text-center"><div class="adaptive-score text-blue-700 font-mono drop-shadow-xl tracking-tighter font-black">${d.scoreRaw || '--'}</div><div class="adaptive-label text-slate-400 uppercase italic mt-4 tracking-widest font-black text-[11px]">Total Score</div></div>` : (d.type === 'Milestone' ? '<div class="text-xs font-black text-slate-300 uppercase italic">Level Based</div>' : ''))}
            </div></div>`).join('');
}

function generateCompareTables() {
    const container = document.getElementById('compareContainer');
    if (!container) return;
    container.innerHTML = "";
    const filtered = getFilteredData();
    const sorted = sortDataList([...filtered]); if (sorted.length === 0) return;

    let html = `<div class="mb-4 border-b-2 border-slate-900 pb-1 flex justify-between items-center"><h2 class="adaptive-title text-slate-900 uppercase italic tracking-tighter"><i class="fas fa-chart-line text-teal-500 mr-2"></i>學前 / 學中 / 學後 成長對照總表 (由遠而近)</h2></div>`;
    const getTeacherRow = (list) => `<tr><td class="font-black text-indigo-600 text-center text-xs tracking-tighter bg-indigo-50/50">評量教師</td>${list.map(d => `<td class="text-center font-black text-indigo-700 bg-indigo-50/20 text-xs">${d.teacherName}</td>`).join('')}</tr>`;
    const getStudentRow = (list) => `<tr><td class="font-black text-blue-600 text-center text-xs tracking-tighter bg-blue-50/50">受評學員</td>${list.map(d => `<td class="text-center font-black text-blue-700 bg-blue-50/20 text-xs">${d.studentName}</td>`).join('')}</tr>`;

    const msGroups = {}; sorted.filter(d => d.type === 'Milestone').forEach(d => { if (!msGroups[d.studentName]) msGroups[d.studentName] = []; msGroups[d.studentName].push(d); });
    for (let sName in msGroups) {
        html += `<div class="bg-white rounded-3xl p-4 shadow-xl mb-8 border border-slate-200 overflow-x-auto slide-up"><h3 class="text-xs font-black text-teal-600 mb-2 border-b border-teal-100 pb-1 w-fit uppercase font-black tracking-widest italic">Milestone 成長比對：${sName}</h3><table class="compare-table"><thead><tr><th class="text-slate-400 w-1/4 text-left font-black italic tracking-widest text-xs">指標 / 日期</th>${msGroups[sName].map(d => `<th class="font-black text-slate-800 bg-teal-50/50">${d.date}</th>`).join('')}</tr></thead><tbody class="adaptive-text font-black">`; html += getTeacherRow(msGroups[sName]); TARGET_MILESTONES.forEach(target => { html += `<tr><td class="font-bold text-slate-600 border-r border-slate-50 tracking-tighter text-xs">${target}</td>${msGroups[sName].map(d => `<td class="text-center"><span class="px-2 py-1 rounded font-black border ${getGradeStyle(d.milestoneLevels[target])}">${d.milestoneLevels[target] ? 'L' + d.milestoneLevels[target].toString().replace(/^L/i, '') : '-'}</span></td>`).join('')}</tr>`; }); html += `</tbody></table></div>`;
    }

    const skillData = sorted.filter(d => ['DOPS', 'Mini-CEX', 'CbD', '實習總評量表', '筆試成績', '問卷調查'].includes(d.type));
    const skillGroups = {}; skillData.forEach(d => { const gKey = `${d.studentName} | ${getSmartGroupName(d)}`; if (!skillGroups[gKey]) skillGroups[gKey] = []; skillGroups[gKey].push(d); });
    for (let gKey in skillGroups) {
        const info = gKey.split(' | ');
        html += `<div class="bg-white rounded-3xl p-4 shadow-xl mb-8 border border-slate-200 overflow-x-auto slide-up"><div class="flex items-center gap-2 mb-3 border-b border-slate-100 pb-1"><span class="text-[10px] font-black px-2 py-0.5 rounded bg-indigo-600 text-white uppercase italic shadow-sm tracking-tighter">同人進度比對</span><h3 class="text-sm font-black text-slate-800 tracking-tighter italic">學員：${info[0]} / 部位：${info[1]}</h3></div><table class="compare-table"><thead><tr><th class="w-1/6 text-slate-400 font-bold uppercase text-left tracking-tighter italic text-xs">對照項 / 日期</th>${skillGroups[gKey].map(d => `<th class="font-black text-slate-800 bg-slate-50">${d.date}<br><span class="text-[10px] opacity-60">(${d.type})</span></th>`).join('')}</tr></thead><tbody class="adaptive-text font-black text-slate-700">`;
        html += getStudentRow(skillGroups[gKey]); html += getTeacherRow(skillGroups[gKey]);
        html += `<tr><td class="font-black text-slate-400 text-xs tracking-tighter text-center italic">項目題目</td>${skillGroups[gKey].map(d => `<td class="font-bold text-slate-700 bg-slate-50/30 text-xs tracking-tight">${d.skillName}</td>`).join('')}</tr>`;
        html += `<tr><td class="font-black text-blue-600 italic text-center text-lg">總評分</td>${skillGroups[gKey].map(d => `<td class="text-center adaptive-score text-slate-800 font-mono tracking-tighter font-black">${d.scoreRaw}</td>`).join('')}</tr>`;
        html += `<tr><td class="font-black text-emerald-700 text-center tracking-tighter">表現良好</td>${skillGroups[gKey].map(d => `<td class="adaptive-feedback text-slate-700 font-bold min-w-[200px] bg-emerald-50/10 leading-snug">${d.feedbackGood || '-'}</td>`).join('')}</tr>`;
        html += `<tr><td class="font-black text-amber-700 text-center tracking-tighter">建議加強</td>${skillGroups[gKey].map(d => `<td class="adaptive-feedback text-slate-700 font-bold min-w-[200px] bg-amber-50/10 leading-snug">${d.feedbackNeeds || '-'}</td>`).join('')}</tr>`;
        html += `<tr><td class="font-black text-blue-700 text-center tracking-tighter italic">學員回饋</td>${skillGroups[gKey].map(d => `<td class="adaptive-feedback text-slate-700 font-black min-w-[200px] bg-blue-50/10 leading-snug">${d.studentFeedback || '-'}</td>`).join('')}</tr>`;
        html += `</tbody></table></div>`;
    }

    const epaData = sorted.filter(d => d.type === 'EPA');
    const epaGroups = {}; epaData.forEach(d => { const g = `${d.studentName} | ${getSmartGroupName(d)}`; if (!epaGroups[g]) epaGroups[g] = []; epaGroups[g].push(d); });
    for (let part in epaGroups) {
        const info = part.split(' | ');
        html += `<div class="bg-white rounded-3xl p-4 shadow-xl mb-8 border border-slate-200 overflow-x-auto slide-up"><h3 class="text-xs font-black text-blue-600 mb-2 border-b border-blue-100 pb-1 w-fit uppercase italic tracking-tighter font-black tracking-widest">EPA 信賴成長：${info[0]} (${info[1]})</h3><table class="compare-table"><thead><tr><th class="w-1/6 text-slate-400 italic text-left tracking-tighter uppercase italic text-xs">日期 / 指標</th>${epaGroups[part].map(d => `<th class="font-black text-slate-800 bg-blue-50/50">${d.date}</th>`).join('')}</tr></thead><tbody class="adaptive-text">`; html += getStudentRow(epaGroups[part]); html += getTeacherRow(epaGroups[part]);[1, 2, 3].forEach(i => { html += `<tr><td class="font-bold text-blue-500 border-t border-slate-50 pt-2 uppercase tracking-tighter font-black text-center text-xs">OPA ${i}</td>${epaGroups[part].map(d => `<td class="text-center pt-2 border-t border-slate-50"><span class="px-4 py-1.5 rounded-xl font-black text-2xl border-2 shadow-sm ${getGradeStyle(d.opaScores[i])}">${d.opaScores[i] || '-'}</span></td>`).join('')}</tr>`; html += `<tr><td class="text-xs font-black text-slate-400 border-none italic pb-2 text-center tracking-tighter">質性建議</td>${epaGroups[part].map(d => `<td class="adaptive-feedback text-slate-700 min-w-[200px] border-none pb-2 bg-slate-50/20 font-medium leading-tight">${d.opaFeedbacks[i] || '-'}</td>`).join('')}</tr>`; }); html += `</tbody></table></div>`;
    }
    container.innerHTML = html;
}

function setFilter(f) { currentFilter = f; document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active-filter')); const target = document.getElementById('f_' + f); if (target) target.classList.add('active-filter'); switchView(currentViewMode()); }
function setStudentFilter(val) { currentStudentFilter = val; switchView(currentViewMode()); }
function setTrainingFilter(val) { currentTrainingFilter = val; switchView(currentViewMode()); }
function toggleSort() { sortDirection = sortDirection === 'desc' ? 'asc' : 'desc'; const icon = document.getElementById('sortIcon'); if (icon) icon.className = `fas fa-sort-amount-${sortDirection === 'desc' ? 'down' : 'up'} text-teal-500`; const txt = document.getElementById('sortText'); if (txt) txt.innerText = `日期：${sortDirection === 'desc' ? '新到舊' : '舊到新'}`; switchView(currentViewMode()); }
function currentViewMode() { if (document.getElementById('cardModeBtn')?.classList.contains('mode-active')) return 'card'; if (document.getElementById('compareModeBtn')?.classList.contains('mode-active')) return 'compare'; return 'chart'; }
function sortDataList(list) { return list.sort((a, b) => sortDirection === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)); }

/* Initialization and Event Listeners */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => { if (dropZone) dropZone.addEventListener(e, (evt) => { evt.preventDefault(); evt.stopPropagation(); }, false); });
if (dropZone) dropZone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
if (dropZone) dropZone.onclick = () => fileInput.click();
if (fileInput) fileInput.onchange = (e) => handleFiles(e.target.files);

async function handleFiles(files) {
    if (!files || files.length === 0) return;
    document.getElementById('progressOverlay').classList.remove('hidden');
    try {
        for (let i = 0; i < files.length; i++) {
            // Only process CSV files
            if (!files[i].name.toLowerCase().endsWith('.csv')) continue;
            const text = await files[i].text();
            // Call analyzeCSV from parser.js
            const result = analyzeCSV(text);
            if (result) { if (Array.isArray(result)) historyData.push(...result); else historyData.push(result); }
        }
    } catch (e) { console.error('匯入錯誤:', e); alert('匯入時發生錯誤: ' + e.message); }
    document.getElementById('progressOverlay').classList.add('hidden');
    updateFilterOptions();
    switchView('card');
}

function updateFilterOptions() {
    const sSelect = document.getElementById('studentFilter');
    const tSelect = document.getElementById('trainingFilter');
    if (!sSelect || !tSelect) return;
    const students = [...new Set(historyData.map(d => d.studentName))].sort();
    const trainings = [...new Set(historyData.map(d => d.trainingType))].sort();
    sSelect.innerHTML = '<option value="all">所有學員</option>';
    students.forEach(s => { sSelect.innerHTML += `<option value="${s}" ${s === currentStudentFilter ? 'selected' : ''}>${s}</option>`; });
    tSelect.innerHTML = '<option value="all">所有訓練別</option>';
    trainings.forEach(t => { tSelect.innerHTML += `<option value="${t}" ${t === currentTrainingFilter ? 'selected' : ''}>${t}</option>`; });
}

function getFilteredData() {
    let data = currentFilter === 'all' ? historyData : historyData.filter(d => d.type === currentFilter);
    if (currentStudentFilter !== 'all') data = data.filter(d => d.studentName === currentStudentFilter);
    if (currentTrainingFilter !== 'all') data = data.filter(d => d.trainingType === currentTrainingFilter);
    return data;
}

function printAccreditationReport() {
    if (historyData.length === 0) {
        alert('目前沒有資料可列印，請先匯入評量表單');
        return;
    }

    // Switch to chart view to generate charts
    switchView('chart');

    // Wait for charts to render
    setTimeout(() => {
        const chartGrid = document.getElementById('chartGrid');
        if (!chartGrid) return;

        // Get student names for header
        const students = [...new Set(historyData.map(d => d.studentName))].sort();
        const studentNames = students.join('、') || '未知學員';
        // Calculate Training Period from data
        const filteredData = getFilteredData();
        const dates = filteredData.map(d => d.date).filter(d => d && d !== '1900-01-01');
        let trainingPeriod = '未提供';
        if (dates.length > 0) {
            const sortedDates = [...dates].sort();
            const firstDateStr = sortedDates[0];
            const lastDateStr = sortedDates[sortedDates.length - 1];

            // Start: 1st day of the earliest month
            const firstParts = firstDateStr.split('-');
            const startDate = `${firstParts[0]}年${parseInt(firstParts[1])}月01日`;

            // End: Last day of the latest month
            const lastParts = lastDateStr.split('-');
            const year = parseInt(lastParts[0]);
            const month = parseInt(lastParts[1]);
            const lastDay = new Date(year, month, 0).getDate(); // month is 1-indexed here, so new Date(Y, M, 0) gives last day of M
            const endDate = `${year}年${month}月${lastDay}日`;

            trainingPeriod = `${startDate} 至 ${endDate}`;
        }

        // 移除舊的 header / footer（避免重複）
        document.querySelectorAll('.print-header, .print-footer').forEach(el => el.remove());

        // 將封面頁插入 chartGrid 內作為第一個子元素
        const printHeader = document.createElement('div');
        printHeader.className = 'print-header chart-card';
        printHeader.innerHTML = `
            <div class="print-header-inner">
                <h1>醫事放射師PGY成果展示報告</h1>
                <p>受評學員：${studentNames}</p>
                <p>受訓時間：${trainingPeriod}</p>
                <p class="print-sub">本報告依據教學醫院評鑑基準產出，呈現學員能力成長軌跡</p>
                <p class="print-sub">評量展示助手 產出 | 本報告依據學員於受訓期間內之評量數據統計產出</p>
            </div>
        `;
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
            printContainer.remove();
            // 還原 body 子元素
            bodyChildren.forEach(el => {
                el.style.display = el.dataset.printHidden || '';
                delete el.dataset.printHidden;
            });
            window.onafterprint = null;
        };

        // Trigger print
        window.print();
    }, 500);
}

