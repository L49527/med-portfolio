const fs = require('fs');

// Mock DOM
const window = {};

// Load parser
const parserCode = fs.readFileSync('/Users/chl/Desktop/med-portfolio-main/parser.js', 'utf8');
eval(parserCode);

const csvData = fs.readFileSync('/Users/chl/Desktop/ePortfolio_Export_v1.2.csv', 'utf8');
const result = analyzeCSV(csvData);
console.log(result ? `Success! Parsed ${result.length} items.` : 'Failed. result is null');
if (result && result.length > 0) {
    console.log("First item instrumentType: ", result[result.length - 1].instrumentType);
}
