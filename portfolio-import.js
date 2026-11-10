const PORTFOLIO_FILE_EXTENSION = /\.(?:html?|csv)$/i;

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
        const record = legacyPortfolio.analyzeHTML(text);
        return record ? analyzeCSV(legacyPortfolio.toPortfolioCSV([record])) : null;
    }
    if (isExamQueryCSV(text, fileName)) {
        const records = legacyPortfolio.parseCSV(text);
        return records.length ? analyzeCSV(legacyPortfolio.toPortfolioCSV(records)) : null;
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
        '儀器別', '各站成績', '操作項目', ...TARGET_MILESTONES
    ];
    const rows = historyData.map(item => [
        item.date, item.studentName, item.teacherName, item.type, item.trainingType, item.title, item.scoreRaw,
        item.opaScores?.[1], item.opaFeedbacks?.[1], item.opaScores?.[2], item.opaFeedbacks?.[2],
        item.opaScores?.[3], item.opaFeedbacks?.[3], item.feedbackGood, item.feedbackNeeds, item.studentFeedback,
        item.trainingType, item.instrumentType, item.stationDetails, item.skillName,
        ...TARGET_MILESTONES.map(label => item.milestoneLevels?.[label])
    ]);
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
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
