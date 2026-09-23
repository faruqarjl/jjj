/**
 * Generic input logic for transaction sheets (BARANG MASUK, BARANG RETUR,
 * BARANG KELUAR). Every function here takes a sheetName parameter and
 * resolves columns via getConfig()/getColumnIndex() from Config.gs — none
 * of them special-case a particular sheet, so the same code serves all
 * three transaction sheets without duplication.
 *
 * Inserts resync REKAP BARANG for the codes they touch, so appendRow and
 * batchInsert leave the recap as current as deleteRow and onEdit do.
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

  const spot = resolveAppendRow_(table, getConfig());
  if (spot.sisipkan) table.sheet.insertRowsBefore(spot.row, 1);
  const targetRow = spot.row;

  Logger.log(
    'appendRow("%s"): headerRow=%s width=%s -> writing row %s (disisipkan: %s)',
    sheetName, table.headerRow, table.width, targetRow, spot.sisipkan
  );
  table.sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);

  // The row above owns the pricing formulas; inherit them, then make sure
  // anything the caller typed still wins over what was pasted.
  const copied = copyFormulaColumns_(sheetName, targetRow, 1);
  restoreManualValues_(sheetName, targetRow, [rowValues], copied);

  applyBorders(sheetName);
  resyncRekapForCodes_(sheetName, [rowValues]);
  return targetRow;
}

/**
 * Recomputes the recap for every item code just written to a transaction
 * sheet, so an insert leaves REKAP BARANG as current as deleteRow and
 * onEdit already do. Each distinct code is recalculated once, however many
 * rows of it a batch contained.
 *
 * Does nothing for sheets Config doesn't treat as transactions — the REKAP
 * form runs its own recalculation. A recap failure is logged rather than
 * thrown: the rows are already written, so reporting the insert as failed
 * would be worse than a stale recap.
 */
function resyncRekapForCodes_(sheetName, rowValuesList) {
  const config = getConfig();
  const columns = transactionColumns_(sheetName, config);
  if (!columns) return;

  try {
    const table = getTableInfo_(sheetName);
    const kodeIndex = resolveColumnIndex_(table.headers, columns.kode, sheetName, table.headerRow) - 1;

    const seen = {};
    rowValuesList.forEach(function (rowValues) {
      const kode = normalizeText_(rowValues[kodeIndex]);
      if (kode === '' || seen[kode]) return;
      seen[kode] = true;
      recalculateRekap(kode);
    });
  } catch (err) {
    Logger.log('resyncRekapForCodes_("%s"): rekap gagal disinkronkan — %s', sheetName, err.message);
  }
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
 * Where the real data ends, which is NOT getLastRow().
 *
 * These sheets carry hundreds of pre-filled rows whose only content is a
 * VLOOKUP returning "" — and BARANG KELUAR ends with a TOTAL row of SUM
 * formulas. getLastRow() counts every one of them, so appending at
 * getLastRow() + 1 dropped new rows hundreds of lines below the data, and
 * underneath the TOTAL row whose SUM range then never reached them.
 *
 * The item-code column decides instead: the last row that names an item is
 * the last row of data. Formula-only rows have no code, and neither does a
 * TOTAL row, so both fall outside every range derived from here.
 *
 * Falls back to getLastRow() for a sheet whose code column Config doesn't
 * describe, which keeps behaviour unchanged for anything not a transaction
 * or recap sheet.
 */
function getDataBounds_(table, config) {
  const sheetName = table.sheet.getName();
  const sheetLastRow = table.sheet.getLastRow();

  if (sheetLastRow <= table.headerRow) {
    return { lastDataRow: table.headerRow, dataRowCount: 0, akurat: true };
  }

  const fallback = {
    lastDataRow: sheetLastRow,
    dataRowCount: sheetLastRow - table.headerRow,
    akurat: false
  };

  const kodeName = columnNameFor_(sheetName, 'kode', config || getConfig());
  if (!kodeName) return fallback;

  let kodeIndex;
  try {
    kodeIndex = resolveColumnIndex_(table.headers, kodeName, sheetName, table.headerRow);
  } catch (err) {
    Logger.log('getDataBounds_("%s"): kolom kode tidak ketemu — pakai getLastRow(). %s',
      sheetName, err.message);
    return fallback;
  }

  const codes = table.sheet
    .getRange(table.firstDataRow, kodeIndex, sheetLastRow - table.headerRow, 1)
    .getValues();

  let lastDataRow = table.headerRow;
  for (let i = codes.length - 1; i >= 0; i--) {
    if (normalizeText_(codes[i][0]) !== '') {
      lastDataRow = table.firstDataRow + i;
      break;
    }
  }

  if (lastDataRow < sheetLastRow) {
    Logger.log(
      'getDataBounds_("%s"): data berakhir di baris %s, getLastRow()=%s ' +
      '(%s baris di bawahnya cuma rumus kosong atau baris TOTAL).',
      sheetName, lastDataRow, sheetLastRow, sheetLastRow - lastDataRow
    );
  }

  return { lastDataRow: lastDataRow, dataRowCount: lastDataRow - table.headerRow, akurat: true };
}

/**
 * The row a new entry belongs on, and whether something has to be pushed
 * down to make space.
 *
 * Writing straight over the row after the data is right when that row is a
 * blank formula row — the formulas there are the ones we want anyway. It is
 * wrong when the row holds a TOTAL, so that case inserts instead, which also
 * lets Sheets widen the SUM ranges to include the new rows.
 */
function resolveAppendRow_(table, config) {
  const bounds = getDataBounds_(table, config);
  const row = Math.max(table.firstDataRow, bounds.lastDataRow + 1);
  const sisipkan = row <= table.sheet.getLastRow() && rowHasContent_(table, row);

  if (sisipkan) {
    Logger.log(
      'resolveAppendRow_("%s"): baris %s sudah terisi (kemungkinan baris TOTAL) — baris baru disisipkan di atasnya.',
      table.sheet.getName(), row
    );
  }
  return { row: row, sisipkan: sisipkan, bounds: bounds };
}

/**
 * Whether a row holds something a new entry must not overwrite.
 *
 * The pre-filled rows are not blank on screen: `=IF($O10="ANZAR",...)` shows
 * 0 and a VLOOKUP shows "". Judging by displayed values alone would call
 * every one of them occupied and insert a row each time, so the waiting
 * formulas would never be used. What counts is whether anything was *typed*:
 * a cell that is non-empty and is not the output of a formula.
 *
 * A TOTAL row qualifies through its "TOTAL" label. As a second guard, the
 * sheet's very last row is treated as occupied whenever it contains any
 * formula, which covers a footer of bare SUMs carrying no label. Both guards
 * only ever cause an insert, which is never destructive.
 */
function rowHasContent_(table, row) {
  const range = table.sheet.getRange(row, 1, 1, table.width);
  const values = range.getValues()[0];
  const formulas = range.getFormulas()[0];

  const diketik = values.some(function (value, i) {
    return normalizeText_(value) !== '' && normalizeText_(formulas[i]) === '';
  });
  if (diketik) return true;

  const adaRumus = formulas.some(function (formula) { return normalizeText_(formula) !== ''; });
  return adaRumus && row >= table.sheet.getLastRow();
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
  const spot = resolveAppendRow_(table, config);
  if (spot.sisipkan) sheet.insertRowsBefore(spot.row, rows.length);
  const startRow = spot.row;

  Logger.log(
    'batchInsert("%s"): headerRow=%s -> writing %s row(s) from row %s (disisipkan: %s)',
    sheetName, table.headerRow, rows.length, startRow, spot.sisipkan
  );
  sheet.getRange(startRow, 1, rows.length, table.width).setValues(rows);

  const copied = copyFormulaColumns_(sheetName, startRow, rows.length, config);
  restoreManualValues_(sheetName, startRow, rows, copied, config);

  applyBorders(sheetName);
  resyncRekapForCodes_(sheetName, rows);

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
 * then renumbers the "NO" column (if the sheet has one) and re-applies
 * borders. `order` is "desc" (newest first, the default) or "asc". The date
 * column is resolved from Config based on which transaction sheet sheetName
 * points to (BARANG RETUR reuses the BARANG MASUK column keys, since it
 * shares the same layout).
 *
 * Ordering happens in JavaScript rather than via Range.sort(), which refuses
 * any range containing vertical merges. Merges in the data rows are broken
 * and refilled first — see normalizeMergedCells_().
 */
function sortByDate(sheetName, order) {
  const direction = normalizeSortOrder_(order);
  const config = getConfig();
  const dateColumnName = columnNameFor_(sheetName, 'tgl', config);
  if (dateColumnName === null) {
    throw new Error('Sheet "' + sheetName + '" bukan sheet transaksi yang dikenal di Config.');
  }

  const table = getTableInfo_(sheetName);
  const dateColumnIndex = getColumnIndex(sheetName, dateColumnName, table.headerRow);
  const dataRowCount = getDataBounds_(table, config).dataRowCount;

  Logger.log(
    'sortByDate("%s", "%s"): headerRow=%s dataRows=%s sortColumn=%s',
    sheetName, direction, table.headerRow, dataRowCount, dateColumnIndex
  );

  if (dataRowCount < 1) {
    applyBorders(sheetName);
    return 0;
  }

  normalizeMergedCells_(table);

  const dataRange = table.sheet.getRange(table.firstDataRow, 1, dataRowCount, table.width);
  const sorted = sortRowsByDate_(dataRange.getValues(), dateColumnIndex - 1, direction);

  const noIndex = findNoColumnIndex_(table.sheet.getName(), table.headers);
  if (noIndex !== -1) {
    sorted.forEach(function (row, i) {
      row[noIndex] = i + 1;
    });
  }

  dataRange.setValues(sorted);
  applyBorders(sheetName);
  return sorted.length;
}

/** "asc" or "desc"; empty/omitted means "desc". Anything else is a typo. */
function normalizeSortOrder_(order) {
  if (order === undefined || order === null || order === '') return 'desc';

  const normalized = String(order).trim().toLowerCase();
  if (normalized !== 'asc' && normalized !== 'desc') {
    throw new Error('Parameter order harus "asc" atau "desc", bukan ' + JSON.stringify(order) + '.');
  }
  return normalized;
}

/**
 * Orders rows by `dateIndex` (0-based) in plain JavaScript: "desc" puts the
 * newest first, "asc" the oldest first. Rows whose date cell can't be read
 * as a date sink to the bottom in BOTH directions — they aren't dates, so
 * they shouldn't lead the table. Ties and unreadable dates keep their
 * original relative order: the original index is the explicit tiebreaker
 * rather than relying on sort stability.
 */
function sortRowsByDate_(rows, dateIndex, order) {
  const sign = order === 'asc' ? -1 : 1;

  return rows
    .map(function (row, i) {
      return { row: row, i: i, key: toTimeValue_(row[dateIndex]) };
    })
    .sort(function (a, b) {
      if (a.key === null || b.key === null) {
        if (a.key === null && b.key === null) return a.i - b.i;
        return a.key === null ? 1 : -1;
      }
      if (a.key !== b.key) return sign * (b.key - a.key);
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

/**
 * Locates the row-number column, or -1 when the sheet has none.
 *
 * The header comes from the sheet's col_*_no key, so a business numbering
 * its rows "No." or "SEQ" still gets renumbering. Falls back to "NO" when
 * the key is missing, which keeps a Config sheet written before those keys
 * existed working until Setup backfills it.
 */
function findNoColumnIndex_(sheetName, headers) {
  const configured = columnNameFor_(sheetName, 'no');
  const wanted = normalizeText_(configured === null ? 'NO' : configured).toUpperCase();

  return headers.findIndex(function (header) {
    return normalizeText_(header).toUpperCase() === wanted;
  });
}

/**
 * Renumbers the "NO" column to 1..N top to bottom, for callers that change
 * the row count without rewriting the whole block (sortByDate renumbers in
 * its own array instead, to avoid a second write). Returns rows renumbered.
 */
function renumberNoColumn_(table) {
  const noIndex = findNoColumnIndex_(table.sheet.getName(), table.headers);
  if (noIndex === -1) return 0;

  const rowCount = getDataBounds_(table).dataRowCount;
  if (rowCount < 1) return 0;

  const numbers = [];
  for (let i = 1; i <= rowCount; i++) {
    numbers.push([i]);
  }
  table.sheet.getRange(table.firstDataRow, noIndex + 1, rowCount, 1).setValues(numbers);
  return rowCount;
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
  const dataRowCount = getDataBounds_(table).dataRowCount;
  if (dataRowCount < 1) return 0;
  const lastRow = table.headerRow + dataRowCount;

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

/**
 * Applies a thin grid border to the table of `sheetName` — the header row
 * down to the last data row, across the table's width only. Title/blank
 * rows above the header are deliberately left alone. Idempotent:
 * setBorder() sets an edge property per cell rather than stacking lines.
 */
function applyBorders(sheetName) {
  const table = getTableInfo_(sheetName);
  // Header plus real data only — bordering down to getLastRow() would frame
  // hundreds of blank formula rows and the TOTAL row along with them.
  const rowCount = getDataBounds_(table).dataRowCount + 1;
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

/* ------------------------------------------------------------------ *
 * Formula columns (Fase 8C)
 * ------------------------------------------------------------------ */

/**
 * Copies the formulas of the columns named by col_<sheet>_formula from the
 * row above into freshly written rows.
 *
 * Why copy rather than compute: those columns (AMOUNT KANTOR, ANZAR,
 * SALES B in the original workbook) hold the spreadsheet's own pricing
 * logic, routing a line's value to whichever column matches the chosen
 * sales name. Re-implementing that in code would create a second, rival
 * formula that silently drifts the first time someone edits the sheet's
 * version. Copying keeps the arithmetic owned by the spreadsheet, whatever
 * shape it takes.
 *
 * setValues() had been writing '' across the full row width, so every row
 * added by the script since Fase 1 left these columns blank — a paste of
 * the formula is what makes a scripted row behave like a hand-typed one.
 *
 * Silent no-op when the key is blank, when the sheet has no row above to
 * copy from, or when the source cell holds a value rather than a formula:
 * pasting a static number down the column would be worse than leaving it
 * empty, because it would look computed.
 */
function copyFormulaColumns_(sheetName, startRow, rowCount, config) {
  const settings = config || getConfig();
  const names = formulaColumnNames_(sheetName, settings);
  if (names.length === 0) return [];

  const table = getTableInfo_(sheetName);
  const sourceRow = startRow - 1;
  const bounds = getDataBounds_(table, settings);

  // Never copy from a TOTAL row: its SUM would be pasted into a data row and
  // read as if it were that line's amount.
  if (sourceRow > bounds.lastDataRow) {
    Logger.log(
      'copyFormulaColumns_("%s"): baris %s di luar data (kemungkinan baris TOTAL) — rumus tidak disalin.',
      sheetName, sourceRow
    );
    return [];
  }
  if (sourceRow < table.firstDataRow) {
    Logger.log(
      'copyFormulaColumns_("%s"): baris %s tidak punya baris data di atasnya — rumus tidak disalin.',
      sheetName, startRow
    );
    return [];
  }

  // Only columns whose source cell really holds a formula.
  const columns = [];
  names.forEach(function (name) {
    let index;
    try {
      index = resolveColumnIndex_(table.headers, name, sheetName, table.headerRow);
    } catch (err) {
      Logger.log('copyFormulaColumns_(): kolom rumus "%s" tidak ada di "%s" — dilewati.', name, sheetName);
      return;
    }
    if (table.sheet.getRange(sourceRow, index).getFormula() === '') {
      Logger.log(
        'copyFormulaColumns_(): "%s" baris %s bukan rumus — dilewati supaya nilai statis tidak ikut tersalin.',
        name, sourceRow
      );
      return;
    }
    columns.push(index);
  });
  if (columns.length === 0) return [];

  // Adjacent columns are pasted in one call; copyTo repeats the single
  // source row down the whole destination, so a batch costs the same as one.
  groupConsecutiveRuns_(columns).forEach(function (run) {
    table.sheet.getRange(sourceRow, run.start, 1, run.count)
      .copyTo(
        table.sheet.getRange(startRow, run.start, rowCount, run.count),
        SpreadsheetApp.CopyPasteType.PASTE_FORMULA,
        false
      );
  });

  Logger.log(
    'copyFormulaColumns_("%s"): rumus kolom %s disalin dari baris %s ke %s baris mulai %s.',
    sheetName, columns.join(','), sourceRow, rowCount, startRow
  );
  return columns;
}

/** The formula columns configured for a sheet, as header names. */
function formulaColumnNames_(sheetName, config) {
  const raw = normalizeText_(columnNameFor_(sheetName, 'formula', config));
  if (raw === '') return [];
  return raw.split(',')
    .map(function (part) { return normalizeText_(part); })
    .filter(function (part) { return part !== ''; });
}

/**
 * Re-writes the cells the caller supplied that fall inside a column whose
 * formula was just pasted over them.
 *
 * Normally the two sets don't overlap — the form asks for PRICE, DISKON and
 * SALES, never for the computed columns — and then this does nothing. It
 * matters when Config lists the same column in both places: what the user
 * typed has to win over a formula inherited from the row above.
 */
function restoreManualValues_(sheetName, startRow, rows, copiedColumns, config) {
  if (copiedColumns.length === 0 || rows.length === 0) return;

  const table = getTableInfo_(sheetName);
  const overlap = copiedColumns.filter(function (index) {
    return rows.some(function (row) {
      const value = row[index - 1];
      return value !== '' && value !== null && value !== undefined;
    });
  });
  if (overlap.length === 0) return;

  groupConsecutiveRuns_(overlap).forEach(function (run) {
    const block = rows.map(function (row) {
      return row.slice(run.start - 1, run.start - 1 + run.count);
    });
    table.sheet.getRange(startRow, run.start, block.length, run.count).setValues(block);
  });

  Logger.log(
    'restoreManualValues_("%s"): kolom %s ditimpa balik dengan nilai dari form.',
    sheetName, overlap.join(',')
  );
}
