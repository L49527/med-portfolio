/* import.js — reads e-Portfolio HTML forms and CSV files into records, and exports CSV. */

/* Shared constants */
const TARGET_MILESTONES = ["一、醫學影像及放射科學知識 1", "一、醫學影像及放射科學知識 2", "二、醫病關係及團隊溝通能力 1", "二、醫病關係及團隊溝通能力 2", "三、病人照護 1", "三、病人照護 2", "三、病人照護 3", "三、病人照護 4", "三、病人照護 5", "四、提升本職技能 1", "五、專業素養 1", "五、專業素養 2"];
const CORE_COMPETENCIES = ["醫學影像知識", "團隊溝通能力", "病人照護核心", "本職技能提升", "專業素養表現"];
const CORE_MAP = { "醫學影像知識": [0, 1], "團隊溝通能力": [2, 3], "病人照護核心": [4, 5, 6, 7, 8], "本職技能提升": [9], "專業素養表現": [10, 11] };
const OPA_VALUE_MAP = { 'N/A': 0, '1': 1, '2A': 2, '2B': 3, '3A': 4, '3B': 5, '3C': 6, '4': 7, '5': 8 };
const OPA_LABEL_MAP = { 0: 'N/A', 1: '1', 2: '2a', 3: '2b', 4: '3a', 5: '3b', 6: '3c', 7: '4', 8: '5' };

/* Shared helpers */
function getSmartGroupName(item) {
    const title = item.title;

    // 新增：特別針對 DOPS-XXXX-影像醫學科 格式提取 XXXX (細項部位)
    const dopsMatch = title.match(/^DOPS-(.*?)-/i);
    if (dopsMatch && dopsMatch[1]) {
        let part = dopsMatch[1].replace(/學前|測驗|學中|學後|評量|訓練/g, '').trim();
        if (part) return part;
    }

    // 移除學前/學中/學後，只保留真實部位相關的詞彙
    if (title.includes("放射醫學影像及儀器品保")) return "影像學";
    const keywords = ["頭頸部", "胸腹部", "胸部", "腹部", "CTA", "Dynamic", "四肢部", "脊椎部", "Pancreas", "Liver", "乳房攝影", "Mammo", "頸椎", "腰椎", "骨盆", "KUB", "Chest", "Abdomen", "Brain", "Spine", "影像及儀器品保", "影像學"];
    for (let key of keywords) { if (title.includes(key)) return key; }

    // 若無具體部位關鍵字，優先使用已識別的儀器類別
    if (item.instrumentType && !["未分類", "放射治療", "無", ""].includes(item.instrumentType)) {
        return item.instrumentType;
    }

    // 如果找不到指定的 keyword，那就嘗試從標題濾掉表單類型名稱後，取剩餘有意義的部位
    // 同時過濾掉「學前/學中/學後/訓練」這類干擾字
    let cleanTitle = title.replace(/^(DOPS|Mini-CEX|CEX|CbD|EPA|Milestone|EPA\d)[-\s:_/]+/i, '')
        .replace(/學前|測驗|學中|學後|評量|訓練/g, '')
        .trim();

    return cleanTitle.split(/[-_\s/]/)[0] || "其他項目";
}

function escapeAssessmentText(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function normalizeTrainingProgram(value) {
    const label = String(value ?? '').normalize('NFKC').trim().toUpperCase();
    return label.match(/^(?:醫事放射師?\s*)?(UGY|PGY)$/)?.[1] || '';
}

// Other form text boxes travel through CSV as "【標題】內容 ｜ 【標題】內容".
const OTHER_FIELDS_HEADER = '其他文字欄位';
const FORM_FIELD_SEPARATOR = ' ｜ ';

function formatFormFields(fields) {
    return (fields || []).map(field => `【${field.label}】${field.content}`).join(FORM_FIELD_SEPARATOR);
}

function parseFormFields(text) {
    const fields = [];
    const pattern = /【([^】]*)】([\s\S]*?)(?= ｜ 【|$)/g;
    for (const match of String(text || '').matchAll(pattern)) {
        if (match[2].trim()) fields.push({ label: match[1], content: match[2].trim() });
    }
    return fields;
}

// Builds one record from a header row and a data row (the e-Portfolio CSV layout).
// HTML forms use the same function through toRecord(), so both paths give identical fields.
function recordFromRow(headers, r) {
    const getValue = (colName) => {
        // lastIndexOf matches the earlier column map, where a repeated header kept its last position.
        const idx = headers.lastIndexOf(colName);
        return (idx >= 0 && r[idx]) ? r[idx].replace(/\r/g, '').trim() : '';
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
    // 擴大修復範圍：如果儀器別是放射治療、無、或未分類，都進來重新判斷
    if (type === 'EPA' && (instRaw.includes('放射治療') || !instRaw || instRaw === "無" || instRaw === "未分類")) {
        const t = title;
        if (t.includes('電腦斷層') || t.includes('EPA1')) instRaw = 'CT';
        else if (t.includes('一般診斷') || t.includes('EPA2')) instRaw = '一般攝影';
        else if (t.includes('乳房攝影') || t.includes('Mammo') || t.includes('EPA3')) instRaw = 'Mammo';
        else if (t.includes('磁振造影') || t.includes('EPA4')) instRaw = 'MRI';
        else if (t.includes('血管攝影') || t.includes('EPA5')) instRaw = 'Angio';
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
        trainingProgram: normalizeTrainingProgram(getValue("訓練類別")),
        instrumentType: (instRaw || '').includes('總評估') ? '總評估' : (instRaw || ''),
        stationDetails: getValue("各站成績") || '', // 新增：支援 v5.1 各站成績 (基礎課程細項)
        milestoneLevels: {},
        formFields: parseFormFields(getValue(OTHER_FIELDS_HEADER))
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
    return item;
}

/* CSV reader (e-Portfolio CSV and this tool's own export) */
function analyzeCSV(content) {
    try {
        // Remove BOM if present
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

        const rows = []; let row = []; let curr = ""; let inQuotes = false;
        for (let i = 0; i < content.length; i++) {
            let char = content[i]; if (inQuotes && char === '"' && content[i + 1] === '"') { curr += '"'; i++; } else if (char === '"') inQuotes = !inQuotes; else if (char === ',' && !inQuotes) { row.push(curr); curr = ""; } else if (char === '\n' && !inQuotes) { row.push(curr); rows.push(row); row = []; curr = ""; } else curr += char;
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
            for (let i = 1; i < rows.length; i++) {
                if (rows[i].length < 3) continue;
                res.push(recordFromRow(headers, rows[i]));
            }
        } else {
            // Original format (exported by this tool)
            const trainingProgramColumn = headers.indexOf('訓練類別');
            const dataRows = rows.filter(r => r.length > 5 && r[0] !== "評量日期");
            dataRows.forEach(r => {
                let item = { id: Math.random().toString(36).substr(2, 9), date: r[0], studentName: r[1], type: r[2], title: r[3], scoreRaw: r[4], skillName: r[5], opaScores: { 1: r[6], 2: r[8], 3: r[10] }, opaFeedbacks: { 1: r[7], 2: r[9], 3: r[11] }, feedbackGood: r[12], feedbackNeeds: r[13], studentFeedback: r[14], teacherName: r[15] || '未註明', trainingType: r[16] || '未分類', instrumentType: r[17] || '', milestoneLevels: {}, formFields: [] };
                item.trainingProgram = normalizeTrainingProgram(r[trainingProgramColumn]);
                TARGET_MILESTONES.forEach((m, idx) => { if (r[18 + idx]) item.milestoneLevels[m] = r[18 + idx]; });
                res.push(item);
            });
        }

        return res;
    } catch (e) { console.error("CSV parse error:", e); return null; }
}

/* e-Portfolio HTML form reader */
const htmlFormReader = (() => {
function analyzeHTML(raw) {
    try {
        let parser = new DOMParser();
        let doc = parser.parseFromString(raw, "text/html");
        let cleanText = doc.body.innerText.replace(/\s+/g, ' ');
        const categoryLabel = Array.from(doc.querySelectorAll('dt'))
            .find(label => /^訓練類別\s*[:：]?$/.test(label.textContent.trim()));
        const category = categoryLabel?.nextElementSibling;

        // 相容於評量展示助手 v1.0 的里程碑指標清單
        const TARGET_MILESTONES = [
            "一、醫學影像及放射科學知識 1",
            "一、醫學影像及放射科學知識 2",
            "二、醫病關係及團隊溝通能力 1",
            "二、醫病關係及團隊溝通能力 2",
            "三、病人照護 1",
            "三、病人照護 2",
            "三、病人照護 3",
            "三、病人照護 4",
            "三、病人照護 5",
            "四、提升本職技能 1",
            "五、專業素養 1",
            "五、專業素養 2"
        ];

        let item = {
            id: Math.random().toString(36).substr(2, 9),
            type: '評量表', department: '影像醫學科', title: doc.title || "評量表", date: '1900-01-01',
            trainingProgram: category?.tagName === 'DD' ? category.textContent.trim() : '',
            scoreRaw: '', studentName: '未知', teacherName: '未註明',
            subScores: { knowledge: '', operation: '', attitude: '' },
            stationScores: [], feedbacks: [], showSubscores: false,
            isInternGeneralFeedback: false,
            opaScores: { opa1: '', opa2: '', opa3: '' },  // EPA OPA 分數
            opaFeedbacks: { opa1: '', opa2: '', opa3: '' }, // EPA OPA 質性回饋
            milestoneLevels: {}, // 里程碑各項等級 (相容於展示助手)
            instrument: '' // 新增儀器別
        };

        // --- 1. 偵測類型 (v5.2 Refined) ---
        const ut = item.title.toUpperCase();
        item.isInternGeneralFeedback = ut.includes('醫事放射實習生總回饋');
        const isEffectivenessFeedback = ut.includes('整體實習成效回饋');

        // 優先判定特殊回饋單
        if (ut.includes('醫事放射實習生總回饋') || ut.includes('整體實習成效回饋') || ut.includes('回饋單') || ut.includes('FEEDBACK') || ut.includes('反應表')) {
            item.type = '學員回饋單';
        }
        else if (ut.includes('問卷') || ut.includes('滿意度')) {
            item.type = '問卷調查';
        }
        else if (ut.includes('導師輔導') || ut.includes('輔導紀錄') || ut.includes('溝通紀錄') || ut.includes('溝通表')) {
            item.type = '輔導紀錄';
        }
        // 總評量表類
        else if (ut.includes('總評量表') || ut.includes('成績總評') || ut.includes('到職訓練') || ut.includes('職前自我評估') || ut.includes('學期測驗') || ut.includes('成績紀錄表')) {
            item.type = '實習總評量表';
        }
        // 標準評量
        else if (ut.includes('EPA')) item.type = 'EPA';
        else if (ut.includes('MILESTONE') || ut.includes('里程碑')) item.type = 'Milestone';
        else if (ut.includes('DOPS') || ut.includes('PROCEDURAL') || ut.includes('PROCEDURAL SKILLS') || ut.includes('操作技能直接觀察')) item.type = 'DOPS';
        else if (ut.includes('MINI-CEX') || ut.includes('MINI CEX') || ut.includes('CEX') || ut.includes('臨床演練')) item.type = 'Mini-CEX';
        else if (ut.includes('CBD') || ut.includes('案例討論')) item.type = 'CbD';
        else if (ut.includes('基礎課程')) item.type = '基礎課程';
        else if (ut.includes('單站評量') || ut.includes('實習成效評量')) item.type = '單站評量';
        else { item.type = '單站評量'; } // 預設

        let instrument = '';
        // v1.1: 嘗試從 radio button 選項提取 (操作項目)
        let radioMatch = raw.match(/操作項目[\s\S]*?checked[\s\S]*?value="([^"]+)"/i);
        if (radioMatch) { instrument = radioMatch[1].trim(); }
        // v1.1: 嘗試從評量類別 input 提取 (核子醫學科 DOPS 專用)
        if (!instrument) {
            let categoryMatch = raw.match(/評量類別[\s\S]*?value="([^"]+)"/i);
            if (categoryMatch) { instrument = categoryMatch[1].trim(); }
        }
        // v1.1: 嘗試從操作項目文字提取
        if (!instrument) {
            let opMatch = cleanText.match(/操作項目[:：\s]*([\u4e00-\u9fa5a-zA-Z0-9\-\s().]+)/);
            if (opMatch) { instrument = opMatch[1].trim(); }
        }

        // v1.1: 關鍵字標準化 (以標題或操作項目判定)
        const iTitle = (item.title + ' ' + instrument).toUpperCase();
        const iTitleOrig = item.title + ' ' + instrument; // 保留原始大小寫用於中文判定

        // v1.1: 嘗試從階段/子階段提取 (用於優先判定)
        let iPhase = "";
        let iPhaseOrig = "";
        let phaseMatch = raw.match(/階段\/子階段[:：\s]*[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/i);
        if (phaseMatch) {
            iPhaseOrig = phaseMatch[1].replace(/<[^>]+>/g, '').trim();
            iPhase = iPhaseOrig.toUpperCase();
        }

        // 如果已經從 radio button 抓到 instrument，直接使用 (最優先)
        if (instrument && instrument !== '') {
            item.instrument = instrument;
        }
        // 心導管 (優先判定，避免被其他規則搶走)
        else if (iTitleOrig.includes('心導管') || iTitle.includes('CATH LAB') || iTitle.includes('CARDIAC CATH')) item.instrument = '心導管';
        // 模擬攝影 (放射治療專用)
        else if (iTitleOrig.includes('模擬攝影') || iTitleOrig.includes('模擬定位') || iTitle.includes('SIMULATOR') || iTitle.includes('CT SIM')) item.instrument = '模擬攝影';
        // PET/CT 與 PET 優先判定 (避免被 CT 搶走)
        else if (iTitle.includes('PET/CT') || iTitle.includes('PET-CT') || iTitle.includes('PETCT')) item.instrument = 'PET/CT';
        else if (iTitle.includes('PET') && !iTitle.includes('PET/CT')) item.instrument = 'PET';
        // SPECT/CT 與 SPECT
        else if (iTitle.includes('SPECT/CT') || iTitle.includes('SPECT-CT')) item.instrument = 'SPECT/CT';
        else if (iTitle.includes('SPECT')) item.instrument = 'SPECT';
        // CT (需使用 word boundary 避免匹配 'Direct' 等單字)
        else if (/\bCT\b/.test(iTitle) || iTitleOrig.includes('電腦斷層')) item.instrument = 'CT';
        else if (/\bMRI\b/.test(iTitle) || iTitleOrig.includes('磁振') || /\bMR\b/.test(iTitle)) item.instrument = 'MRI';
        // v1.1.1: 重構儀器別判定順序，嚴格優先使用「階段/子階段」欄位
        let finalInstrument = '';

        // 1. 優先從「階段/子階段」精確判定
        if (iPhaseOrig) {
            if (iPhaseOrig.includes('磁振') || iPhaseOrig.includes('MRI') || iPhaseOrig.includes('MR')) finalInstrument = 'MRI';
            else if (iPhaseOrig.includes('血管') || iPhaseOrig.includes('ANGIO')) finalInstrument = 'Angio';
            else if (iPhaseOrig.includes('電腦斷層') || iPhaseOrig.includes('CT')) finalInstrument = 'CT';
            else if (iPhaseOrig.includes('超音波') || iPhaseOrig.includes('ECHO')) finalInstrument = 'Echo';
            else if (iPhaseOrig.includes('放射治療計畫')) finalInstrument = '放射治療計畫';
            else if (iPhaseOrig.includes('放射治療品保')) finalInstrument = '放射治療品保';
            else if (iPhaseOrig.includes('模具製作')) finalInstrument = '模具製作';
            else if (iPhaseOrig.includes('放射治療') || iPhaseOrig.includes('放射線治療') || iPhaseOrig.includes('放射腫瘤')) finalInstrument = '放射治療';
            else if (iPhaseOrig.includes('核子醫學') || iPhaseOrig.includes('核醫')) finalInstrument = '核子醫學';
            else if (iPhaseOrig.includes('乳房') || iPhaseOrig.includes('MAMMO')) finalInstrument = 'Mammo';
        }

        // 2. 如果階段判定為空，則使用全文字串判定 (標題 + 操作項目)
        if (!finalInstrument) {
            if (item.type === '基礎課程') finalInstrument = '基礎課程';
            else if (iTitleOrig.includes('學前總評估')) finalInstrument = '學前總評估';
            else if (iTitleOrig.includes('學後總評估')) finalInstrument = '學後總評估';
            else if (iTitleOrig.includes('心導管') || iTitle.includes('CATH LAB')) finalInstrument = '心導管';
            else if (iTitleOrig.includes('模擬攝影') || iTitleOrig.includes('模擬定位')) finalInstrument = '模擬攝影';
            else if (iTitle.includes('PET/CT')) finalInstrument = 'PET/CT';
            else if (iTitle.includes('SPECT/CT')) finalInstrument = 'SPECT/CT';
            else if (iTitle.includes('MRI') || iTitleOrig.includes('磁振') || iTitle.includes(' MR ')) finalInstrument = 'MRI';
            else if (iTitle.includes(' CT ') || iTitle.includes('CT-') || iTitleOrig.includes('電腦斷層')) finalInstrument = 'CT';
            else if (iTitle.includes('ANGIO') || iTitleOrig.includes('血管') || iTitle.includes('DSA')) finalInstrument = 'Angio';
            else if (iTitleOrig.includes('放射治療') || iTitleOrig.includes('放射線治療') || iTitleOrig.includes('放射腫瘤')) finalInstrument = '放射治療';
            else if (iTitle.includes('NUC') || iTitleOrig.includes('核子醫學') || iTitleOrig.includes('核醫')) finalInstrument = '核子醫學';
            else if (iTitleOrig.includes('乳房') || iTitleOrig.includes('乳攝')) finalInstrument = 'Mammo';
            else if (iTitle.includes('DEXA') || iTitleOrig.includes('骨密')) finalInstrument = 'BMD';
            else if (iTitleOrig.includes('透視') || iTitle.includes('GI') || iTitle.includes('UGI')) finalInstrument = 'Fluoro';
            else if (iTitleOrig.includes('超音波') || iTitle.includes('ECHO')) finalInstrument = 'Echo';
            else if (iTitle.includes('DENTAL') || iTitleOrig.includes('牙')) finalInstrument = 'Dental';
        }

        // 3. 處理核醫/放教等細分 (如果已經判定為大類)
        if (finalInstrument === '核子醫學') {
            if (iTitleOrig.includes('藥物') || iPhaseOrig.includes('藥物')) finalInstrument = '核醫藥物';
            else if (iTitleOrig.includes('治療') || iPhaseOrig.includes('治療')) finalInstrument = '核醫治療';
            else if (iTitleOrig.includes('造影') || iPhaseOrig.includes('造影')) finalInstrument = '核醫造影';
        }

        // 如果上述都沒有判定出，且有抓到 instrument (操作項目)，則直接使用
        item.instrument = finalInstrument || (instrument && instrument !== '未知' ? instrument : '');

        // 如果前面的判定仍然沒有結果，再透過標題輔助判定
        if (!item.instrument) {
            // 放射線治療相關 (輔助)
            if (iTitle.includes('LINAC') || iTitleOrig.includes('直線加速器')) item.instrument = 'LINAC';
            else if (iTitle.includes('TOMO') || iTitleOrig.includes('螺旋斷層')) item.instrument = 'TomoTherapy';
            else if (iTitle.includes('BRACHY') || iTitleOrig.includes('近接')) item.instrument = 'Brachytherapy';
            else if (iTitle.includes('CYBER') || iTitleOrig.includes('電腦刀')) item.instrument = 'CyberKnife';
            else if (iTitle.includes('GAMMA KNIFE') || iTitleOrig.includes('加馬刀') || iTitleOrig.includes('伽瑪刀')) item.instrument = 'Gamma Knife';
            else if (iTitle.includes('PROTON') || iTitleOrig.includes('質子')) item.instrument = 'Proton';
            // 碎石機
            else if (iTitle.includes('LITHO') || iTitleOrig.includes('碎石') || iTitle.includes('ESWL')) item.instrument = 'Lithotripsy';
            // 牙科
            else if (iTitle.includes('DENTAL') || iTitleOrig.includes('牙') || iTitle.includes('PANO') || iTitle.includes('CEPH')) item.instrument = 'Dental';
            // 一般攝影 / X光
            else if (iTitle.includes('X-RAY') || iTitle.includes('XRAY') || iTitleOrig.includes('X光') || iTitleOrig.includes('一般攝影') || iTitleOrig.includes('一般診斷')) {
                if (iTitleOrig.includes('第一季')) item.instrument = '一般診斷攝影-第一季';
                else if (iTitleOrig.includes('第二季')) item.instrument = '一般診斷攝影-第二季';
                else item.instrument = 'X-ray';
            }
            else if (iTitle.includes('GENERAL') || /\bCR\b/.test(iTitle) || /\bDR\b/.test(iTitle) || iTitle.includes('PORTABLE') || iTitleOrig.includes('移動式')) item.instrument = 'General';
            else if (iTitleOrig.includes('放射醫學影像及儀器品保') || iTitleOrig.includes('放射醫學影像品保') || iTitleOrig.includes('影像學')) item.instrument = '影像學';
            // 如果最後還是空的，給予預設值
            else {
                if (item.title.includes('一般診斷攝影') || item.title.includes('X-ray')) {
                    item.instrument = item.title.includes('第二季') ? '一般診斷攝影-第二季' : '一般診斷攝影-第一季';
                } else {
                    item.instrument = 'X-ray';
                }
            }
        }

        // 特別排除：整體實習成效不用套儀器別
        if (iTitleOrig.includes('整體實習成效')) {
            item.instrument = '';
        }

        // --- 1.6 DOPS/Mini-CEX/CbD/Milestone/EPA/輔導紀錄 儀器別補充偵測 ---
        const isOverall = iTitleOrig.includes('整體實習成效');
        const requiresInstrument = ['DOPS', 'Mini-CEX', 'CbD', 'EPA', '單站評量', '基礎課程', '輔導紀錄'].includes(item.type) && !isOverall;
        // 允許從全文搜尋中優化儀器別 (特別是當標題只拿到大類 X-ray 或 Special 但全文有 季別 或 骨密 時)
        const isGeneric = !item.instrument || ['X-RAY', 'GENERAL', '影像學', 'SPECIAL'].includes(item.instrument.toUpperCase());
        if (requiresInstrument && isGeneric) {
            const fullText = cleanText.toUpperCase();

            // --- 優先判定 RT / NM (避免被 CT/MRI 截斷) ---
            if (fullText.includes('放射治療計畫')) item.instrument = '放射治療計畫';
            else if (fullText.includes('放射治療') || fullText.includes('放射線治療')) item.instrument = '放射治療';
            else if (fullText.includes('放射治療品保')) item.instrument = '放射治療品保';
            else if (fullText.includes('直線加速器') || /\bLINAC\b/.test(fullText)) item.instrument = 'LINAC';

            else if (fullText.includes('核子醫學藥物') || fullText.includes('核醫藥物')) item.instrument = '核醫藥物';
            else if (fullText.includes('核子醫學治療') || fullText.includes('核醫治療')) item.instrument = '核醫治療';
            else if (fullText.includes('放射免疫分析')) item.instrument = '放射免疫分析';
            else if (fullText.includes('放射免疫')) item.instrument = '放射免疫';
            else if (fullText.includes('體內分析')) item.instrument = '體內分析';

            // --- 其他影像醫學項目 ---
            // 骨密 (優先判定，避免被 X-ray 搶走)
            else if (fullText.includes('骨密') || /\bDEXA\b/.test(fullText) || fullText.includes('骨質密度')) {
                item.instrument = 'BMD';
            }
            // X-ray (一般診斷攝影)
            else if (fullText.includes('一般診斷攝影') || fullText.includes('一般攝影') ||
                fullText.includes('X光') || fullText.includes('X 光') ||
                /\bX-RAY\b/.test(fullText) || /\bXRAY\b/.test(fullText) ||
                /\bBUCKY\b/.test(fullText)) {
                if (fullText.includes('第一季')) item.instrument = '一般診斷攝影-第一季';
                else if (fullText.includes('第二季')) item.instrument = '一般診斷攝影-第二季';
                else item.instrument = 'X-ray';
            }
            else if (/\bPET[\s\/\-]CT\b/.test(fullText)) item.instrument = 'PET/CT';
            else if (/\bSPECT[\s\/\-]CT\b/.test(fullText)) item.instrument = 'SPECT/CT';
            else if (fullText.includes('電腦斷層') || /\bCT\b/.test(fullText)) item.instrument = 'CT';
            else if (fullText.includes('磁振') || /\bMRI\b/.test(fullText)) item.instrument = 'MRI';
            else if (/\bC-ARM\b/.test(fullText)) item.instrument = 'C-arm';
            else if (fullText.includes('血管攝影') || /\bANGIO\b/.test(fullText) || /\bDSA\b/.test(fullText)) item.instrument = 'Angio';
            else if (fullText.includes('乳房攝影') || fullText.includes('乳攝') || /\bMAMMO\b/.test(fullText)) item.instrument = 'Mammo';
            else if (fullText.includes('透視') || fullText.includes('鋇劑') || /\bFLUORO\b/.test(fullText)) item.instrument = 'Fluoro';
            else if (fullText.includes('超音波') || /\bECHO\b/.test(fullText) || /\bSONO\b/.test(fullText)) item.instrument = 'Echo';
            else if (fullText.includes('放射醫學影像及儀器品保') || fullText.includes('放射醫學影像品保') || fullText.includes('影像學')) item.instrument = '影像學';
            else if (fullText.includes('興趣加選')) item.instrument = '興趣加選';
            else if (/\bCR\b/.test(fullText) || /\bDR\b/.test(fullText)) item.instrument = 'General';
        }

        // --- 2. 精準科別判定 ---
        let codeMatch = item.title.match(/(\d+[.\-]\d+([.\-]\d+)?)/);
        let normCode = codeMatch ? codeMatch[0].replace(/-/g, '.') : "";
        if (normCode.startsWith('4.6') || normCode.startsWith('4.1')) item.department = '核子醫學科';
        else if (normCode.startsWith('3.6') || normCode.startsWith('3.1')) item.department = '放射治療科';
        else if (normCode.startsWith('2.1.5')) item.department = '心導管室';
        else if (normCode.startsWith('2.1') || normCode.startsWith('2.6') || normCode.startsWith('2.7')) item.department = '影像醫學科';

        let deptField = raw.match(/階段\/子階段[:：\s]*[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/i);
        if (deptField) {
            let d = deptField[1].trim();
            if (d.includes('心導管')) item.department = '心導管室';
            else if (d.includes('核子醫學')) item.department = '核子醫學科';
            else if (d.includes('放射治療') || d.includes('放射腫瘤')) item.department = '放射治療科';

            // v1.1: 從階段/子階段提取儀器別 (優先於標題判定，允许覆盖通用类型)
            // 注意：'影像學' 不列為通用型別，以防止其正確分類被覆寫
            const isGenericTypes = ['X-RAY', 'GENERAL', 'SPECIAL'];
            if (!item.instrument || item.instrument === '' || isGenericTypes.includes(item.instrument.toUpperCase())) {
                // 放射治療相關
                if (d.includes('模擬攝影') || d.includes('模擬定位')) item.instrument = '模擬攝影';
                else if (d.includes('直線加速器') || d.includes('LINAC')) item.instrument = 'LINAC';
                else if (d.includes('模具製作')) item.instrument = '模具製作';
                else if (d.includes('放射治療計畫')) item.instrument = '放射治療計畫';
                else if (d.includes('治療計畫') || d.includes('TPS')) item.instrument = '治療計畫';
                else if (d.includes('放射治療技術')) item.instrument = '放射治療技術';
                else if (d.includes('放射治療品保')) item.instrument = '放射治療品保';
                else if (d.includes('劑量計算')) item.instrument = '劑量計算';
                else if (d.includes('近接治療') || d.includes('Brachy')) item.instrument = 'Brachytherapy';
                // 核醫相關
                else if (d.includes('SPECT')) item.instrument = 'SPECT';
                else if (d.includes('PET')) item.instrument = 'PET';
                else if (d.includes('Gamma') || d.includes('伽瑪')) item.instrument = 'Gamma Camera';
                else if (d.includes('核子醫學診斷造影')) item.instrument = '核醫造影';
                else if (d.includes('放射免疫分析')) item.instrument = '放射免疫分析';
                else if (d.includes('放射免疫')) item.instrument = '放射免疫';
                else if (d.includes('體內分析')) item.instrument = '體內分析';
                else if (d.includes('核子醫學藥物') || d.includes('核醫藥物')) item.instrument = '核醫藥物';
                else if (d.includes('核子醫學治療') || d.includes('核醫治療')) item.instrument = '核醫治療';
                else if (d.includes('核子醫學') || d.includes('核醫')) item.instrument = '核子醫學';
                // 心導管
                else if (d.includes('心導管')) item.instrument = '心導管';
                // 影像醫學相關
                // 影像醫學相關
                else if (d.includes('電腦斷層') || /\bCT\b/.test(d.toUpperCase())) item.instrument = 'CT';
                else if (d.includes('磁振') || /\bMRI\b/.test(d.toUpperCase())) item.instrument = 'MRI';
                else if (d.includes('血管攝影') || d.includes('Angio')) item.instrument = 'Angio';
                else if (d.includes('超音波')) item.instrument = 'Echo';
                else if (d.includes('乳房') || d.includes('乳攝')) item.instrument = 'Mammo';
                else if (d.includes('透視') || d.includes('Fluoro')) item.instrument = 'Fluoro';
                else if (d.includes('一般診斷攝影-第一季')) item.instrument = '一般診斷攝影-第一季';
                else if (d.includes('一般診斷攝影-第二季')) item.instrument = '一般診斷攝影-第二季';
                else if (d.includes('一般診斷攝影-骨質密度')) item.instrument = 'BMD';
                else if (d.includes('一般診斷攝影')) {
                    if (d.includes('第一季')) item.instrument = '一般診斷攝影-第一季';
                    else if (d.includes('第二季')) item.instrument = '一般診斷攝影-第二季';
                    else item.instrument = 'X-ray';
                }
                else if (d.includes('一般診斷') || d.includes('一般攝影')) {
                    if (d.includes('第一季')) item.instrument = '一般診斷攝影-第一季';
                    else if (d.includes('第二季')) item.instrument = '一般診斷攝影-第二季';
                    else item.instrument = 'X-ray';
                }
                else if (d.includes('放射治療技術')) item.instrument = '放射治療技術';
                else if (d.includes('放射治療品保')) item.instrument = '放射治療品保';
                else if (d.includes('特殊攝影')) item.instrument = 'Special';
                else if (d.includes('放射醫學影像及儀器品保')) item.instrument = '影像學';
                else if (d.includes('興趣加選')) item.instrument = '興趣加選';
            }
        }

        // --- 最終強制覆蓋：僅针對「放射醫學影像及儀器品保」子階段 ---
        // 這個判定最後執行，覆蓋所有其他判定結果。
        // 做法：直接檢查 iPhaseOrig 是否含有「放射醫學影像及儀器品保」，有則強制設為 '影像學'
        if (iPhaseOrig.includes('放射醫學影像及儀器品保')) {
            item.instrument = '影像學';
        }

        // 學員姓名 - 使用通用模式
        // 方法1: 從流程中抓取 (學員) 標記
        let flowStudentMatch = cleanText.match(/([\u4e00-\u9fa5]{2,10})\s*\(學員\)/);
        if (flowStudentMatch) item.studentName = flowStudentMatch[1];

        // 方法2: 從簽名檔抓取最後一個簽名（通常是學員）
        if (item.studentName === '未知') {
            let allSigs = [...raw.matchAll(/class="e_signature_name[^"]*">([\u4e00-\u9fa5]{2,10})<\/td>/gi)];
            if (allSigs.length > 0) item.studentName = allSigs[allSigs.length - 1][1];
        }

        // 方法3: 從「學員姓名」標籤抓取
        if (item.studentName === '未知') {
            let labelMatch = raw.match(/學員姓名[:：]\s*([\u4e00-\u9fa5]{2,10})/);
            if (labelMatch) item.studentName = labelMatch[1];
        }

        // 方法4: 從 SingleLineString input 抓取任意學員 (排除已知導師)
        if (item.studentName === '未知') {
            let inputs = [...raw.matchAll(/SingleLineString[^"]*[^>]*value="([\u4e00-\u9fa5]{2,10})"/gi)];
            if (inputs.length > 0) {
                for (let inp of inputs) {
                    if (!inp[1].includes('林國基')) {
                        item.studentName = inp[1]; break;
                    }
                }
            }
        }

        // 負責教師提取邏輯
        // 方法1: 從「導師姓名」標籤或對應的 input 抓取 - 增加 DOM 輔助
        let teacherLabelMatch = raw.match(/(?:導師姓名|負責導師)[:：]\s*(?:<[^>]+>)*\s*([\u4e00-\u9fa5]{2,10})/i) ||
            raw.match(/name="SingleLineString[^"]*(?:導師|教師|負責人)[^"]*"[^>]*value="([\u4e00-\u9fa5]{2,10})"/i);

        if (!teacherLabelMatch) {
            // DOM 備援：搜尋內容包含「導師姓名」的 label 之後的 input
            let allGroups = doc.querySelectorAll('.form-group');
            for (let group of allGroups) {
                let labelText = group.querySelector('label')?.innerText || '';
                if (labelText.includes('導師姓名') || labelText.includes('負責導師') || labelText.includes('指導教師姓名')) {
                    let inputVal = group.querySelector('input[type="text"]')?.value;
                    if (inputVal && inputVal.trim()) {
                        item.teacherName = inputVal.trim();
                        break;
                    }
                }
            }
        } else {
            item.teacherName = teacherLabelMatch[1];
        }

        if (item.teacherName === '未註明' && (raw.includes('2.1.0') || ut.includes('職前自我評估'))) {
            // 規則：2.1.0 或 職前自我評估 抓流程中的「計畫導師」
            // 尋找箭頭後方的姓名且緊跟著(計畫導師)
            let mentorMatch = cleanText.match(/(?:→|->)\s*([\u4e00-\u9fa5]{2,10})\s*\(計畫導師\)/);
            if (mentorMatch) item.teacherName = mentorMatch[1];
        }

        if (item.teacherName === '未註明') {
            // 抓取簽名檔中非學員且非主持人的第一個人
            let sigMatches = raw.matchAll(/class="e_signature_name">([\u4e00-\u9fa5]{2,10})<\/td>/gi);
            for (const m of sigMatches) {
                if (m[1] !== item.studentName && !m[1].includes('林國基')) {
                    item.teacherName = m[1];
                    break;
                }
            }
        }

        if (item.teacherName === '未註明') {
            // 備選流程抓取 (排除主持人)
            // 模式1: Teacher -> Student
            let flowMatch1 = cleanText.match(/([\u4e00-\u9fa5]{2,10})\s*\([^)]*(?:教師|導師|負責人|管理員)[^)]*\)\s*(?:→|->)\s*([\u4e00-\u9fa5]{2,10})\s*\(學員\)/i);
            if (flowMatch1) item.teacherName = flowMatch1[1];

            // 模式2: Student -> Teacher (輔導紀錄常見)
            let flowMatch2 = cleanText.match(/([\u4e00-\u9fa5]{2,10})\s*\(學員\)\s*(?:→|->)\s*([\u4e00-\u9fa5]{2,10})\s*\([^)]*(?:教師|導師|負責人|管理員)[^)]*\)/i);
            if (flowMatch2 && item.teacherName === '未註明') item.teacherName = flowMatch2[2];
        }

        // --- 4. 分數計算 ---
        const findValue = (key) => {
            let r = new RegExp(key + "[\\s\\S]*?<input[^>]*value=\"([\\d.]+)\"", "i");
            let m = raw.match(r); return m ? m[1] : "";
        };

        if (item.isInternGeneralFeedback || item.type === '輔導紀錄') {
            item.scoreRaw = "";
        } else if (item.title.includes('到職訓練') || item.title.includes('職前自我評估')) {
            let pts = 0, count = 0;
            let matches = raw.matchAll(/checked[^>]*value="(\d+)"/gi);
            for (const m of matches) { let v = parseInt(m[1]); if (v >= 1 && v <= 5) { pts += v; count++; } }
            if (count > 0) {
                let final = (pts / (count * 5)) * 100;
                item.scoreRaw = (final > 100 ? 100 : final).toFixed(0);
            }
        } else if (isEffectivenessFeedback) {
            let scores = []; let matches = raw.matchAll(/checked[^>]*value="(\d+)"/gi);
            for (const m of matches) { if (parseInt(m[1]) <= 10) scores.push(parseInt(m[1])); }
            if (scores.length > 0) item.scoreRaw = ((scores.reduce((a, b) => a + b, 0) / scores.length) * 10).toFixed(0);
        } else {
            // v1.2: 擴充分數提取模式，支援滿意度問卷等更多格式
            let totalMatch = cleanText.match(/(?:評量總分數|滿意度總分數|成績|平均分數|總分|整體評分|分數)[:：\s]*(\d{1,3}(?:\.\d+)?)/i);

            // v1.1: 優先嘗試匹配 DOPS/Mini-CEX 格式 (1-10/1-5 量表) - 使用 DOM 解析更準確
            let scaleScores = [];
            let maxValInScale = 0;
            let checkedInputs = doc.querySelectorAll('input[checked]');

            checkedInputs.forEach(input => {
                let val = parseInt(input.value);
                let name = input.getAttribute('name') || '';

                if (!isNaN(val) && val >= 1 && val <= 10) {
                    if (name.includes('ScaleType') || (!name.includes('ChoiceType') && !name.includes('MultiLineString'))) {
                        scaleScores.push(val);
                        if (val > maxValInScale) maxValInScale = val;
                    }
                }
            });

            if (scaleScores.length > 0) {
                // 自動判斷量表範圍
                // 若最大值 <= 5，通常為 1-5 分制 (如滿意度問卷)，則 * 20 換算為 100 分
                // 若最大值 > 5，通常為 1-10 分制 (如 DOPS/Mini-CEX)，則 * 10 換算為 100 分
                let multiplier = (maxValInScale <= 5) ? 20 : 10;
                let avgCalculated = (scaleScores.reduce((a, b) => a + b, 0) / scaleScores.length) * multiplier;

                // 邏輯優化：
                // 1. 如果 regex 抓到的是很明確的關鍵字如 "滿意度總分數"、"評量總分數" 或 "成績"，則信任它
                // 2. 如果 regex 抓到的是模糊的 "分數"，且我們有計算值，則優先使用計算值（避免抓到說明文字中的 "70分"）
                let isSpecificMatch = totalMatch && (totalMatch[0].includes("總分數") || totalMatch[0].includes("成績") || totalMatch[0].includes("總分"));

                if (!totalMatch || (!isSpecificMatch)) {
                    totalMatch = [null, avgCalculated.toFixed(0)];
                }
            } else if (!totalMatch) {
                totalMatch = null;
            }
            item.scoreRaw = totalMatch ? totalMatch[1] : findValue("專業知識");
        }

        if (item.scoreRaw !== "" && item.scoreRaw !== "--" && !isNaN(parseFloat(item.scoreRaw))) {
            if (parseFloat(item.scoreRaw) > 100) item.scoreRaw = "100";
        }

        if (item.type === '實習總評量表') {
            let sms = ["一般診斷攝影與品保", "特殊攝影與介入性診療與品保", "血管攝影與品保", "超音波造影與品保", "心導管技術與品保", "磁振造影與品保", "電腦斷層造影與品保", "放射醫學影像品保", "核子醫學診斷", "放射免疫分析", "體內分析", "核子醫學藥物", "核子醫學治療", "放射治療技術", "模擬攝影", "模具製作", "放射治療計畫", "劑量計算", "品德操守"];
            sms.forEach(n => {
                let val = findValue(n);
                if (val) item.stationScores.push({ label: n, value: val });
            });
        }

        // 學期測驗及實務操作評核成績紀錄表 特殊處理
        if (item.title.includes('學期測驗') || item.title.includes('成績紀錄表')) {
            item.type = '實習總評量表'; // 歸類為總評量表

            // 定義所有欄位 - 使用更精確的匹配
            let fields = [
                { pattern: "臨床案例教學與討論\\(1\\)", label: "臨床案例教學與討論(1)" },
                { pattern: "臨床案例教學與討論\\(2\\)", label: "臨床案例教學與討論(2)" },
                { pattern: "臨床案例教學與討論\\(3\\)", label: "臨床案例教學與討論(3)" },
                { pattern: "臨床案例教學與討論\\(4\\)", label: "臨床案例教學與討論(4)" },
                { pattern: "筆試測驗\\(期初\\)", label: "筆試測驗(期初)" },
                { pattern: "筆試測驗\\(期末\\)", label: "筆試測驗(期末)" }
            ];

            let allScores = [];
            fields.forEach(f => {
                let r = new RegExp(f.pattern + "[\\s\\S]*?<input[^>]*value=\"([\\d.]+)\"", "i");
                let m = raw.match(r);
                if (m && m[1]) {
                    item.stationScores.push({ label: f.label, value: m[1] });
                    allScores.push(parseFloat(m[1]));
                }
            });

            // 口頭報告平均成績 - 可能有多筆
            let oralMatches = [...raw.matchAll(/口頭報告平均成績[\s\S]*?<input[^>]*value="([\d.]+)"/gi)];
            oralMatches.forEach((m, idx) => {
                let label = oralMatches.length > 1 ? `口頭報告(${idx + 1})` : "口頭報告";
                item.stationScores.push({ label: label, value: m[1] });
                allScores.push(parseFloat(m[1]));
            });

            // 書面報告平均成績 - 可能有多筆
            let writtenMatches = [...raw.matchAll(/書面報告平均成績[\s\S]*?<input[^>]*value="([\d.]+)"/gi)];
            writtenMatches.forEach((m, idx) => {
                let label = writtenMatches.length > 1 ? `書面報告(${idx + 1})` : "書面報告";
                item.stationScores.push({ label: label, value: m[1] });
                allScores.push(parseFloat(m[1]));
            });

            // 計算平均分數作為主要分數
            if (allScores.length > 0) {
                let avg = allScores.reduce((a, b) => a + b, 0) / allScores.length;
                item.scoreRaw = avg.toFixed(1);
            }
        }


        // --- EPA OPA 分數與回饋提取 ---
        if (item.type === 'EPA') {
            let opaBlocks = raw.split(/整體任務[：:]/i);
            for (let i = 1; i <= 3; i++) {
                if (opaBlocks[i]) {
                    // 1. 提取分數 (Label 方式)
                    let checkedMatch = opaBlocks[i].match(/checked[\s\S]{0,500}?<label[^>]*>\s*(N\/A|[1-5]|[2-3][abc])\s*<\/label>/i);
                    if (checkedMatch) {
                        item.opaScores['opa' + i] = checkedMatch[1].trim();
                    }
                    // 2. 提取質性回饋 (Textarea 方式)
                    let feedbackMatch = opaBlocks[i].match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
                    if (feedbackMatch) {
                        item.opaFeedbacks['opa' + i] = feedbackMatch[1].trim();
                    }
                }
            }
        }

        // --- 1.1 基礎課程 細項解析 (DOM 方式) ---
        if (item.title.includes('1.1') && item.title.includes('基礎課程')) {
            item.type = '基礎課程'; // 強制確保類型
            let passedCount = 0;
            let totalCount = 0;

            // 使用 DOM 查詢 (doc 由上方 new DOMParser().parseFromString(raw, "text/html") 產生)
            // 找出所有含有 "1. xxx" 形式的 label 所在的 form-group
            let formGroups = doc.querySelectorAll('.form-group');

            formGroups.forEach(group => {
                // 找題目 Label (通常在 label > p 或直接在 label 內)
                let labelEl = group.querySelector('label p') || group.querySelector('label');
                if (labelEl) {
                    let labelText = labelEl.innerText.trim();
                    // 檢查是否為題目 (e.g., "1.醫事放射相關法規")
                    if (/^\d+\./.test(labelText)) {
                        totalCount++;
                        // 找該題組內被 checked 的 radio
                        let checkedInput = group.querySelector('input[type="radio"]:checked');
                        let status = "未評";
                        if (checkedInput) {
                            // 找 checked input 對應的 label (通過/不通過)
                            // 根據 HTML 結構: <input id="xx"> <label for="xx">通過</label>
                            let statusLabel = group.querySelector(`label[for="${checkedInput.id}"]`);
                            if (statusLabel) {
                                status = statusLabel.innerText.trim();
                            }
                        }

                        // 加入細項成績 (顯示在卡片與 CSV 各站成績)
                        item.stationScores.push({ label: labelText, value: status });

                        if (status === '通過') {
                            passedCount++;
                        }
                    }
                }
            });

            if (totalCount > 0) {
                item.scoreRaw = `${passedCount}/${totalCount} <span class="text-[0.5em] font-sans">通過</span>`;
            }
        }

        // --- 1.2 里程碑 (Milestone) 細項解析 (DOM 方式) ---
        if (item.type === 'Milestone') {
            let formGroups = doc.querySelectorAll('.form-group');
            let currentCategory = ''; // 用於跨區塊存儲大項標題

            formGroups.forEach(group => {
                // 1. 偵測大項標題 (例如 "一、醫學影像及放射科學知識 1：放射診斷造影相關知識能力")
                let headerEl = group.querySelector('label.bg-info p') || group.querySelector('label.bg-info');
                if (headerEl) {
                    let headerText = headerEl.innerText.trim();
                    // 簡化標題：僅保留大標題 (一、... 1)
                    headerText = headerText.split('：')[0].split(':')[0].trim();

                    // 檢查是否屬於 12 大指標之一
                    TARGET_MILESTONES.forEach(target => {
                        if (headerText.includes(target) || target.includes(headerText)) {
                            currentCategory = target;
                        }
                    });
                }

                // 2. 偵測選中的 Level 等級 (僅存入 milestoneLevels，不重複存入 stationScores)
                let checkedInput = group.querySelector('input[type="radio"]:checked');

                if (checkedInput && currentCategory) {
                    let statusLabel = group.querySelector(`label[for="${checkedInput.id}"]`);
                    if (statusLabel) {
                        let status = statusLabel.innerText.trim();
                        // 提取數字部分 (例如 "Level 2" -> "2")
                        let levelMatch = status.match(/Level\s*(\d)/i) || status.match(/(\d)/);
                        if (levelMatch) {
                            item.milestoneLevels[currentCategory] = levelMatch[1];
                        }
                    }
                }
            });
            item.scoreRaw = ''; // 重置總分，里程碑不顯示總分
        }

        // --- 5. 回饋內容完整提取 (改用 DOM 遍歷以確保抓取所有符合條件的欄位) ---
        // Specific labels come first: "教師回饋意見-建議加強項目" must match 建議加強項目, not 教師回饋意見.
        const feedbackKeywords = [
            "表現良好項目", "建議加強項目", "改善項目", "待加強",
            "臨床指導教師評估與回饋", "評估者回饋", "教師回饋意見", "教師回饋",
            "導師回應", "教學負責人回應", "負責人回應",
            "對於如何增進實習效果的建議", "實習心得", "學員職前期許", "學生對實習醫院之建議",
            "學生對學校之建議", "受評者回饋意見", "學員回饋", "學生其它建議", "訪談記錄", "導師意見"
        ];

        // Every labelled text box, in form order; toRecord() keeps the ones not shown elsewhere.
        item.formFields = [];
        let allFormGroups = doc.querySelectorAll('.form-group');
        allFormGroups.forEach(group => {
            let labelElement = group.querySelector('label');
            let textareaElement = group.querySelector('textarea');
            if (labelElement && textareaElement) {
                let labelText = labelElement.innerText.trim();
                let content = textareaElement.value.trim() || textareaElement.innerText.trim();

                if (content && !["無", "沒有", "無建議", "無。", "無建議。"].includes(content)) {
                    const fieldLabel = labelText.replace(/\s+/g, ' ').replace(/\s*[:：]\s*$/, '').trim();
                    if (fieldLabel) item.formFields.push({ label: fieldLabel, content });
                    // 偵測是否為感興趣的欄位
                    let matchedKeyword = feedbackKeywords.find(kw => labelText.includes(kw));
                    // 或者是特殊回饋單 (isInternGeneralFeedback) 的序號標題
                    let isSpecialHeader = item.isInternGeneralFeedback && /^\(\d+\)/.test(labelText);

                    if (matchedKeyword || isSpecialHeader) {
                        let displayLabel = matchedKeyword || labelText.replace(/[:：]/g, '').trim();
                        item.feedbacks.push({
                            label: displayLabel,
                            content: content,
                            type: displayLabel.includes('教師') || displayLabel.includes('評核') || displayLabel.includes('導師') || displayLabel.includes('負責人') || displayLabel.includes('訪談') ? 'teacher' : 'student'
                        });
                    }
                }
            }
        });

        // --- 精準日期提取 (優先搜尋「評量日期」欄位) ---
        let finalDate = "";
        let labels = doc.querySelectorAll('label');
        for (let lb of labels) {
            if (lb.innerText.includes('評量日期')) {
                let group = lb.closest('.form-group');
                if (group) {
                    let inp = group.querySelector('input[type="text"]');
                    if (inp && inp.value && /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(inp.value)) {
                        finalDate = inp.value.trim().replace(/\//g, '-');
                        break;
                    }
                }
            }
        }

        if (!finalDate) {
            let dateMatches = raw.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
            finalDate = dateMatches ? dateMatches[1].replace(/\//g, '-') : "1900-01-01";
        }
        item.date = finalDate;

        // 針對輔導紀錄的特殊處理 (優先根據科別判定)
        if (item.type === '輔導紀錄' && !item.instrument) {
            if (item.department.includes('放射治療')) item.instrument = '放射治療';
            else if (item.department.includes('核子醫學')) item.instrument = '核子醫學';
        }

        return item;
    } catch (e) { return null; }
}

// The original exam CSV reader; a missing score stays blank.
function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];
    
    const results = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // 更穩健的 CSV 解析：僅在引號外分割逗號，並保留欄位內的空格
        const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
        
        if (cols.length < 7) continue;
        
        const [status, target, paperName, teacher, student, date, score] = cols;
        if (!student || !date) continue; // 基本校驗

        let instrument = '';
        const combinedText = ((target || '') + ' ' + (paperName || '')).toUpperCase();
        if (combinedText.includes('基礎課程')) instrument = '基礎課程';
        else if (combinedText.includes('學前總評估')) instrument = '學前總評估';
        else if (combinedText.includes('學後總評估')) instrument = '學後總評估';
        else if (combinedText.includes('磁振')) instrument = 'MRI';
        else if (combinedText.includes('一般診斷')) instrument = 'X-ray';
        else if (combinedText.includes('乳房')) instrument = 'Mammo';
        else if (combinedText.includes('電腦斷層')) instrument = 'CT';
        else if (combinedText.includes('血管')) instrument = 'Angio';
        else if (combinedText.includes('超音波')) instrument = 'Echo';
        else if (combinedText.includes('核子醫學')) instrument = '核子醫學';
        else if (combinedText.includes('放射治療')) instrument = '放射治療';
        else if (combinedText.includes('心導管')) instrument = '心導管';

        results.push({
            id: 'csv-' + Math.random().toString(36).substr(2, 9),
            type: '筆試成績',
            department: (target || '').includes('科') ? target.split('-').pop() : '影像醫學科',
            title: paperName || '未命名測驗',
            date: date || '1900-01-01',
            scoreRaw: score || '',
            studentName: student || '未知',
            teacherName: teacher || '未註明',
            instrument: instrument,
            stationScores: [],
            feedbacks: [],
            milestoneLevels: {}
        });
    }
    return results;
}

// Same columns the original CSV conversion produced, so records match the earlier import exactly.
const RECORD_HEADERS = [
    "執行日期", "學員姓名", "教師/主持人", "類型", "科別", "表單標題", "總分",
    "OPA1", "OPA1回饋", "OPA2", "OPA2回饋", "OPA3", "OPA3回饋",
    "表現良好項目", "建議加強項目", "學員回饋意見", "訓練別編號", "儀器別", "各站成績",
    ...TARGET_MILESTONES, "訓練類別"
];

function toRecord(form) {
    let feedbackGood = '';
    let feedbackNeeds = '';
    let studentFeedback = '';
    form.feedbacks.forEach(f => {
        if (f.label.includes('良好') || f.label.includes('表現')) feedbackGood = f.content;
        else if (f.label.includes('加強') || f.label.includes('改善')) feedbackNeeds = f.content;
        else if (f.label.includes('學員') || f.label.includes('心得')) studentFeedback = f.content;
    });
    const noScore = form.type === 'EPA' || form.type === 'Milestone' || form.title.toUpperCase().includes('EPA') || form.title.toUpperCase().includes('里程碑');
    const row = [
        form.date, form.studentName, form.teacherName, form.type, form.department, form.title, noScore ? '' : form.scoreRaw,
        form.opaScores?.opa1, form.opaFeedbacks?.opa1, form.opaScores?.opa2, form.opaFeedbacks?.opa2,
        form.opaScores?.opa3, form.opaFeedbacks?.opa3,
        feedbackGood, feedbackNeeds, studentFeedback,
        form.department, form.instrument, form.stationScores.map(s => s.label + ':' + s.value).join('; '),
        ...TARGET_MILESTONES.map(label => form.milestoneLevels?.[label] || ''),
        form.trainingProgram
    ].map(value => String(value ?? '').replace(/\r/g, ''));
    const record = recordFromRow(RECORD_HEADERS, row);
    // Text boxes already shown as 表現良好／建議加強／學員回饋 or OPA feedback are not repeated.
    const shown = new Set([record.feedbackGood, record.feedbackNeeds, record.studentFeedback,
        ...Object.values(record.opaFeedbacks)].map(text => String(text || '').trim()).filter(Boolean));
    record.formFields = (form.formFields || []).filter(field => !shown.has(field.content.trim()));
    return record;
}

return { analyzeHTML, parseCSV, toRecord };
})();

/* File import, drag and drop, e-Portfolio bookmark and CSV export */
const PORTFOLIO_FILE_EXTENSION = /\.(?:html?|csv)$/i;

// This function is serialized into the user's bookmark and runs on the e-Portfolio page.
async function sendEPortfolioForms(appUrl, pairingKey) {
    const forms = [];
    for (const link of document.querySelectorAll('.modal-body a')) {
        if (!link.getClientRects().length) continue;
        const handler = [link.getAttribute('href'), link.getAttribute('onclick')].join(' ');
        const args = handler.match(/\bshowFillForm\s*\(([^)]*)\)/)?.[1]
            .split(',').map(value => value.trim().replace(/^(['"])(.*)\1$/, '$2'));
        if (!args || args.length < 4 || !args[0]) continue;
        const url = new URL('../form/prompt/fillForm', document.baseURI);
        url.search = new URLSearchParams({
            isWindowOpen: 'true', formKey: args[0], fromPage: 'classForm',
            refTable: args[2], refId: args[3]
        });
        const name = link.innerText.trim().replace(/[\\/:*?"<>|]/g, '_') || '表單-' + (forms.length + 1);
        forms.push({ url, name: name + '.html' });
    }

    const destination = new URL(appUrl);
    if (!forms.length || destination.origin === location.origin || !/^https?:$/.test(location.protocol)) {
        alert('請先在 e-Portfolio 開啟「表單明細」，再點此書籤。');
        return;
    }
    destination.hash = new URLSearchParams({ epImport: pairingKey, source: location.origin });
    const receiver = window.open(destination.href, '_blank');
    if (!receiver) {
        alert('瀏覽器阻擋了評量展示助手。請允許 e-Portfolio 開啟彈出式視窗，再點一次書籤。');
        return;
    }

    const port = await new Promise(resolve => {
        const timer = setTimeout(() => {
            window.removeEventListener('message', onReady);
            resolve(null);
        }, 25_000);
        function onReady(event) {
            if (event.source !== receiver || event.origin !== destination.origin ||
                event.data?.type !== 'med-portfolio-ready' || event.data.key !== pairingKey || !event.ports[0]) return;
            clearTimeout(timer);
            window.removeEventListener('message', onReady);
            resolve(event.ports[0]);
        }
        window.addEventListener('message', onReady);
    });
    if (!port) {
        alert('評量展示助手尚未連線。請確認網頁可正常開啟，並從該頁重新加入書籤。');
        return;
    }

    const files = [];
    const failedFiles = [];
    for (const { url, name } of forms) {
        if (receiver.closed) return;
        port.postMessage({ processed: files.length + failedFiles.length, total: forms.length });
        try {
            const response = await fetch(url, { mode: 'same-origin', signal: AbortSignal.timeout(20_000) });
            if (!response.ok) throw new Error('讀取表單失敗');
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const isAssessment = Array.from(doc.querySelectorAll('dt')).some(label =>
                /^訓練(?:類別|計畫)\s*[:：]?$/.test(label.textContent.trim()) &&
                label.nextElementSibling?.tagName === 'DD');
            if (!isAssessment) throw new Error('回傳頁面缺少評量表欄位');
            files.push(new File([html], name, { type: 'text/html' }));
        } catch {
            failedFiles.push(name);
        }
        if (files.length + failedFiles.length < forms.length) await new Promise(resolve => setTimeout(resolve, 800));
    }
    port.postMessage({ files, failedFiles });
}

function initializeEPortfolioTransfer() {
    const bookmark = document.getElementById('eportfolioBookmark');
    if (!bookmark || !window.isSecureContext || !/^https?:$/.test(window.location?.protocol)) return;

    const appUrl = new URL(window.location.href);
    const params = new URLSearchParams(appUrl.hash.slice(1));
    let key;
    try {
        const storageKey = 'med-portfolio-eportfolio-bookmark';
        key = localStorage.getItem(storageKey);
        if (!/^[a-f0-9]{32}$/.test(key ?? '')) {
            key = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
            localStorage.setItem(storageKey, key);
        }
    } catch {
        document.getElementById('eportfolioBookmarkNotice').textContent = '請允許這個網頁儲存書籤設定後再使用。';
        return;
    }

    appUrl.hash = '';
    const command = 'void (' + sendEPortfolioForms.toString() + ')(' +
        JSON.stringify(appUrl.href) + ',' + JSON.stringify(key) + ')';
    bookmark.href = 'javascript:' + encodeURIComponent(command);
    bookmark.addEventListener('click', event => event.preventDefault());
    bookmark.hidden = false;
    document.getElementById('eportfolioBookmarkNotice').textContent =
        '把下方連結拖到瀏覽器書籤列。回 e-Portfolio 開啟「表單明細」，再點書籤。';

    if (!params.has('epImport')) return;
    history.replaceState(null, '', appUrl.href);
    const status = document.getElementById('eportfolioTransferStatus');
    const source = params.get('source');
    const opener = window.opener;
    if (params.get('epImport') !== key || !/^https?:\/\/[^/]+$/.test(source ?? '') || !opener) {
        status.textContent = '無法連線。請在這個瀏覽器重新加入書籤，再從 e-Portfolio 開啟。';
        return;
    }

    const channel = new MessageChannel();
    const port = channel.port1;
    const interrupted = () => {
        port.close();
        status.textContent = '接收已中斷。請回 e-Portfolio 確認登入狀態，再點一次書籤。';
    };
    let timer = setTimeout(interrupted, 90_000);
    status.textContent = '已連線，等待 e-Portfolio 讀取表單…';
    port.onmessage = async ({ data }) => {
        if (Number.isSafeInteger(data?.processed) && Number.isSafeInteger(data.total)) {
            clearTimeout(timer);
            timer = setTimeout(interrupted, 90_000);
            status.textContent = '正在讀取 e-Portfolio 表單 ' + data.processed + '／' + data.total;
            return;
        }
        if (!Array.isArray(data?.files) || !Array.isArray(data.failedFiles) ||
            !data.files.every(file => file instanceof File && /\.html$/i.test(file.name)) ||
            !data.failedFiles.every(name => typeof name === 'string')) return;

        clearTimeout(timer);
        port.close();
        status.textContent = '';
        const summary = (await queuePortfolioImport(() => data.files)) ??
            { added: 0, duplicates: 0, failedFiles: [] };
        if (data.failedFiles.length) {
            showImportStatus({ ...summary, failedFiles: [...data.failedFiles, ...summary.failedFiles] });
        }
    };
    opener.postMessage({ type: 'med-portfolio-ready', key }, source, [channel.port2]);
}

function isExamQueryCSV(text, fileName) {
    const [header = '', firstRow = ''] = text.split(/\r?\n/, 2);
    const headers = header.replace(/^\uFEFF/, '').split(',')
        .map(cell => cell.trim().replace(/^"|"$/g, ''));
    const has = label => headers.includes(label);

    // Give the existing assessment layouts priority over exam-file heuristics.
    if (has('來源檔案') || has('表單標題') ||
        (has('類型') && (has('評量日期') || has('執行日期') || has('教師/主持人')))) return false;

    if (fileName.includes('測驗查詢') || headers.some(label => /測驗名稱|試卷名稱|應試日期|作答日期|測驗狀態/.test(label))) {
        return true;
    }

    // The exam reader is positional, so a renamed file can still be recognized.
    const columns = firstRow.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
        .map(cell => cell.trim().replace(/^"|"$/g, ''));
    const looksLikeDate = value => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s|T|$)/.test(value || '');
    return columns.length >= 7 && !looksLikeDate(columns[0]) && looksLikeDate(columns[5]);
}

function readPortfolioFile(text, fileName) {
    if (/\.html?$/i.test(fileName)) {
        const form = htmlFormReader.analyzeHTML(text);
        return form ? [htmlFormReader.toRecord(form)] : null;
    }
    if (isExamQueryCSV(text, fileName)) {
        const records = htmlFormReader.parseCSV(text).map(htmlFormReader.toRecord);
        return records.length ? records : null;
    }
    return analyzeCSV(text);
}

async function filesInPortfolioEntry(entry) {
    if (entry.isFile) {
        if (!PORTFOLIO_FILE_EXTENSION.test(entry.name)) return [];
        return [await new Promise((resolve, reject) => entry.file(resolve, reject))];
    }

    if (!entry.isDirectory) return [];
    const reader = entry.createReader();
    const entries = [];
    for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        entries.push(...batch);
    }
    return (await Promise.all(entries.map(filesInPortfolioEntry))).flat();
}

async function readPortfolioDrop(transfer) {
    const items = Array.from(transfer.items || []).filter(item => item.kind === 'file');
    const fallback = Array.from(transfer.files || []);
    const entries = items.map(item => item.getAsEntry?.() || item.webkitGetAsEntry?.());
    if (!entries.some(entry => entry?.isDirectory)) return fallback;
    // Collect entries and File objects during the drop event, before awaiting any directory reads.
    const groups = await Promise.all(items.map((item, index) => {
        if (entries[index]) return filesInPortfolioEntry(entries[index]);
        const file = item.getAsFile?.();
        return file ? [file] : [];
    }));
    return groups.flat();
}

function exportPortfolioCSV() {
    if (!historyData.length) {
        alert('目前沒有資料可匯出，請先匯入檔案');
        return;
    }

    const headers = [
        '執行日期', '學員姓名', '教師/主持人', '類型', '科別', '表單標題', '總分',
        'OPA1', 'OPA1回饋', 'OPA2', 'OPA2回饋', 'OPA3', 'OPA3回饋',
        '表現良好項目', '建議加強項目', '學員回饋意見', '訓練別編號',
        '儀器別', '各站成績', '操作項目', ...TARGET_MILESTONES, '訓練類別', OTHER_FIELDS_HEADER
    ];
    const rows = historyData.map(item => [
        item.date, item.studentName, item.teacherName, item.type, item.trainingType, item.title, item.scoreRaw,
        item.opaScores?.[1], item.opaFeedbacks?.[1], item.opaScores?.[2], item.opaFeedbacks?.[2],
        item.opaScores?.[3], item.opaFeedbacks?.[3], item.feedbackGood, item.feedbackNeeds, item.studentFeedback,
        item.trainingType, item.instrumentType, item.stationDetails, item.skillName,
        ...TARGET_MILESTONES.map(label => item.milestoneLevels?.[label]),
        item.trainingProgram, formatFormFields(item.formFields)
    ]);
    // Text starting with = + - @ (or tab/CR) would run as a formula in Excel; prefix it with '.
    const guard = text => (/^[=+\-@\t\r]/.test(text) && !/^[-+]?\d+(\.\d+)?$/.test(text) ? "'" + text : text);
    const quote = value => '"' + guard(String(value ?? '')).replace(/"/g, '""') + '"';
    const csv = [headers, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
    const names = new Set(historyData.map(item => item.studentName).filter(Boolean));
    const name = names.size === 1 ? names.values().next().value : '評量資料';
    const dates = historyData.map(item => item.date).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || '')).sort();
    const suffix = dates.length ? '_' + dates[0] + '~' + dates[dates.length - 1] : '';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = (name + suffix).replace(/[\/\\:*?"<>|]/g, '_') + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
