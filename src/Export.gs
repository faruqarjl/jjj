/**
 * PDF and Excel export.
 *
 * Every export copies the chosen sheet into a throwaway spreadsheet and
 * works there, never on the live one. Two reasons:
 *
 * - Filtering by date, adding a title block and setting print options all
 *   mean changing a sheet. Doing that in place would modify shared data,
 *   and on a file several people have open they would watch rows disappear
 *   mid-export.
 * - The format=xlsx export URL ignores gid and always returns the whole
 *   spreadsheet, so a single-sheet .xlsx is only possible from a temporary
 *   spreadsheet that contains nothing else.
 *
 * The copy is made with copyTo(), which carries values, borders and
 * backgrounds across, so STATUS colours survive into the exported file and
 * the borders stay consistent with applyBorders() without restyling
 * anything.
 *
 * No advanced service is needed — DriveApp and UrlFetchApp are built in —
 * but the manifest's oauthScopes must include drive and
 * script.external_request.
 */

const EXPORT_FOLDER_NAME = 'Export';
const EXPORT_LANDSCAPE_MIN_COLUMNS = 9; // more than 8 columns -> landscape

/**
 * Exports one sheet to PDF. `options` may carry { dateRangeStart,
 * dateRangeEnd } to keep only rows inside that range; leaving them out
 * exports everything. Returns { url, name, rowCount, orientation }.
 */
function exportToPDF(sheetName, options) {
  const settings = options || {};
  const prepared = buildExportSpreadsheet_(sheetName, settings);

  try {
    const landscape = prepared.columnCount >= EXPORT_LANDSCAPE_MIN_COLUMNS;
    const params = [
      'format=pdf',
      'gid=' + prepared.sheet.getSheetId(),
      'portrait=' + (landscape ? 'false' : 'true'),
      'fitw=true',            // shrink to page width so nothing is cut off
      'size=A4',
      'gridlines=false',      // the copied borders already draw the table
      'printtitle=false',
      'sheetnames=false',
      'pagenum=CENTER',
      'top_margin=0.50', 'bottom_margin=0.50',
      'left_margin=0.50', 'right_margin=0.50'
    ].join('&');

    const name = buildExportFileName_(sheetName, 'pdf', prepared.timestamp);
    const file = saveExportBlob_(prepared.spreadsheetId, params, name);

    Logger.log(
      'exportToPDF("%s"): %s baris, %s kolom, %s -> %s',
      sheetName, prepared.rowCount, prepared.columnCount,
      landscape ? 'landscape' : 'portrait', name
    );

    return {
      url: file.getUrl(),
      name: name,
      rowCount: prepared.rowCount,
      orientation: landscape ? 'landscape' : 'portrait',
      message: 'PDF "' + name + '" selesai (' + prepared.rowCount + ' baris data).'
    };
  } finally {
    discardTempSpreadsheet_(prepared.spreadsheetId);
  }
}

/** Exports one sheet to .xlsx. Returns { url, name, rowCount }. */
function exportToExcel(sheetName, options) {
  const settings = options || {};
  const prepared = buildExportSpreadsheet_(sheetName, settings);

  try {
    const name = buildExportFileName_(sheetName, 'xlsx', prepared.timestamp);
    const file = saveExportBlob_(prepared.spreadsheetId, 'format=xlsx', name);

    Logger.log('exportToExcel("%s"): %s baris -> %s', sheetName, prepared.rowCount, name);
    return {
      url: file.getUrl(),
      name: name,
      rowCount: prepared.rowCount,
      message: 'Excel "' + name + '" selesai (' + prepared.rowCount + ' baris data).'
    };
  } finally {
    discardTempSpreadsheet_(prepared.spreadsheetId);
  }
}

/**
 * Copies `sheetName` into a fresh spreadsheet, drops rows outside the date
 * range, adds a title block and auto-fits the columns. The source sheet is
 * only read.
 */
function buildExportSpreadsheet_(sheetName, settings) {
  const table = getTableInfo_(sheetName);
  const sourceLastRow = table.sheet.getLastRow();
  const dataRowCount = sourceLastRow - table.headerRow;

  if (dataRowCount < 1) {
    throw new Error('Sheet "' + sheetName + '" tidak ada data untuk di-export.');
  }

  const start = parseDateInput_(settings.dateRangeStart, false);
  const end = parseDateInput_(settings.dateRangeEnd, true);
  let keptRowCount = dataRowCount;
  let removals = [];

  if (start !== null || end !== null) {
    const dateColumnName = resolveDateColumnName_(sheetName);
    if (dateColumnName === null) {
      throw new Error(
        'Sheet "' + sheetName + '" tidak punya kolom tanggal, jadi filter tanggal tidak bisa dipakai. ' +
        'Kosongkan filter tanggal untuk meng-export semuanya.'
      );
    }

    const dateIndex = resolveColumnIndex_(table.headers, dateColumnName, sheetName, table.headerRow) - 1;
    const rows = table.sheet.getRange(table.firstDataRow, 1, dataRowCount, table.width).getValues();
    const keep = filterRowsByDate_(rows, dateIndex, start, end);

    keptRowCount = keep.filter(Boolean).length;
    if (keptRowCount === 0) {
      throw new Error('Tidak ada baris di "' + sheetName + '" yang masuk rentang tanggal itu.');
    }
    // Row numbers in the copy match the source until anything is deleted.
    keep.forEach(function (isKept, i) {
      if (!isKept) removals.push(table.firstDataRow + i);
    });
  }

  const timestamp = new Date();
  const temp = SpreadsheetApp.create(
    'TEMP Export ' + sheetName + ' ' + formatExportStamp_(timestamp)
  );
  const copied = table.sheet.copyTo(temp);
  copied.setName(sheetName);

  // create() leaves a default empty sheet behind; the xlsx export would
  // otherwise carry it as a stray second tab.
  temp.getSheets().forEach(function (sheet) {
    if (sheet.getSheetId() !== copied.getSheetId()) temp.deleteSheet(sheet);
  });

  // Bottom-up and grouped into runs, so 400 rows don't cost 400 calls.
  groupConsecutiveRuns_(removals).reverse().forEach(function (run) {
    copied.deleteRows(run.start, run.count);
  });

  insertExportTitle_(copied, sheetName, timestamp, start, end);
  copied.autoResizeColumns(1, table.width);
  SpreadsheetApp.flush();

  return {
    spreadsheetId: temp.getId(),
    sheet: copied,
    rowCount: keptRowCount,
    columnCount: table.width,
    timestamp: timestamp
  };
}

/** Puts the sheet name, export time and any date range above the table. */
function insertExportTitle_(sheet, sheetName, timestamp, start, end) {
  sheet.insertRowsBefore(1, 3);

  const subtitle = 'Diexport: ' + formatExportDisplay_(timestamp) +
    (start !== null || end !== null
      ? '   |   Rentang: ' + (start === null ? 'awal' : formatExportDisplay_(start)) +
        ' s/d ' + (end === null ? 'akhir' : formatExportDisplay_(end))
      : '');

  sheet.getRange(1, 1).setValue(sheetName).setFontSize(14).setFontWeight('bold');
  sheet.getRange(2, 1).setValue(subtitle).setFontSize(9);
}

/** Which rows fall inside [start, end]; either bound may be null. */
function filterRowsByDate_(rows, dateIndex, start, end) {
  const from = start === null ? null : start.getTime();
  const to = end === null ? null : end.getTime();

  return rows.map(function (row) {
    const time = toTimeValue_(row[dateIndex]);
    if (time === null) return false;     // no readable date, so out of range
    if (from !== null && time < from) return false;
    if (to !== null && time > to) return false;
    return true;
  });
}

/** Turns [5,6,7,10] into [{start:5,count:3},{start:10,count:1}]. */
function groupConsecutiveRuns_(rowNumbers) {
  const runs = [];
  rowNumbers.slice().sort(function (a, b) { return a - b; }).forEach(function (row) {
    const last = runs[runs.length - 1];
    if (last && row === last.start + last.count) {
      last.count++;
    } else {
      runs.push({ start: row, count: 1 });
    }
  });
  return runs;
}

/** The sheet's date column name from Config, or null when it has none. */
function resolveDateColumnName_(sheetName) {
  const config = getConfig();
  const prefix = resolveSheetKeyPrefix_(sheetName, config);
  if (prefix === 'masuk' || prefix === 'retur') return config.col_masuk_tgl;
  if (prefix === 'keluar') return config.col_keluar_tgl;
  return null; // REKAP BARANG has no date column
}

/**
 * Parses a YYYY-MM-DD string from the dialog. Built field by field rather
 * than with new Date(text), which reads a bare date as UTC midnight and
 * would shift the boundary a day in Asia/Jakarta.
 */
function parseDateInput_(text, endOfDay) {
  const value = normalizeText_(text);
  if (value === '') return null;

  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) {
    throw new Error('Tanggal "' + text + '" tidak valid. Pakai format YYYY-MM-DD.');
  }

  const year = Number(parts[1]);
  const month = Number(parts[2]) - 1;
  const day = Number(parts[3]);
  return endOfDay
    ? new Date(year, month, day, 23, 59, 59, 999)
    : new Date(year, month, day, 0, 0, 0, 0);
}

/* ------------------------------------------------------------------ *
 * Drive plumbing
 * ------------------------------------------------------------------ */

function saveExportBlob_(spreadsheetId, params, fileName) {
  const url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?' + params;
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(
      'Gagal membuat file export (HTTP ' + response.getResponseCode() + '). Coba lagi sebentar.'
    );
  }

  const blob = response.getBlob().setName(fileName);
  return getOrCreateExportFolder_().createFile(blob);
}

/** The "Export" folder beside the spreadsheet, created on first use. */
function getOrCreateExportFolder_() {
  const parents = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

  const existing = parent.getFoldersByName(EXPORT_FOLDER_NAME);
  if (existing.hasNext()) return existing.next();

  Logger.log('getOrCreateExportFolder_(): folder "%s" dibuat.', EXPORT_FOLDER_NAME);
  return parent.createFolder(EXPORT_FOLDER_NAME);
}

function discardTempSpreadsheet_(spreadsheetId) {
  try {
    DriveApp.getFileById(spreadsheetId).setTrashed(true);
  } catch (err) {
    Logger.log('discardTempSpreadsheet_(): gagal menghapus temp %s — %s', spreadsheetId, err.message);
  }
}

/** "[NamaSheet]_[YYYYMMDD_HHmmss]_Export.ext" — seconds keep repeats unique. */
function buildExportFileName_(sheetName, extension, when) {
  return normalizeText_(sheetName).replace(/[\\/:*?"<>|]/g, '-') +
    '_' + formatExportStamp_(when) + '_Export.' + extension;
}

function formatExportStamp_(when) {
  return Utilities.formatDate(when, exportTimeZone_(), 'yyyyMMdd_HHmmss');
}

function formatExportDisplay_(when) {
  return Utilities.formatDate(when, exportTimeZone_(), 'dd/MM/yyyy HH:mm');
}

function exportTimeZone_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Asia/Jakarta';
}

/* ------------------------------------------------------------------ *
 * Export dialog
 * ------------------------------------------------------------------ */

function showExportDialog() {
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutputFromFile('ExportDialog').setWidth(420).setHeight(470),
    'Export Data'
  );
}

/** Server call for the dialog: exportable sheets and whether each can be date-filtered. */
function getExportDialogData() {
  const config = getConfig();
  const names = [
    config.sheet_barang_masuk, config.sheet_barang_retur,
    config.sheet_barang_keluar, config.sheet_rekap_barang
  ];

  const sheets = [];
  names.forEach(function (raw) {
    const name = normalizeText_(raw);
    if (name === '') return;
    sheets.push({ name: name, hasDateColumn: resolveDateColumnName_(name) !== null });
  });

  const active = SpreadsheetApp.getActiveSheet().getName();
  const match = sheets.filter(function (sheet) { return sheet.name === active; })[0];
  return { sheets: sheets, activeSheet: match ? active : (sheets[0] || {}).name };
}

/** Server call for the dialog's Export button. */
function runExport(payload) {
  const request = payload || {};
  const sheetName = normalizeText_(request.sheetName);
  if (sheetName === '') throw new Error('Pilih sheet dulu.');

  const options = {
    dateRangeStart: request.dateRangeStart,
    dateRangeEnd: request.dateRangeEnd
  };

  const start = parseDateInput_(options.dateRangeStart, false);
  const end = parseDateInput_(options.dateRangeEnd, true);
  if (start !== null && end !== null && start.getTime() > end.getTime()) {
    throw new Error('Tanggal "dari" lebih akhir daripada tanggal "sampai".');
  }

  return normalizeText_(request.format).toLowerCase() === 'xlsx'
    ? exportToExcel(sheetName, options)
    : exportToPDF(sheetName, options);
}
