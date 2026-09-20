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

/**
 * Shows only the REKAP BARANG rows whose STATUS matches: "SEMUA" (clears
 * the filter), "AMAN", or "PERLU_RESTOK".
 *
 * This is a basic filter, which every viewer of the spreadsheet shares —
 * SpreadsheetApp cannot create a per-user Filter View; that needs the
 * Sheets Advanced Service. Hiding rows here therefore hides them for
 * everyone with the file open.
 */
function filterRekapByStatus(status) {
  const pilihan = normalizeText_(status).toUpperCase().replace(/\s+/g, '_');
  const sheetName = getConfigValue('sheet_rekap_barang');
  const table = getTableInfo_(sheetName);

  const existing = table.sheet.getFilter();
  if (existing) existing.remove();

  if (pilihan === FILTER_SEMUA) {
    Logger.log('filterRekapByStatus(): filter dihapus, semua baris ditampilkan.');
    return { status: FILTER_SEMUA, message: 'Filter dihapus. Semua baris REKAP BARANG ditampilkan.' };
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
  const rowCount = table.sheet.getLastRow() - table.headerRow + 1;
  if (rowCount < 2) {
    return { status: pilihan, message: 'Belum ada data di REKAP BARANG untuk difilter.' };
  }

  const filter = table.sheet.getRange(table.headerRow, 1, rowCount, table.width).createFilter();
  filter.setColumnFilterCriteria(
    statusColumn,
    SpreadsheetApp.newFilterCriteria().whenTextEqualTo(nilai).build()
  );

  Logger.log('filterRekapByStatus("%s"): kolom %s difilter ke "%s".', pilihan, statusColumn, nilai);
  return { status: pilihan, message: 'REKAP BARANG difilter: hanya STATUS "' + nilai + '".' };
}

/* ------------------------------------------------------------------ *
 * Colour picker sidebar
 * ------------------------------------------------------------------ */

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
