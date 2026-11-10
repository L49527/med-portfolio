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
        '儀器別', '各站成績', '操作項目', ...TARGET_MILESTONES, '訓練類別'
    ];
    const rows = historyData.map(item => [
        item.date, item.studentName, item.teacherName, item.type, item.trainingType, item.title, item.scoreRaw,
        item.opaScores?.[1], item.opaFeedbacks?.[1], item.opaScores?.[2], item.opaFeedbacks?.[2],
        item.opaScores?.[3], item.opaFeedbacks?.[3], item.feedbackGood, item.feedbackNeeds, item.studentFeedback,
        item.trainingType, item.instrumentType, item.stationDetails, item.skillName,
        ...TARGET_MILESTONES.map(label => item.milestoneLevels?.[label]),
        item.trainingProgram
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
