/**
 * Entry points: custom menu and first-run setup.
 */

const PANDUAN_SHEET_NAME = 'Panduan';

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  const sortMenu = ui.createMenu('Urutkan Tanggal')
    .addItem('BARANG MASUK - Terbaru ke Terlama', 'sortMasukDesc')
    .addItem('BARANG MASUK - Terlama ke Terbaru', 'sortMasukAsc')
    .addSeparator()
    .addItem('BARANG RETUR - Terbaru ke Terlama', 'sortReturDesc')
    .addItem('BARANG RETUR - Terlama ke Terbaru', 'sortReturAsc')
    .addSeparator()
    .addItem('BARANG KELUAR - Terbaru ke Terlama', 'sortKeluarDesc')
    .addItem('BARANG KELUAR - Terlama ke Terbaru', 'sortKeluarAsc');

  const filterMenu = ui.createMenu('Filter Rekap Barang')
    .addItem('Tampilkan Semua', 'filterRekapSemua')
    .addItem('Hanya Aman', 'filterRekapAman')
    .addItem('Hanya Perlu Restok', 'filterRekapPerluRestok');

  ui.createMenu('Stock Manager')
    .addItem('Setup', 'runSetup')
    .addSeparator()
    .addItem('Input Manual', 'testAppendRow')
    .addItem('Input Batch (Invoice)', 'testBatchInsert')
    .addSubMenu(sortMenu)
    .addSeparator()
    .addItem('Hapus Baris', 'promptDeleteRow')
    .addItem('Edit Rekap Barang', 'showRekapForm')
    .addItem('Refresh Semua Status', 'refreshSemuaStatus')
    .addSeparator()
    .addItem('Warnai Transaksi', 'showColorPicker')
    .addSubMenu(filterMenu)
    .addSeparator()
    .addItem('Undo Terakhir', 'undoLastAction')
    .addItem('Redo', 'redoAction')
    .addSeparator()
    .addItem('Debug Config', 'debugConfig')
    .addItem('Clear Cache Config', 'clearConfigCacheAndNotify')
    .addToUi();
}

/**
 * Simple trigger. Apps Script merges every .gs file into one global scope,
 * so there can only be ONE onEdit in the whole project — it dispatches to
 * each handler instead. Everything is wrapped: a failure here must never
 * block the user's manual edit, so errors are logged, not thrown.
 */
function onEdit(e) {
  try {
    handleConfigEdit_(e);
  } catch (err) {
    Logger.log('onEdit() -> handleConfigEdit_ failed: %s', err.message);
  }

  // Logged before the resync, so beforeState is captured while the recap
  // still reflects the pre-edit numbers.
  try {
    handleEditLogging_(e);
  } catch (err) {
    Logger.log('onEdit() -> handleEditLogging_ failed: %s', err.message);
  }

  try {
    handleTransaksiEdit_(e);
  } catch (err) {
    Logger.log('onEdit() -> handleTransaksiEdit_ failed: %s', err.message);
  }
}

function filterRekapSemua() {
  showFilterViewResult_(filterRekapByStatus(FILTER_SEMUA));
}

function filterRekapAman() {
  showFilterViewResult_(filterRekapByStatus(FILTER_AMAN));
}

function filterRekapPerluRestok() {
  showFilterViewResult_(filterRekapByStatus(FILTER_PERLU_RESTOK));
}

/** Menu handler: recalculates every item in REKAP BARANG, then reports totals. */
function refreshSemuaStatus() {
  const summary = recalculateAllRekap();

  const parts = [summary.updated + ' barang diperbarui'];
  if (summary.skipped > 0) parts.push(summary.skipped + ' dilewati');
  if (summary.failed > 0) parts.push(summary.failed + ' gagal');

  let message = 'Selesai dari ' + summary.total + ' baris: ' + parts.join(', ') + '.';
  if (summary.failures.length > 0) {
    message += '\n\nYang gagal:\n' + summary.failures.join('\n');
  }
  notify_('Refresh Semua Status', message);
}

/** Menu handler: asks for a row number, then deletes it from the active sheet. */
function promptDeleteRow() {
  const ui = SpreadsheetApp.getUi();
  const sheetName = SpreadsheetApp.getActiveSheet().getName();

  const response = ui.prompt(
    'Hapus Baris',
    'Nomor baris yang mau dihapus di sheet "' + sheetName + '":',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const rowIndex = Number(response.getResponseText().trim());
  if (!rowIndex || !isFinite(rowIndex) || rowIndex % 1 !== 0) {
    notify_('Hapus Baris', 'Nomor baris harus angka bulat.');
    return;
  }

  const result = deleteRowLogged(sheetName, rowIndex);
  notify_('Hapus Baris', result.message);
}

/** Menu handler: flushes the cached config, then reports what a fresh read returns. */
function clearConfigCacheAndNotify() {
  clearConfigCache();
  const config = getConfig();
  notify_(
    'Clear Cache Config',
    'Cache dibersihkan. Hasil baca ulang sheet Config: ' + Object.keys(config).length +
    ' key.\n\n' + Object.keys(config).join(', ')
  );
}

/** Menu handler: appends one dummy row to BARANG MASUK via appendRow(). */
function testAppendRow() {
  const sheetName = getConfigValue('sheet_barang_masuk');
  Logger.log('testAppendRow(): sheet_barang_masuk resolved to %s (typeof %s)',
    JSON.stringify(sheetName), typeof sheetName);
  const row = {};
  row[getConfigValue('col_masuk_tgl')] = new Date();
  row[getConfigValue('col_masuk_kode')] = 'TEST01';
  row[getConfigValue('col_masuk_nama')] = 'Contoh Barang Masuk';
  row[getConfigValue('col_masuk_jumlah')] = 10;
  row[getConfigValue('col_masuk_keterangan')] = 'Dummy test dari menu Input Manual';

  const rowIndex = appendRowLogged(sheetName, row);
  notify_('Input Manual', 'Baris baru ditambahkan ke "' + sheetName + '" di baris ' + rowIndex + '.');
}

/** Menu handler: batch-inserts 3 dummy rows into BARANG KELUAR sharing one INVOICE. */
function testBatchInsert() {
  const config = getConfig();
  const invoiceNumber = 'INV-TEST-' + new Date().getTime();
  const items = [
    { kode: 'TEST01', nama: 'Contoh Barang 1', jumlah: 5 },
    { kode: 'TEST02', nama: 'Contoh Barang 2', jumlah: 3 },
    { kode: 'TEST03', nama: 'Contoh Barang 3', jumlah: 7 }
  ];

  const rows = items.map(function (item) {
    const row = {};
    row[config.col_keluar_tgl] = new Date();
    row[config.col_keluar_invoice] = invoiceNumber;
    row[config.col_keluar_kode] = item.kode;
    row[config.col_keluar_nama] = item.nama;
    row[config.col_keluar_jumlah] = item.jumlah;
    return row;
  });

  const rowIndices = batchInsertLogged(config.sheet_barang_keluar, rows);
  notify_(
    'Input Batch (Invoice)',
    rowIndices.length + ' baris ditambahkan ke "' + config.sheet_barang_keluar +
    '" (invoice ' + invoiceNumber + ') di baris ' + rowIndices.join(', ') + '.'
  );
}

function sortMasukDesc() {
  sortByDate(getConfigValue('sheet_barang_masuk'), 'desc');
}

function sortMasukAsc() {
  sortByDate(getConfigValue('sheet_barang_masuk'), 'asc');
}

function sortReturDesc() {
  sortByDate(getConfigValue('sheet_barang_retur'), 'desc');
}

function sortReturAsc() {
  sortByDate(getConfigValue('sheet_barang_retur'), 'asc');
}

function sortKeluarDesc() {
  sortByDate(getConfigValue('sheet_barang_keluar'), 'desc');
}

function sortKeluarAsc() {
  sortByDate(getConfigValue('sheet_barang_keluar'), 'asc');
}

/**
 * Ensures the Config and Panduan sheets exist, creating them with defaults
 * if this is a fresh copy of the template. Safe to run repeatedly.
 */
function runSetup() {
  const configCreated = ensureConfigSheet();
  const panduanCreated = ensurePanduanSheet_();
  const actionLogCreated = ensureActionLogSheet();
  const addedKeys = configCreated ? [] : backfillConfigSheet();

  const created = [];
  if (configCreated) created.push('Config');
  if (panduanCreated) created.push('Panduan');
  if (actionLogCreated) created.push('ActionLog');

  const messages = [];
  if (created.length > 0) {
    messages.push('Sheet dibuat: ' + created.join(', '));
  }
  if (addedKeys.length > 0) {
    messages.push('Key baru ditambahkan ke Config:\n' + addedKeys.join('\n'));
  }
  if (messages.length === 0) {
    messages.push('Sheet Config, Panduan dan ActionLog sudah lengkap. Tidak ada yang diubah.');
  }

  notify_('Setup', messages.join('\n\n'));
}

function ensurePanduanSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(PANDUAN_SHEET_NAME)) {
    return false;
  }

  const lines = [
    ['PANDUAN PENGGUNAAN — STOCK MANAGER TEMPLATE'],
    [''],
    ['1. APA ITU SHEET "Config"?'],
    ['Satu-satunya sumber nama sheet dan nama kolom yang dipakai script ini.'],
    ['Kolom A = Key (JANGAN diubah), Kolom B = Value (SILAKAN diubah sesuai spreadsheet Anda).'],
    ['Contoh: key "sheet_barang_masuk" -> value "BARANG MASUK" adalah nama sheet transaksi masuk.'],
    [''],
    ['2. CARA DUPLICATE KE SPREADSHEET LAIN'],
    ['a. File > Make a Copy di spreadsheet ini.'],
    ['b. Di spreadsheet hasil copy, buka sheet Config.'],
    ['c. Ganti kolom Value (bukan Key) sesuai nama sheet & nama kolom di spreadsheet baru.'],
    ['d. Selesai — TIDAK PERLU edit kode sama sekali. Semua function baca dari Config.'],
    [''],
    ['3. KALAU URUTAN KOLOM BERBEDA'],
    ['Tidak masalah. getColumnIndex() mencari kolom berdasarkan teks header,'],
    ['bukan berdasarkan nomor/urutan kolom — asalkan teks header di Value Config'],
    ['cocok dengan header asli di sheet tersebut.'],
    [''],
    ['3b. KALAU BARIS HEADER BUKAN DI ROW 1'],
    ['Sheet yang punya judul/baris kosong di atas tabel diatur lewat key:'],
    ['header_row_masuk, header_row_retur, header_row_keluar, header_row_rekap.'],
    ['Isi dengan nomor baris tempat header kolom berada (contoh: 5 atau 6).'],
    ['Data baru selalu ditambahkan di bawah baris data terakhir, dan sort'],
    ['hanya menyentuh baris data — judul di atas header tidak ikut teracak.'],
    [''],
    ['4. CACHE'],
    ['getConfig() menyimpan hasil bacaan di cache supaya hemat kuota & lebih cepat.'],
    ['Cache otomatis dibersihkan begitu Anda mengedit sheet Config (lewat trigger onEdit).'],
    ['Kalau perlu membersihkan manual, jalankan function clearConfigCache() di Apps Script editor.'],
    [''],
    ['5. MENU "Stock Manager > Setup"'],
    ['Aman dijalankan berkali-kali. Kalau sheet Config atau Panduan terhapus, menu ini akan'],
    ['membuat ulang dengan isi default.']
  ];

  const sheet = ss.insertSheet(PANDUAN_SHEET_NAME);
  sheet.getRange(1, 1, lines.length, 1).setValues(lines).setWrap(true);
  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  sheet.setColumnWidth(1, 700);
  return true;
}
