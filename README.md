# 醫學教育評量展示助手 (Medical Education Assessment Dashboard)

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
- 支援列印功能，產出符合教學醫院評鑑標準的報告。
  Supports printing functionality to produce reports meeting teaching hospital accreditation standards.
