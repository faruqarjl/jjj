/**
 * Stock Manager Template — inventory read/write helpers.
 */

/**
 * Adds or updates an item in the Inventory sheet.
 * If itemId already exists, its fields are updated; otherwise a new row is appended.
 */
function upsertItem(itemId, name, category, quantity, unit, unitPrice, reorderLevel) {
  const sheet = getSheet_(INVENTORY_SHEET);
  const data = sheet.getDataRange().getValues();
  const now = new Date();

  for (let row = 1; row < data.length; row++) {
    if (data[row][0] === itemId) {
      sheet.getRange(row + 1, 1, 1, INVENTORY_HEADERS.length).setValues([[
        itemId, name, category, quantity, unit, unitPrice, reorderLevel, now
      ]]);
      return row + 1;
    }
  }

  sheet.appendRow([itemId, name, category, quantity, unit, unitPrice, reorderLevel, now]);
  return sheet.getLastRow();
}

/** Finds the 1-indexed row number for an item ID, or -1 if not found. */
function findItemRow_(itemId) {
  const sheet = getSheet_(INVENTORY_SHEET);
  const ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === itemId) return i + 2;
  }
  return -1;
}

/**
 * Adjusts an item's quantity by delta (positive for stock in, negative for stock out)
 * and logs the movement to the Transactions sheet.
 */
function adjustStock(itemId, delta, notes) {
  const row = findItemRow_(itemId);
  if (row === -1) {
    throw new Error('Item not found: ' + itemId);
  }

  const inventorySheet = getSheet_(INVENTORY_SHEET);
  const quantityCell = inventorySheet.getRange(row, 4);
  const newQuantity = quantityCell.getValue() + delta;
  if (newQuantity < 0) {
    throw new Error('Insufficient stock for item: ' + itemId);
  }

  quantityCell.setValue(newQuantity);
  inventorySheet.getRange(row, 8).setValue(new Date());

  const itemName = inventorySheet.getRange(row, 2).getValue();
  logTransaction_(itemId, itemName, delta >= 0 ? 'IN' : 'OUT', Math.abs(delta), notes || '');

  return newQuantity;
}

function logTransaction_(itemId, itemName, type, quantity, notes) {
  const sheet = getSheet_(TRANSACTIONS_SHEET);
  sheet.appendRow([new Date(), itemId, itemName, type, quantity, notes]);
}

function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error('Sheet "' + name + '" not found. Run setupSpreadsheet() first.');
  }
  return sheet;
}
