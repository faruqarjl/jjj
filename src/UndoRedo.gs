/**
 * Custom undo/redo. Google Sheets' own Ctrl+Z doesn't see changes made by
 * Apps Script, so every scripted mutation is recorded in an "ActionLog"
 * sheet and can be reverted from there.
 *
 * Nothing here changes existing business logic: the *Logged() functions
 * wrap appendRow/batchInsert/deleteRow/saveRekapItem, capturing state
 * around calls that are otherwise untouched, and undo/redo replay through
 * those same helpers (deleteRow, normalizeMergedCells_, applyBorders,
 * renumberNoColumn_, recalculateRekap) rather than reimplementing them.
 */

const ACTION_LOG_SHEET_NAME = 'ActionLog';
// InputBy is appended AFTER Status rather than inserted before it, so a log
// written by an earlier version keeps its Status in the same column.
const ACTION_LOG_HEADERS = [
  'Timestamp', 'ActionType', 'SheetName', 'RowIndex', 'BeforeState', 'AfterState',
  'Status', 'InputBy'
];
const ACTION_LOG_STATUS_COLUMN = 7;
const ACTION_LOG_MAX_ACTIVE = 50;

/**
 * Who is performing the current action. The web app sets this from the
 * "Pilih Nama Kamu" dropdown; work done from the spreadsheet menu leaves it
 * blank. Apps Script runs each execution in a fresh context, so this never
 * leaks between users.
 */
let currentInputBy_ = '';

function setInputBy_(name) {
  currentInputBy_ = normalizeText_(name);
}

const LOG_STATUS_ACTIVE = 'ACTIVE';
const LOG_STATUS_UNDONE = 'UNDONE';
const LOG_STATUS_EXPIRED = 'EXPIRED';

const AKSI_APPEND = 'APPEND';
const AKSI_BATCH_INSERT = 'BATCH_INSERT';
const AKSI_DELETE = 'DELETE';
const AKSI_EDIT_MANUAL = 'EDIT_MANUAL';
const AKSI_EDIT_FORM = 'EDIT_FORM';

/* ------------------------------------------------------------------ *
 * Sheet setup and log plumbing
 * ------------------------------------------------------------------ */

/** Creates the ActionLog sheet if absent. Returns true when it was created. */
function ensureActionLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheetByName(ACTION_LOG_SHEET_NAME);

  if (existing) {
    // A log from before InputBy existed is one column short; widen it
    // rather than leaving the header blank for every new entry.
    if (existing.getLastColumn() < ACTION_LOG_HEADERS.length) {
      existing.getRange(1, 1, 1, ACTION_LOG_HEADERS.length).setValues([ACTION_LOG_HEADERS]);
      Logger.log('ensureActionLogSheet(): header diperlebar ke %s kolom.', ACTION_LOG_HEADERS.length);
    }
    return false;
  }

  const sheet = ss.insertSheet(ACTION_LOG_SHEET_NAME);
  sheet.getRange(1, 1, 1, ACTION_LOG_HEADERS.length)
    .setValues([ACTION_LOG_HEADERS])
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  return true;
}

function getActionLogSheet_() {
  ensureActionLogSheet();
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ACTION_LOG_SHEET_NAME);
}

/**
 * Serializes row values for the log. Dates are wrapped in a marker rather
 * than left as the ISO strings JSON.stringify would produce — restoring a
 * string into a TGL cell would silently turn a date into text.
 */
function encodeValues_(state) {
  if (state === null || state === undefined) return '';
  return JSON.stringify(state, function (key, value) {
    const raw = this[key];
    return raw instanceof Date ? { __date: raw.toISOString() } : value;
  });
}

function decodeValues_(json) {
  const text = normalizeText_(json);
  if (text === '') return null;
  return JSON.parse(text, function (key, value) {
    if (value && typeof value === 'object' && typeof value.__date === 'string') {
      return new Date(value.__date);
    }
    return value;
  });
}

/**
 * Records one action as ACTIVE.
 *
 * Logging a new action expires every UNDONE entry first: once you act after
 * undoing, the undone branch is gone, which is how an undo stack behaves.
 * The log is then trimmed to ACTION_LOG_MAX_ACTIVE entries, oldest first.
 */
function logAction_(actionType, sheetName, rowIndex, beforeState, afterState) {
  const sheet = getActionLogSheet_();
  expireUndoneEntries_(sheet);

  sheet.appendRow([
    new Date(), actionType, sheetName, rowIndex,
    encodeValues_(beforeState), encodeValues_(afterState), LOG_STATUS_ACTIVE,
    currentInputBy_
  ]);
  Logger.log('logAction_(): %s di "%s" baris %s oleh "%s".',
    actionType, sheetName, rowIndex, currentInputBy_ || '(menu)');

  trimActionLog_(sheet);
}

function readActionLogEntries_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, ACTION_LOG_HEADERS.length).getValues();
  return values.map(function (row, i) {
    return {
      logRow: i + 2,
      actionType: normalizeText_(row[1]),
      sheetName: normalizeText_(row[2]),
      rowIndex: Number(row[3]),
      beforeState: decodeValues_(row[4]),
      afterState: decodeValues_(row[5]),
      status: normalizeText_(row[6]),
      inputBy: normalizeText_(row[7])
    };
  });
}

function setEntryStatus_(sheet, logRow, status) {
  sheet.getRange(logRow, ACTION_LOG_STATUS_COLUMN).setValue(status);
}

function expireUndoneEntries_(sheet) {
  readActionLogEntries_(sheet)
    .filter(function (entry) { return entry.status === LOG_STATUS_UNDONE; })
    .forEach(function (entry) {
      setEntryStatus_(sheet, entry.logRow, LOG_STATUS_EXPIRED);
      Logger.log('logAction_(): entry baris %s hangus (tidak bisa di-redo lagi).', entry.logRow);
    });
}

/** Drops the oldest ACTIVE entries once there are more than the cap. */
function trimActionLog_(sheet) {
  const active = readActionLogEntries_(sheet).filter(function (entry) {
    return entry.status === LOG_STATUS_ACTIVE;
  });
  if (active.length <= ACTION_LOG_MAX_ACTIVE) return 0;

  const excess = active.slice(0, active.length - ACTION_LOG_MAX_ACTIVE);
  // Bottom-up, so deleting one row doesn't shift the next one's index.
  excess.slice().reverse().forEach(function (entry) {
    sheet.deleteRow(entry.logRow);
  });

  Logger.log('trimActionLog_(): %s entry terlama dihapus (batas %s).', excess.length, ACTION_LOG_MAX_ACTIVE);
  return excess.length;
}

/* ------------------------------------------------------------------ *
 * Logged wrappers — call these instead of the bare functions
 * ------------------------------------------------------------------ */

function appendRowLogged(sheetName, rowDataObject) {
  const rowIndex = appendRow(sheetName, rowDataObject);

  const table = getTableInfo_(sheetName);
  const after = table.sheet.getRange(rowIndex, 1, 1, table.width).getValues()[0];
  logAction_(AKSI_APPEND, sheetName, rowIndex, null, { row: after });
  return rowIndex;
}

function batchInsertLogged(sheetName, arrayOfRowDataObjects) {
  const rowIndices = batchInsert(sheetName, arrayOfRowDataObjects);
  if (rowIndices.length === 0) return rowIndices;

  const table = getTableInfo_(sheetName);
  const rows = table.sheet.getRange(rowIndices[0], 1, rowIndices.length, table.width).getValues();
  // One entry for the whole batch, so undo removes all of its rows at once.
  logAction_(AKSI_BATCH_INSERT, sheetName, rowIndices[0], null, { rows: rows });
  return rowIndices;
}

function deleteRowLogged(sheetName, rowIndex) {
  const table = getTableInfo_(sheetName);
  const row = Number(rowIndex);

  // Captured before the delete — afterwards the row is gone.
  let before = null;
  if (isFinite(row) && row > table.headerRow && row <= table.sheet.getLastRow()) {
    before = table.sheet.getRange(row, 1, 1, table.width).getValues()[0];
  }

  const result = deleteRow(sheetName, rowIndex);
  if (result.success && before !== null) {
    logAction_(AKSI_DELETE, sheetName, row, { row: before }, null);
  }
  return result;
}

/** Called by the sidebar in place of saveRekapItem, so form edits are undoable. */
function saveRekapItemLogged(payload) {
  const sheetName = getConfigValue('sheet_rekap_barang');
  const kode = normalizeText_(payload && payload.kode);
  const existing = kode === '' ? null : findRekapRow_(kode);

  let before = null;
  if (existing) {
    before = existing.table.sheet
      .getRange(existing.row, 1, 1, existing.table.width).getValues()[0];
  }

  const result = saveRekapItem(payload);

  const table = getTableInfo_(sheetName);
  const after = table.sheet.getRange(result.row, 1, 1, table.width).getValues()[0];
  logAction_(AKSI_EDIT_FORM, sheetName, result.row,
    before === null ? null : { row: before }, { row: after });
  return result;
}

/**
 * Records a manual cell edit, called from onEdit() in Main.gs.
 *
 * Only single-cell edits on a sheet Config knows about are logged: a
 * multi-cell paste carries no e.oldValue, so there would be nothing to
 * restore. e.oldValue always arrives as text, so it is coerced back to the
 * cell's own type before being stored — otherwise undoing an edit to a
 * number or date column would leave a string behind.
 */
function handleEditLogging_(e) {
  if (!e || !e.range || e.oldValue === undefined) return;
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  const sheetName = e.range.getSheet().getName();
  const config = getConfig();
  if (!resolveSheetKeyPrefix_(sheetName, config)) return;

  const table = getTableInfo_(sheetName);
  const row = e.range.getRow();
  if (row <= table.headerRow) return;

  const column = e.range.getColumn();
  const newValue = e.range.getValue();

  logAction_(AKSI_EDIT_MANUAL, sheetName, row,
    { column: column, value: coerceLikeCell_(e.oldValue, newValue) },
    { column: column, value: newValue });
}

/** Restores e.oldValue (always text) to the type the cell actually holds. */
function coerceLikeCell_(oldValueText, currentValue) {
  const text = String(oldValueText === null || oldValueText === undefined ? '' : oldValueText);

  if (typeof currentValue === 'number' && text.trim() !== '') {
    const asNumber = Number(text);
    if (isFinite(asNumber)) return asNumber;
  }
  if (currentValue instanceof Date) {
    const asDate = new Date(text);
    if (!isNaN(asDate.getTime())) return asDate;
  }
  return text;
}

/* ------------------------------------------------------------------ *
 * Undo / redo
 * ------------------------------------------------------------------ */

function undoLastAction() {
  const sheet = getActionLogSheet_();
  const entries = readActionLogEntries_(sheet).filter(function (entry) {
    return entry.status === LOG_STATUS_ACTIVE;
  });

  if (entries.length === 0) {
    notify_('Undo', 'Tidak ada aksi untuk di-undo.');
    return false;
  }

  const entry = entries[entries.length - 1];
  try {
    revertAction_(entry);
  } catch (err) {
    notify_('Undo', 'Gagal undo: ' + err.message);
    return false;
  }

  setEntryStatus_(sheet, entry.logRow, LOG_STATUS_UNDONE);
  notify_('Undo', 'Aksi ' + entry.actionType + ' di "' + entry.sheetName + '" sudah dibatalkan.');
  return true;
}

function redoAction() {
  const sheet = getActionLogSheet_();
  const entries = readActionLogEntries_(sheet).filter(function (entry) {
    return entry.status === LOG_STATUS_UNDONE;
  });

  if (entries.length === 0) {
    notify_('Redo', 'Tidak ada aksi untuk di-redo.');
    return false;
  }

  // Undo walks newest to oldest, so the most recently undone entry is the
  // oldest of the UNDONE ones — that is the one redo must replay first.
  const entry = entries[0];
  try {
    replayAction_(entry);
  } catch (err) {
    notify_('Redo', 'Gagal redo: ' + err.message);
    return false;
  }

  setEntryStatus_(sheet, entry.logRow, LOG_STATUS_ACTIVE);
  notify_('Redo', 'Aksi ' + entry.actionType + ' di "' + entry.sheetName + '" dijalankan ulang.');
  return true;
}

function revertAction_(entry) {
  switch (entry.actionType) {
    case AKSI_APPEND:
      removeLoggedRows_(entry.sheetName, entry.rowIndex, [entry.afterState.row]);
      break;

    case AKSI_BATCH_INSERT:
      removeLoggedRows_(entry.sheetName, entry.rowIndex, entry.afterState.rows);
      break;

    case AKSI_DELETE:
      insertRowsAt_(entry.sheetName, entry.rowIndex, [entry.beforeState.row]);
      break;

    case AKSI_EDIT_MANUAL:
      restoreCell_(entry, entry.beforeState, entry.afterState);
      break;

    case AKSI_EDIT_FORM:
      if (entry.beforeState === null) {
        // The form had added a brand new item; undoing it removes the row.
        removeLoggedRows_(entry.sheetName, entry.rowIndex, [entry.afterState.row]);
      } else {
        restoreRow_(entry.sheetName, entry.rowIndex, entry.beforeState.row);
      }
      break;

    case AKSI_COLORIZE:
      applyRowColors_(entry.sheetName, entry.rowIndex, entry.beforeState.colors);
      break;

    default:
      throw new Error('Jenis aksi "' + entry.actionType + '" tidak dikenal.');
  }
}

function replayAction_(entry) {
  switch (entry.actionType) {
    case AKSI_APPEND:
      insertRowsAt_(entry.sheetName, entry.rowIndex, [entry.afterState.row]);
      break;

    case AKSI_BATCH_INSERT:
      insertRowsAt_(entry.sheetName, entry.rowIndex, entry.afterState.rows);
      break;

    case AKSI_DELETE:
      removeLoggedRows_(entry.sheetName, entry.rowIndex, [entry.beforeState.row]);
      break;

    case AKSI_EDIT_MANUAL:
      restoreCell_(entry, entry.afterState, entry.beforeState);
      break;

    case AKSI_EDIT_FORM:
      if (entry.beforeState === null) {
        insertRowsAt_(entry.sheetName, entry.rowIndex, [entry.afterState.row]);
      } else {
        restoreRow_(entry.sheetName, entry.rowIndex, entry.afterState.row);
      }
      break;

    case AKSI_COLORIZE:
      applyRowColors_(entry.sheetName, entry.rowIndex, entry.afterState.colors);
      break;

    default:
      throw new Error('Jenis aksi "' + entry.actionType + '" tidak dikenal.');
  }
}

/* ------------------------------------------------------------------ *
 * Sheet operations used by undo/redo
 * ------------------------------------------------------------------ */

/**
 * Deletes rows previously written by a logged action, after checking they
 * still hold what was recorded.
 *
 * The check matters: a sort or an earlier delete can move rows, leaving the
 * stored index pointing at unrelated data. Refusing is far better than
 * deleting the wrong row, which nothing would undo.
 */
function removeLoggedRows_(sheetName, rowIndex, rows) {
  for (let i = 0; i < rows.length; i++) {
    verifyRowMatches_(sheetName, rowIndex + i, rows[i]);
  }

  // Bottom-up, so each delete leaves the remaining indices valid.
  for (let i = rows.length - 1; i >= 0; i--) {
    const result = deleteRow(sheetName, rowIndex + i);
    if (!result.success) throw new Error(result.message);
  }
}

/** Re-inserts rows at their original position, restoring borders and the recap. */
function insertRowsAt_(sheetName, rowIndex, rows) {
  const table = getTableInfo_(sheetName);
  normalizeMergedCells_(table);

  table.sheet.insertRowsBefore(rowIndex, rows.length);
  table.sheet.getRange(rowIndex, 1, rows.length, table.width).setValues(rows);

  renumberNoColumn_(table);
  applyBorders(sheetName);

  for (let i = 0; i < rows.length; i++) {
    resyncRekapForRow_(sheetName, rowIndex + i);
  }
}

/** Writes a whole row back in place (no insert), then resyncs the recap. */
function restoreRow_(sheetName, rowIndex, values) {
  const table = getTableInfo_(sheetName);
  normalizeMergedCells_(table);

  table.sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
  applyBorders(sheetName);
  resyncRekapForRow_(sheetName, rowIndex);
}

/**
 * Writes one cell back. `counterpart` is the state being moved away from —
 * when the edited column is an item code, the code it currently holds must
 * be recomputed too, or its totals would be left stale.
 */
function restoreCell_(entry, target, counterpart) {
  const table = getTableInfo_(entry.sheetName);
  table.sheet.getRange(entry.rowIndex, target.column).setValue(target.value);

  resyncRekapForRow_(entry.sheetName, entry.rowIndex);
  recalcIfCodeColumn_(entry.sheetName, target.column, counterpart.value);
}

function verifyRowMatches_(sheetName, rowIndex, expected) {
  const table = getTableInfo_(sheetName);
  if (rowIndex <= table.headerRow || rowIndex > table.sheet.getLastRow()) {
    throw new Error('Baris ' + rowIndex + ' di "' + sheetName + '" sudah tidak ada.');
  }

  // The NO column is excluded: it is cosmetic and maintained automatically
  // (deleteRow and sortByDate renumber it), so it legitimately differs from
  // what was recorded without meaning the row itself changed.
  const noIndex = findNoColumnIndex_(sheetName, table.headers);

  const actual = table.sheet.getRange(rowIndex, 1, 1, table.width).getValues()[0];
  for (let i = 0; i < expected.length && i < actual.length; i++) {
    if (i === noIndex) continue;
    if (!sameCellValue_(actual[i], expected[i])) {
      throw new Error(
        'Isi baris ' + rowIndex + ' di "' + sheetName + '" sudah berubah sejak aksi itu ' +
        '(kolom ' + (i + 1) + ': ' + JSON.stringify(actual[i]) + ' vs ' + JSON.stringify(expected[i]) +
        '). Undo dibatalkan supaya tidak menghapus baris yang salah.'
      );
    }
  }
}

function sameCellValue_(a, b) {
  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    return a.getTime() === b.getTime();
  }
  return String(a) === String(b);
}

/** Recomputes the recap for whichever item code sits in the given row. */
function resyncRekapForRow_(sheetName, rowIndex) {
  const config = getConfig();
  const table = getTableInfo_(sheetName);
  if (rowIndex <= table.headerRow || rowIndex > table.sheet.getLastRow()) return;

  const columns = transactionColumns_(sheetName, config);
  const kodeHeader = columns
    ? columns.kode
    : (resolveSheetKeyPrefix_(sheetName, config) === 'rekap' ? config.col_rekap_kode : null);
  if (!kodeHeader) return;

  const kodeColumn = resolveColumnIndex_(table.headers, kodeHeader, sheetName, table.headerRow);
  const kode = normalizeText_(table.sheet.getRange(rowIndex, kodeColumn).getValue());
  if (kode !== '') recalculateRekap(kode);
}

function recalcIfCodeColumn_(sheetName, column, value) {
  const config = getConfig();
  const columns = transactionColumns_(sheetName, config);
  if (!columns) return;

  const table = getTableInfo_(sheetName);
  const kodeColumn = resolveColumnIndex_(table.headers, columns.kode, sheetName, table.headerRow);
  if (column !== kodeColumn) return;

  const kode = normalizeText_(value);
  if (kode !== '') recalculateRekap(kode);
}
