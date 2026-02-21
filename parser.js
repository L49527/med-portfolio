/* Data Constants */
const TARGET_MILESTONES = ["一、醫學影像及放射科學知識 1", "一、醫學影像及放射科學知識 2", "二、醫病關係及團隊溝通能力 1", "二、醫病關係及團隊溝通能力 2", "三、病人照護 1", "三、病人照護 2", "三、病人照護 3", "三、病人照護 4", "三、病人照護 5", "四、提升本職技能 1", "五、專業素養 1", "五、專業素養 2"];
const CORE_COMPETENCIES = ["醫學影像知識", "團隊溝通能力", "病人照護核心", "本職技能提升", "專業素養表現"];
const CORE_MAP = { "醫學影像知識": [0, 1], "團隊溝通能力": [2, 3], "病人照護核心": [4, 5, 6, 7, 8], "本職技能提升": [9], "專業素養表現": [10, 11] };
const OPA_VALUE_MAP = { 'N/A': 0, '1': 1, '2A': 2, '2B': 3, '3A': 4, '3B': 5, '3C': 6, '4': 7, '5': 8 };
const OPA_LABEL_MAP = { 0: 'N/A', 1: '1', 2: '2a', 3: '2b', 4: '3a', 5: '3b', 6: '3c', 7: '4', 8: '5' };
const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#7c3aed', '#e11d48', '#db2777', '#0891b2', '#475569'];

/* Helper Functions */
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getSmartGroupName(item) {
    const title = item.title;
    // 移除學前/學中/學後，只保留真實部位相關的詞彙
    const keywords = ["頭頸部", "胸腹部", "胸部", "腹部", "CTA", "Dynamic", "四肢部", "脊椎部", "Pancreas", "Liver"];
    for (let key of keywords) { if (title.includes(key)) return key; }

    // 如果找不到指定的 keyword，那就嘗試從標題濾掉表單類型名稱後，取剩餘有意義的部位
    // 同時過濾掉「學前/學中/學後/訓練」這類干擾字
    let cleanTitle = title.replace(/^(DOPS|Mini-CEX|CEX|CbD|EPA|Milestone)[-\s:_/]+/i, '')
        .replace(/學前|測驗|學中|學後|評量|訓練/g, '')
        .trim();

    return cleanTitle.split(/[-_\s/]/)[0] || "其他項目";
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

function extractFieldContent(rawHtml, label) {
    let rt = new RegExp(label + "[\\s\\S]*?<textarea[^>]*>([\\s\\S]*?)<\\/textarea>", "i");
    let ma = rawHtml.match(rt); if (ma && ma[1].trim()) return ma[1].trim();
    let rs = new RegExp(label + "[^<:：]{0,100}[:：]?\\s*(?:<[^>]+>\\s*)*([^<>\s][^<]{1,3000})", "i");
    let mb = rawHtml.match(rs); if (mb && mb[1].trim()) return mb[1].replace(/<[^>]*>?/gm, '').trim();
    return "";
}

/* Core Parsing Functions */
function analyzeHTML(raw) {
    if (!raw) return null;
    try {
        const textStream = raw.replace(/(\r\n|\n|\r)/gm, " ").replace(/\s+/g, " ");
        let item = { id: Math.random().toString(36).substr(2, 9), type: 'Unknown', trainingType: '未分類', title: (raw.match(/<title>(.*?)<\/title>/i)?.[1] || "未定義表單"), date: '1900-01-01', scoreRaw: '', skillName: '', feedbackGood: '', feedbackNeeds: '', studentFeedback: '', opaScores: { 1: '', 2: '', 3: '' }, opaFeedbacks: { 1: '', 2: '', 3: '' }, milestoneLevels: {}, details: [], studentName: '未知學員', teacherName: '未註明' };

        let snmMatch = raw.match(/<h3[^>]*><strong>\s*([\u4e00-\u9fa5]{2,5})\s*<\/strong><\/h3>/i) ||
            raw.match(/評量學員：[\s\S]*?<strong>\s*([\u4e00-\u9fa5]{2,5})\s*<\/strong>/i) ||
            raw.match(/([\u4e00-\u9fa5]{2,5})\(學員\)/i);
        if (snmMatch) item.studentName = snmMatch[1].trim();

        let tnmSign = raw.match(/<td[^>]*class=["']e_signature_name["'][^>]*>([\u4e00-\u9fa5]{2,10})<\/td>/i);
        let tnmFlow = raw.match(/([\u4e00-\u9fa5]{2,5})\(臨床教師\)/i);
        let tnmInput = raw.match(/(?:評量教師|臨床教師姓名|指導教師)[^]{0,1000}value=["']((?!關閉|列印|提交|清除)[\u4e00-\u9fa5]{2,10})["']/i);
        if (tnmSign) item.teacherName = tnmSign[1].trim();
        else if (tnmFlow) item.teacherName = tnmFlow[1].trim();
        else if (tnmInput) item.teacherName = tnmInput[1].trim();

        let trm = raw.match(/<dt>階段\/子階段：<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/i);
        if (trm) {
            let fullPath = trm[1].replace(/<[^>]*>?/gm, '').trim();
            item.trainingType = fullPath.split('/').pop() || "未分類";
        }

        let dm = raw.match(/DateType[^>]*?value=["'](\d{4}[-\/]\d{1,2}[-\/]\d{1,2})["']/i);
        item.date = dm ? dm[1].replace(/\//g, '-') : (raw.match(/20\d{2}[-\/]\d{1,2}[-\/]\d{1,2}/g)?.pop()?.replace(/\//g, '-') || "1900-01-01");

        const upTitle = item.title.toUpperCase();
        if (upTitle.includes('DOPS')) item.type = 'DOPS';
        else if (upTitle.includes('CBD')) item.type = 'CbD';
        else if (upTitle.includes('CEX') || upTitle.includes('MINI-CEX')) item.type = 'Mini-CEX';
        else if (upTitle.includes('EPA')) item.type = 'EPA';
        else if (upTitle.includes('MILESTONE') || upTitle.includes('里程碑')) item.type = 'Milestone';

        if (['DOPS', 'Mini-CEX', 'CbD'].includes(item.type)) {
            item.scoreRaw = textStream.match(/(?:評量總分數|評量成績|總分)[^0-9.]{0,20}(\d{1,3}(\.\d)?)/i)?.[1] || "--";
            item.skillName = textStream.match(/(?:操作項目|技能名稱|操作技能名稱|題目)[^<:：]{0,30}[:：]?\s*(?:<[^>]+>\s*)*([^<>\s][^<]{2,150})/i)?.[1]?.trim() || "未指定";
            item.feedbackGood = extractFieldContent(raw, "教師回饋意見-表現良好項目") || extractFieldContent(raw, "表現良好項目");
            item.feedbackNeeds = extractFieldContent(raw, "教師回饋意見-建議加強項目") || extractFieldContent(raw, "建議加強項目");
            item.studentFeedback = extractFieldContent(raw, "學員回饋意見");
        } else if (item.type === 'EPA') {
            for (let i = 1; i <= 3; i++) {
                let scoreRe = new RegExp(`OPA\\s*${i}[\\s\\S]*?<input[^>]*checked[^>]*>[\\s\\S]*?<label[^>]*?>\\s*([^<]+?)\\s*<`, "i");
                let sm = raw.match(scoreRe); if (sm) item.opaScores[i] = sm[1].trim();
                let fbRe = new RegExp(`(?:OPA\\s*${i}[^]*?)(?:其它質性回饋|回饋[：:])[\\s\\S]*?<textarea[^>]*>([\\s\\S]*?)<\\/textarea>`, "i");
                let fm = raw.match(fbRe); if (fm) item.opaFeedbacks[i] = fm[1].trim();
            }
        } else if (item.type === 'Milestone') {
            TARGET_MILESTONES.forEach(target => {
                let loc = textStream.search(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, "\\s*"), 'i'));
                if (loc > -1) {
                    let block = textStream.substring(loc, loc + 3000);
                    let cm = block.match(/<input[^>]*?\bchecked\b[^>]*?>[^<]*?<label[^>]*?>\s*(?:Level\s*)?([1-5])/i);
                    if (cm) item.milestoneLevels[target] = cm[1];
                }
            });
        }
        buildItemDetails(item);
        return item;
    } catch (e) { console.error("Parse error", e); return null; }
}

function buildItemDetails(item) {
    item.details = [];
    item.details.push(`<div class="mb-2 text-[11px] font-black text-slate-400 bg-slate-50 px-2 py-0.5 rounded border inline-block tracking-tighter">訓練別：${item.trainingType}</div>`);
    if (['DOPS', 'Mini-CEX', 'CbD'].includes(item.type)) {
        if (item.skillName) item.details.push(`<div class="bg-slate-200 p-2 px-3 rounded-lg text-[13px] font-black border-l-4 border-slate-500 mb-2 leading-tight">項目：${item.skillName}</div>`);
        if (item.feedbackGood) item.details.push(`<div class="adaptive-text mb-1 text-slate-700 font-medium leading-snug"><span class="text-emerald-700 font-bold mr-1 italic">【表現良好】</span>${item.feedbackGood}</div>`);
        if (item.feedbackNeeds) item.details.push(`<div class="adaptive-text mb-1 text-slate-700 font-medium leading-snug"><span class="text-amber-700 font-bold mr-1 italic">【建議加強】</span>${item.feedbackNeeds}</div>`);
        if (item.studentFeedback) item.details.push(`<div class="adaptive-text bg-blue-50 p-2 rounded-lg italic text-slate-800 font-bold border border-blue-100 shadow-inner mt-2"><span class="text-blue-800 font-black mr-2">學員回饋</span>${item.studentFeedback}</div>`);
    } else if (item.type === 'EPA') {
        [1, 2, 3].forEach(i => { if (item.opaScores[i]) item.details.push(`<div class="mt-1 border-l-2 border-blue-400 pl-3 py-1 bg-white rounded shadow-sm border border-slate-100"><div class="flex justify-between items-center mb-0.5 font-bold"><span class="text-[10px] text-blue-400 font-black uppercase">OPA ${i}</span><span class="px-2 py-0.5 rounded text-[10px] font-black border ${getGradeStyle(item.opaScores[i])}">${item.opaScores[i]}</span></div><div class="adaptive-text text-slate-700">${item.opaFeedbacks[i] || '無具體建議'}</div></div>`); });
    }

    // 新增：處理 v5.1 各站成績 (基礎課程細項)
    if (item.stationDetails) {
        // Format: "Label:Value; Label:Value"
        const parts = item.stationDetails.split(';');
        parts.forEach(p => {
            const [label, val] = p.split(':');
            if (label && val) {
                const v = val.trim();
                // 根據 Value 決定顏色 (通過=綠, 不通過=紅)
                const colorClass = v.includes('通過') && !v.includes('不') ? 'text-emerald-600 bg-emerald-50 border-emerald-200' :
                    v.includes('不通過') ? 'text-teal-600 bg-teal-50 border-rose-200' : 'text-slate-600 bg-slate-50 border-slate-200';

                item.details.push(`<div class="flex justify-between items-center py-1 border-b border-slate-50 adaptive-text font-black text-xs leading-tight">
                    <span class="text-slate-700">${label.trim()}</span>
                    <span class="px-2 py-0.5 rounded border ${colorClass} text-[10px]">${v}</span>
                </div>`);
            }
        });
    }

    if (item.type === 'Milestone') {
        TARGET_MILESTONES.forEach(target => { if (item.milestoneLevels[target]) item.details.push(`<div class="flex justify-between items-center py-1 border-b border-slate-50 adaptive-text font-black text-xs leading-tight"><span class="text-slate-700">${target}</span><span class="px-2 py-0.5 rounded border ${getGradeStyle(item.milestoneLevels[target])}">L${item.milestoneLevels[target]}</span></div>`); });
    }
}

function analyzeCSV(content) {
    try {
        // Remove BOM if present
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

        const rows = []; let row = []; let curr = ""; let inQuotes = false;
        for (let i = 0; i < content.length; i++) {
            let char = content[i]; if (char === '"' && content[i + 1] === '"') { curr += '"'; i++; } else if (char === '"') inQuotes = !inQuotes; else if (char === ',' && !inQuotes) { row.push(curr); curr = ""; } else if (char === '\n' && !inQuotes) { row.push(curr); rows.push(row); row = []; curr = ""; } else curr += char;
        }
        if (curr || row.length) { row.push(curr); rows.push(row); }

        if (rows.length < 2) return null;

        const headers = rows[0].map(h => h.replace(/\r/g, '').trim());
        const res = [];

        // Detect CSV format by checking header row
        const isEPortfolioFormat = headers.includes("來源檔案") || headers.includes("執行日期") || headers.includes("教師/主持人");
        const isOriginalFormat = headers.includes("評量日期") && headers.includes("類型");

        if (isEPortfolioFormat) {
            // E-Portfolio Web Tool format
            const colMap = {};
            headers.forEach((h, i) => { colMap[h] = i; });

            for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                if (r.length < 3) continue;

                const getValue = (colName) => {
                    const idx = colMap[colName];
                    return (idx !== undefined && r[idx]) ? r[idx].replace(/\r/g, '').trim() : '';
                };

                // Detect type from title/filename
                const title = getValue("表單標題") || getValue("來源檔案") || "";
                let type = (getValue("類型") || 'Unknown').trim();

                // If type is still Unknown or generic, try to detect from title
                if (!type || type === 'Unknown') {
                    const upTitle = title.toUpperCase();
                    if (upTitle.includes('DOPS')) type = 'DOPS';
                    else if (upTitle.includes('CBD') || upTitle.includes('案例討論')) type = 'CbD';
                    else if (upTitle.includes('CEX') || upTitle.includes('MINI-CEX')) type = 'Mini-CEX';
                    else if (upTitle.includes('EPA')) type = 'EPA';
                    else if (upTitle.includes('MILESTONE') || upTitle.includes('里程碑')) type = 'Milestone';
                }

                // 為了修復 EPA 等報表有時候匯出的欄位沒抓到對的儀器，我們再次統一針對 Instrument 做分析
                // 優先使用「儀器別」，若無，再看「訓練別編號」，若都無，如果是 EPA，就用 getSmartGroupName 猜一個。
                let instRaw = getValue("儀器別") || getValue("訓練別編號") || getValue("科別") || "";

                // --- 特別修復 ---
                // E-Portfolio 的導出工具預設會把 EPA 的儀器別全部填上「放射治療」！必須在這裡將其洗掉
                if (type === 'EPA' && instRaw.includes('放射治療')) {
                    const t = title;
                    if (t.includes('電腦斷層')) instRaw = 'CT';
                    else if (t.includes('血管攝影')) instRaw = 'Angio';
                    else if (t.includes('磁振造影')) instRaw = 'MRI';
                    else if (t.includes('一般診斷')) instRaw = '一般診斷攝影';
                    else if (t.includes('透視') || t.includes('特殊')) instRaw = 'Special';
                    else if (t.includes('超音波')) instRaw = 'Sono';
                    else if (t.includes('核子醫學')) instRaw = 'NM';
                    else instRaw = '';
                }

                // 對於 EPA 或 DOPS，如果還是空的，試著從標題猜
                if ((!instRaw || instRaw === "無" || instRaw === "未分類") && (type === 'EPA' || type === 'DOPS')) {
                    instRaw = getSmartGroupName({ title: title }); // 借用這個函數切出最前面那一塊
                }


                let item = {
                    id: Math.random().toString(36).substr(2, 9),
                    date: getValue("執行日期") || '1900-01-01',
                    studentName: getValue("學員姓名") || '未知學員',
                    type: type,
                    title: title || "未定義表單",
                    scoreRaw: getValue("總分") || '',
                    skillName: getValue("操作項目") || getValue("科別") || '',
                    opaScores: { 1: '', 2: '', 3: '' },
                    opaFeedbacks: { 1: '', 2: '', 3: '' },
                    feedbackGood: getValue("表現良好項目") || '',
                    feedbackNeeds: getValue("建議加強項目") || '',
                    studentFeedback: getValue("學員回饋意見") || getValue("評語/心得") || '',
                    teacherName: getValue("教師/主持人") || '未註明',
                    trainingType: getValue("訓練別編號") || getValue("科別") || '未分類',
                    instrumentType: instRaw || '',
                    stationDetails: getValue("各站成績") || '', // 新增：支援 v5.1 各站成績 (基礎課程細項)
                    milestoneLevels: {},
                    details: []
                };

                // Try to parse OPA scores from dynamic columns (OPA1, OPA2, OPA3)
                [1, 2, 3].forEach(n => {
                    const opaScore = getValue(`OPA${n}`) || getValue(`OPA ${n}`);
                    const opaFeedback = getValue(`OPA${n}回饋`) || getValue(`OPA ${n}回饋`);
                    if (opaScore) item.opaScores[n] = opaScore;
                    if (opaFeedback) item.opaFeedbacks[n] = opaFeedback;
                });

                // Try to parse Milestone levels from dynamic columns
                // First try using TARGET_MILESTONES
                TARGET_MILESTONES.forEach(m => {
                    const level = getValue(m);
                    if (level) item.milestoneLevels[m] = level;
                });

                // If type is Milestone and no levels found, try dynamic column detection
                // If type is Milestone and no levels found, try dynamic column detection by order
                if (type === 'Milestone' && Object.keys(item.milestoneLevels).length === 0) {
                    // Find all potential level columns
                    const potentialLevelCols = [];
                    headers.forEach((h, idx) => {
                        // Specific logic for E-Portfolio CSV: Columns after _dataType or at the end
                        // The CSV from the tool seems to have long description headers
                        if (r[idx]) {
                            const val = r[idx].replace(/\r/g, '').trim();
                            // Check if value looks like a Level
                            if (val.includes('Level') || /^L?\d$/.test(val)) {
                                potentialLevelCols.push(val);
                            }
                        }
                    });

                    // If we found exactly 12 columns (matching TARGET_MILESTONES length), map them by order
                    if (potentialLevelCols.length === TARGET_MILESTONES.length) {
                        potentialLevelCols.forEach((val, idx) => {
                            // Extract numeric value only (e.g. "Level 4" -> "4", "L4" -> "4")
                            item.milestoneLevels[TARGET_MILESTONES[idx]] = val.replace(/Level\s*|L/gi, '').trim();
                        });
                    } else if (potentialLevelCols.length > 0) {
                        potentialLevelCols.forEach((val, idx) => {
                            if (idx < TARGET_MILESTONES.length) {
                                item.milestoneLevels[TARGET_MILESTONES[idx]] = val.replace(/Level\s*|L/gi, '').trim();
                            }
                        });
                    }
                }

                buildItemDetails(item);
                res.push(item);
            }
        } else {
            // Original format (exported by this tool)
            const dataRows = rows.filter(r => r.length > 5 && r[0] !== "評量日期");
            dataRows.forEach(r => {
                let item = { id: Math.random().toString(36).substr(2, 9), date: r[0], studentName: r[1], type: r[2], title: r[3], scoreRaw: r[4], skillName: r[5], opaScores: { 1: r[6], 2: r[8], 3: r[10] }, opaFeedbacks: { 1: r[7], 2: r[9], 3: r[11] }, feedbackGood: r[12], feedbackNeeds: r[13], studentFeedback: r[14], teacherName: r[15] || '未註明', trainingType: r[16] || '未分類', instrumentType: r[17] || '', milestoneLevels: {}, details: [] };
                TARGET_MILESTONES.forEach((m, idx) => { if (r[18 + idx]) item.milestoneLevels[m] = r[18 + idx]; });
                buildItemDetails(item); res.push(item);
            });
        }

        return res;
    } catch (e) { console.error("CSV parse error:", e); return null; }
}
