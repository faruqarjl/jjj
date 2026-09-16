/**
 * Generic input logic for transaction sheets (BARANG MASUK, BARANG RETUR,
 * BARANG KELUAR). Every function here takes a sheetName parameter and
 * resolves columns via getConfig()/getColumnIndex() from Config.gs — none
 * of them special-case a particular sheet, so the same code serves all
 * three transaction sheets without duplication.
 */

/**
 * Appends one row to the bottom of `sheetName` (getLastRow() + 1, never
 * inserted at a fixed row) and re-applies borders. rowDataObject keys must
 * match the sheet's actual header text, e.g. { "TGL": ..., "JUMLAH": ... }.
 * Returns the 1-indexed row that was written.
 */
function appendRow(sheetName, rowDataObject) {
  const sheet = getSheetOrThrow_(sheetName);
  const lastColumn = sheet.getLastColumn();
  const rowValues = new Array(lastColumn).fill('');

  Object.keys(rowDataObject).forEach(function (columnHeaderName) {
    const columnIndex = getColumnIndex(sheetName, columnHeaderName);
    rowValues[columnIndex - 1] = rowDataObject[columnHeaderName];
  });

  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);

  applyBorders(sheetName);
  return targetRow;
}

/**
 * Appends several rows in one batch (one setValues() call, no per-row
 * appendRow loop) — e.g. every line item of one invoice in BARANG KELUAR.
 * Returns the array of 1-indexed rows that were written.
 */
function batchInsert(sheetName, arrayOfRowDataObjects) {
  if (!arrayOfRowDataObjects || arrayOfRowDataObjects.length === 0) {
    return [];
  }

  const config = getConfig();
  if (sheetName === config.sheet_barang_keluar) {
    assertConsistentInvoice_(config, arrayOfRowDataObjects);
  }

  const sheet = getSheetOrThrow_(sheetName);
  const lastColumn = sheet.getLastColumn();
  const columnIndexByHeader = buildColumnIndexMap_(sheetName, arrayOfRowDataObjects);

  const rows = arrayOfRowDataObjects.map(function (rowDataObject) {
    const rowValues = new Array(lastColumn).fill('');
    Object.keys(rowDataObject).forEach(function (columnHeaderName) {
      rowValues[columnIndexByHeader[columnHeaderName] - 1] = rowDataObject[columnHeaderName];
    });
    return rowValues;
  });

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, lastColumn).setValues(rows);

  applyBorders(sheetName);

  const rowIndices = [];
  for (let i = 0; i < rows.length; i++) {
    rowIndices.push(startRow + i);
  }
  return rowIndices;
}

/** Resolves each unique header used across a batch to a column index once. */
function buildColumnIndexMap_(sheetName, rowDataObjects) {
  const headerNames = new Set();
  rowDataObjects.forEach(function (rowDataObject) {
    Object.keys(rowDataObject).forEach(function (key) {
      headerNames.add(key);
    });
  });

  const map = {};
  headerNames.forEach(function (headerName) {
    map[headerName] = getColumnIndex(sheetName, headerName);
  });
  return map;
}

/** For BARANG KELUAR batches, all rows carrying an INVOICE value must share the same one. */
function assertConsistentInvoice_(config, rowDataObjects) {
  const invoiceHeader = config.col_keluar_invoice;
  const invoiceValues = rowDataObjects
    .map(function (row) {
      return row[invoiceHeader];
    })
    .filter(function (value) {
      return value !== undefined && value !== null && value !== '';
    });

  if (invoiceValues.length === 0) return;

  const first = invoiceValues[0];
  const allMatch = invoiceValues.every(function (value) {
    return value === first;
  });
  if (!allMatch) {
    throw new Error('Semua baris dalam satu batch invoice harus punya nomor INVOICE yang sama.');
  }
}

/**
 * Sorts all data rows (header excluded) in `sheetName` by its date column,
 * newest first, then renumbers the "NO" column (if the sheet has one) and
 * re-applies borders. The date column is resolved from Config based on
 * which transaction sheet sheetName points to (BARANG RETUR reuses the
 * BARANG MASUK column keys, since it shares the same layout).
 *
 * Note: Range.sort() cannot sort a range containing merged cells — keep the
 * data rows on these sheets free of merges for this to work.
 */
function sortByDate(sheetName) {
  const config = getConfig();
  const prefix = resolveColumnPrefix_(sheetName, config);
  const dateColumnName = config['col_' + prefix + '_tgl'];
  const dateColumnIndex = getColumnIndex(sheetName, dateColumnName);

  const sheet = getSheetOrThrow_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow >= 2) {
    const dataRange = sheet.getRange(2, 1, lastRow - 1, lastColumn);
    dataRange.sort({ column: dateColumnIndex, ascending: false });
    renumberNoColumn_(sheet);
  }

  applyBorders(sheetName);
}

/** Maps a transaction sheet to its Config column-key prefix ("masuk" or "keluar"). */
function resolveColumnPrefix_(sheetName, config) {
  if (sheetName === config.sheet_barang_masuk || sheetName === config.sheet_barang_retur) {
    return 'masuk';
  }
  if (sheetName === config.sheet_barang_keluar) {
    return 'keluar';
  }
  throw new Error('Sheet "' + sheetName + '" bukan sheet transaksi yang dikenal di Config.');
}

/**
 * Renumbers a column literally headed "NO" (if present) to 1..N top to
 * bottom. This column isn't in the Config defaults from Fase 0 — it's
 * treated as an optional, purely cosmetic row-number column rather than a
 * per-sheet business field, so it's detected by header text directly
 * instead of adding config keys nothing else needs.
 */
function renumberNoColumn_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return;

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const noColumnIndex = headers.findIndex(function (header) {
    return String(header).trim().toUpperCase() === 'NO';
  });
  if (noColumnIndex === -1) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const numbers = [];
  for (let i = 1; i <= lastRow - 1; i++) {
    numbers.push([i]);
  }
  sheet.getRange(2, noColumnIndex + 1, numbers.length, 1).setValues(numbers);
}

/**
 * Applies a thin grid border to the whole used range (header + data) of
 * `sheetName`. Idempotent — setBorder() sets an edge property per cell
 * rather than stacking lines, so calling this repeatedly is safe.
 */
function applyBorders(sheetName) {
  const sheet = getSheetOrThrow_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow === 0 || lastColumn === 0) return;

  sheet.getRange(1, 1, lastRow, lastColumn).setBorder(true, true, true, true, true, true);
}

function getSheetOrThrow_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet "' + sheetName + '" tidak ditemukan.');
  }
  return sheet;
}
