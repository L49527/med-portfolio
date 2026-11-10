// HTML reader adapted from export/parser.js.
const legacyPortfolio = (() => {
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
        const feedbackKeywords = [
            "臨床指導教師評估與回饋", "表現良好項目", "評估者回饋", "教師回饋意見", "教師回饋",
            "導師回應", "教學負責人回應", "負責人回應", "建議加強項目", "改善項目", "待加強",
            "對於如何增進實習效果的建議", "實習心得", "學員職前期許", "學生對實習醫院之建議",
            "學生對學校之建議", "受評者回饋意見", "學員回饋", "學生其它建議", "訪談記錄", "導師意見"
        ];

        let allFormGroups = doc.querySelectorAll('.form-group');
        allFormGroups.forEach(group => {
            let labelElement = group.querySelector('label');
            let textareaElement = group.querySelector('textarea');
            if (labelElement && textareaElement) {
                let labelText = labelElement.innerText.trim();
                let content = textareaElement.value.trim() || textareaElement.innerText.trim();

                if (content && !["無", "沒有", "無建議", "無。", "無建議。"].includes(content)) {
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

// Reuse the original export-to-display CSV field mapping.
function toPortfolioCSV(records) {
    // 欄位名稱與 評量展示助手 v1.0 完全相容
    const milestoneHeaders = [
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

    let hs = [
        "執行日期", "學員姓名", "教師/主持人", "類型", "科別", "表單標題", "總分",
        "OPA1", "OPA1回饋", "OPA2", "OPA2回饋", "OPA3", "OPA3回饋",
        "表現良好項目", "建議加強項目", "學員回饋意見", "訓練別編號", "儀器別", "各站成績",
        ...milestoneHeaders, "訓練類別"
    ];

    let rows = [hs.join(',')];

    records.forEach(i => {
        let stationText = i.stationScores.map(s => s.label + ':' + s.value).join('; ');

        // 分離回饋內容
        let feedbackGood = '';
        let feedbackNeeds = '';
        let studentFeedback = '';
        i.feedbacks.forEach(f => {
            if (f.label.includes('良好') || f.label.includes('表現')) feedbackGood = f.content;
            else if (f.label.includes('加強') || f.label.includes('改善')) feedbackNeeds = f.content;
            else if (f.label.includes('學員') || f.label.includes('心得')) studentFeedback = f.content;
        });

        // 總分輸出
        let scoreOutput = (i.type === 'EPA' || i.type === 'Milestone' || i.title.toUpperCase().includes('EPA') || i.title.toUpperCase().includes('里程碑')) ? '' : i.scoreRaw;

        // 里程碑等級欄位資料
        let mLevels = milestoneHeaders.map(h => i.milestoneLevels ? (i.milestoneLevels[h] || '') : '');

        let rowData = [
            i.date,
            i.studentName,
            i.teacherName,
            i.type,
            i.department,
            i.title,
            scoreOutput,
            i.opaScores ? i.opaScores.opa1 : '',
            i.opaFeedbacks ? i.opaFeedbacks.opa1 : '',
            i.opaScores ? i.opaScores.opa2 : '',
            i.opaFeedbacks ? i.opaFeedbacks.opa2 : '',
            i.opaScores ? i.opaScores.opa3 : '',
            i.opaFeedbacks ? i.opaFeedbacks.opa3 : '',
            feedbackGood,
            feedbackNeeds,
            studentFeedback,
            i.department, // 訓練別編號
            i.instrument, // 儀器別
            stationText,
            ...mLevels,
            i.trainingProgram
        ];

        rows.push(rowData.map(v => `"${(v || '').toString().replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '')}"`).join(','));
    });
    return rows.join('\n');
}

return { analyzeHTML, parseCSV, toPortfolioCSV };
})();
