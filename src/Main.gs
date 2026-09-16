/**
 * Entry points: custom menu and first-run setup.
 */

const PANDUAN_SHEET_NAME = 'Panduan';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Stock Manager')
    .addItem('Setup', 'runSetup')
    .addToUi();
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
