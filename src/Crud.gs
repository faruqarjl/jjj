/**
 * Delete + recap sync. Like Transaksi.gs, everything here resolves sheets
 * and columns through Config and reuses the Fase 1 helpers
 * (getTableInfo_, normalizeMergedCells_, appendRow, applyBorders) rather
 * than growing a second copy of that logic.
 *
 * Recap arithmetic: SISA STOK = STOK AWAL + MASUK + RETUR - KELUAR.
 * RETUR adds stock — it is goods coming back into the warehouse from a
 * customer, not goods returned to a supplier.
 */

/**
 * Deletes one data row from `sheetName`, keeping the recap in sync.
 * Returns { success, message }. The item code is read BEFORE the delete,
 * since after it the row is gone and the recap could not be recalculated.
 */
function deleteRow(sheetName, rowIndex) {
  const table = getTableInfo_(sheetName);
  const lastRow = table.sheet.getLastRow();
  const row = Number(rowIndex);

  if (!isFinite(row) || row % 1 !== 0) {
    return { success: false, message: 'Nomor baris harus angka bulat, bukan ' + JSON.stringify(rowIndex) + '.' };
  }
  if (row <= table.headerRow) {
    return {
      success: false,
      message: 'Baris ' + row + ' adalah baris header/judul di sheet "' + sheetName +
        '" (header ada di baris ' + table.headerRow + '). Baris data mulai dari ' + table.firstDataRow + '.'
    };
  }
  if (row > lastRow) {
    return {
      success: false,
      message: 'Baris ' + row + ' di luar data sheet "' + sheetName + '" (baris terakhir: ' + lastRow + ').'
    };
  }

  const config = getConfig();
  const columns = transactionColumns_(sheetName, config);
  let kodeBarang = '';
  if (columns) {
    const kodeColumn = getColumnIndex(sheetName, columns.kode, table.headerRow);
    kodeBarang = normalizeText_(table.sheet.getRange(row, kodeColumn).getValue());
  }

  normalizeMergedCells_(table);
  table.sheet.deleteRow(row);
  Logger.log('deleteRow("%s", %s): deleted, kodeBarang=%s', sheetName, row, JSON.stringify(kodeBarang));

  // The header row can't shift — rows at or above it are refused above — so
  // the table geometry captured before the delete is still valid here.
  renumberNoColumn_(table);
  applyBorders(sheetName);

  let recapNote = '';
  if (kodeBarang !== '') {
    const updated = recalculateRekap(kodeBarang);
    recapNote = updated
      ? ' Rekap untuk "' + kodeBarang + '" sudah dihitung ulang.'
      : ' Kode "' + kodeBarang + '" belum ada di REKAP BARANG, rekap dilewati.';
  }

  return { success: true, message: 'Baris ' + row + ' di "' + sheetName + '" berhasil dihapus.' + recapNote };
}

/**
 * Recomputes MASUK, RETUR, KELUAR and SISA STOK for one item code in
 * REKAP BARANG from the three transaction sheets. Returns false (with a
 * logged warning, no throw) when the code has no recap row yet — that just
 * means the item hasn't been registered.
 */
function recalculateRekap(kodeBarang) {
  const kode = normalizeText_(kodeBarang);
  if (kode === '') return false;

  const found = findRekapRow_(kode);
  if (!found) {
    Logger.log('recalculateRekap("%s"): belum ada barisnya di REKAP BARANG — dilewati.', kode);
    return false;
  }

  const config = getConfig();
  const masuk = sumTransaksi_(config.sheet_barang_masuk, kode, config);
  const retur = sumTransaksi_(config.sheet_barang_retur, kode, config);
  const keluar = sumTransaksi_(config.sheet_barang_keluar, kode, config);

  const input = {
    stokAwal: readRekapValue_(found, config.col_rekap_stok_awal),
    masuk: masuk,
    retur: retur,
    keluar: keluar,
    isiDus: readRekapValue_(found, config.col_rekap_isi_dus),
    isiPack: readRekapValue_(found, config.col_rekap_isi_pack),
    minStok: readRekapValue_(found, config.col_rekap_min_stok)
  };
  const values = computeRekapValues_(input);
  logRekapWarnings_(kode, input, values);

  writeRekapValue_(found, config.col_rekap_masuk, masuk);
  writeRekapValue_(found, config.col_rekap_retur, retur);
  writeRekapValue_(found, config.col_rekap_keluar, keluar);
  writeRekapValue_(found, config.col_rekap_sisa_stok, values.sisaStok);
  writeRekapValue_(found, config.col_rekap_sisa_dus, values.sisaDusText);
  writeRekapValue_(found, config.col_rekap_status, values.status);
  applyStatusColor_(found.table.sheet.getName(), found.row, values.status);
  return true;
}

/**
 * The recap arithmetic for one item, with no sheet access at all.
 *
 * Both recalculateRekap() (which reads one item on demand) and
 * recalculateAllRekap() (which reads every sheet once up front) run their
 * numbers through here, so the two paths cannot drift apart — only how the
 * inputs are fetched differs.
 */
function computeRekapValues_(input) {
  const sisaStok = input.stokAwal + input.masuk + input.retur - input.keluar;
  const sisaDus = formatSisaDus_(sisaStok, input.isiDus, input.isiPack);
  const status = calculateStatus_(sisaStok, input.minStok);

  return {
    sisaStok: sisaStok,
    sisaDus: sisaDus,
    sisaDusText: sisaDus === null ? 'N/A' : sisaDus,
    status: status,
    warna: STATUS_WARNA[status] || null
  };
}

function logRekapWarnings_(kode, input, values) {
  if (values.sisaDus === null) {
    Logger.log(
      'recalculateRekap("%s"): ISI PER DUS (%s) atau ISI PER PACK (%s) kosong/nol — SISA DUS diisi "N/A".',
      kode, input.isiDus, input.isiPack
    );
  }
  if (values.status === STATUS_TIDAK_DIKETAHUI) {
    Logger.log(
      'recalculateRekap("%s"): MIN STOK (%s) kosong/nol — STATUS diisi "N/A".',
      kode, input.minStok
    );
  }
  Logger.log(
    'recalculateRekap("%s"): stokAwal=%s masuk=%s retur=%s keluar=%s -> sisa=%s, sisaDus=%s, status=%s',
    kode, input.stokAwal, input.masuk, input.retur, input.keluar,
    values.sisaStok, values.sisaDusText, values.status
  );
}

/**
 * Recalculates every item in REKAP BARANG — for a first-time setup or a
 * manual refresh.
 *
 * Sheet access is a fixed cost here, not one per item: each transaction
 * sheet is read once into a per-code totals map, REKAP is read once, every
 * row is computed in memory, and each derived column is written back in a
 * single setValues(). A 200-item catalogue costs the same number of API
 * calls as a 5-item one, which is what keeps this inside the 6-minute
 * execution limit.
 *
 * Derived columns are written individually rather than writing the whole
 * block back: re-writing untouched columns would replace any formula in
 * them with the static value getValues() returned.
 *
 * The arithmetic itself is computeRekapValues_() — the same function
 * recalculateRekap() uses — so batch and single-item results always agree.
 */
function recalculateAllRekap() {
  const config = getConfig();
  const sheetName = getConfigValue('sheet_rekap_barang');
  const table = getTableInfo_(sheetName);
  const rowCount = table.sheet.getLastRow() - table.headerRow;

  const summary = { total: 0, updated: 0, skipped: 0, failed: 0, failures: [] };
  if (rowCount < 1) return summary;

  Logger.log('recalculateAllRekap(): mulai, %s baris di "%s".', rowCount, sheetName);

  const totals = {
    masuk: buildTransaksiTotals_(config.sheet_barang_masuk, config),
    retur: buildTransaksiTotals_(config.sheet_barang_retur, config),
    keluar: buildTransaksiTotals_(config.sheet_barang_keluar, config)
  };

  // Resolved against the header row getTableInfo_ already read, so eleven
  // column lookups cost zero extra Sheets round trips.
  const at = function (columnHeaderName) {
    return resolveColumnIndex_(table.headers, columnHeaderName, sheetName, table.headerRow);
  };
  const column = {
    kode: at(config.col_rekap_kode),
    stokAwal: at(config.col_rekap_stok_awal),
    minStok: at(config.col_rekap_min_stok),
    isiDus: at(config.col_rekap_isi_dus),
    isiPack: at(config.col_rekap_isi_pack),
    masuk: at(config.col_rekap_masuk),
    retur: at(config.col_rekap_retur),
    keluar: at(config.col_rekap_keluar),
    sisaStok: at(config.col_rekap_sisa_stok),
    sisaDus: at(config.col_rekap_sisa_dus),
    status: at(config.col_rekap_status)
  };

  const rows = table.sheet.getRange(table.firstDataRow, 1, rowCount, table.width).getValues();
  const statusRange = table.sheet.getRange(table.firstDataRow, column.status, rowCount, 1);
  const warna = statusRange.getBackgrounds();

  // Seeded with each row's current value, so rows this run doesn't touch
  // (blank codes, failures) are written back unchanged instead of blanked.
  const out = {
    masuk: rows.map(function (row) { return [row[column.masuk - 1]]; }),
    retur: rows.map(function (row) { return [row[column.retur - 1]]; }),
    keluar: rows.map(function (row) { return [row[column.keluar - 1]]; }),
    sisaStok: rows.map(function (row) { return [row[column.sisaStok - 1]]; }),
    sisaDus: rows.map(function (row) { return [row[column.sisaDus - 1]]; }),
    status: rows.map(function (row) { return [row[column.status - 1]]; })
  };

  rows.forEach(function (row, i) {
    const kode = normalizeText_(row[column.kode - 1]);
    if (kode === '') return;

    summary.total++;
    try {
      const key = kode.toLowerCase();
      const input = {
        stokAwal: toNumber_(row[column.stokAwal - 1]),
        masuk: totals.masuk[key] || 0,
        retur: totals.retur[key] || 0,
        keluar: totals.keluar[key] || 0,
        isiDus: toNumber_(row[column.isiDus - 1]),
        isiPack: toNumber_(row[column.isiPack - 1]),
        minStok: toNumber_(row[column.minStok - 1])
      };
      const values = computeRekapValues_(input);

      out.masuk[i] = [input.masuk];
      out.retur[i] = [input.retur];
      out.keluar[i] = [input.keluar];
      out.sisaStok[i] = [values.sisaStok];
      out.sisaDus[i] = [values.sisaDusText];
      out.status[i] = [values.status];
      warna[i] = [values.warna];
      summary.updated++;
    } catch (err) {
      summary.failed++;
      summary.failures.push(kode + ': ' + err.message);
      Logger.log('recalculateAllRekap(): gagal untuk "%s" — %s', kode, err.message);
    }

    if (summary.total % 50 === 0) {
      Logger.log('recalculateAllRekap(): memproses %s dari %s barang…', summary.total, rowCount);
    }
  });

  writeRekapColumn_(table, column.masuk, out.masuk);
  writeRekapColumn_(table, column.retur, out.retur);
  writeRekapColumn_(table, column.keluar, out.keluar);
  writeRekapColumn_(table, column.sisaStok, out.sisaStok);
  writeRekapColumn_(table, column.sisaDus, out.sisaDus);
  writeRekapColumn_(table, column.status, out.status);
  statusRange.setBackgrounds(warna);

  Logger.log(
    'recalculateAllRekap(): selesai — %s diperbarui, %s dilewati, %s gagal.',
    summary.updated, summary.skipped, summary.failed
  );
  return summary;
}

function writeRekapColumn_(table, column, columnValues) {
  table.sheet.getRange(table.firstDataRow, column, columnValues.length, 1).setValues(columnValues);
}

/**
 * Totals JUMLAH per item code across one whole transaction sheet in a
 * single read, keyed the same way sumTransaksi_() matches (normalized,
 * lower-cased) so both produce identical totals.
 */
function buildTransaksiTotals_(sheetName, config) {
  const columns = transactionColumns_(sheetName, config);
  if (!columns) return {};

  const table = getTableInfo_(sheetName);
  const rowCount = table.sheet.getLastRow() - table.headerRow;
  if (rowCount < 1) return {};

  const kodeIndex = resolveColumnIndex_(table.headers, columns.kode, sheetName, table.headerRow) - 1;
  const jumlahIndex = resolveColumnIndex_(table.headers, columns.jumlah, sheetName, table.headerRow) - 1;
  const values = table.sheet.getRange(table.firstDataRow, 1, rowCount, table.width).getValues();

  const totals = {};
  values.forEach(function (row) {
    const key = normalizeText_(row[kodeIndex]).toLowerCase();
    if (key === '') return;
    totals[key] = (totals[key] || 0) + toNumber_(row[jumlahIndex]);
  });

  Logger.log(
    'buildTransaksiTotals_("%s"): %s baris -> %s kode unik.',
    sheetName, rowCount, Object.keys(totals).length
  );
  return totals;
}

/**
 * Breaks a quantity into the original "{dus} DUS {pack}PACK" text, e.g.
 * 8800 with 5000/dus and 100/pack -> "1 DUS 38PACK". Returns null when
 * either divisor is missing or zero, so the caller can write "N/A" rather
 * than dividing by zero.
 *
 * The remainder is computed as sisaStok - totalDus * isiDus rather than
 * with %, so a negative stock still decomposes coherently (-5 with 12/dus
 * is "-1 DUS 0PACK", i.e. -12 + 7) instead of yielding a negative pack
 * count the way JavaScript's remainder operator would.
 */
function formatSisaDus_(sisaStok, isiDus, isiPack) {
  if (!(isiDus > 0) || !(isiPack > 0)) return null;

  const totalDus = Math.floor(sisaStok / isiDus);
  const sisaSetelahDus = sisaStok - totalDus * isiDus;
  const totalPack = Math.floor(sisaSetelahDus / isiPack);
  return totalDus + ' DUS ' + totalPack + 'PACK';
}

/** Locates an item code's row in REKAP BARANG, or null. */
function findRekapRow_(kodeBarang) {
  const config = getConfig();
  const sheetName = getConfigValue('sheet_rekap_barang');
  const table = getTableInfo_(sheetName);
  const rowCount = table.sheet.getLastRow() - table.headerRow;
  if (rowCount < 1) return null;

  const kodeColumn = getColumnIndex(sheetName, config.col_rekap_kode, table.headerRow);
  const values = table.sheet.getRange(table.firstDataRow, kodeColumn, rowCount, 1).getValues();
  const wanted = normalizeText_(kodeBarang).toLowerCase();

  for (let i = 0; i < values.length; i++) {
    if (normalizeText_(values[i][0]).toLowerCase() === wanted) {
      return { table: table, row: table.firstDataRow + i };
    }
  }
  return null;
}

function writeRekapValue_(found, columnHeaderName, value) {
  const column = getColumnIndex(found.table.sheet.getName(), columnHeaderName, found.table.headerRow);
  found.table.sheet.getRange(found.row, column).setValue(value);
}

function readRekapValue_(found, columnHeaderName) {
  const column = getColumnIndex(found.table.sheet.getName(), columnHeaderName, found.table.headerRow);
  return toNumber_(found.table.sheet.getRange(found.row, column).getValue());
}

/** Total JUMLAH for one item code on a transaction sheet. */
function sumTransaksi_(sheetName, kodeBarang, config) {
  const columns = transactionColumns_(sheetName, config);
  if (!columns) return 0;

  const table = getTableInfo_(sheetName);
  const rowCount = table.sheet.getLastRow() - table.headerRow;
  if (rowCount < 1) return 0;

  const kodeIndex = getColumnIndex(sheetName, columns.kode, table.headerRow) - 1;
  const jumlahIndex = getColumnIndex(sheetName, columns.jumlah, table.headerRow) - 1;
  const values = table.sheet.getRange(table.firstDataRow, 1, rowCount, table.width).getValues();
  const wanted = normalizeText_(kodeBarang).toLowerCase();

  let total = 0;
  values.forEach(function (row) {
    if (normalizeText_(row[kodeIndex]).toLowerCase() === wanted) {
      total += toNumber_(row[jumlahIndex]);
    }
  });
  return total;
}

/**
 * The code and quantity column names for a transaction sheet, or null when
 * sheetName isn't one. BARANG RETUR reuses the BARANG MASUK column names.
 */
function transactionColumns_(sheetName, config) {
  const key = resolveSheetKeyPrefix_(sheetName, config);
  if (key !== 'masuk' && key !== 'retur' && key !== 'keluar') return null;

  const prefix = key === 'keluar' ? 'keluar' : 'masuk';
  return { kode: config['col_' + prefix + '_kode'], jumlah: config['col_' + prefix + '_jumlah'] };
}

function toNumber_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  if (value === '' || value === null || value === undefined) return 0;
  const parsed = Number(String(value).trim());
  return isFinite(parsed) ? parsed : 0;
}

/**
 * Edit-driven recap sync, called from onEdit() in Main.gs. Only reacts to
 * edits in a transaction sheet's item-code or quantity column, below the
 * header row.
 *
 * When the code column itself changed, the OLD code is recalculated too —
 * moving a row from code A to code B changes both totals, and recomputing
 * only B would leave A stale.
 */
function handleTransaksiEdit_(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  const config = getConfig();
  const columns = transactionColumns_(sheetName, config);
  if (!columns) return;

  const table = getTableInfo_(sheetName);
  const editedRow = e.range.getRow();
  if (editedRow <= table.headerRow) return;

  const kodeColumn = getColumnIndex(sheetName, columns.kode, table.headerRow);
  const jumlahColumn = getColumnIndex(sheetName, columns.jumlah, table.headerRow);

  const firstColumn = e.range.getColumn();
  const lastColumn = firstColumn + e.range.getNumColumns() - 1;
  const touchedKode = kodeColumn >= firstColumn && kodeColumn <= lastColumn;
  const touchedJumlah = jumlahColumn >= firstColumn && jumlahColumn <= lastColumn;
  if (!touchedKode && !touchedJumlah) return;

  const lastRow = editedRow + e.range.getNumRows() - 1;
  const codes = {};

  for (let row = editedRow; row <= lastRow && row <= sheet.getLastRow(); row++) {
    const kode = normalizeText_(sheet.getRange(row, kodeColumn).getValue());
    if (kode !== '') codes[kode] = true;
  }
  if (touchedKode && e.oldValue !== undefined) {
    const previous = normalizeText_(e.oldValue);
    if (previous !== '') codes[previous] = true;
  }

  Object.keys(codes).forEach(function (kode) {
    recalculateRekap(kode);
  });
}

/** Menu handler: opens the REKAP BARANG editor in a sidebar. */
function showRekapForm() {
  const html = HtmlService.createHtmlOutputFromFile('RekapForm').setTitle('Edit Rekap Barang');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** Server call for the sidebar: every item currently in REKAP BARANG. */
function getRekapItems() {
  const config = getConfig();
  const sheetName = getConfigValue('sheet_rekap_barang');
  const table = getTableInfo_(sheetName);
  const rowCount = table.sheet.getLastRow() - table.headerRow;
  if (rowCount < 1) return [];

  const values = table.sheet.getRange(table.firstDataRow, 1, rowCount, table.width).getValues();
  const index = {
    kode: getColumnIndex(sheetName, config.col_rekap_kode, table.headerRow) - 1,
    nama: getColumnIndex(sheetName, config.col_rekap_nama, table.headerRow) - 1,
    isiPack: getColumnIndex(sheetName, config.col_rekap_isi_pack, table.headerRow) - 1,
    isiDus: getColumnIndex(sheetName, config.col_rekap_isi_dus, table.headerRow) - 1,
    minStok: getColumnIndex(sheetName, config.col_rekap_min_stok, table.headerRow) - 1,
    stokAwal: getColumnIndex(sheetName, config.col_rekap_stok_awal, table.headerRow) - 1
  };

  return values
    .filter(function (row) {
      return normalizeText_(row[index.kode]) !== '';
    })
    .map(function (row) {
      return {
        kode: normalizeText_(row[index.kode]),
        nama: normalizeText_(row[index.nama]),
        isiPack: toNumber_(row[index.isiPack]),
        isiDus: toNumber_(row[index.isiDus]),
        minStok: toNumber_(row[index.minStok]),
        stokAwal: toNumber_(row[index.stokAwal])
      };
    });
}

/**
 * Server call for the sidebar: adds a new REKAP BARANG item or updates an
 * existing one. Throws on validation failure so the sidebar's failure
 * handler can show the reason.
 */
function saveRekapItem(payload) {
  const config = getConfig();
  const sheetName = getConfigValue('sheet_rekap_barang');
  const kode = normalizeText_(payload && payload.kode);
  const nama = normalizeText_(payload && payload.nama);

  if (kode === '') throw new Error('Kode Barang wajib diisi.');
  if (nama === '') throw new Error('Nama Barang wajib diisi.');

  const existing = findRekapRow_(kode);
  const isNew = payload.mode === 'new';

  if (isNew && existing) {
    throw new Error('Kode Barang "' + kode + '" sudah ada di REKAP BARANG. Pakai mode Edit.');
  }
  if (!isNew && !existing) {
    throw new Error('Kode Barang "' + kode + '" tidak ditemukan di REKAP BARANG.');
  }

  const fields = {};
  fields[config.col_rekap_nama] = nama;
  fields[config.col_rekap_isi_pack] = toNumber_(payload.isiPack);
  fields[config.col_rekap_isi_dus] = toNumber_(payload.isiDus);
  fields[config.col_rekap_min_stok] = toNumber_(payload.minStok);
  fields[config.col_rekap_stok_awal] = toNumber_(payload.stokAwal);

  let targetRow;
  if (isNew) {
    fields[config.col_rekap_kode] = kode;
    targetRow = appendRow(sheetName, fields);

    const table = getTableInfo_(sheetName);
    const noIndex = findNoColumnIndex_(table.headers);
    if (noIndex !== -1) {
      table.sheet.getRange(targetRow, noIndex + 1).setValue(targetRow - table.headerRow);
    }
  } else {
    targetRow = existing.row;
    Object.keys(fields).forEach(function (columnHeaderName) {
      writeRekapValue_(existing, columnHeaderName, fields[columnHeaderName]);
    });
    applyBorders(sheetName);
  }

  recalculateRekap(kode);
  Logger.log('saveRekapItem(): mode=%s kode=%s row=%s', payload.mode, kode, targetRow);

  return {
    kode: kode,
    row: targetRow,
    message: (isNew ? 'Barang baru "' : 'Barang "') + kode + '" tersimpan di baris ' + targetRow + '.'
  };
}
