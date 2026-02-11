import xlsx from 'xlsx';
import fs from 'fs';

/**
 * In the future, we'd like to parse the sheet intelligently, with AI recognizing the structure of the sheet
 * and inferring meaning from color-coding, bolding, etc.
 * Then the app confirms the understanding of the sheet structure with the user, then parses the sheet programmatically.
 * Currently, code will parse one sample sheet based on hardcoded structure determined from manual human inspection.
 * 
 * Random ideas for the agent sheet parsing:
 * - Have the agent find in the sheet the main column headers and subheaders and infer the meaning, creating a key-value pair for each column, the equivalent of a data dictionary in finance.
 *  For example, the Golden Designs sheet has "2025-2026 Dealer Cost", "MAP", and "MSRP" as column headers, which could be inferred using supply chain knowledge.
 * 
 * TODO: Match products on "Most Popular" sheet with products on other sheets. Programatically determine if all the data matches.
 * TODO: Count the numebr of unique products in the sheet using script.
 */

const FILENAME = '2025-2026 Ecommerce Saunas 08-01-2025 Final - Revised.xlsx';
const OUTPUT_FILENAME = 'golden_designs_sheet1.json';

// Read the sheet from the data/ folder. Make sure the .xlsx file is present.
const workbook = xlsx.readFile(`data/${FILENAME}`);

// Print all the sheet names.
const sheetNames = workbook.SheetNames; // TODO: Confirm this is the correct function.
console.log(sheetNames);

// Print the first sheet data.
const firstSheet = workbook.Sheets[sheetNames[0]];
const firstSheetData = xlsx.utils.sheet_to_json(firstSheet);

// Write the first sheet data to a JSON file.
fs.writeFileSync(`data/${OUTPUT_FILENAME}`, JSON.stringify(firstSheetData, null, 2));

console.log(`Wrote ${OUTPUT_FILENAME} to data/ folder.`);
