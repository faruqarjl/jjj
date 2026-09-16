/**
 * Entry points: custom menu and first-run setup.
 */

const PANDUAN_SHEET_NAME = 'Panduan';

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  const sortMenu = ui.createMenu('Urutkan Terbaru')
    .addItem('BARANG MASUK', 'sortBarangMasuk')
    .addItem('BARANG RETUR', 'sortBarangRetur')
    .addItem('BARANG KELUAR', 'sortBarangKeluar');

  ui.createMenu('Stock Manager')
    .addItem('Setup', 'runSetup')
    .addSeparator()
    .addItem('Input Manual', 'testAppendRow')
    .addItem('Input Batch (Invoice)', 'testBatchInsert')
    .addSubMenu(sortMenu)
    .addSeparator()
    .addItem('Debug Config', 'debugConfig')
    .addItem('Clear Cache Config', 'clearConfigCacheAndNotify')
    .addToUi();
}

/** Menu handler: flushes the cached config, then reports what a fresh read returns. */
function clearConfigCacheAndNotify() {
  clearConfigCache();
  const config = getConfig();
  SpreadsheetApp.getUi().alert(
    'Cache dibersihkan. Hasil baca ulang sheet Config: ' + Object.keys(config).length +
    ' key.\n\n' + Object.keys(config).join(', ')
  );
}

/** Menu handler: appends one dummy row to BARANG MASUK via appendRow(). */
function testAppendRow() {
  const sheetName = getConfigValue('sheet_barang_masuk');
  const row = {};
  row[getConfigValue('col_masuk_tgl')] = new Date();
  row[getConfigValue('col_masuk_kode')] = 'TEST01';
  row[getConfigValue('col_masuk_nama')] = 'Contoh Barang Masuk';
  row[getConfigValue('col_masuk_jumlah')] = 10;
  row[getConfigValue('col_masuk_keterangan')] = 'Dummy test dari menu Input Manual';

  const rowIndex = appendRow(sheetName, row);
  SpreadsheetApp.getUi().alert(
    'Baris baru ditambahkan ke "' + sheetName + '" di baris ' + rowIndex + '.'
  );
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

  const rowIndices = batchInsert(config.sheet_barang_keluar, rows);
  SpreadsheetApp.getUi().alert(
    rowIndices.length + ' baris ditambahkan ke "' + config.sheet_barang_keluar +
    '" (invoice ' + invoiceNumber + ') di baris ' + rowIndices.join(', ') + '.'
  );
}

function sortBarangMasuk() {
  sortByDate(getConfig().sheet_barang_masuk);
}

function sortBarangRetur() {
  sortByDate(getConfig().sheet_barang_retur);
}

function sortBarangKeluar() {
  sortByDate(getConfig().sheet_barang_keluar);
}

/**
 * Ensures the Config and Panduan sheets exist, creating them with defaults
 * if this is a fresh copy of the template. Safe to run repeatedly.
 */
function runSetup() {
  const configCreated = ensureConfigSheet();
  const panduanCreated = ensurePanduanSheet_();

  const ui = SpreadsheetApp.getUi();
  if (!configCreated && !panduanCreated) {
    ui.alert('Sheet Config dan Panduan sudah ada. Tidak ada yang diubah.');
    return;
  }

  const created = [];
  if (configCreated) created.push('Config');
  if (panduanCreated) created.push('Panduan');
  ui.alert('Sheet berikut berhasil dibuat: ' + created.join(', '));
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
