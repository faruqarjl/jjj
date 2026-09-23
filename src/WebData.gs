/**
 * Browsing and editing sheet data from the web app (Fase 9).
 *
 * Fase 8B made the dashboard strictly read-only. This file deliberately
 * lifts that restriction for the data pages, because the goal changed: the
 * spreadsheet should no longer be the only place work can happen.
 *
 * Every write still goes through the existing logged wrappers
 * (appendRowLogged, deleteRowLogged, saveRekapItemLogged), so undo, the
 * recap resync and the ActionLog behave exactly as they do from the menu.
 * Nothing here reimplements business logic, and nothing here writes to a
 * column Config marks as a formula column.
 */

const WEB_PAGE_SIZE = 25;

/* ------------------------------------------------------------------ *
 * Reading a transaction sheet
 * ------------------------------------------------------------------ */

/**
 * One page of a transaction sheet, plus the column metadata the table
 * needs to render and to know what may be edited.
 *
 * request: { kodeAkses, jenis, halaman, cari }
 */
function getSheetPage(request) {
  const payload = request || {};
  assertWebAppAccess_(payload.kodeAkses);

  const config = getConfig();
  const jenis = normalizeText_(payload.jenis).toLowerCase();
  const sheetName = webAppSheetFor_(jenis, config);
  const table = getTableInfo_(sheetName);
  const bounds = getDataBounds_(table, config);

  const columns = describeColumns_(sheetName, table, config);
  const hasil = {
    jenis: jenis,
    sheet: sheetName,
    kolom: columns,
    halaman: Math.max(1, Math.round(toNumber_(payload.halaman)) || 1),
    ukuranHalaman: WEB_PAGE_SIZE,
    totalBaris: 0,
    totalHalaman: 1,
    baris: []
  };

  if (bounds.dataRowCount < 1) return hasil;

  const values = table.sheet
    .getRange(table.firstDataRow, 1, bounds.dataRowCount, table.width)
    .getValues();

  // Newest first: what someone opens this page to check is what was just
  // entered, not the oldest row in the sheet.
  const rows = values
    .map(function (row, i) {
      return { baris: table.firstDataRow + i, nilai: row.map(webCellValue_) };
    })
    .filter(function (row) { return row.nilai.some(function (v) { return v !== ''; }); })
    .reverse();

  const cari = normalizeText_(payload.cari).toLowerCase();
  const cocok = cari === '' ? rows : rows.filter(function (row) {
    return row.nilai.some(function (value) {
      return String(value).toLowerCase().indexOf(cari) !== -1;
    });
  });

  hasil.totalBaris = cocok.length;
  hasil.totalHalaman = Math.max(1, Math.ceil(cocok.length / WEB_PAGE_SIZE));
  hasil.halaman = Math.min(hasil.halaman, hasil.totalHalaman);

  const mulai = (hasil.halaman - 1) * WEB_PAGE_SIZE;
  hasil.baris = cocok.slice(mulai, mulai + WEB_PAGE_SIZE);
  return hasil;
}

/**
 * Each column's header, its role, and whether the form may write to it.
 *
 * A column listed in col_<sheet>_formula is shown but never written: its
 * value belongs to the spreadsheet's own formula, which the row inherited.
 */
function describeColumns_(sheetName, table, config) {
  const rumus = formulaColumnNames_(sheetName, config).map(function (name) {
    return name.toLowerCase();
  });
  const noColumn = normalizeText_(columnNameFor_(sheetName, 'no', config)).toLowerCase();

  const peran = {};
  ['tgl', 'invoice', 'kode', 'nama', 'jumlah', 'keterangan', 'price',
   'diskon', 'diskon2', 'diskon3', 'sales'].forEach(function (field) {
    const nama = normalizeText_(columnNameFor_(sheetName, field, config)).toLowerCase();
    if (nama !== '') peran[nama] = field;
  });

  const columns = [];
  for (let i = 0; i < table.width; i++) {
    const header = normalizeText_(table.headers[i]);
    if (header === '') continue;

    const key = header.toLowerCase();
    const isRumus = rumus.indexOf(key) !== -1;
    const isNo = key === noColumn;

    columns.push({
      indeks: i,
      header: header,
      peran: peran[key] || '',
      rumus: isRumus,
      // NO is maintained by renumbering, formula columns by the sheet.
      bisaDiubah: !isRumus && !isNo
    });
  }
  return columns;
}

/** Dates cross to the browser as ISO days; everything else as-is. */
function webCellValue_(value) {
  if (value instanceof Date) {
    const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
  }
  return value === null || value === undefined ? '' : value;
}

/* ------------------------------------------------------------------ *
 * Editing one row
 * ------------------------------------------------------------------ */

/**
 * Updates the editable cells of one transaction row.
 *
 * request: { kodeAkses, user, jenis, baris, nilai: { HEADER: value } }
 *
 * Refuses a row outside the real data — the blank formula rows and the
 * TOTAL footer are not editable records. Writes only the columns Config
 * allows, one contiguous run at a time, then lets the recap resync exactly
 * as an edit made in the sheet would.
 */
function updateSheetRow(request) {
  const payload = request || {};
  assertWebAppAccess_(payload.kodeAkses);

  const user = assertWebAppUser_(payload.user);
  setInputBy_(user);

  const config = getConfig();
  const jenis = normalizeText_(payload.jenis).toLowerCase();
  const sheetName = webAppSheetFor_(jenis, config);
  const table = getTableInfo_(sheetName);
  const bounds = getDataBounds_(table, config);
  const baris = Math.round(toNumber_(payload.baris));

  if (!(baris > table.headerRow) || baris > bounds.lastDataRow) {
    throw new Error(
      'Baris ' + baris + ' bukan baris data di "' + sheetName + '". ' +
      'Baris data ada di ' + table.firstDataRow + '–' + bounds.lastDataRow + '.'
    );
  }

  const columns = describeColumns_(sheetName, table, config);
  const before = table.sheet.getRange(baris, 1, 1, table.width).getValues()[0];
  const after = before.slice();

  const diubah = [];
  const nilai = payload.nilai || {};

  columns.forEach(function (column) {
    if (!column.bisaDiubah) return;
    if (!Object.prototype.hasOwnProperty.call(nilai, column.header)) return;

    const baru = webEditValue_(nilai[column.header], column, sheetName);
    if (sameCell_(before[column.indeks], baru)) return;

    after[column.indeks] = baru;
    diubah.push(column.header);
  });

  if (diubah.length === 0) {
    return { baris: baris, diubah: [], message: 'Tidak ada yang berubah.' };
  }

  // Only the changed cells are written, grouped into contiguous runs.
  // Writing the whole row would clear the formula columns it passes over,
  // which is the bug Fase 8D existed to fix.
  groupConsecutiveRuns_(columns.filter(function (column) {
    return diubah.indexOf(column.header) !== -1;
  }).map(function (column) { return column.indeks + 1; })).forEach(function (run) {
    const block = after.slice(run.start - 1, run.start - 1 + run.count);
    table.sheet.getRange(baris, run.start, 1, run.count).setValues([block]);
  });

  logAction_(AKSI_EDIT_FORM, sheetName, baris, { row: before }, { row: after });

  // The item code may have moved, so both the old and the new code need
  // recalculating — the same rule handleTransaksiEdit_ follows.
  resyncRekapForCodes_(sheetName, [before, after]);

  Logger.log('updateSheetRow(): "%s" baris %s, kolom %s, oleh %s.',
    sheetName, baris, diubah.join(', '), user);

  return {
    baris: baris,
    diubah: diubah,
    message: 'Baris ' + baris + ' diperbarui (' + diubah.join(', ') + ').'
  };
}

/** Coerces a submitted value to the type its column expects. */
function webEditValue_(value, column, sheetName) {
  const teks = normalizeText_(value);

  if (column.peran === 'tgl') {
    if (teks === '') return '';
    // Melempar sendiri kalau formatnya salah, dengan pesan yang menyebut
    // format yang benar — lebih berguna daripada pesan baru di sini.
    return parseDateInput_(teks, false);
  }

  if (column.peran === 'jumlah') {
    return webAppQuantity_(teks, column.header);
  }

  if (['price', 'diskon', 'diskon2', 'diskon3'].indexOf(column.peran) !== -1) {
    return webAppOptionalNumber_(teks, column.header);
  }

  if (column.peran === 'sales') {
    return teks === '' ? '' : assertWebAppSales_(teks, sheetName);
  }

  return teks;
}

/** Cell comparison that treats a Date and its ISO day as the same value. */
function sameCell_(lama, baru) {
  if (lama instanceof Date && baru instanceof Date) {
    return lama.getTime() === baru.getTime();
  }
  return normalizeText_(lama) === normalizeText_(baru);
}

/* ------------------------------------------------------------------ *
 * Deleting a row
 * ------------------------------------------------------------------ */

/** request: { kodeAkses, user, jenis, baris } */
function deleteSheetRow(request) {
  const payload = request || {};
  assertWebAppAccess_(payload.kodeAkses);

  const user = assertWebAppUser_(payload.user);
  setInputBy_(user);

  const config = getConfig();
  const sheetName = webAppSheetFor_(normalizeText_(payload.jenis).toLowerCase(), config);
  const hasil = deleteRowLogged(sheetName, Math.round(toNumber_(payload.baris)));

  if (!hasil.success) throw new Error(hasil.message);

  Logger.log('deleteSheetRow(): "%s" baris %s oleh %s.', sheetName, payload.baris, user);
  return hasil;
}

/* ------------------------------------------------------------------ *
 * The catalogue
 * ------------------------------------------------------------------ */

/**
 * REKAP BARANG as the catalogue page shows it: the stored values, read and
 * not recomputed, exactly as the dashboard reads them.
 */
function getRekapPage(request) {
  const payload = request || {};
  assertWebAppAccess_(payload.kodeAkses);

  const config = getConfig();
  const sheetName = normalizeText_(config.sheet_rekap_barang);
  const texts = statusTexts_();
  const items = readDashboardItems_(sheetName, config);

  const cari = normalizeText_(payload.cari).toLowerCase();
  const cocok = cari === '' ? items : items.filter(function (item) {
    return (item.kode + ' ' + item.nama).toLowerCase().indexOf(cari) !== -1;
  });

  // The editable fields live on the recap sheet but not in the dashboard's
  // view of it, so they are read here in one pass.
  const tambahan = readRekapEditableFields_(sheetName, config);

  return {
    sheet: sheetName,
    label: { aman: texts.aman, perluRestok: texts.perluRestok },
    totalBaris: cocok.length,
    barang: cocok.map(function (item) {
      const extra = tambahan[item.kode] || {};
      return {
        kode: item.kode,
        nama: item.nama,
        sisaStok: item.sisaStok,
        sisaDus: item.sisaDus,
        minStok: item.minStok,
        status: item.status,
        statusKey: item.statusKey,
        stokAwal: extra.stokAwal === undefined ? '' : extra.stokAwal,
        isiPack: extra.isiPack === undefined ? '' : extra.isiPack,
        isiDus: extra.isiDus === undefined ? '' : extra.isiDus
      };
    })
  };
}

/** STOK AWAL / ISI PER PACK / ISI PER DUS per item code, in one read. */
function readRekapEditableFields_(sheetName, config) {
  const hasil = {};
  try {
    getRekapItems().forEach(function (item) {
      hasil[item.kode] = {
        stokAwal: item.stokAwal,
        isiPack: item.isiPack,
        isiDus: item.isiDus
      };
    });
  } catch (err) {
    Logger.log('readRekapEditableFields_(): %s', err.message);
  }
  return hasil;
}

/**
 * Adds or updates a catalogue item. Wraps saveRekapItemLogged, so the
 * recap is recalculated and the change is undoable.
 *
 * request: { kodeAkses, user, mode, kode, nama, stokAwal, minStok, isiPack, isiDus }
 */
function saveRekapFromWeb(request) {
  const payload = request || {};
  assertWebAppAccess_(payload.kodeAkses);

  const user = assertWebAppUser_(payload.user);
  setInputBy_(user);

  const hasil = saveRekapItemLogged({
    mode: normalizeText_(payload.mode) === 'new' ? 'new' : 'edit',
    kode: payload.kode,
    nama: payload.nama,
    stokAwal: payload.stokAwal,
    minStok: payload.minStok,
    isiPack: payload.isiPack,
    isiDus: payload.isiDus
  });

  Logger.log('saveRekapFromWeb(): %s oleh %s.', hasil.kode, user);
  return hasil;
}

/**
 * Removes a catalogue item.
 *
 * Refuses while transactions still reference the code: deleting the item
 * would leave those rows pointing at nothing, and their quantities would
 * vanish from every total without any row being removed.
 */
function deleteRekapFromWeb(request) {
  const payload = request || {};
  assertWebAppAccess_(payload.kodeAkses);

  const user = assertWebAppUser_(payload.user);
  setInputBy_(user);

  const config = getConfig();
  const sheetName = normalizeText_(config.sheet_rekap_barang);
  const kode = normalizeText_(payload.kode);
  if (kode === '') throw new Error('Kode barang wajib diisi.');

  const dipakai = countTransactionsForCode_(kode, config);
  if (dipakai > 0) {
    throw new Error(
      'Barang "' + kode + '" masih dipakai di ' + dipakai + ' baris transaksi. ' +
      'Hapus atau ubah baris-baris itu dulu, supaya tidak ada transaksi yang ' +
      'menunjuk ke barang yang sudah tidak ada.'
    );
  }

  const found = findRekapRow_(kode);
  if (!found) throw new Error('Kode barang "' + kode + '" tidak ada di ' + sheetName + '.');

  const hasil = deleteRowLogged(sheetName, found.row);
  if (!hasil.success) throw new Error(hasil.message);

  Logger.log('deleteRekapFromWeb(): %s (baris %s) oleh %s.', kode, found.row, user);
  return { kode: kode, message: 'Barang "' + kode + '" dihapus dari ' + sheetName + '.' };
}

/** How many transaction rows across all three sheets name this code. */
function countTransactionsForCode_(kode, config) {
  const target = kode.toLowerCase();
  let total = 0;

  ['masuk', 'retur', 'keluar'].forEach(function (jenis) {
    const sheetName = normalizeText_(config['sheet_barang_' + jenis]);
    if (sheetName === '') return;
    if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName)) return;

    let table;
    try {
      table = getTableInfo_(sheetName);
    } catch (err) {
      return;
    }

    const bounds = getDataBounds_(table, config);
    if (bounds.dataRowCount < 1) return;

    let kodeIndex;
    try {
      kodeIndex = resolveColumnIndex_(
        table.headers, columnNameFor_(sheetName, 'kode', config), sheetName, table.headerRow);
    } catch (err) {
      return;
    }

    table.sheet.getRange(table.firstDataRow, kodeIndex, bounds.dataRowCount, 1)
      .getValues()
      .forEach(function (row) {
        if (normalizeText_(row[0]).toLowerCase() === target) total++;
      });
  });

  return total;
}
