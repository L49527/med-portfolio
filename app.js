/* Global State */
let historyData = [];
let currentFilter = 'all';
let currentStudentFilter = 'all';
let currentTrainingFilter = 'all';
let sortDirection = 'asc';
let charts = {};
let adminCharts = {};
let isAdminMode = false;
let selectedChartItems = new Set(); // Track selected items for chart view

/* UI Logic */
function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    if (!sb) return;
    sb.classList.toggle('expanded');
    document.getElementById('sidebarIcon').className = sb.classList.contains('expanded') ? 'fas fa-angles-left text-xl' : 'fas fa-angles-right text-xl';
    document.getElementById('sidebarBtnLabel').innerText = sb.classList.contains('expanded') ? '收合匯入區' : '開啟匯入區';
}

function switchView(mode) {
    if (isAdminMode) toggleAdminMode(); // Force exit admin
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

/* --- Admin Mode Logic --- */
function toggleAdminMode() {
    isAdminMode = !isAdminMode;
    const app = document.getElementById('appContainer');
    const admin = document.getElementById('adminDashboard');
    const btn = document.getElementById('adminBtn');
    const normalBtns = document.getElementById('normalModeBtns');

    if (isAdminMode) {
        app.classList.add('hidden');
        admin.classList.remove('hidden');
        btn.classList.add('bg-orange-500', 'border-orange-400');
        btn.classList.remove('bg-slate-700');
        // Removed button text update logic
        normalBtns.classList.add('opacity-30', 'pointer-events-none');
        generateAdminDashboard();
    } else {
        app.classList.remove('hidden');
        admin.classList.add('hidden');
        btn.classList.remove('bg-orange-500', 'border-orange-400');
        btn.classList.add('bg-slate-700');
        normalBtns.classList.remove('opacity-30', 'pointer-events-none');
    }
}

function generateAdminDashboard() {
    if (historyData.length === 0) return;
    renderFeedbackAudit();
    renderCorrelationChart();
    renderTeacherStats();
}

function renderFeedbackAudit() {
    const tbody = document.getElementById('feedbackAuditBody');
    tbody.innerHTML = '';

    // Filter only items with potential feedback fields
    const feedbackData = historyData.filter(d => ['DOPS', 'Mini-CEX', 'CbD', '實習總評量表'].includes(d.type));
    const studentFeedbackHistory = {}; // To check for duplicates

    feedbackData.forEach(d => {
        const tr = document.createElement('tr');

        // Clean text for analysis
        const cleanGood = (d.feedbackGood || '').replace(/<[^>]*>?/gm, '').trim();
        const cleanNeeds = (d.feedbackNeeds || '').replace(/<[^>]*>?/gm, '').trim();
        const cleanFeedback = (d.studentFeedback || '').replace(/<[^>]*>?/gm, '').trim();

        // Check Student Quality
        let sQuality = 1; // 1:OK, 0:Bad
        let sMsg = "";
        let isDuplicate = false;

        if (cleanFeedback.length > 0) {
            if (studentFeedbackHistory[d.studentName] && studentFeedbackHistory[d.studentName].includes(cleanFeedback)) isDuplicate = true;
            if (!studentFeedbackHistory[d.studentName]) studentFeedbackHistory[d.studentName] = [];
            studentFeedbackHistory[d.studentName].push(cleanFeedback);
        }

        if (cleanFeedback.length < 6 || ["無", "沒有", "謝謝", "謝謝老師", "good", "ok"].includes(cleanFeedback.toLowerCase())) {
            sQuality = 0; sMsg = "學員敷衍";
        } else if (isDuplicate) {
            sQuality = 0; sMsg = "學員複製";
        }

        // Check Teacher Quality
        let tQuality = 1; // 1:OK, 0:Bad
        let tMsg = "";
        if (cleanNeeds.length < 4 || ["無", "沒有", "none", "good", "ok"].includes(cleanNeeds.toLowerCase())) {
            tQuality = 0; tMsg = "教師評語過短";
        }

        // Build Status Badge
        let statusHtml = '';
        if (sQuality === 1 && tQuality === 1) statusHtml = '<span class="tag-badge bg-green-500/20 text-green-400">雙方優良</span>';
        else {
            if (tQuality === 0) statusHtml += `<div class="tag-badge bg-red-500/20 text-red-400 mb-1">⚠️ ${tMsg}</div>`;
            if (sQuality === 0) statusHtml += `<div class="tag-badge bg-orange-500/20 text-orange-400">⚠️ ${sMsg}</div>`;
        }

        let displayGood = d.feedbackGood || '<span class="text-slate-600 italic">無</span>';
        let displayNeeds = d.feedbackNeeds || '<span class="text-slate-600 italic">無</span>';
        let displayFeedback = d.studentFeedback || '<span class="text-slate-600 italic">無</span>';

        tr.innerHTML = `
            <td class="text-center align-top pt-4">
                <div class="font-black text-slate-200">${d.studentName}</div>
                <div class="text-[10px] text-slate-500 font-mono mt-1">${d.date}</div>
                <span class="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 mt-2 inline-block">${d.type}</span>
            </td>
            <td class="text-slate-300 text-sm leading-relaxed p-4 border-l border-slate-700">
                <div class="text-orange-400 font-bold text-xs mb-2 flex items-center"><i class="fas fa-user-tie mr-1"></i>${d.teacherName}</div>
                <div class="mb-3 bg-slate-700/30 p-2 rounded border-l-2 border-emerald-500">
                    <div class="text-[10px] text-emerald-500 font-bold mb-1">【表現良好】</div>
                    <div class="text-xs text-slate-300">${displayGood}</div>
                </div>
                <div class="bg-slate-700/30 p-2 rounded border-l-2 border-orange-500">
                    <div class="text-[10px] text-orange-500 font-bold mb-1">【建議加強】</div>
                    <div class="text-xs text-slate-300">${displayNeeds}</div>
                </div>
            </td>
            <td class="text-slate-300 text-sm leading-relaxed p-4 border-l border-slate-700 align-top">
                    <div class="text-blue-400 font-bold text-xs mb-2"><i class="fas fa-user-graduate mr-1"></i>學員回饋</div>
                    <div class="text-xs text-slate-300 bg-slate-700/30 p-2 rounded border-l-2 border-blue-500 min-h-[60px]">${displayFeedback}</div>
            </td>
            <td class="text-center align-top pt-4 border-l border-slate-700">
                ${statusHtml}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderCorrelationChart() {
    const ctx = document.getElementById('correlationChart').getContext('2d');
    if (adminCharts.corr) adminCharts.corr.destroy();

    const points = [];
    const students = [...new Set(historyData.map(d => d.studentName))];

    students.forEach(s => {
        const sData = historyData.filter(d => d.studentName === s);
        const dops = sData.filter(d => ['DOPS', 'Mini-CEX'].includes(d.type));
        const milestones = sData.filter(d => d.type === 'Milestone');

        if (dops.length > 0 && milestones.length > 0) {
            // Calc Avg Score
            const avgScore = dops.reduce((acc, curr) => acc + (parseFloat(curr.scoreRaw) || 0), 0) / dops.length;

            // Calc Avg Level
            let totalLvl = 0, countLvl = 0;
            milestones.forEach(m => {
                Object.values(m.milestoneLevels).forEach(l => {
                    if (l) { totalLvl += parseFloat(l); countLvl++; }
                });
            });
            const avgLvl = countLvl ? (totalLvl / countLvl) : 0;

            if (avgScore > 0 && avgLvl > 0) {
                points.push({ x: avgLvl, y: avgScore, name: s });
            }
        }
    });

    adminCharts.corr = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: '學員能力分佈 (平均 Milestone Level vs 平均 DOPS 分數)',
                data: points,
                backgroundColor: '#fbbf24'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: '平均 Milestone Level (1-5)', color: '#94a3b8' }, grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
                y: { title: { display: true, text: '平均 DOPS/CEX 分數', color: '#94a3b8' }, min: 60, max: 100, grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return `${context.raw.name}: L${context.raw.x.toFixed(1)} / ${context.raw.y.toFixed(1)}分`;
                        }
                    }
                }
            }
        }
    });
}

function renderTeacherStats() {
    const ctx = document.getElementById('teacherStatsChart').getContext('2d');
    if (adminCharts.teacher) adminCharts.teacher.destroy();

    const tStats = {};
    historyData.filter(d => ['DOPS', 'Mini-CEX'].includes(d.type)).forEach(d => {
        if (!tStats[d.teacherName]) tStats[d.teacherName] = { sum: 0, count: 0 };
        const s = parseFloat(d.scoreRaw);
        if (!isNaN(s)) {
            tStats[d.teacherName].sum += s;
            tStats[d.teacherName].count++;
        }
    });

    const labels = Object.keys(tStats);
    const data = labels.map(t => (tStats[t].sum / tStats[t].count).toFixed(1));

    adminCharts.teacher = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '教師平均給分',
                data: data,
                backgroundColor: '#10b981',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { min: 70, max: 100, grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            }
        }
    });
}

/* --- Common Functions --- */
function deleteItem(id) {
    if (confirm('確定要刪除此筆評量紀錄嗎？')) {
        historyData = historyData.filter(item => item.id !== id);
        updateFilterOptions();
        switchView(currentViewMode());
        if (isAdminMode) generateAdminDashboard();
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
        const sData = sortDataList([...studentGroups[sName]]);
        // 1. Milestone (按學員區分)
        const msData = sData.filter(d => d.type === 'Milestone');
        if (msData.length > 0) {
            const ds = msData.map((d, i) => {
                const getAvg = (indices) => {
                    const vals = indices.map(idx => parseFloat(d.milestoneLevels[TARGET_MILESTONES[idx]])).filter(v => !isNaN(v));
                    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 0;
                };
                const coreValues = [getAvg(CORE_MAP["醫學影像知識"]), getAvg(CORE_MAP["團隊溝通能力"]), getAvg(CORE_MAP["病人照護核心"]), parseFloat(d.milestoneLevels[TARGET_MILESTONES[9]]) || 0, getAvg(CORE_MAP["專業素養表現"])];
                return { label: `日期: ${d.date}`, data: coreValues, borderColor: CHART_COLORS[i % CHART_COLORS.length], backgroundColor: hexToRgba(CHART_COLORS[i % CHART_COLORS.length], 0.15), borderWidth: 2.5 };
            });
            createChart(`【${sName}】MILESTONE 核心能力成長分析`, 'radar', CORE_COMPETENCIES, ds, { r: { min: 0, max: 5, ticks: { stepSize: 1 } } });
        }
        // 2. EPA (按學員+部位區分)
        const epaData = sData.filter(d => d.type === 'EPA');
        if (epaData.length > 0) {
            const pg = {}; epaData.forEach(d => { const g = getSmartGroupName(d); if (!pg[g]) pg[g] = []; pg[g].push(d); });
            for (let k in pg) {
                const ds = pg[k].map((d, i) => ({ label: `日期: ${d.date}`, data: [1, 2, 3].map(i => OPA_VALUE_MAP[d.opaScores[i]?.toUpperCase()] || 0), borderColor: CHART_COLORS[i % CHART_COLORS.length], backgroundColor: hexToRgba(CHART_COLORS[i % CHART_COLORS.length], 0.1), borderWidth: 2 }));
                createChart(`【${sName}】EPA 信賴能力分析 (Radar) - ${k}`, 'radar', ["OPA 1", "OPA 2", "OPA 3"], ds, { r: { min: 0, max: 8, ticks: { callback: v => OPA_LABEL_MAP[Math.round(v)] || '', font: { weight: 'bold' } } } });
            }
        }
        // 3. DOPS/Mini-CEX (按學員+部位區分)
        const skillData = sData.filter(d => ['DOPS', 'Mini-CEX', 'CbD', '實習總評量表'].includes(d.type));
        if (skillData.length > 0) {
            const pg = {}; skillData.forEach(d => { const g = getSmartGroupName(d); if (!pg[g]) pg[g] = []; pg[g].push(d); });
            for (let k in pg) {
                createChart(`【${sName}】${pg[k][0].type} 成長曲線 - ${k}`, 'line', pg[k].map(d => d.date), [{ label: '總分', data: pg[k].map(d => parseFloat(d.scoreRaw) || 0), borderColor: '#e11d48', tension: 0.1, fill: false, pointRadius: 6 }], { y: { min: 60, max: 100 } });
            }
        }
    });
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
        'Basic Course': 'bg-indigo-500 text-white',
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
    card.innerHTML = `<h3 class="adaptive-title text-slate-800 mb-8 text-center font-black tracking-tighter">${title}</h3><div class="h-[380px] w-full"><canvas id="${id}"></canvas></div>`;
    document.getElementById('chartGrid').appendChild(card);
    const ctx = document.getElementById(id).getContext('2d');
    charts[id] = new Chart(ctx, {
        type,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            devicePixelRatio: 2,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { font: { size: 12, weight: 'bold' }, padding: 15 }
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
                    <span class="text-[10px] font-black px-3 py-1 rounded-lg ${d.type === 'EPA' ? 'bg-blue-600' : (d.type === 'Milestone' ? 'bg-teal-600' : (d.type === 'DOPS' ? 'bg-purple-600' : (d.type === 'CbD' ? 'bg-emerald-600' : 'bg-orange-500')))} text-white uppercase shadow-md font-bold tracking-widest">${d.type}</span>
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
                ${d.type === 'EPA' ? `<div class="flex flex-col gap-3">${[1, 2, 3].map(i => `<div class="border-2 rounded-2xl p-2 min-w-[110px] text-center shadow-sm ${getGradeStyle(d.opaScores[i])}"><span class="text-[10px] block uppercase opacity-80 mb-1 font-bold tracking-tighter font-black">OPA ${i}</span><span class="text-4xl font-black">${d.opaScores[i] || '?'}</span></div>`).join('')}</div>` : (['DOPS', 'Mini-CEX', 'CbD', '實習總評量表'].includes(d.type) ? `<div class="text-center"><div class="adaptive-score text-blue-700 font-mono drop-shadow-xl tracking-tighter font-black">${d.scoreRaw || '--'}</div><div class="adaptive-label text-slate-400 uppercase italic mt-4 tracking-widest font-black text-[11px]">Total Score</div></div>` : (d.type === 'Milestone' ? '<div class="text-xs font-black text-slate-300 uppercase italic">Level Based</div>' : ''))}
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

    const skillData = sorted.filter(d => ['DOPS', 'Mini-CEX', 'CbD', '實習總評量表'].includes(d.type));
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
    } catch (e) { }
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
        const printDate = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

        // Create print header
        let printHeader = document.querySelector('.print-header');
        if (!printHeader) {
            printHeader = document.createElement('div');
            printHeader.className = 'print-header';
            chartGrid.parentNode.insertBefore(printHeader, chartGrid);
        }
        printHeader.innerHTML = `
            <h1>醫學教育成果展示報告</h1>
            <p>受評學員：${studentNames}</p>
            <p>列印日期：${printDate}</p>
            <p style="font-size: 9pt; margin-top: 8px;">本報告依據教學醫院評鑑基準產出，呈現學員能力成長軌跡</p>
        `;

        // Create print footer
        let printFooter = document.querySelector('.print-footer');
        if (!printFooter) {
            printFooter = document.createElement('div');
            printFooter.className = 'print-footer';
            chartGrid.parentNode.appendChild(printFooter);
        }
        printFooter.innerHTML = `
            <p>評量展示助手 v1.0 產出 | 教學醫院評鑑用成果展示 | 列印時間：${new Date().toLocaleString('zh-TW')}</p>
        `;

        // Trigger print
        window.print();
    }, 500);
}
