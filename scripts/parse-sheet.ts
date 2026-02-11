import xlsx from 'xlsx';

// Read the sheet from the data/ folder. Make sure the .xlsx file is present.
const FILENAME = '2025-2026 Ecommerce Saunas 08-01-2025 Final - Revised.xlsx';
const workbook = xlsx.readFile(`data/${FILENAME}`);

// Print all the sheet names.
const sheetNames = workbook.SheetNames; // TODO: Confirm this is the correct function.
console.log(sheetNames);

// Print the first sheet data.
const firstSheet = workbook.Sheets[sheetNames[0]];
const firstSheetData = xlsx.utils.sheet_to_json(firstSheet);
console.log(firstSheetData);
