/**
 * Web app input form (Fase 8A).
 *
 * Deployed as "Execute as me / Anyone with the link", so warehouse staff on
 * personal Gmail accounts can submit without signing in.
 *
 * SECURITY, stated plainly: that deployment means anyone holding the URL can
 * write to the spreadsheet. The "Pilih Nama Kamu" dropdown is a self-declared
 * label for accountability, NOT authentication — nothing stops someone
 * picking another person's name. webapp_kode_akses adds a shared code as a
 * second barrier; leave it blank to disable the check entirely.
 *
 * Every submit goes through appendRowLogged/batchInsertLogged, so the recap
 * resync, borders and undo history all behave exactly as they do from the
 * spreadsheet menu.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('WebAppInput')
    .setTitle('Input Stok')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

/** Everything the form needs on load: names, sheet labels, known items. */
function getWebAppData() {
  const config = getConfig();

  return {
    users: getWebAppUsers_(),
    needsAccessCode: normalizeText_(config.webapp_kode_akses) !== '',
    jenis: [
      { id: 'masuk', label: 'Barang Masuk', sheet: normalizeText_(config.sheet_barang_masuk) },
      { id: 'retur', label: 'Barang Retur', sheet: normalizeText_(config.sheet_barang_retur) },
      { id: 'keluar', label: 'Barang Keluar', sheet: normalizeText_(config.sheet_barang_keluar) }
    ],
    items: getWebAppItems_()
  };
}

/** Item codes and names from the recap, for the picker that fills the name. */
function getWebAppItems_() {
  try {
    return getRekapItems().map(function (item) {
      return { kode: item.kode, nama: item.nama };
    });
  } catch (err) {
    // A missing or empty recap sheet must not stop someone recording stock.
    Logger.log('getWebAppItems_(): daftar barang tidak bisa dibaca — %s', err.message);
    return [];
  }
}

/** Names from the daftar_user key, trimmed and de-duplicated. */
function getWebAppUsers_() {
  const raw = normalizeText_(getConfig().daftar_user);
  if (raw === '') return [];

  const seen = {};
  return raw.split(',')
    .map(function (name) { return normalizeText_(name); })
    .filter(function (name) {
      const key = name.toLowerCase();
      if (name === '' || seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

/**
 * Records one transaction. payload:
 *   { user, kodeAkses, jenis, tanggal, kode, nama, jumlah, keterangan, invoice }
 * Returns { message, sheetName, rowIndex }.
 */
function submitWebAppInput(payload) {
  const request = payload || {};
  assertWebAppAccess_(request.kodeAkses);

  const user = assertWebAppUser_(request.user);
  setInputBy_(user);

  const config = getConfig();
  const jenis = normalizeText_(request.jenis).toLowerCase();
  const sheetName = webAppSheetFor_(jenis, config);

  const kode = normalizeText_(request.kode);
  const jumlah = webAppQuantity_(request.jumlah);
  const tanggal = webAppDate_(request.tanggal);
  if (kode === '') throw new Error('Kode barang wajib diisi.');

  const row = {};
  row[columnNameFor_(sheetName, 'tgl', config)] = tanggal;
  row[columnNameFor_(sheetName, 'kode', config)] = kode;
  row[columnNameFor_(sheetName, 'jumlah', config)] = jumlah;

  const namaColumn = columnNameFor_(sheetName, 'nama', config);
  if (namaColumn) row[namaColumn] = normalizeText_(request.nama);

  if (jenis === 'keluar') {
    const invoice = normalizeText_(request.invoice);
    if (invoice === '') throw new Error('Nomor invoice wajib diisi untuk barang keluar.');
    row[columnNameFor_(sheetName, 'invoice', config)] = invoice;
  } else {
    const keteranganColumn = columnNameFor_(sheetName, 'keterangan', config);
    if (keteranganColumn) row[keteranganColumn] = normalizeText_(request.keterangan);
  }

  const rowIndex = appendRowLogged(sheetName, row);
  Logger.log('submitWebAppInput(): %s -> "%s" baris %s oleh %s.', jenis, sheetName, rowIndex, user);

  return {
    message: kode + ' (' + jumlah + ') tercatat di ' + sheetName + ', baris ' + rowIndex + '.',
    sheetName: sheetName,
    rowIndex: rowIndex
  };
}

/**
 * Records one invoice with several items, in a single batch so undo removes
 * the whole invoice at once. payload:
 *   { user, kodeAkses, tanggal, invoice, items: [{ kode, nama, jumlah }] }
 */
function submitWebAppBatch(payload) {
  const request = payload || {};
  assertWebAppAccess_(request.kodeAkses);

  const user = assertWebAppUser_(request.user);
  setInputBy_(user);

  const config = getConfig();
  const sheetName = webAppSheetFor_('keluar', config);
  const invoice = normalizeText_(request.invoice);
  const tanggal = webAppDate_(request.tanggal);

  if (invoice === '') throw new Error('Nomor invoice wajib diisi.');

  const items = (request.items || []).filter(function (item) {
    return normalizeText_(item && item.kode) !== '';
  });
  if (items.length === 0) throw new Error('Isi minimal satu barang.');

  const column = {
    tgl: columnNameFor_(sheetName, 'tgl', config),
    invoice: columnNameFor_(sheetName, 'invoice', config),
    kode: columnNameFor_(sheetName, 'kode', config),
    nama: columnNameFor_(sheetName, 'nama', config),
    jumlah: columnNameFor_(sheetName, 'jumlah', config)
  };

  const rows = items.map(function (item, i) {
    const row = {};
    row[column.tgl] = tanggal;
    row[column.invoice] = invoice;
    row[column.kode] = normalizeText_(item.kode);
    row[column.jumlah] = webAppQuantity_(item.jumlah, 'Barang ke-' + (i + 1));
    if (column.nama) row[column.nama] = normalizeText_(item.nama);
    return row;
  });

  const rowIndices = batchInsertLogged(sheetName, rows);
  Logger.log('submitWebAppBatch(): invoice %s, %s baris oleh %s.', invoice, rowIndices.length, user);

  return {
    message: 'Invoice ' + invoice + ' tercatat: ' + rowIndices.length +
      ' barang di ' + sheetName + ', baris ' + rowIndices.join(', ') + '.',
    sheetName: sheetName,
    rowIndices: rowIndices
  };
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * Checks the shared access code when one is configured. A blank
 * webapp_kode_akses disables the check, which is the default.
 */
function assertWebAppAccess_(submitted) {
  const expected = normalizeText_(getConfig().webapp_kode_akses);
  if (expected === '') return;

  if (normalizeText_(submitted) !== expected) {
    throw new Error('Kode akses salah.');
  }
}

/** The chosen name must be one of the configured users, not free text. */
function assertWebAppUser_(submitted) {
  const users = getWebAppUsers_();
  if (users.length === 0) {
    throw new Error(
      'Daftar nama belum diisi. Isi key "daftar_user" di sheet Config ' +
      '(nama dipisah koma), lalu buka ulang halaman ini.'
    );
  }

  const name = normalizeText_(submitted);
  const match = users.filter(function (user) {
    return user.toLowerCase() === name.toLowerCase();
  })[0];

  if (!match) throw new Error('Pilih nama kamu dulu dari daftar.');
  return match;
}

function webAppSheetFor_(jenis, config) {
  const sheets = {
    masuk: config.sheet_barang_masuk,
    retur: config.sheet_barang_retur,
    keluar: config.sheet_barang_keluar
  };

  const sheetName = normalizeText_(sheets[jenis]);
  if (sheetName === '') {
    throw new Error('Jenis transaksi "' + jenis + '" tidak dikenal.');
  }
  return sheetName;
}

function webAppQuantity_(value, label) {
  const jumlah = Number(normalizeText_(value));
  if (!isFinite(jumlah) || jumlah <= 0) {
    throw new Error((label ? label + ': j' : 'J') + 'umlah harus angka lebih dari 0.');
  }
  return jumlah;
}

/** Parses the form's YYYY-MM-DD, defaulting to today when left blank. */
function webAppDate_(value) {
  const parsed = parseDateInput_(value, false);
  return parsed === null ? new Date() : parsed;
}
