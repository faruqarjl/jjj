/**
 * Stock Manager Template — sheet setup.
 * Run setupSpreadsheet() once (or use the "Stock Manager > Initialize" menu)
 * to create the Inventory and Transactions sheets with headers.
 */

const INVENTORY_SHEET = 'Inventory';
const TRANSACTIONS_SHEET = 'Transactions';

const INVENTORY_HEADERS = [
  'Item ID', 'Item Name', 'Category', 'Quantity', 'Unit', 'Unit Price',
  'Reorder Level', 'Last Updated'
];

const TRANSACTIONS_HEADERS = [
  'Date', 'Item ID', 'Item Name', 'Type', 'Quantity', 'Notes'
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Stock Manager')
    .addItem('Initialize sheets', 'setupSpreadsheet')
    .addSeparator()
    .addItem('Stock In...', 'promptStockIn')
    .addItem('Stock Out...', 'promptStockOut')
    .addSeparator()
    .addItem('Check low stock', 'checkLowStock')
    .addToUi();
}

function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetWithHeaders_(ss, INVENTORY_SHEET, INVENTORY_HEADERS);
  ensureSheetWithHeaders_(ss, TRANSACTIONS_SHEET, TRANSACTIONS_HEADERS);
}

function ensureSheetWithHeaders_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  if (sheet.getLastRow() === 0 || headerRange.getValues()[0].join('') === '') {
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}
