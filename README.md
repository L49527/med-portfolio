# 醫學教育評量展示助手 (Medical Education Assessment Dashboard)

## 匯入與匯出

展開左側匯入區，選取或拖放 e-Portfolio HTML 評量表、筆試查詢 CSV 或原有評量 CSV，也可選取資料夾批次匯入。匯入後可使用評量類型、訓練別及儀器別篩選。右上角的「匯出 CSV」會下載目前已匯入的全部紀錄。

### 從 e-Portfolio 直接匯入

1. 開啟評量展示助手的 HTTPS 網頁版，展開左側「從 e-Portfolio 直接匯入」，把「匯入 e-Portfolio 表單」拖到瀏覽器書籤列。
2. 在同一個瀏覽器登入 e-Portfolio，開啟「表單明細」，點剛加入的書籤。瀏覽器會另開評量展示助手並匯入這批表單。
3. 在新分頁確認新增、重複及失敗筆數。更換瀏覽器或清除網站資料後，請重新加入書籤。

### 2026-11-10：整合 e-Portfolio 匯入
- HTML 評量表及筆試查詢 CSV 沿用原匯出助手的讀取規則，原有評量 CSV 繼續使用既有解析器。
- 筆試缺漏分數保留空白。匯入成功提示約 4 秒後收起，失敗時保留檔名直到手動關閉。
- 同組僅一筆有效分數時，成果展用單一直立長條顯示分數和日期。學前／學後圖表沿用既有呈現。

## 本機驗證

使用 Node.js 執行 `node tests/test.js`。測試使用匿名資料，不需私人 CSV。

### 2026-11-09：成果展選取、匯入與報告修正
- 「全不選」保留空選取；刪除、清空與再次匯入同步更新選取狀態。
- 重複匯入時比對解析後完整內容（排除隨機 ID 與衍生 HTML），跳過相同紀錄；內容不同仍保留。
- 匯入後顯示新增、重複及失敗檔案數；資料僅存在目前頁面，重新整理仍需重新匯入。
- 封面姓名、筆數與評量資料涵蓋期間依目前篩選及勾選紀錄產生；不再擴展成整月或推定受訓期間。
- 實習總評量表、輔導紀錄、單站評量及其他無圖表類型，以文字紀錄納入成果展與列印；缺少結果標示「未提供」。
- 新增總評量、輔導與單站篩選按鈕；長篇紀錄可跨頁列印。
- 修正 CSV 空引號欄位被誤讀成引號字元的問題，保留正常逸出引號內容。

## 修正記錄 (Revision History)

### 2026-04-22: 整合「筆試成績」功能 (Integration of Written Test Scores)
- **新增筆試成績支援**：系統可解析 CSV 中的「筆試成績」類型。為保持介面簡潔，筆試卡片僅顯示基本資訊與分數，不顯示回饋欄位。
  **Added Written Test Score Support**: The system parses "Written Test Score" from CSV. To keep the UI clean, test cards only display basic info and scores, excluding feedback fields.
- **新增分析圖表**：在「成果展」模式中，新增「筆試成績分析」直方圖，依類別（如 CT, MRI, 基礎課程）呈現。
  **Added Analysis Chart**: In "Exhibition" mode, a "Written Test Score Analysis" bar chart has been added, presented by category (e.g., CT, MRI, Basic Course).
- **介面優化**：為筆試成績卡片設定了專屬的靛藍色 (Indigo) 主題與評分顯示邏輯。
  **UI Optimization**: Set a dedicated Indigo theme and score display logic for written test score cards.

### 2026-04-22: 優化列印模式時間顯示 (Optimization of Print Mode Time Display)
- **更新受訓時間顯示**：將報告封面原本的「列印日期」與「列印時間」移除，改為根據匯入資料自動計算的「受訓時間」。日期範圍會自動擴展至完整月份（最早月份 1 日至最晚月份最後一日），以符合一般受訓週期。
  **Updated Training Period Display**: Replaced "Print Date" and "Print Time" on the report cover with an automatically calculated "Training Period". The date range now automatically expands to full months (from the 1st of the earliest month to the last day of the latest month) to align with standard training cycles.

### 2026-04-22: 修改報告標題 (Update Report Title)
- **更新報告名稱**：將列印模式封面標題由「醫學教育成果展示報告」修改為「醫事放射師PGY成果展示報告」，以更精確地反映放射師 PGY 受訓性質。
  **Updated Report Title**: Changed the report cover title from "Medical Education Assessment Report" to "Medical Radiologist PGY Assessment Report" to accurately reflect the nature of radiologist PGY training.

### 2026-04-22: 優化筆試成績圖表呈現 (Optimization of Written Test Score Chart)
- **重整圖表結構**：將「筆試成績：學前 vs 學後」圖表的 X 軸調整為以「儀器」分組，並將「學前」與「學後」設為不同顏色的資料集，使對比更清晰。
  **Reorganized Chart Structure**: Adjusted the X-axis of the "Written Test Score: Pre vs Post" chart to group by "Instrument", and set "Pre" and "Post" as datasets with different colors for clearer comparison.

### 2026-04-22: DOPS 部位互比與筆試邏輯套用 (DOPS Part Comparison & Application of Written Test Logic)
- **優化解析邏輯**：更新部位提取規則，優先從表單標題中識別「胸腹部」、「頭頸部」等細項部位，不再僅以大項儀器名稱（如 CT）進行分組。
  **Optimized Parsing Logic**: Updated part extraction rules to prioritize identifying sub-items like "Chest/Abdomen" and "Head/Neck" from form titles, rather than grouping solely by broad instrument names (e.g., CT).
- **新增部位對照長條圖**：為 DOPS、Mini-CEX 及 CbD 新增「部位細項成績分析」長條圖，套用與筆試成績相同的對照邏輯，讓不同細項間的表現一目了然。
  **Added Part Comparison Bar Chart**: Introduced "Part Sub-item Score Analysis" bar charts for DOPS, Mini-CEX, and CbD, applying the same comparison logic as written test scores to visualize performance across different sub-items clearly.
- **同步更新折線圖**：受惠於解析邏輯優化，DOPS 成長曲線折線圖現在會自動根據部位分線顯示，呈現更精確的部位互比趨勢。
  **Synchronized Line Charts**: Benefiting from optimized parsing logic, DOPS growth curve line charts now automatically display separate lines based on parts, showing more precise part comparison trends.

---

## 功能概述 (Features)
- 支援批次匯入 ePortfolio 匯出的 CSV 檔案。
  Supports batch import of CSV files exported from ePortfolio.
- 自動識別多種評量類型：DOPS, Mini-CEX, CbD, EPA, Milestone, 筆試成績。
  Automatically identifies various assessment types: DOPS, Mini-CEX, CbD, EPA, Milestone, Written Test Scores.
- 提供卡片檢視、成長互比、成果展圖表三種模式。
  Provides three modes: Card View, Growth Comparison, and Exhibition Charts.
- 支援列印功能，產出供教學成果整理與評鑑準備使用的報告。
  Supports printing functionality to produce reports for teaching reviews and accreditation preparation.
