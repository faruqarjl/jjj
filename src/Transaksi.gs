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
  const table = getTableInfo_(sheetName);
  const rowValues = new Array(table.width).fill('');

  Object.keys(rowDataObject).forEach(function (columnHeaderName) {
    const columnIndex = getColumnIndex(sheetName, columnHeaderName, table.headerRow);
    rowValues[columnIndex - 1] = rowDataObject[columnHeaderName];
  });

  const targetRow = table.firstDataRow > table.sheet.getLastRow()
    ? table.firstDataRow
    : table.sheet.getLastRow() + 1;

  Logger.log(
    'appendRow("%s"): headerRow=%s width=%s -> writing row %s',
    sheetName, table.headerRow, table.width, targetRow
  );
  table.sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);

  applyBorders(sheetName);
  return targetRow;
}

/**
 * Resolves a sheet's table geometry once: the configured header row, the
 * first data row below it, and the table width.
 *
 * Width comes from the header row's own trailing non-empty cell, not
 * getLastColumn() — a title row above the table may span more columns than
 * the table itself, which would otherwise pad every written row with blanks
 * out past the real last column.
 */
function getTableInfo_(sheetName) {
  const sheet = getSheetOrThrow_(sheetName);
  const headerRow = getHeaderRow(sheetName);
  const lastColumn = sheet.getLastColumn();

  if (lastColumn === 0) {
    throw new Error('Sheet "' + sheetName + '" kosong, tidak ada header.');
  }
  if (headerRow > sheet.getLastRow()) {
    throw new Error(
      'Header row ' + headerRow + ' di luar isi sheet "' + sheetName +
      '". Cek key header_row_* di sheet Config.'
    );
  }

  const headers = sheet.getRange(headerRow, 1, 1, lastColumn).getValues()[0];
  let width = headers.length;
  while (width > 0 && String(headers[width - 1]).trim() === '') {
    width--;
  }
  if (width === 0) {
    throw new Error(
      'Header row ' + headerRow + ' di sheet "' + sheetName + '" kosong. ' +
      'Cek key header_row_* di sheet Config.'
    );
  }

  return { sheet: sheet, headerRow: headerRow, firstDataRow: headerRow + 1, headers: headers, width: width };
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

  const table = getTableInfo_(sheetName);
  const columnIndexByHeader = buildColumnIndexMap_(sheetName, arrayOfRowDataObjects, table.headerRow);

  const rows = arrayOfRowDataObjects.map(function (rowDataObject) {
    const rowValues = new Array(table.width).fill('');
    Object.keys(rowDataObject).forEach(function (columnHeaderName) {
      rowValues[columnIndexByHeader[columnHeaderName] - 1] = rowDataObject[columnHeaderName];
    });
    return rowValues;
  });

  const sheet = table.sheet;
  const startRow = table.firstDataRow > sheet.getLastRow()
    ? table.firstDataRow
    : sheet.getLastRow() + 1;

  Logger.log(
    'batchInsert("%s"): headerRow=%s -> writing %s row(s) from row %s',
    sheetName, table.headerRow, rows.length, startRow
  );
  sheet.getRange(startRow, 1, rows.length, table.width).setValues(rows);

  applyBorders(sheetName);

  const rowIndices = [];
  for (let i = 0; i < rows.length; i++) {
    rowIndices.push(startRow + i);
  }
  return rowIndices;
}

/** Resolves each unique header used across a batch to a column index once. */
function buildColumnIndexMap_(sheetName, rowDataObjects, headerRow) {
  const headerNames = new Set();
  rowDataObjects.forEach(function (rowDataObject) {
    Object.keys(rowDataObject).forEach(function (key) {
      headerNames.add(key);
    });
  });

  const map = {};
  headerNames.forEach(function (headerName) {
    map[headerName] = getColumnIndex(sheetName, headerName, headerRow);
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

  const table = getTableInfo_(sheetName);
  const dateColumnIndex = getColumnIndex(sheetName, dateColumnName, table.headerRow);

  const lastRow = table.sheet.getLastRow();
  const dataRowCount = lastRow - table.headerRow;

  Logger.log(
    'sortByDate("%s"): headerRow=%s dataRows=%s sortColumn=%s',
    sheetName, table.headerRow, dataRowCount, dateColumnIndex
  );

  if (dataRowCount > 0) {
    const dataRange = table.sheet.getRange(table.firstDataRow, 1, dataRowCount, table.width);
    dataRange.sort({ column: dateColumnIndex, ascending: false });
    renumberNoColumn_(table);
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
function renumberNoColumn_(table) {
  const noColumnIndex = table.headers.findIndex(function (header) {
    return String(header).trim().toUpperCase() === 'NO';
  });
  if (noColumnIndex === -1) return;

  const dataRowCount = table.sheet.getLastRow() - table.headerRow;
  if (dataRowCount < 1) return;

  const numbers = [];
  for (let i = 1; i <= dataRowCount; i++) {
    numbers.push([i]);
  }
  table.sheet.getRange(table.firstDataRow, noColumnIndex + 1, numbers.length, 1).setValues(numbers);
}

/**
 * Applies a thin grid border to the table of `sheetName` — the header row
 * down to the last data row, across the table's width only. Title/blank
 * rows above the header are deliberately left alone. Idempotent:
 * setBorder() sets an edge property per cell rather than stacking lines.
 */
function applyBorders(sheetName) {
  const table = getTableInfo_(sheetName);
  const lastRow = table.sheet.getLastRow();
  const rowCount = lastRow - table.headerRow + 1;
  if (rowCount < 1) return;

  table.sheet
    .getRange(table.headerRow, 1, rowCount, table.width)
    .setBorder(true, true, true, true, true, true);
}

function getSheetOrThrow_(sheetName) {
  if (!sheetName) {
    Logger.log('getSheetOrThrow_(): sheetName is falsy (%s) — likely an undefined Config value.', sheetName);
    throw new Error(
      'sheetName kosong/undefined. Ini biasanya berarti getConfig() tidak menemukan key yang ' +
      'diharapkan (misal sheet_barang_masuk) — cek isi sheet Config.'
    );
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    Logger.log('getSheetOrThrow_("%s"): sheet not found in this spreadsheet.', sheetName);
    throw new Error('Sheet "' + sheetName + '" tidak ditemukan.');
  }
  return sheet;
}
