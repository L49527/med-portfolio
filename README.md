# 評量展示助手 v1.0 (Refactored)

> 輔仁大學附設醫院 | 醫學教育評量資料視覺化展示工具

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-v1.0-green.svg)

## 📋 專案簡介

**評量展示助手** 是一個專為醫學教育設計的純前端資料視覺化工具。它能將複雜的評量 CSV 資料（如 DOPS, Mini-CEX, EPA, Milestone）轉換為直觀的互動式儀表板，協助教學部、教師與學員檢視學習成效。

## ✨ 核心功能

### 1. 多維度展示模式
- **🃏 卡片模式 (Card View)**：以資訊卡形式瀏覽單筆評量細節，支援狀態燈號與分數強調。
- **📊 互比模式 (Compare View)**：以表格形式橫向比對同一學員在不同時間點的成長軌跡（支援 Milestone/EPA/技能評量）。
- **🏆 成果展模式 (Exhibition View)**：自動生成雷達圖與趨勢圖，視覺化呈現主要核心能力（Core Competencies）與信賴授權等級（EPA Levels）。

### 2. 強大資料處理
- **批次匯入**：支援拖放多個 CSV 檔案一次匯入。
- **智慧篩選**：可依「評量類型」、「學員姓名」、「訓練別」與「儀器別」快速篩選資料。
- **自動解析**：內建解析器自動處理不同格式的評量資料（DOPS, Cbeta, etc.）。

### 3. 教學品管後台
- **師生回饋檢核**：自動分析教師評語與學員回饋的品質，標示過短或敷衍的內容。
- **相關性分析**：分析 DOPS 分數與 Milestone 等級的關聯性。
- **教師給分偏好**：統計不同教師的平均給分趨勢。

### 4. 其它特色
- **🖨️ 友善列印**：專為 A4 橫式列印優化的 CSS 設定，適合產出紙本成果報告。
- **🔒 資料隱私**：採純前端架構 (No-Server)，所有資料運算皆在瀏覽器本地完成，確保機敏資料不外流。

## 🚀 檔案結構 (v1.0 重構版)

本專案已採用現代化模組設計，易於維護：

```bash
├── index.html       # 主程式入口 (開啟此檔案即可使用)
├── style.css        # 視覺樣式 (含 Tailwind 客製與列印設定)
├── app.js           # 應用程式邏輯 (介面互動、圖表渲染)
├── parser.js        # 資料核心 (CSV 解析、常數定義)
├── logo.png         # 醫院 Logo
└── README.md        # 專案說明文件
```

## 🛠️ 技術堆疊

- **核心**：HTML5, CSS3, Vanilla JavaScript (ES6+)
- **框架/庫**：
    - [Tailwind CSS](https://tailwindcss.com/) - 實用優先的 CSS 框架
    - [Chart.js](https://www.chartjs.org/) - 互動式圖表繪製
    - [Font Awesome](https://fontawesome.com/) - 圖示庫

## 📖 使用方式

1. **開啟程式**：直接雙擊資料夾中的 `index.html`。
2. **匯入資料**：將評量 CSV 檔案拖曳至左側側邊欄的虛線區域。
3. **開始使用**：使用上方過濾器篩選資料，並切換不同模式檢視成果。

## 📝 授權

MIT License

---
**Fu Jen Catholic University Hospital** | Medical Education Assessment
