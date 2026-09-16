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
// Bumped to v2 so any poisoned v1 entry cached by an earlier build is ignored.
const CONFIG_CACHE_KEY = 'app_config_v2';
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
 *
 * Row 1 is only skipped if column A literally reads "Key" (the header
 * ensureConfigSheet() writes) — a Config sheet filled in manually starting
 * at row 1, with no header row, is read correctly too.
 */
function getConfig() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CONFIG_CACHE_KEY);

  // An empty object serializes to "{}", which is truthy — so never trust a
  // cached entry that parsed to zero keys, or a stale empty entry would be
  // served for the full TTL without the sheet ever being re-read.
  if (cached) {
    const parsed = JSON.parse(cached);
    if (Object.keys(parsed).length > 0) {
      Logger.log('getConfig(): cache hit, %s key(s)', Object.keys(parsed).length);
      return parsed;
    }
    Logger.log('getConfig(): cached entry was empty — discarding and re-reading the sheet.');
    cache.remove(CONFIG_CACHE_KEY);
  }

  const sheet = findConfigSheet_();
  if (!sheet) {
    throw new Error(
      'Sheet "' + CONFIG_SHEET_NAME + '" tidak ketemu. Nama sheet yang ada sekarang: ' +
      listSheetNames_().join(' | ') + '. Jalankan Stock Manager > Setup, atau rename sheet config Anda.'
    );
  }

  const lastRow = sheet.getLastRow();
  Logger.log('getConfig(): reading sheet "%s", lastRow = %s', sheet.getName(), lastRow);

  const config = {};
  if (lastRow >= 1) {
    const rows = sheet.getRange(1, 1, lastRow, 2).getValues();
    rows.forEach(function (row, i) {
      const key = normalizeText_(row[0]);
      if (key === '' || key.toLowerCase() === 'key') return;
      const value = typeof row[1] === 'string' ? normalizeText_(row[1]) : row[1];
      if (value === '' || value === null) {
        Logger.log('getConfig(): row %s key "%s" has an EMPTY value in column B.', i + 1, key);
      }
      config[key] = value;
    });
  }

  const keyCount = Object.keys(config).length;
  Logger.log('getConfig(): parsed %s key(s) = %s', keyCount, Object.keys(config).join(', '));

  // Don't cache an empty result — that's the poisoning case above.
  if (keyCount > 0) {
    cache.put(CONFIG_CACHE_KEY, JSON.stringify(config), CONFIG_CACHE_TTL_SECONDS);
  }
  return config;
}

/**
 * Finds the Config sheet tolerantly: exact name first, then ignoring case
 * and stray/non-breaking whitespace, so "config", "CONFIG" or "Config "
 * (a trailing space is invisible in the sheet tab) still resolve.
 */
function findConfigSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const exact = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (exact) return exact;

  const wanted = CONFIG_SHEET_NAME.toLowerCase();
  const match = ss.getSheets().filter(function (sheet) {
    return normalizeText_(sheet.getName()).toLowerCase() === wanted;
  })[0];

  if (match) {
    Logger.log(
      'findConfigSheet_(): exact "%s" not found, matched "%s" loosely instead.',
      CONFIG_SHEET_NAME, match.getName()
    );
  }
  return match || null;
}

/** Trims and collapses non-breaking spaces, which are invisible but break equality. */
function normalizeText_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/ /g, ' ')
    .trim();
}

function listSheetNames_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().map(function (sheet) {
    return JSON.stringify(sheet.getName());
  });
}

/**
 * Diagnostic dump: run this and read View > Execution log. Shows every sheet
 * name (JSON-quoted so hidden whitespace is visible), the raw cache entry,
 * every raw Config cell with its JavaScript type, and the parsed result.
 */
function debugConfig() {
  const lines = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  lines.push('Spreadsheet: ' + ss.getName());
  lines.push('Sheets: ' + listSheetNames_().join(' | '));

  const rawCache = CacheService.getScriptCache().get(CONFIG_CACHE_KEY);
  lines.push('Raw cache [' + CONFIG_CACHE_KEY + ']: ' + (rawCache === null ? '(empty)' : rawCache));

  const sheet = findConfigSheet_();
  if (!sheet) {
    lines.push('RESULT: no Config sheet matched, not even loosely.');
  } else {
    lines.push('Matched sheet: ' + JSON.stringify(sheet.getName()) +
      ' | lastRow=' + sheet.getLastRow() + ' lastColumn=' + sheet.getLastColumn());

    const lastRow = sheet.getLastRow();
    if (lastRow >= 1) {
      const rows = sheet.getRange(1, 1, lastRow, 2).getValues();
      rows.forEach(function (row, i) {
        lines.push(
          '  row ' + (i + 1) + ': A=' + JSON.stringify(row[0]) + ' (' + typeof row[0] + ')' +
          ' B=' + JSON.stringify(row[1]) + ' (' + typeof row[1] + ')'
        );
      });
    }

    clearConfigCache();
    const config = getConfig();
    lines.push('Parsed config (' + Object.keys(config).length + ' keys): ' + JSON.stringify(config));
    lines.push('sheet_barang_masuk resolves to: ' + JSON.stringify(config.sheet_barang_masuk));
  }

  const report = lines.join('\n');
  Logger.log(report);
  SpreadsheetApp.getUi().alert('Debug Config', report, SpreadsheetApp.getUi().ButtonSet.OK);
  return report;
}

/**
 * Returns a single Config value by key, or throws a clear error naming the
 * missing key instead of letting `undefined` propagate into a sheet lookup
 * (which used to surface downstream as a confusing "Sheet undefined" error).
 */
function getConfigValue(key) {
  const config = getConfig();
  if (!Object.prototype.hasOwnProperty.call(config, key) || config[key] === '') {
    Logger.log('getConfigValue("%s"): NOT FOUND. Known keys: %s', key, Object.keys(config).join(', '));
    throw new Error(
      'Config key "' + key + '" tidak ditemukan atau kosong di sheet Config. ' +
      'Key yang terbaca sekarang: ' + (Object.keys(config).join(', ') || '(kosong)') + '. ' +
      'Jalankan Stock Manager > Debug Config buat lihat detailnya.'
    );
  }
  Logger.log('getConfigValue("%s") = "%s"', key, config[key]);
  return config[key];
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
  const wanted = normalizeText_(columnHeaderName).toLowerCase();
  const index = headers.findIndex(function (header) {
    return normalizeText_(header).toLowerCase() === wanted;
  });

  if (index === -1) {
    throw new Error(
      'Kolom "' + columnHeaderName + '" tidak ditemukan di sheet "' + sheetName + '". ' +
      'Header yang ada: ' + headers.map(function (h) { return JSON.stringify(h); }).join(' | ')
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
  if (findConfigSheet_()) {
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
  if (normalizeText_(e.range.getSheet().getName()).toLowerCase() === CONFIG_SHEET_NAME.toLowerCase()) {
    clearConfigCache();
  }
}
