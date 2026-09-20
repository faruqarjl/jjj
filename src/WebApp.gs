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

/**
 * One deployment serves both pages, picked by ?page=:
 *   ...?page=dashboard  -> read-only dashboard (Fase 8B)
 *   anything else       -> the input form (Fase 8A), the safe default
 *
 * One URL means one deployment to redeploy, one access code, and one link
 * to hand out. The dashboard's viewport allows pinch-zoom because its
 * tables are worth zooming into; the form pins the scale so iOS doesn't
 * jump around while someone is typing.
 */
function doGet(e) {
  const page = normalizeText_(e && e.parameter && e.parameter.page).toLowerCase();

  if (page === 'dashboard') {
    return HtmlService.createHtmlOutputFromFile('WebDashboard')
      .setTitle('Dashboard Stok')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  return HtmlService.createHtmlOutputFromFile('WebAppInput')
    .setTitle('Input Stok')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

/**
 * Absolute links for the header nav on both pages. HtmlService renders
 * inside a sandboxed iframe, so a relative "?page=dashboard" would resolve
 * against the sandbox host rather than the web app — the links have to be
 * absolute and open with target="_top".
 *
 * Returns blank strings when the script isn't running as a deployed web
 * app (the editor, a test), and the pages simply hide the nav.
 */
function getWebAppNav() {
  let base = '';
  try {
    base = normalizeText_(ScriptApp.getService().getUrl());
  } catch (err) {
    Logger.log('getWebAppNav(): URL web app tidak tersedia — %s', err.message);
  }
  if (base === '') return { input: '', dashboard: '' };

  const joiner = base.indexOf('?') === -1 ? '?' : '&';
  return {
    input: base + joiner + 'page=input',
    dashboard: base + joiner + 'page=dashboard'
  };
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

/* ------------------------------------------------------------------ *
 * Dashboard (Fase 8B) — read-only
 *
 * Nothing below writes anything. It reads REKAP BARANG as recalculateRekap()
 * already left it and aggregates; SISA STOK, SISA DUS and STATUS are taken
 * from the sheet verbatim rather than recomputed, so the dashboard can never
 * disagree with the spreadsheet.
 * ------------------------------------------------------------------ */

/**
 * Everything the dashboard renders, in one call. payload: { kodeAkses }.
 *
 * Guarded by the same access code as the input form — stock levels are no
 * less sensitive than the ability to add a row.
 */
function getDashboardData(payload) {
  const request = payload || {};
  assertWebAppAccess_(request.kodeAkses);

  const config = getConfig();
  const texts = statusTexts_();
  const rekapSheetName = normalizeText_(config.sheet_rekap_barang);
  const items = readDashboardItems_(rekapSheetName, config);

  const aman = items.filter(function (item) { return item.statusKey === 'aman'; });
  const perluRestok = items.filter(function (item) { return item.statusKey === 'perluRestok'; });
  const lainnya = items.filter(function (item) { return item.statusKey === 'lainnya'; });

  // Most urgent first: furthest below its reorder point.
  const kritis = perluRestok.slice().sort(function (a, b) {
    return a.selisih - b.selisih || a.sisaStok - b.sisaStok;
  });

  const stokTersedikit = items.slice().sort(function (a, b) {
    return a.sisaStok - b.sisaStok;
  }).slice(0, DASHBOARD_TOP_N);

  return {
    generatedAt: formatDashboardTime_(new Date()),
    rekapSheet: rekapSheetName,
    label: { aman: texts.aman, perluRestok: texts.perluRestok, lainnya: texts.tidakDiketahui },
    summary: {
      totalBarang: items.length,
      aman: aman.length,
      perluRestok: perluRestok.length,
      lainnya: lainnya.length
    },
    stokTersedikit: stokTersedikit,
    kritis: kritis,
    hariIni: getDashboardToday_(config),
    kosong: items.length === 0,
    catatan: items.length === 0
      ? 'Sheet "' + rekapSheetName + '" belum berisi barang. Tambahkan barang lewat ' +
        'menu Stock Manager > Edit Rekap Barang, lalu refresh halaman ini.'
      : ''
  };
}

const DASHBOARD_TOP_N = 10;

/**
 * One read of REKAP BARANG, mapped through the Config column names.
 *
 * An unreadable recap (sheet renamed, still empty, header row misconfigured)
 * yields an empty list rather than an exception: a dashboard that says "no
 * items yet" is more useful to whoever opened it than a stack trace.
 */
function readDashboardItems_(sheetName, config) {
  const texts = statusTexts_();

  let table;
  try {
    table = getTableInfo_(sheetName);
  } catch (err) {
    Logger.log('readDashboardItems_(): "%s" tidak terbaca — %s', sheetName, err.message);
    return [];
  }

  const rowCount = table.sheet.getLastRow() - table.headerRow;
  if (rowCount < 1) return [];

  const index = {};
  const fields = ['kode', 'nama', 'sisa_stok', 'sisa_dus', 'min_stok', 'status'];
  for (let i = 0; i < fields.length; i++) {
    const columnName = columnNameFor_(sheetName, fields[i], config);
    try {
      index[fields[i]] = resolveColumnIndex_(table.headers, columnName, sheetName, table.headerRow) - 1;
    } catch (err) {
      Logger.log('readDashboardItems_(): kolom "%s" tidak ketemu — %s', fields[i], err.message);
      return [];
    }
  }

  const values = table.sheet.getRange(table.firstDataRow, 1, rowCount, table.width).getValues();

  return values
    .filter(function (row) { return normalizeText_(row[index.kode]) !== ''; })
    .map(function (row) {
      const status = normalizeText_(row[index.status]);
      const sisaStok = toNumber_(row[index.sisa_stok]);
      const minStok = toNumber_(row[index.min_stok]);

      let statusKey = 'lainnya';
      if (status === texts.aman) statusKey = 'aman';
      else if (status === texts.perluRestok) statusKey = 'perluRestok';

      return {
        kode: normalizeText_(row[index.kode]),
        nama: normalizeText_(row[index.nama]),
        sisaStok: sisaStok,
        sisaDus: normalizeText_(row[index.sisa_dus]),
        minStok: minStok,
        selisih: sisaStok - minStok,
        status: status,
        statusKey: statusKey
      };
    });
}

/**
 * Today's activity across the three transaction sheets: how many rows were
 * recorded and how many units they move. A sheet this business doesn't have
 * is reported as zero rather than failing the whole dashboard.
 */
function getDashboardToday_(config) {
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const today = dashboardDayKey_(new Date(), timeZone);

  const result = { tanggal: today, masuk: null, retur: null, keluar: null, total: { baris: 0, jumlah: 0 } };

  ['masuk', 'retur', 'keluar'].forEach(function (jenis) {
    const sheetName = normalizeText_(config['sheet_barang_' + jenis]);
    const counted = countRowsForDay_(sheetName, today, timeZone, config);
    result[jenis] = counted;
    result.total.baris += counted.baris;
    result.total.jumlah += counted.jumlah;
  });

  return result;
}

/** Rows and quantity on one sheet whose date column falls on `dayKey`. */
function countRowsForDay_(sheetName, dayKey, timeZone, config) {
  const empty = { sheet: sheetName, baris: 0, jumlah: 0, terbaca: false };
  if (sheetName === '') return empty;
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName)) return empty;

  let table;
  try {
    table = getTableInfo_(sheetName);
  } catch (err) {
    Logger.log('countRowsForDay_(): "%s" tidak terbaca — %s', sheetName, err.message);
    return empty;
  }

  const rowCount = table.sheet.getLastRow() - table.headerRow;
  if (rowCount < 1) return { sheet: sheetName, baris: 0, jumlah: 0, terbaca: true };

  let tglIndex, jumlahIndex;
  try {
    tglIndex = resolveColumnIndex_(
      table.headers, columnNameFor_(sheetName, 'tgl', config), sheetName, table.headerRow) - 1;
    jumlahIndex = resolveColumnIndex_(
      table.headers, columnNameFor_(sheetName, 'jumlah', config), sheetName, table.headerRow) - 1;
  } catch (err) {
    Logger.log('countRowsForDay_(): kolom TGL/JUMLAH "%s" tidak ketemu — %s', sheetName, err.message);
    return empty;
  }

  const values = table.sheet.getRange(table.firstDataRow, 1, rowCount, table.width).getValues();
  let baris = 0;
  let jumlah = 0;

  values.forEach(function (row) {
    if (dashboardDayKey_(row[tglIndex], timeZone) !== dayKey) return;
    baris++;
    jumlah += toNumber_(row[jumlahIndex]);
  });

  return { sheet: sheetName, baris: baris, jumlah: jumlah, terbaca: true };
}

/**
 * The calendar day a cell falls on, as yyyy-MM-dd in the spreadsheet's own
 * time zone. Comparing formatted days rather than timestamps keeps a date
 * typed at 09:00 and one at 17:00 on the same day.
 */
function dashboardDayKey_(value, timeZone) {
  const time = toTimeValue_(value);
  if (time === null) return '';
  return Utilities.formatDate(new Date(time), timeZone, 'yyyy-MM-dd');
}

function formatDashboardTime_(date) {
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return Utilities.formatDate(date, timeZone, 'dd-MM-yyyy HH:mm');
}
