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
    .addItem('Export Data', 'showExportDialog')
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
 * Creates the Config and ActionLog sheets if missing, backfills any Config
 * key added by a later version, then regenerates Panduan. Safe to run
 * repeatedly — and worth re-running after editing Config, since Panduan's
 * key table is built from whatever Config currently holds.
 */
function runSetup() {
  const configCreated = ensureConfigSheet();
  const actionLogCreated = ensureActionLogSheet();
  const addedKeys = configCreated ? [] : backfillConfigSheet();

  // Last, so the key table it prints reflects the backfill that just ran.
  const panduanCreated = rebuildPanduanSheet_();

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
  messages.push('Sheet Panduan dibuat ulang sesuai isi Config saat ini.');

  notify_('Setup', messages.join('\n\n'));
}

/**
 * Rewrites the Panduan sheet from scratch on every Setup.
 *
 * The Config key table is generated from the live Config sheet rather than
 * typed out here, so it can never drift from what the script actually
 * reads — including keys a business adds itself. Because it is generated,
 * anything hand-written on this sheet is replaced; edit Config, not Panduan.
 *
 * Returns true when the sheet had to be created.
 */
function rebuildPanduanSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PANDUAN_SHEET_NAME);
  const created = !sheet;
  if (!sheet) sheet = ss.insertSheet(PANDUAN_SHEET_NAME);

  const rows = []
    .concat(panduanIntro_())
    .concat(panduanDuplicateSteps_())
    .concat(panduanConfigTable_())
    .concat(panduanMenuTable_())
    .concat(panduanLimitations_())
    .concat(panduanFormulas_());

  sheet.clear();
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);

  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 460);
  sheet.getRange(1, 1, rows.length, 3).setVerticalAlignment('top').setWrap(true);

  // Bold every section heading, which is the rows whose column A is a
  // numbered title and whose other columns are empty.
  rows.forEach(function (row, i) {
    if (/^[0-9]+\. /.test(String(row[0])) && row[1] === '' && row[2] === '') {
      sheet.getRange(i + 1, 1, 1, 3).setFontWeight('bold');
    }
  });

  Logger.log('rebuildPanduanSheet_(): %s baris ditulis.', rows.length);
  return created;
}

function panduanIntro_() {
  const stamp = Utilities.formatDate(
    new Date(),
    SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Asia/Jakarta',
    'dd/MM/yyyy HH:mm'
  );
  return [
    ['PANDUAN STOCK MANAGER', '', ''],
    ['Dibuat ulang otomatis setiap kali menu Setup dijalankan. Terakhir: ' + stamp, '', ''],
    ['Jangan mengetik apa pun di sheet ini — isinya akan ditimpa. Yang diubah adalah sheet Config.', '', ''],
    ['', '', '']
  ];
}

function panduanDuplicateSteps_() {
  return [
    ['1. CARA PAKAI DI BISNIS / SPREADSHEET LAIN', '', ''],
    ['a. File > Make a Copy', '', 'Salin spreadsheet ini beserta script-nya.'],
    ['b. Sesuaikan sheet Config', '', 'Ganti kolom Value (JANGAN kolom Key) supaya cocok dengan nama sheet dan nama kolom di file baru. Nama sheet, nama kolom, baris header, teks STATUS — semuanya diatur dari sini.'],
    ['c. Jalankan Stock Manager > Setup', '', 'Menambahkan key yang belum ada (backfill) dan membuat ulang Panduan ini sesuai Config yang baru.'],
    ['d. Uji 1 baris', '', 'Stock Manager > Input Manual, lalu cek barisnya masuk di tempat yang benar dan REKAP ikut berubah. Kalau ada kolom yang tidak ketemu, pesan errornya menyebutkan nama kolom yang dicari beserta header yang benar-benar ada.'],
    ['', '', '']
  ];
}

/**
 * The Config key table, read from the live sheet. Keys in the default order
 * first, then anything extra the spreadsheet added on its own.
 */
function panduanConfigTable_() {
  const config = getConfig();
  const ordered = DEFAULT_CONFIG_ENTRIES.map(function (entry) { return entry[0]; });
  const extras = Object.keys(config).filter(function (key) {
    return ordered.indexOf(key) === -1;
  });

  const rows = [
    ['2. DAFTAR KEY DI SHEET CONFIG', '', ''],
    ['Key', 'Value sekarang', 'Fungsi']
  ];

  ordered.concat(extras).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) return;
    rows.push([key, String(config[key]), describeConfigKey_(key)]);
  });

  rows.push(['', '', '']);
  return rows;
}

const CONFIG_KEY_NOTES = {
  sheet_barang_masuk: 'Nama sheet transaksi barang masuk.',
  sheet_barang_retur: 'Nama sheet retur (barang kembali ke gudang — menambah stok).',
  sheet_barang_keluar: 'Nama sheet barang keluar / penjualan.',
  sheet_rekap_barang: 'Nama sheet rekap stok per barang.',
  daftar_user: 'Daftar nama yang muncul di dropdown "Pilih Nama Kamu" pada web app, dipisah koma.',
  col_keluar_price: 'Kolom harga satuan di sheet barang keluar, diketik lewat form input. Kosongkan kalau tidak dipakai.',
  col_keluar_diskon: 'Kolom diskon pertama di sheet barang keluar, diketik lewat form input. Kosongkan kalau tidak dipakai.',
  col_keluar_diskon2: 'Kolom diskon kedua. Kosongkan kalau tidak dipakai.',
  col_keluar_diskon3: 'Kolom diskon ketiga. Kosongkan kalau tidak dipakai.',
  col_keluar_formula: 'Kolom yang isinya RUMUS milik spreadsheet (mis. AMOUNT KANTOR, ANZAR, SALES B). Script tidak pernah menulis angka ke kolom ini \u2014 rumusnya disalin dari baris tepat di atasnya setiap kali ada baris baru. Pisahkan dengan koma. Kosongkan kalau sheet Anda tidak punya kolom rumus.',
  sisa_dus_teks_error: 'Teks SISA DUS kalau ISI PER DUS / ISI PER PACK kosong atau nol. Default "0 DUS 0 PACK", mengikuti IFERROR di rumus asli.',
  daftar_sales: 'Pilihan nama sales di dropdown form input barang keluar, dipisah koma. Isinya harus sama persis dengan yang dikenali rumus di kolom AMOUNT/ANZAR/SALES B.',
  col_keluar_omset: 'Kolom rupiah di sheet barang keluar yang dijumlah jadi omset. Boleh lebih dari satu, dipisah koma — nilainya dijumlah apa adanya, PRICE dan DISKON tidak dihitung ulang. Kosongkan kalau bisnis Anda tidak memakai omset.',
  col_keluar_sales: 'Kolom berisi NAMA sales di sheet barang keluar, dipakai untuk rincian omset per sales. Kosongkan kalau tidak ada.',
  dashboard_minggu_tren: 'Berapa minggu terakhir yang ditampilkan di grafik tren omset dashboard. Default 8.',
  webapp_kode_akses: 'Kode akses web app. Kalau diisi, kode ini harus dimasukkan sebelum bisa submit; dikosongkan = tidak ditanya sama sekali. GANTI dari nilai bawaannya — nilai bawaan ikut terbaca siapa pun yang punya salinan script ini.',
  status_teks_aman: 'Teks yang ditulis ke kolom STATUS saat stok masih aman.',
  status_teks_perlu_restok: 'Teks STATUS saat sisa stok <= min stok.',
  status_teks_na: 'Teks saat STATUS atau SISA DUS tidak bisa dihitung (min stok / isi per dus kosong).'
};

const CONFIG_FIELD_NOTES = {
  tgl: 'tanggal', kode: 'kode barang', nama: 'nama barang', jumlah: 'jumlah',
  keterangan: 'keterangan', invoice: 'nomor invoice', no: 'nomor urut baris',
  stok_awal: 'stok awal', min_stok: 'batas minimum stok', sisa_stok: 'sisa stok',
  sisa_dus: 'sisa dalam dus/pack', status: 'status stok', masuk: 'total barang masuk',
  retur: 'total retur', keluar: 'total barang keluar',
  isi_pack: 'isi per pack', isi_dus: 'isi per dus'
};

const CONFIG_SHEET_LABELS = {
  masuk: 'BARANG MASUK', retur: 'BARANG RETUR',
  keluar: 'BARANG KELUAR', rekap: 'REKAP BARANG'
};

/**
 * A description for one Config key. Derived from the key's shape when it
 * isn't in the notes map, so a key added later still documents itself.
 */
function describeConfigKey_(key) {
  if (CONFIG_KEY_NOTES[key]) return CONFIG_KEY_NOTES[key];

  const column = /^col_(masuk|retur|keluar|rekap)_(.+)$/.exec(key);
  if (column) {
    const sheet = CONFIG_SHEET_LABELS[column[1]] || column[1];
    const field = CONFIG_FIELD_NOTES[column[2]] || column[2].replace(/_/g, ' ');
    return 'Nama kolom ' + field + ' di sheet ' + sheet + '.';
  }

  const headerRow = /^header_row_(.+)$/.exec(key);
  if (headerRow) {
    const sheet = CONFIG_SHEET_LABELS[headerRow[1]] || headerRow[1];
    return 'Nomor baris tempat header kolom berada di sheet ' + sheet +
      ' (isi angka, contoh 5). Baris data dianggap mulai tepat di bawahnya.';
  }

  return 'Key tambahan milik spreadsheet ini.';
}

/**
 * Menu reference. Written by hand rather than derived from onOpen(), which
 * stays untouched because it is the entry point everything else depends on
 * — so update this list when a menu item changes.
 */
function panduanMenuTable_() {
  const items = [
    ['Setup', 'Membuat/melengkapi sheet Config, Panduan, ActionLog. Aman dijalankan berulang.'],
    ['Input Manual', 'Menambah 1 baris contoh ke sheet barang masuk — dipakai untuk menguji sambungan Config.'],
    ['Input Batch (Invoice)', 'Menambah 3 baris contoh ke barang keluar dengan satu nomor invoice.'],
    ['Urutkan Tanggal >', 'Urutkan tiap sheet transaksi, terbaru ke terlama atau sebaliknya. Nomor urut ikut dirapikan.'],
    ['Hapus Baris', 'Menghapus satu baris (diminta nomor barisnya). Nomor urut dirapikan, rekap ikut dihitung ulang.'],
    ['Edit Rekap Barang', 'Sidebar untuk menambah atau mengubah data barang di sheet rekap.'],
    ['Refresh Semua Status', 'Menghitung ulang seluruh isi sheet rekap sekaligus.'],
    ['Warnai Transaksi', 'Sidebar untuk mewarnai baris di sheet transaksi. Sheet rekap tidak bisa diwarnai manual.'],
    ['Filter Rekap Barang >', 'Membuat filter view per-user: Semua / Hanya Aman / Hanya Perlu Restok.'],
    ['Export Data', 'Dialog export PDF atau Excel ke folder Drive "Export", dengan filter tanggal opsional.'],
    ['Undo Terakhir', 'Membatalkan aksi terakhir yang tercatat di sheet ActionLog.'],
    ['Redo', 'Menjalankan ulang aksi yang barusan dibatalkan.'],
    ['Debug Config', 'Menampilkan isi Config apa adanya — dipakai kalau ada key yang tidak terbaca.'],
    ['Clear Cache Config', 'Membersihkan cache Config supaya perubahan langsung terbaca.']
  ];

  const rows = [['3. MENU "STOCK MANAGER"', '', ''], ['Menu', '', 'Fungsi']];
  items.forEach(function (item) { rows.push([item[0], '', item[1]]); });
  rows.push(['', '', '']);
  return rows;
}

function panduanLimitations_() {
  const items = [
    ['Filter view tidak aktif otomatis', 'Script hanya bisa membuat/memperbarui filter view. Mengaktifkannya hanya bisa dilakukan browser masing-masing, jadi menunya menampilkan link yang harus diklik. Butuh Sheets Advanced Service aktif.'],
    ['Export minta izin di awal', 'Pemakaian pertama meminta izin akses Drive dan koneksi eksternal. Wajib di-Allow, kalau tidak export gagal.'],
    ['Refresh Semua Status makan waktu', 'Sudah dioptimasi jadi sekali baca per sheet (bukan per barang), tapi katalog yang sangat besar tetap perlu waktu. Progres dicatat tiap 50 barang di log.'],
    ['Merge cell dibongkar permanen', 'Sort pertama kali akan meng-unmerge sel yang ter-merge di area data dan mengisi ulang nilainya. Ini tidak bisa dibatalkan — salin dulu spreadsheet sebelum sort pertama.'],
    ['Undo hanya 50 aksi terakhir', 'ActionLog menyimpan maksimal 50 aksi aktif; yang paling lama terhapus lebih dulu (FIFO).'],
    ['Tabel harus mulai dari kolom A', 'Semua baca/tulis dimulai dari kolom A selebar tabel. Tabel yang mulai dari kolom C belum didukung.'],
    ['Struktur 4 sheet itu tetap', 'Script mengenal masuk, retur, keluar, dan rekap. Menambah sheet transaksi kelima perlu perubahan kode.'],
    ['Baris data tepat di bawah header', 'Tidak boleh ada baris pemisah atau subtotal di antara header dan baris data pertama.'],
    ['Label menu & judul sidebar tetap', 'Beberapa teks tampilan masih memakai istilah asli (mis. nama sheet di label submenu Urutkan). Fungsinya tetap mengikuti Config, hanya tulisannya yang tidak ikut berubah.']
  ];

  const rows = [['4. BATASAN YANG DIKETAHUI', '', ''], ['Batasan', '', 'Penjelasan']];
  items.forEach(function (item) { rows.push([item[0], '', item[1]]); });
  rows.push(['', '', '']);
  return rows;
}

function panduanFormulas_() {
  return [
    ['5. RUMUS YANG DIPAKAI', '', ''],
    ['SISA STOK', '', 'STOK AWAL + MASUK + RETUR - KELUAR. Retur menambah stok (barang kembali dari pelanggan).'],
    ['SISA DUS', '', 'dus = SISA STOK dibagi ISI PER DUS (dibulatkan ke bawah); sisanya dibagi ISI PER PACK. Ditulis sebagai teks "{dus} DUS {pack}PACK".'],
    ['STATUS', '', 'Perlu restok bila SISA STOK <= MIN STOK, selain itu aman. Teksnya diatur lewat key status_teks_*.']
  ];
}
