/**
 * Stock Manager Template — low stock alerts and menu prompts.
 */

/** Returns items whose quantity is at or below their reorder level. */
function getLowStockItems() {
  const sheet = getSheet_(INVENTORY_SHEET);
  const data = sheet.getDataRange().getValues();
  const lowStock = [];

  for (let row = 1; row < data.length; row++) {
    const [itemId, name, category, quantity, unit, unitPrice, reorderLevel] = data[row];
    if (itemId === '') continue;
    if (quantity <= reorderLevel) {
      lowStock.push({ itemId, name, category, quantity, unit, reorderLevel });
    }
  }

  return lowStock;
}

function checkLowStock() {
  const lowStock = getLowStockItems();
  const ui = SpreadsheetApp.getUi();

  if (lowStock.length === 0) {
    ui.alert('No items are below their reorder level.');
    return;
  }

  const lines = lowStock.map(function (item) {
    return item.name + ' (' + item.itemId + '): ' + item.quantity + ' ' + item.unit +
      ' left, reorder at ' + item.reorderLevel;
  });
  ui.alert('Low stock items:\n\n' + lines.join('\n'));
}

function promptStockIn() {
  promptStockChange_(1, 'Stock In');
}

function promptStockOut() {
  promptStockChange_(-1, 'Stock Out');
}

function promptStockChange_(sign, title) {
  const ui = SpreadsheetApp.getUi();

  const idResponse = ui.prompt(title, 'Item ID:', ui.ButtonSet.OK_CANCEL);
  if (idResponse.getSelectedButton() !== ui.Button.OK) return;
  const itemId = idResponse.getResponseText().trim();

  const qtyResponse = ui.prompt(title, 'Quantity:', ui.ButtonSet.OK_CANCEL);
  if (qtyResponse.getSelectedButton() !== ui.Button.OK) return;
  const quantity = Number(qtyResponse.getResponseText().trim());

  if (!itemId || isNaN(quantity) || quantity <= 0) {
    ui.alert('Invalid item ID or quantity.');
    return;
  }

  try {
    const newQuantity = adjustStock(itemId, sign * quantity, title);
    ui.alert('Updated ' + itemId + '. New quantity: ' + newQuantity);
  } catch (err) {
    ui.alert('Error: ' + err.message);
  }
}
