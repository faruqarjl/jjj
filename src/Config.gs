/**
 * Reusable Config foundation.
 *
 * This script must run unmodified after File > Make a Copy into any
 * spreadsheet: every sheet name and column name it needs comes from the
 * "Config" sheet (Key in column A, Value in column B), never from a
 * hardcoded string scattered across functions. To adapt this template to a
 * different spreadsheet layout, edit Config values — not this code.
 */

const CONFIG_SHEET_NAME = 'Config';
const CONFIG_CACHE_KEY = 'app_config_v1';
const CONFIG_CACHE_TTL_SECONDS = 21600; // 6 hours — CacheService's max

const DEFAULT_CONFIG_ENTRIES = [
  ['sheet_barang_masuk', 'BARANG MASUK'],
  ['sheet_barang_retur', 'BARANG RETUR'],
  ['sheet_barang_keluar', 'BARANG KELUAR'],
  ['sheet_rekap_barang', 'REKAP BARANG'],
  ['col_masuk_tgl', 'TGL'],
  ['col_masuk_kode', 'CODE BARANG'],
  ['col_masuk_nama', 'NAMA BARANG'],
  ['col_masuk_jumlah', 'JUMLAH'],
  ['col_masuk_keterangan', 'KETERANGAN'],
  ['col_keluar_tgl', 'TGL'],
  ['col_keluar_invoice', 'INVOICE'],
  ['col_keluar_kode', 'KODE BARANG'],
  ['col_keluar_nama', 'NAMA BARANG'],
  ['col_keluar_jumlah', 'JUMLAH'],
  ['col_rekap_kode', 'KODE BARANG'],
  ['col_rekap_nama', 'NAMA BARANG'],
  ['col_rekap_stok_awal', 'STOK AWAL'],
  ['col_rekap_min_stok', 'MIN STOK'],
  ['col_rekap_sisa_stok', 'SISA STOK'],
  ['col_rekap_status', 'STATUS']
];

/**
 * Reads the Config sheet into a plain object, e.g.
 * { sheet_barang_masuk: "BARANG MASUK", col_masuk_tgl: "TGL", ... }.
 * Cached in the script cache so repeated calls don't re-read the sheet;
 * the cache is auto-cleared by onEdit() whenever Config changes.
 */
function getConfig() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CONFIG_CACHE_KEY);
  if (cached) {
    return JSON.parse(cached);
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) {
    throw new Error(
      'Sheet "' + CONFIG_SHEET_NAME + '" belum ada. Jalankan menu Stock Manager > Setup dulu.'
    );
  }

  const lastRow = sheet.getLastRow();
  const config = {};
  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    rows.forEach(function (row) {
      const key = String(row[0]).trim();
      if (key === '') return;
      config[key] = row[1];
    });
  }

  cache.put(CONFIG_CACHE_KEY, JSON.stringify(config), CONFIG_CACHE_TTL_SECONDS);
  return config;
}

/** Clears the cached config so the next getConfig() call re-reads the sheet. */
function clearConfigCache() {
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
}

/**
 * Finds the 1-indexed column number in `sheetName` whose header row (row 1)
 * matches `columnHeaderName`. Always look columns up by header text instead
 * of a fixed number — column order can differ between spreadsheets.
 */
function getColumnIndex(sheetName, columnHeaderName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet "' + sheetName + '" tidak ditemukan.');
  }

  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) {
    throw new Error('Sheet "' + sheetName + '" tidak punya header.');
  }

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const index = headers.findIndex(function (header) {
    return String(header).trim() === String(columnHeaderName).trim();
  });

  if (index === -1) {
    throw new Error(
      'Kolom "' + columnHeaderName + '" tidak ditemukan di sheet "' + sheetName + '".'
    );
  }

  return index + 1;
}

/**
 * Creates the Config sheet with default Key/Value entries if it doesn't
 * already exist. Returns true if it was created, false if it already existed.
 */
function ensureConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(CONFIG_SHEET_NAME)) {
    return false;
  }

  const sheet = ss.insertSheet(CONFIG_SHEET_NAME);
  sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]).setFontWeight('bold');
  sheet.getRange(2, 1, DEFAULT_CONFIG_ENTRIES.length, 2).setValues(DEFAULT_CONFIG_ENTRIES);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 2);
  clearConfigCache();
  return true;
}

/**
 * Simple trigger: auto-clears the config cache whenever the Config sheet is
 * edited, so getConfig() reflects new values on the very next call instead
 * of waiting for the cache TTL to expire.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getName() === CONFIG_SHEET_NAME) {
    clearConfigCache();
  }
}
