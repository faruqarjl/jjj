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
  normalizeMergedCells_(table);
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
  Logger.log(
    'getTableInfo_() received sheetName=%s (typeof %s, length %s)',
    JSON.stringify(sheetName), typeof sheetName,
    sheetName === null || sheetName === undefined ? 'n/a' : String(sheetName).length
  );

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
  normalizeMergedCells_(table);
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
  const dataRowCount = table.sheet.getLastRow() - table.headerRow;

  Logger.log(
    'sortByDate("%s"): headerRow=%s dataRows=%s sortColumn=%s',
    sheetName, table.headerRow, dataRowCount, dateColumnIndex
  );

  if (dataRowCount < 1) {
    applyBorders(sheetName);
    return 0;
  }

  normalizeMergedCells_(table);

  const dataRange = table.sheet.getRange(table.firstDataRow, 1, dataRowCount, table.width);
  const sorted = sortRowsByDateDesc_(dataRange.getValues(), dateColumnIndex - 1);

  const noIndex = findNoColumnIndex_(table.headers);
  if (noIndex !== -1) {
    sorted.forEach(function (row, i) {
      row[noIndex] = i + 1;
    });
  }

  dataRange.setValues(sorted);
  applyBorders(sheetName);
  return sorted.length;
}

/**
 * Orders rows newest-first by `dateIndex` (0-based) in plain JavaScript.
 * Rows whose date cell can't be read as a date sink to the bottom. Ties and
 * unreadable dates keep their original relative order — the original index
 * is the explicit tiebreaker rather than relying on sort stability.
 */
function sortRowsByDateDesc_(rows, dateIndex) {
  return rows
    .map(function (row, i) {
      return { row: row, i: i, key: toTimeValue_(row[dateIndex]) };
    })
    .sort(function (a, b) {
      if (a.key === null || b.key === null) {
        if (a.key === null && b.key === null) return a.i - b.i;
        return a.key === null ? 1 : -1;
      }
      if (a.key !== b.key) return b.key - a.key;
      return a.i - b.i;
    })
    .map(function (entry) {
      return entry.row;
    });
}

/** Comparable time value for a date cell, or null when it isn't a date. */
function toTimeValue_(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return isNaN(time) ? null : time;
  }
  if (typeof value === 'number' && isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const time = new Date(value).getTime();
    if (!isNaN(time)) return time;
  }
  return null;
}

function findNoColumnIndex_(headers) {
  return headers.findIndex(function (header) {
    return String(header).trim().toUpperCase() === 'NO';
  });
}

/**
 * Breaks every merge inside the table's data rows and refills the freed
 * cells with the merge's value, so unmerging leaves no blanks. Sheets
 * imported from Excel carry vertical merges (typically in NO or INVOICE)
 * that make both range.sort() and setValues() fail.
 *
 * A merge starting above the first data row is refused rather than broken:
 * spreading a header cell's text down into data rows would corrupt data, so
 * it's named for manual fixing instead. Returns how many merges were broken.
 */
function normalizeMergedCells_(table) {
  const lastRow = table.sheet.getLastRow();
  const dataRowCount = lastRow - table.headerRow;
  if (dataRowCount < 1) return 0;

  const dataRange = table.sheet.getRange(table.firstDataRow, 1, dataRowCount, table.width);
  const merges = dataRange.getMergedRanges();
  if (merges.length === 0) {
    Logger.log('normalizeMergedCells_("%s"): no merged cells.', table.sheet.getName());
    return 0;
  }

  const blocking = merges.filter(function (merged) {
    return merged.getRow() < table.firstDataRow;
  });
  if (blocking.length > 0) {
    throw new Error(
      'Ada merge yang melewati baris header di sheet "' + table.sheet.getName() + '": ' +
      blocking.map(function (m) { return m.getA1Notation(); }).join(', ') +
      '. Unmerge manual dulu — script sengaja tidak membongkarnya otomatis supaya isi ' +
      'header tidak tertulis ke baris data.'
    );
  }

  merges.forEach(function (merged) {
    const value = merged.getCell(1, 1).getValue();
    const startRow = merged.getRow();
    const startColumn = merged.getColumn();
    const numRows = Math.min(startRow + merged.getNumRows() - 1, lastRow) - startRow + 1;
    const numColumns = Math.min(startColumn + merged.getNumColumns() - 1, table.width) - startColumn + 1;

    Logger.log(
      'normalizeMergedCells_(): breaking %s, refilling with %s',
      merged.getA1Notation(), JSON.stringify(value)
    );
    merged.breakApart();

    if (numRows < 1 || numColumns < 1) return;
    const filled = [];
    for (let r = 0; r < numRows; r++) {
      const row = [];
      for (let c = 0; c < numColumns; c++) row.push(value);
      filled.push(row);
    }
    table.sheet.getRange(startRow, startColumn, numRows, numColumns).setValues(filled);
  });

  return merges.length;
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
    Logger.log('getSheetOrThrow_(): sheetName is falsy (typeof %s).', typeof sheetName);
    throw new Error(
      'sheetName kosong/undefined. Dua kemungkinan:\n' +
      '1) Anda menjalankan appendRow/batchInsert/sortByDate LANGSUNG dari tombol Run di editor ' +
      'Apps Script. Function ini generic dan butuh parameter, jadi kalau dijalankan sendiri ' +
      'parameternya undefined. Jalankan testAppendRow/testBatchInsert, atau lewat menu Stock Manager.\n' +
      '2) Kalau dipanggil lewat menu, berarti getConfig() tidak menemukan key yang diharapkan ' +
      '(misal sheet_barang_masuk) — cek isi sheet Config lewat Stock Manager > Debug Config.'
    );
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    Logger.log('getSheetOrThrow_("%s"): sheet not found in this spreadsheet.', sheetName);
    throw new Error('Sheet "' + sheetName + '" tidak ditemukan.');
  }
  return sheet;
}
