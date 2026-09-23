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
    items: getWebAppItems_(),
    sales: getWebAppSales_(),
    fieldKeluar: webAppKeluarFields_(config)
  };
}

/**
 * Which of the optional barang-keluar fields this spreadsheet actually has,
 * so the form shows a PRICE or DISKON box only where there is a column to
 * put it in. A business without them sees the plain Fase 8A form.
 */
function webAppKeluarFields_(config) {
  const sheetName = normalizeText_(config.sheet_barang_keluar);
  const fields = {};

  ['price', 'diskon', 'diskon2', 'diskon3', 'sales'].forEach(function (field) {
    fields[field] = sheetName === ''
      ? null
      : normalizeText_(columnNameFor_(sheetName, field, config)) || null;
  });

  return fields;
}

/** Sales names for the dropdown, from daftar_sales. */
function getWebAppSales_() {
  return splitConfigList_(getConfig().daftar_sales);
}

/** A comma-separated Config value as a trimmed, de-duplicated list. */
function splitConfigList_(raw) {
  const text = normalizeText_(raw);
  if (text === '') return [];

  const seen = {};
  return text.split(',')
    .map(function (part) { return normalizeText_(part); })
    .filter(function (part) {
      const key = part.toLowerCase();
      if (part === '' || seen[key]) return false;
      seen[key] = true;
      return true;
    });
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
  return splitConfigList_(getConfig().daftar_user);
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
    applyKeluarFields_(row, request, config);
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

    // Price and discounts vary per line; the sales name belongs to the
    // whole invoice, so it is taken from the request for every row.
    applyKeluarFields_(row, {
      price: item.price,
      diskon: item.diskon,
      diskon2: item.diskon2,
      diskon3: item.diskon3,
      sales: request.sales
    }, config);
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

/**
 * Fills the manually typed barang-keluar columns — price, up to three
 * discounts, and the sales name — into a row about to be written.
 *
 * These are the inputs the sheet's own formulas consume. The computed
 * columns are never touched here: their formulas are inherited from the
 * row above by copyFormulaColumns_() once the row is written.
 *
 * Every field is optional in Config, so a spreadsheet without a PRICE
 * column simply never receives one.
 */
function applyKeluarFields_(row, request, config) {
  const sheetName = normalizeText_(config.sheet_barang_keluar);
  const fields = webAppKeluarFields_(config);

  if (fields.price) {
    row[fields.price] = webAppOptionalNumber_(request.price, 'Harga (PRICE)');
  }

  [['diskon', 'Diskon'], ['diskon2', 'Diskon 2'], ['diskon3', 'Diskon 3']].forEach(function (pair) {
    const column = fields[pair[0]];
    if (column) row[column] = webAppOptionalNumber_(request[pair[0]], pair[1]);
  });

  if (fields.sales) {
    row[fields.sales] = assertWebAppSales_(request.sales, sheetName);
  }
}

/**
 * A number the user may legitimately leave blank, which becomes '' so the
 * cell stays empty rather than reading a misleading 0. Text that is not a
 * number is rejected instead of silently becoming 0 — a price typed as
 * "25.000,-" would otherwise flow into the sheet's formulas as nothing.
 */
function webAppOptionalNumber_(value, label) {
  const text = normalizeText_(value);
  if (text === '') return '';

  const parsed = Number(text);
  if (!isFinite(parsed)) {
    throw new Error(label + ' harus berupa angka. Isi "' + text + '" tidak bisa dibaca.');
  }
  return parsed;
}

/**
 * The chosen sales name must be one of the configured ones: the sheet's
 * formulas route a line's value by matching this text, so a typo would
 * send the amount to no column at all and quietly lose the sale.
 */
function assertWebAppSales_(submitted, sheetName) {
  const sales = getWebAppSales_();
  const name = normalizeText_(submitted);

  if (sales.length === 0) {
    if (name !== '') return name;
    throw new Error(
      'Daftar sales belum diisi. Isi key "daftar_sales" di sheet Config ' +
      '(nama dipisah koma), lalu buka ulang halaman ini.'
    );
  }

  const match = sales.filter(function (item) {
    return item.toLowerCase() === name.toLowerCase();
  })[0];

  if (!match) {
    throw new Error(
      'Pilih nama sales dulu dari daftar. Nama ini dipakai rumus di sheet "' +
      sheetName + '" untuk menentukan kolom omsetnya, jadi harus persis.'
    );
  }
  return match;
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
 * Dashboard (Fase 8B + 8C) — read-only
 *
 * Nothing below writes anything. Stock figures are read from REKAP BARANG
 * exactly as recalculateRekap() left them; revenue is read from the amount
 * columns of the outgoing sheet exactly as they are typed. PRICE and the
 * DISKON columns are never recomputed — an amount cell already carries its
 * discount, so recomputing it would be a second, competing formula.
 * ------------------------------------------------------------------ */

const DASHBOARD_TOP_N = 10;
const DASHBOARD_WEEKS_DEFAULT = 8;
const DASHBOARD_TANPA_SALES = '(Tanpa Sales)';

/** The time ranges the dashboard toggle offers, in order. */
const DASHBOARD_RANGES = [
  { id: 'hari', label: 'Hari Ini' },
  { id: 'minggu', label: 'Minggu Ini' },
  { id: 'bulan', label: 'Bulan Ini' },
  { id: 'semua', label: 'Semua' }
];

/**
 * Everything the dashboard renders, in one call.
 * payload: { kodeAkses, rentang } — rentang is one of DASHBOARD_RANGES.
 *
 * The range drives transaction counts and revenue, which are historical.
 * It deliberately does NOT drive the stock cards: SISA STOK is the position
 * right now, and the sheet holds no record of what stock was last Tuesday,
 * so a "stock as of last week" figure could only be invented.
 */
function getDashboardData(payload) {
  const request = payload || {};
  assertWebAppAccess_(request.kodeAkses);

  const config = getConfig();
  const texts = statusTexts_();
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const rekapSheetName = normalizeText_(config.sheet_rekap_barang);

  const items = readDashboardItems_(rekapSheetName, config);
  const periode = resolveDashboardRange_(request.rentang, timeZone);

  // One read per transaction sheet, reused for the counts, the revenue and
  // the trend — so the cost does not grow with the number of rows or with
  // how many things the page shows.
  const sheets = readAllTransactionRows_(config, timeZone);

  const aman = items.filter(function (item) { return item.statusKey === 'aman'; });
  const perluRestok = items.filter(function (item) { return item.statusKey === 'perluRestok'; });
  const lainnya = items.filter(function (item) { return item.statusKey === 'lainnya'; });

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
    rentangPilihan: DASHBOARD_RANGES,
    periode: periode,
    summary: {
      totalBarang: items.length,
      aman: aman.length,
      perluRestok: perluRestok.length,
      lainnya: lainnya.length
    },
    stokTersedikit: stokTersedikit,
    kritis: kritis,
    transaksi: summariseTransactions_(sheets, periode),
    omset: summariseOmset_(sheets.keluar, periode),
    tren: buildOmsetTrend_(sheets.keluar, periode, config),
    kosong: items.length === 0,
    catatan: items.length === 0
      ? 'Sheet "' + rekapSheetName + '" belum berisi barang. Tambahkan barang lewat ' +
        'menu Stock Manager > Edit Rekap Barang, lalu refresh halaman ini.'
      : ''
  };
}

/* ------------------------------------------------------------------ *
 * Stock side (unchanged from Fase 8B)
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Time ranges
 * ------------------------------------------------------------------ */

/**
 * Turns the requested range id into concrete day boundaries.
 *
 * Days are compared as yyyy-MM-dd strings in the spreadsheet's own time
 * zone, so a row typed at 09:00 and one at 17:00 fall on the same day and
 * no timestamp arithmetic can drift across a zone boundary.
 *
 * "Minggu Ini" and "Bulan Ini" are calendar ranges (Monday–Sunday, and the
 * 1st to the end of the month), not rolling windows — that is what a
 * weekly or monthly figure means on a report. A row dated tomorrow
 * therefore counts in "Minggu Ini" while not counting in "Hari Ini".
 */
function resolveDashboardRange_(requested, timeZone) {
  const wanted = normalizeText_(requested).toLowerCase();
  const chosen = DASHBOARD_RANGES.filter(function (range) { return range.id === wanted; })[0]
    || DASHBOARD_RANGES[0];

  const todayKey = dashboardDayKey_(new Date(), timeZone);
  const today = civilDateOf_(todayKey);

  let dari = todayKey;
  let sampai = todayKey;

  if (chosen.id === 'minggu') {
    // getDay(): 0 = Minggu. Geser ke Senin sebagai awal minggu.
    const offset = (today.getDay() + 6) % 7;
    const senin = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    dari = civilKeyOf_(senin);
    sampai = civilKeyOf_(new Date(senin.getFullYear(), senin.getMonth(), senin.getDate() + 6));
  } else if (chosen.id === 'bulan') {
    dari = civilKeyOf_(new Date(today.getFullYear(), today.getMonth(), 1));
    sampai = civilKeyOf_(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  } else if (chosen.id === 'semua') {
    dari = '';
    sampai = '';
  }

  return {
    id: chosen.id,
    label: chosen.label,
    dari: dari,
    sampai: sampai,
    hariIni: todayKey,
    semua: chosen.id === 'semua'
  };
}

/** True when a row's day falls inside the period. */
function withinDashboardRange_(dayKey, periode) {
  if (periode.semua) return dayKey !== '';
  if (dayKey === '') return false;
  return dayKey >= periode.dari && dayKey <= periode.sampai;
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

/**
 * A day key as a plain local Date, used only for calendar arithmetic
 * (which Monday, which month). The key is already time-zone resolved, so
 * treating it as a civil date here cannot shift it.
 */
function civilDateOf_(dayKey) {
  const parts = String(dayKey).split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function civilKeyOf_(date) {
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

/* ------------------------------------------------------------------ *
 * Transaction sheets — read once, used for counts, revenue and trend
 * ------------------------------------------------------------------ */

function readAllTransactionRows_(config, timeZone) {
  return {
    masuk: readTransactionRows_('masuk', config, timeZone),
    retur: readTransactionRows_('retur', config, timeZone),
    keluar: readTransactionRows_('keluar', config, timeZone)
  };
}

/**
 * One sheet's rows reduced to what the dashboard needs: which day, how many
 * units, how much money and whose sale. Revenue and sales columns are
 * optional — a business without them simply reports no revenue.
 */
function readTransactionRows_(jenis, config, timeZone) {
  const sheetName = normalizeText_(config['sheet_barang_' + jenis]);
  const empty = { sheet: sheetName, terbaca: false, rows: [], kolomOmset: [], adaOmset: false };

  if (sheetName === '') return empty;
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName)) return empty;

  let table;
  try {
    table = getTableInfo_(sheetName);
  } catch (err) {
    Logger.log('readTransactionRows_(): "%s" tidak terbaca — %s', sheetName, err.message);
    return empty;
  }

  let tglIndex, jumlahIndex;
  try {
    tglIndex = resolveColumnIndex_(
      table.headers, columnNameFor_(sheetName, 'tgl', config), sheetName, table.headerRow) - 1;
    jumlahIndex = resolveColumnIndex_(
      table.headers, columnNameFor_(sheetName, 'jumlah', config), sheetName, table.headerRow) - 1;
  } catch (err) {
    Logger.log('readTransactionRows_(): kolom TGL/JUMLAH "%s" tidak ketemu — %s', sheetName, err.message);
    return empty;
  }

  const omsetColumns = resolveOmsetColumns_(sheetName, table, config);
  const salesIndex = resolveOptionalColumn_(sheetName, table, 'sales', config);

  const rowCount = table.sheet.getLastRow() - table.headerRow;
  const result = {
    sheet: sheetName,
    terbaca: true,
    rows: [],
    kolomOmset: omsetColumns.map(function (column) { return column.nama; }),
    adaOmset: omsetColumns.length > 0
  };
  if (rowCount < 1) return result;

  const values = table.sheet.getRange(table.firstDataRow, 1, rowCount, table.width).getValues();

  result.rows = values.map(function (row) {
    const perKolom = {};
    let omset = 0;
    omsetColumns.forEach(function (column) {
      const nilai = toNumber_(row[column.index]);
      perKolom[column.nama] = nilai;
      omset += nilai;
    });

    return {
      dayKey: dashboardDayKey_(row[tglIndex], timeZone),
      jumlah: toNumber_(row[jumlahIndex]),
      omset: omset,
      perKolom: perKolom,
      sales: salesIndex === -1 ? '' : normalizeText_(row[salesIndex])
    };
  });

  return result;
}

/**
 * The money columns named by col_<sheet>_omset, which may list several
 * separated by commas. A column named in Config but absent from the sheet
 * is logged and skipped rather than failing the whole dashboard.
 */
function resolveOmsetColumns_(sheetName, table, config) {
  const raw = normalizeText_(columnNameFor_(sheetName, 'omset', config));
  if (raw === '') return [];

  const columns = [];
  raw.split(',').forEach(function (part) {
    const nama = normalizeText_(part);
    if (nama === '') return;
    try {
      columns.push({
        nama: nama,
        index: resolveColumnIndex_(table.headers, nama, sheetName, table.headerRow) - 1
      });
    } catch (err) {
      Logger.log('resolveOmsetColumns_(): kolom omset "%s" tidak ada di "%s" — dilewati.', nama, sheetName);
    }
  });
  return columns;
}

/** A column index, or -1 when the key is blank or the column is absent. */
function resolveOptionalColumn_(sheetName, table, field, config) {
  const nama = normalizeText_(columnNameFor_(sheetName, field, config));
  if (nama === '') return -1;
  try {
    return resolveColumnIndex_(table.headers, nama, sheetName, table.headerRow) - 1;
  } catch (err) {
    Logger.log('resolveOptionalColumn_(): kolom "%s" tidak ada di "%s" — dilewati.', nama, sheetName);
    return -1;
  }
}

/* ------------------------------------------------------------------ *
 * Aggregation
 * ------------------------------------------------------------------ */

/** Row and unit counts per sheet for the selected period. */
function summariseTransactions_(sheets, periode) {
  const result = { periode: periode.id, masuk: null, retur: null, keluar: null,
                   total: { baris: 0, jumlah: 0 } };

  ['masuk', 'retur', 'keluar'].forEach(function (jenis) {
    const source = sheets[jenis];
    const counted = { sheet: source.sheet, baris: 0, jumlah: 0, terbaca: source.terbaca };

    source.rows.forEach(function (row) {
      if (!withinDashboardRange_(row.dayKey, periode)) return;
      counted.baris++;
      counted.jumlah += row.jumlah;
    });

    result[jenis] = counted;
    result.total.baris += counted.baris;
    result.total.jumlah += counted.jumlah;
  });

  return result;
}

/**
 * Revenue for the selected period: the grand total, a breakdown by the name
 * in the sales column, and a breakdown by amount column.
 *
 * Every row lands in exactly one sales group — rows with the name left
 * blank go to "(Tanpa Sales)" rather than being dropped — so the breakdown
 * always adds up to the total instead of quietly losing money.
 */
function summariseOmset_(keluar, periode) {
  const result = {
    tersedia: keluar.adaOmset,
    sheet: keluar.sheet,
    kolom: keluar.kolomOmset,
    total: 0,
    barisTerhitung: 0,
    perSales: [],
    perKolom: []
  };
  if (!keluar.adaOmset) return result;

  const bySales = {};
  const byKolom = {};
  keluar.kolomOmset.forEach(function (nama) { byKolom[nama] = 0; });

  keluar.rows.forEach(function (row) {
    if (!withinDashboardRange_(row.dayKey, periode)) return;

    result.total += row.omset;
    result.barisTerhitung++;

    const nama = row.sales === '' ? DASHBOARD_TANPA_SALES : row.sales;
    bySales[nama] = (bySales[nama] || 0) + row.omset;

    keluar.kolomOmset.forEach(function (kolom) {
      byKolom[kolom] += row.perKolom[kolom] || 0;
    });
  });

  result.perSales = Object.keys(bySales)
    .map(function (nama) { return { nama: nama, total: bySales[nama] }; })
    .sort(function (a, b) { return b.total - a.total; });

  result.perKolom = keluar.kolomOmset.map(function (nama) {
    return { nama: nama, total: byKolom[nama] };
  });

  return result;
}

/**
 * Revenue per calendar week for the trend line, ending with the week that
 * contains today. Weeks with no sales are kept at zero — dropping them
 * would draw a line that skips the quiet weeks and reads as if business
 * never paused.
 */
function buildOmsetTrend_(keluar, periode, config) {
  if (!keluar.adaOmset) return [];

  const weeks = Math.max(1, Math.round(toNumber_(config.dashboard_minggu_tren)) || DASHBOARD_WEEKS_DEFAULT);
  const today = civilDateOf_(periode.hariIni);
  const offset = (today.getDay() + 6) % 7;
  const seninIni = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);

  const buckets = [];
  const byStart = {};
  for (let i = weeks - 1; i >= 0; i--) {
    const mulai = new Date(seninIni.getFullYear(), seninIni.getMonth(), seninIni.getDate() - i * 7);
    const selesai = new Date(mulai.getFullYear(), mulai.getMonth(), mulai.getDate() + 6);
    const bucket = {
      mulai: civilKeyOf_(mulai),
      selesai: civilKeyOf_(selesai),
      label: formatWeekLabel_(mulai, selesai),
      total: 0,
      baris: 0
    };
    buckets.push(bucket);
    byStart[bucket.mulai] = bucket;
  }

  const paling_awal = buckets[0].mulai;
  const paling_akhir = buckets[buckets.length - 1].selesai;

  keluar.rows.forEach(function (row) {
    if (row.dayKey === '' || row.dayKey < paling_awal || row.dayKey > paling_akhir) return;

    const hari = civilDateOf_(row.dayKey);
    const geser = (hari.getDay() + 6) % 7;
    const senin = civilKeyOf_(new Date(hari.getFullYear(), hari.getMonth(), hari.getDate() - geser));

    const bucket = byStart[senin];
    if (!bucket) return;
    bucket.total += row.omset;
    bucket.baris++;
  });

  return buckets;
}

const DASHBOARD_BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
                                 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "6–12 Okt" for the trend axis, kept short enough to fit on a phone. */
function formatWeekLabel_(mulai, selesai) {
  const awal = mulai.getDate() + (mulai.getMonth() === selesai.getMonth()
    ? '' : ' ' + DASHBOARD_BULAN_SINGKAT[mulai.getMonth()]);
  return awal + '–' + selesai.getDate() + ' ' + DASHBOARD_BULAN_SINGKAT[selesai.getMonth()];
}

function formatDashboardTime_(date) {
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return Utilities.formatDate(date, timeZone, 'dd-MM-yyyy HH:mm');
}
