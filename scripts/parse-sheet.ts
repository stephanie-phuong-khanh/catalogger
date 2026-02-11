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
 * TODO: Count the number of unique products in the sheet using script.
 */

const FILENAME = '2025-2026 Ecommerce Saunas 08-01-2025 Final - Revised.xlsx';
const OUTPUT_FILENAME = 'golden_designs_sheet1.json';
const PRODUCTS_OUTPUT_FILENAME = 'golden_designs_products.json';

const workbook = xlsx.readFile(`data/${FILENAME}`);
const sheetNames = workbook.SheetNames;
console.log(sheetNames);

// Print the first sheet data.
// [HARDCODED] Row 4 is headers. SKU is column B. Products are rows where column B is non-empty. Features span multiple rows.
// TODO: LLM-assisted parsing, where the LLM analyzes the sheet structure and we use it to parse the sheet programmatically.
const firstSheet = workbook.Sheets[sheetNames[0]];
const firstSheetData = xlsx.utils.sheet_to_json(firstSheet, { range: 3 });
// fs.writeFileSync(`data/${OUTPUT_FILENAME}`, JSON.stringify(firstSheetData, null, 2));
// console.log(`Wrote ${OUTPUT_FILENAME} to data/ folder.`);

const SKU_COLUMN_HEADER = 'GDINA Item #';
let currentProduct: any = null;
const products: any[] = [];
for (const row of firstSheetData) {
    if ((row as any)[SKU_COLUMN_HEADER]) {
        if (currentProduct !== null) {
            products.push(currentProduct);
        }
        currentProduct = row;
    } else if (currentProduct !== null) {
        for (const key in row as any) {
            const val = (row as any)[key];
            if (val !== undefined && val !== '') {
                currentProduct[key] = currentProduct[key] ? currentProduct[key] + ' --- ' + val : val;
            }
        }
    }
}
if (currentProduct !== null) {
    products.push(currentProduct);
}
fs.writeFileSync(`data/${PRODUCTS_OUTPUT_FILENAME}`, JSON.stringify(products, null, 2));
console.log(`Wrote ${PRODUCTS_OUTPUT_FILENAME} to data/ folder.`);
