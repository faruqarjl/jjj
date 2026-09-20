/**
 * Manual row colouring for the transaction sheets, and a STATUS filter for
 * REKAP BARANG. Purely additive — no calculation from earlier phases is
 * touched.
 *
 * Colour ownership is split deliberately: REKAP BARANG's backgrounds belong
 * to STATUS (Fase 3), which rewrites them on every recalculateRekap(), so
 * colorizeRow() refuses that sheet instead of painting something the next
 * recalculation would silently wipe. Manual colours live only on the
 * transaction sheets, where nothing else writes backgrounds.
 */

const WARNA_PRESET = [
  { nama: 'Kuning', hex: '#FFD966' },
  { nama: 'Hijau', hex: '#B6D7A8' },
  { nama: 'Biru Muda', hex: '#9FC5E8' },
  { nama: 'Merah Muda', hex: '#EA9999' },
  { nama: 'Ungu Muda', hex: '#B4A7D6' },
  { nama: 'Abu-abu', hex: '#D9D9D9' }
];

const AKSI_COLORIZE = 'COLORIZE';

const FILTER_SEMUA = 'SEMUA';
const FILTER_AMAN = 'AMAN';
const FILTER_PERLU_RESTOK = 'PERLU_RESTOK';

/**
 * Paints one whole data row of `sheetName`, and logs it so the colour can
 * be undone. Passing an empty colour (or "RESET") clears the background.
 * Returns { sheetName, rowIndex, color, message }.
 */
function colorizeRow(sheetName, rowIndex, colorHex) {
  assertNotRekapSheet_(sheetName);

  const table = getTableInfo_(sheetName);
  const row = Number(rowIndex);

  if (!isFinite(row) || row % 1 !== 0) {
    throw new Error('Nomor baris harus angka bulat, bukan ' + JSON.stringify(rowIndex) + '.');
  }
  if (row <= table.headerRow) {
    throw new Error(
      'Baris ' + row + ' adalah baris header/judul di "' + sheetName +
      '" (header di baris ' + table.headerRow + '). Baris data mulai dari ' + table.firstDataRow + '.'
    );
  }
  if (row > table.sheet.getLastRow()) {
    throw new Error(
      'Baris ' + row + ' di luar data "' + sheetName +
      '" (baris terakhir: ' + table.sheet.getLastRow() + ').'
    );
  }

  const color = normalizeColorHex_(colorHex);
  const range = table.sheet.getRange(row, 1, 1, table.width);

  // Captured per cell, so a row that already had mixed colours is restored
  // exactly as it was rather than flattened to one background.
  const before = range.getBackgrounds()[0];
  const after = [];
  for (let i = 0; i < table.width; i++) after.push(color);

  range.setBackgrounds([after]);
  logAction_(AKSI_COLORIZE, sheetName, row, { colors: before }, { colors: after });

  Logger.log('colorizeRow("%s", %s, %s): selesai.', sheetName, row, JSON.stringify(color));
  return {
    sheetName: sheetName,
    rowIndex: row,
    color: color,
    message: color === null
      ? 'Warna baris ' + row + ' di "' + sheetName + '" dihapus.'
      : 'Baris ' + row + ' di "' + sheetName + '" diwarnai ' + color + '.'
  };
}

/** Writes a per-cell colour array back to a row — used by undo and redo. */
function applyRowColors_(sheetName, rowIndex, colors) {
  const table = getTableInfo_(sheetName);
  const width = Math.min(colors.length, table.width);
  if (width < 1) return;
  table.sheet.getRange(rowIndex, 1, 1, width).setBackgrounds([colors.slice(0, width)]);
}

function assertNotRekapSheet_(sheetName) {
  const config = getConfig();
  if (resolveSheetKeyPrefix_(sheetName, config) === 'rekap') {
    throw new Error(
      '"' + sheetName + '" tidak bisa diwarnai manual: warna barisnya dipakai STATUS dan akan ' +
      'ditimpa setiap kali rekap dihitung ulang. Pakai menu Filter Rekap Barang untuk menyaring.'
    );
  }
}

/** Accepts #RGB or #RRGGBB (with or without #); empty or "RESET" means clear. */
function normalizeColorHex_(colorHex) {
  const text = normalizeText_(colorHex);
  if (text === '' || text.toUpperCase() === 'RESET') return null;

  const withHash = text.charAt(0) === '#' ? text : '#' + text;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(withHash)) {
    throw new Error('Warna "' + colorHex + '" tidak valid. Pakai format hex seperti #FFD966.');
  }
  return withHash.toUpperCase();
}

/* ------------------------------------------------------------------ *
 * Filter REKAP BARANG by STATUS
 * ------------------------------------------------------------------ */

const FILTER_VIEW_TITLES = {};
FILTER_VIEW_TITLES[FILTER_AMAN] = 'Stock Manager - Hanya Aman';
FILTER_VIEW_TITLES[FILTER_PERLU_RESTOK] = 'Stock Manager - Hanya Perlu Restok';

/**
 * Shows only the REKAP BARANG rows whose STATUS matches: "AMAN",
 * "PERLU_RESTOK", or "SEMUA" to go back to the unfiltered sheet.
 *
 * Uses Filter Views (Sheets Advanced Service) rather than a basic filter,
 * because a basic filter is shared: one person hiding rows hides them for
 * everyone with the file open. A Filter View's definition is shared, but
 * each viewer activates it independently.
 *
 * Nothing here can activate a view in someone's browser — the API has no
 * such call — so the result carries a URL that opens the sheet with the
 * view applied, for the person who clicks it and nobody else. "SEMUA"
 * likewise returns the plain sheet URL: leaving a view is per-user too, so
 * deleting the saved views would instead yank them out from under whoever
 * else has one open.
 */
function filterRekapByStatus(status) {
  const pilihan = normalizeText_(status).toUpperCase().replace(/\s+/g, '_');
  assertSheetsAdvancedServiceEnabled_();

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = getConfigValue('sheet_rekap_barang');
  const table = getTableInfo_(sheetName);
  const sheetId = table.sheet.getSheetId();

  // An earlier build created a basic filter here. It is shared, so it would
  // keep hiding rows for everyone regardless of the view chosen.
  const basicFilter = table.sheet.getFilter();
  if (basicFilter) {
    basicFilter.remove();
    Logger.log('filterRekapByStatus(): basic filter lama dihapus (dulu shared antar user).');
  }

  const sheetUrl = spreadsheet.getUrl() + '#gid=' + sheetId;

  if (pilihan === FILTER_SEMUA) {
    Logger.log('filterRekapByStatus(): kembali ke tampilan tanpa filter view.');
    return {
      status: FILTER_SEMUA,
      url: sheetUrl,
      message: 'Buka link ini untuk keluar dari filter view dan melihat semua baris lagi. ' +
        'Filter view yang tersimpan tidak dihapus, supaya rekan lain yang sedang memakainya tidak terganggu.'
    };
  }

  const nilai = pilihan === FILTER_AMAN ? STATUS_AMAN
    : pilihan === FILTER_PERLU_RESTOK ? STATUS_PERLU_RESTOK
      : null;
  if (nilai === null) {
    throw new Error(
      'Filter "' + status + '" tidak dikenal. Pakai ' +
      FILTER_SEMUA + ', ' + FILTER_AMAN + ', atau ' + FILTER_PERLU_RESTOK + '.'
    );
  }

  const statusColumn = getColumnIndex(sheetName, getConfig().col_rekap_status, table.headerRow);
  const title = FILTER_VIEW_TITLES[pilihan];

  const filterView = {
    title: title,
    range: {
      sheetId: sheetId,
      startRowIndex: table.headerRow - 1,
      endRowIndex: table.sheet.getLastRow(),
      startColumnIndex: 0,
      endColumnIndex: table.width
    },
    criteria: {}
  };
  // Criteria keys are zero-based column indexes, as strings.
  filterView.criteria[String(statusColumn - 1)] = {
    condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: nilai }] }
  };

  const existing = findManagedFilterView_(spreadsheet.getId(), sheetId, title);
  let filterViewId;

  if (existing) {
    filterView.filterViewId = existing.filterViewId;
    Sheets.Spreadsheets.batchUpdate(
      { requests: [{ updateFilterView: { filter: filterView, fields: 'range,criteria,title' } }] },
      spreadsheet.getId()
    );
    filterViewId = existing.filterViewId;
    Logger.log('filterRekapByStatus("%s"): filter view %s diperbarui.', pilihan, filterViewId);
  } else {
    const response = Sheets.Spreadsheets.batchUpdate(
      { requests: [{ addFilterView: { filter: filterView } }] },
      spreadsheet.getId()
    );
    filterViewId = response.replies[0].addFilterView.filter.filterViewId;
    Logger.log('filterRekapByStatus("%s"): filter view %s dibuat.', pilihan, filterViewId);
  }

  return {
    status: pilihan,
    filterViewId: filterViewId,
    url: sheetUrl + '&fvid=' + filterViewId,
    message: 'Filter view "' + title + '" siap (hanya STATUS "' + nilai + '"). ' +
      'Buka link di bawah untuk memakainya — filter ini hanya berlaku untuk Anda, ' +
      'rekan lain tetap melihat tampilan mereka sendiri.'
  };
}

/** The filter view this script manages for one status, or null. */
function findManagedFilterView_(spreadsheetId, sheetId, title) {
  const spreadsheet = Sheets.Spreadsheets.get(spreadsheetId, {
    fields: 'sheets(properties/sheetId,filterViews(filterViewId,title))'
  });

  const sheet = (spreadsheet.sheets || []).filter(function (s) {
    return s.properties.sheetId === sheetId;
  })[0];
  if (!sheet || !sheet.filterViews) return null;

  return sheet.filterViews.filter(function (view) {
    return normalizeText_(view.title) === title;
  })[0] || null;
}

function assertSheetsAdvancedServiceEnabled_() {
  if (typeof Sheets === 'undefined') {
    throw new Error(
      'Sheets Advanced Service belum aktif, jadi filter view per-user tidak bisa dibuat.\n\n' +
      'Cara mengaktifkan: buka editor Apps Script > panel kiri "Services" (ikon +) > ' +
      'pilih "Google Sheets API" > Add. Biarkan Identifier-nya "Sheets" dan Version "v4". ' +
      'Setelah itu jalankan menu ini lagi.'
    );
  }
}

/* ------------------------------------------------------------------ *
 * Colour picker sidebar
 * ------------------------------------------------------------------ */

/**
 * Shows a filter result with its URL as a clickable link. An alert() can't
 * be clicked, and the link is the whole point — activating a filter view is
 * something only the viewer's own browser can do.
 * Falls back to the log when there is no UI context.
 */
function showFilterViewResult_(result) {
  const body =
    '<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.55;color:#202124">' +
    '<p style="margin:0 0 14px">' + escapeHtml_(result.message) + '</p>' +
    '<p style="margin:0 0 14px">' +
    '<a href="' + escapeHtml_(result.url) + '" target="_blank" rel="noopener" ' +
    'style="display:inline-block;padding:9px 14px;background:#1a73e8;color:#fff;' +
    'text-decoration:none;border-radius:3px;font-weight:bold">Buka di tab baru</a></p>' +
    '<p style="margin:0;font-size:11px;color:#5f6368">' +
    'Bisa juga lewat menu Google Sheets: Data &gt; Filter views.</p></div>';

  try {
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(body).setWidth(430).setHeight(210),
      'Filter Rekap Barang'
    );
  } catch (err) {
    Logger.log('Filter Rekap Barang — %s\n%s', result.message, result.url);
  }
}

function escapeHtml_(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showColorPicker() {
  const html = HtmlService.createHtmlOutputFromFile('ColorPicker').setTitle('Warnai Transaksi');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** Server call for the sidebar: the sheets it may colour, and the palette. */
function getColorPickerData() {
  const config = getConfig();
  const sheets = [config.sheet_barang_masuk, config.sheet_barang_retur, config.sheet_barang_keluar]
    .map(function (name) { return normalizeText_(name); })
    .filter(function (name) { return name !== ''; });

  const active = SpreadsheetApp.getActiveSheet().getName();
  return {
    sheets: sheets,
    presets: WARNA_PRESET,
    activeSheet: sheets.indexOf(active) === -1 ? sheets[0] : active
  };
}
