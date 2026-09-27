/**
 * PDF and Excel export.
 *
 * Every export copies the chosen sheet into a throwaway spreadsheet and
 * works there, never on the live one. Two reasons:
 *
 * - Filtering by date, adding a title block and setting print options all
 *   mean changing a sheet. Doing that in place would modify shared data,
 *   and on a file several people have open they would watch rows disappear
 *   mid-export.
 * - The format=xlsx export URL ignores gid and always returns the whole
 *   spreadsheet, so a single-sheet .xlsx is only possible from a temporary
 *   spreadsheet that contains nothing else.
 *
 * The copy is made with copyTo(), which carries values, borders and
 * backgrounds across, so STATUS colours survive into the exported file and
 * the borders stay consistent with applyBorders() without restyling
 * anything.
 *
 * No advanced service is needed — DriveApp and UrlFetchApp are built in —
 * but the manifest's oauthScopes must include drive and
 * script.external_request.
 */

const EXPORT_FOLDER_NAME = 'Export';
const EXPORT_LANDSCAPE_MIN_COLUMNS = 9; // more than 8 columns -> landscape

/**
 * Exports one sheet to PDF. `options` may carry { dateRangeStart,
 * dateRangeEnd } to keep only rows inside that range; leaving them out
 * exports everything. Returns { url, name, rowCount, orientation }.
 */
function exportToPDF(sheetName, options) {
  const settings = options || {};
  const prepared = buildExportSpreadsheet_(sheetName, settings);

  try {
    const landscape = prepared.columnCount >= EXPORT_LANDSCAPE_MIN_COLUMNS;
    const params = [
      'format=pdf',
      'gid=' + prepared.sheet.getSheetId(),
      'portrait=' + (landscape ? 'false' : 'true'),
      'fitw=true',            // shrink to page width so nothing is cut off
      'size=A4',
      'gridlines=false',      // the copied borders already draw the table
      'printtitle=false',
      'sheetnames=false',
      'pagenum=CENTER',
      'top_margin=0.50', 'bottom_margin=0.50',
      'left_margin=0.50', 'right_margin=0.50'
    ].join('&');

    const name = buildExportFileName_(sheetName, 'pdf', prepared.timestamp);
    const file = saveExportBlob_(prepared.spreadsheetId, params, name);

    Logger.log(
      'exportToPDF("%s"): %s baris, %s kolom, %s -> %s',
      sheetName, prepared.rowCount, prepared.columnCount,
      landscape ? 'landscape' : 'portrait', name
    );

    return {
      url: file.getUrl(),
      name: name,
      rowCount: prepared.rowCount,
      orientation: landscape ? 'landscape' : 'portrait',
      message: 'PDF "' + name + '" selesai (' + prepared.rowCount + ' baris data).'
    };
  } finally {
    discardTempSpreadsheet_(prepared.spreadsheetId);
  }
}

/** Exports one sheet to .xlsx. Returns { url, name, rowCount }. */
function exportToExcel(sheetName, options) {
  const settings = options || {};
  const prepared = buildExportSpreadsheet_(sheetName, settings);

  try {
    const name = buildExportFileName_(sheetName, 'xlsx', prepared.timestamp);
    const file = saveExportBlob_(prepared.spreadsheetId, 'format=xlsx', name);

    Logger.log('exportToExcel("%s"): %s baris -> %s', sheetName, prepared.rowCount, name);
    return {
      url: file.getUrl(),
      name: name,
      rowCount: prepared.rowCount,
      message: 'Excel "' + name + '" selesai (' + prepared.rowCount + ' baris data).'
    };
  } finally {
    discardTempSpreadsheet_(prepared.spreadsheetId);
  }
}

/**
 * Copies `sheetName` into a fresh spreadsheet, drops rows outside the date
 * range, adds a title block and auto-fits the columns. The source sheet is
 * only read.
 */
function buildExportSpreadsheet_(sheetName, settings) {
  // Diperiksa SEBELUM membuat spreadsheet sementara. Kalau dibalik, sheet
  // kosong meninggalkan file yatim di Drive setiap kali orang salah klik.
  assertExportable_(sheetName);

  const timestamp = new Date();
  const temp = SpreadsheetApp.create(
    'TEMP Export ' + sheetName + ' ' + formatExportStamp_(timestamp)
  );

  const prepared = prepareExportSheet_(temp, sheetName, settings, timestamp);
  removeStrayTempSheets_(temp, [prepared.sheet]);
  SpreadsheetApp.flush();

  return {
    spreadsheetId: temp.getId(),
    sheet: prepared.sheet,
    rowCount: prepared.rowCount,
    columnCount: prepared.columnCount,
    timestamp: timestamp
  };
}

/**
 * Copies one source sheet into an already-created temp spreadsheet, drops the
 * rows the filters exclude, adds a title block and auto-fits the columns.
 *
 * Split out of buildExportSpreadsheet_ so the combined export can put several
 * of these into a single file — the filtering and the "never touch the source
 * sheet" guarantee are then shared rather than written twice.
 */
function prepareExportSheet_(temp, sheetName, settings, timestamp) {
  const table = getTableInfo_(sheetName);
  const config = getConfig();
  const bounds = getDataBounds_(table, config);
  const sourceLastRow = table.sheet.getLastRow();
  const dataRowCount = bounds.dataRowCount;
  assertExportable_(sheetName);

  const start = parseDateInput_(settings.dateRangeStart, false);
  const end = parseDateInput_(settings.dateRangeEnd, true);
  const cari = normalizeText_(settings.cari).toLowerCase();
  let keptRowCount = dataRowCount;
  let removals = [];

  // Everything past the last real data row goes: the blank formula rows and
  // the TOTAL footer are not records, and exporting 400 empty lines under
  // the table made the PDF look broken.
  for (let row = bounds.lastDataRow + 1; row <= sourceLastRow; row++) {
    removals.push(row);
  }

  if (start !== null || end !== null || cari !== '') {
    const rows = table.sheet.getRange(table.firstDataRow, 1, dataRowCount, table.width).getValues();
    let keep = rows.map(function () { return true; });

    if (start !== null || end !== null) {
      const dateColumnName = resolveDateColumnName_(sheetName);
      if (dateColumnName === null) {
        throw new Error(
          'Sheet "' + sheetName + '" tidak punya kolom tanggal, jadi filter tanggal tidak bisa dipakai. ' +
          'Kosongkan filter tanggal untuk meng-export semuanya.'
        );
      }
      const dateIndex = resolveColumnIndex_(
        table.headers, dateColumnName, sheetName, table.headerRow) - 1;
      const byDate = filterRowsByDate_(rows, dateIndex, start, end);
      keep = keep.map(function (ok, i) { return ok && byDate[i]; });
    }

    // Same match the Data page's search box uses, so what is exported is
    // what was on screen when the button was pressed.
    if (cari !== '') {
      keep = keep.map(function (ok, i) {
        return ok && rows[i].some(function (cell) {
          return String(webCellValue_(cell)).toLowerCase().indexOf(cari) !== -1;
        });
      });
    }

    keptRowCount = keep.filter(Boolean).length;
    if (keptRowCount === 0) {
      // Sebutkan filter mana yang menyaring, supaya jelas apa yang harus
      // diubah — "filter" saja tidak memberi tahu apa-apa.
      const sebab = [];
      if (start !== null || end !== null) sebab.push('rentang tanggal itu');
      if (cari !== '') sebab.push('pencarian "' + normalizeText_(settings.cari) + '"');
      throw new Error(
        'Tidak ada baris di "' + sheetName + '" yang cocok dengan ' + sebab.join(' dan ') + '.'
      );
    }
    // Row numbers in the copy match the source until anything is deleted.
    keep.forEach(function (isKept, i) {
      if (!isKept) removals.push(table.firstDataRow + i);
    });
  }

  const copied = table.sheet.copyTo(temp);
  copied.setName(sheetName);

  // Bottom-up and grouped into runs, so 400 rows don't cost 400 calls.
  groupConsecutiveRuns_(removals).reverse().forEach(function (run) {
    copied.deleteRows(run.start, run.count);
  });

  insertExportTitle_(copied, sheetName, timestamp, start, end, cari);
  copied.autoResizeColumns(1, table.width);

  return { sheet: copied, rowCount: keptRowCount, columnCount: table.width };
}

/** How many real data rows a sheet has, ignoring blank formula rows. */
function exportRowCount_(sheetName) {
  const table = getTableInfo_(sheetName);
  return getDataBounds_(table, getConfig()).dataRowCount;
}

/** Throws the standard "nothing to export" error for an empty sheet. */
function assertExportable_(sheetName) {
  if (exportRowCount_(sheetName) < 1) {
    throw new Error('Sheet "' + sheetName + '" tidak ada data untuk di-export.');
  }
}

/**
 * SpreadsheetApp.create() leaves a default empty sheet behind, which the xlsx
 * export would otherwise carry as a stray tab.
 */
function removeStrayTempSheets_(temp, keepSheets) {
  const keepIds = keepSheets.map(function (sheet) { return sheet.getSheetId(); });
  temp.getSheets().forEach(function (sheet) {
    if (keepIds.indexOf(sheet.getSheetId()) === -1) temp.deleteSheet(sheet);
  });
}

/** Puts the sheet name, export time and any date range above the table. */
function insertExportTitle_(sheet, sheetName, timestamp, start, end, cari) {
  sheet.insertRowsBefore(1, 3);

  const subtitle = 'Diexport: ' + formatExportDisplay_(timestamp) +
    (start !== null || end !== null
      ? '   |   Rentang: ' + (start === null ? 'awal' : formatExportDisplay_(start)) +
        ' s/d ' + (end === null ? 'akhir' : formatExportDisplay_(end))
      : '') +
    (normalizeText_(cari) === '' ? '' : '   |   Filter: "' + cari + '"');

  sheet.getRange(1, 1).setValue(sheetName).setFontSize(14).setFontWeight('bold');
  sheet.getRange(2, 1).setValue(subtitle).setFontSize(9);
}

/** Which rows fall inside [start, end]; either bound may be null. */
function filterRowsByDate_(rows, dateIndex, start, end) {
  const from = start === null ? null : start.getTime();
  const to = end === null ? null : end.getTime();

  return rows.map(function (row) {
    const time = toTimeValue_(row[dateIndex]);
    if (time === null) return false;     // no readable date, so out of range
    if (from !== null && time < from) return false;
    if (to !== null && time > to) return false;
    return true;
  });
}

/** Turns [5,6,7,10] into [{start:5,count:3},{start:10,count:1}]. */
function groupConsecutiveRuns_(rowNumbers) {
  const runs = [];
  rowNumbers.slice().sort(function (a, b) { return a - b; }).forEach(function (row) {
    const last = runs[runs.length - 1];
    if (last && row === last.start + last.count) {
      last.count++;
    } else {
      runs.push({ start: row, count: 1 });
    }
  });
  return runs;
}

/** The sheet's date column name from Config, or null when it has none. */
function resolveDateColumnName_(sheetName) {
  const config = getConfig();
  const prefix = resolveSheetKeyPrefix_(sheetName, config);
  if (prefix !== 'masuk' && prefix !== 'retur' && prefix !== 'keluar') {
    return null; // REKAP BARANG has no date column
  }
  return columnNameFor_(sheetName, 'tgl', config);
}

/**
 * Parses a YYYY-MM-DD string from the dialog. Built field by field rather
 * than with new Date(text), which reads a bare date as UTC midnight and
 * would shift the boundary a day in Asia/Jakarta.
 */
function parseDateInput_(text, endOfDay) {
  const value = normalizeText_(text);
  if (value === '') return null;

  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) {
    throw new Error('Tanggal "' + text + '" tidak valid. Pakai format YYYY-MM-DD.');
  }

  const year = Number(parts[1]);
  const month = Number(parts[2]) - 1;
  const day = Number(parts[3]);
  return endOfDay
    ? new Date(year, month, day, 23, 59, 59, 999)
    : new Date(year, month, day, 0, 0, 0, 0);
}

/* ------------------------------------------------------------------ *
 * Drive plumbing
 * ------------------------------------------------------------------ */

function saveExportBlob_(spreadsheetId, params, fileName) {
  const url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?' + params;
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(
      'Gagal membuat file export (HTTP ' + response.getResponseCode() + '). Coba lagi sebentar.'
    );
  }

  const blob = response.getBlob().setName(fileName);
  return getOrCreateExportFolder_().createFile(blob);
}

/** The "Export" folder beside the spreadsheet, created on first use. */
function getOrCreateExportFolder_() {
  const parents = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

  const existing = parent.getFoldersByName(EXPORT_FOLDER_NAME);
  if (existing.hasNext()) return existing.next();

  Logger.log('getOrCreateExportFolder_(): folder "%s" dibuat.', EXPORT_FOLDER_NAME);
  return parent.createFolder(EXPORT_FOLDER_NAME);
}

function discardTempSpreadsheet_(spreadsheetId) {
  try {
    DriveApp.getFileById(spreadsheetId).setTrashed(true);
  } catch (err) {
    Logger.log('discardTempSpreadsheet_(): gagal menghapus temp %s — %s', spreadsheetId, err.message);
  }
}

/** "[NamaSheet]_[YYYYMMDD_HHmmss]_Export.ext" — seconds keep repeats unique. */
function buildExportFileName_(sheetName, extension, when) {
  return normalizeText_(sheetName).replace(/[\\/:*?"<>|]/g, '-') +
    '_' + formatExportStamp_(when) + '_Export.' + extension;
}

function formatExportStamp_(when) {
  return Utilities.formatDate(when, exportTimeZone_(), 'yyyyMMdd_HHmmss');
}

function formatExportDisplay_(when) {
  return Utilities.formatDate(when, exportTimeZone_(), 'dd/MM/yyyy HH:mm');
}

function exportTimeZone_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Asia/Jakarta';
}

/* ------------------------------------------------------------------ *
 * Export dialog
 * ------------------------------------------------------------------ */

function showExportDialog() {
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutputFromFile('ExportDialog').setWidth(420).setHeight(470),
    'Export Data'
  );
}

/** Server call for the dialog: exportable sheets and whether each can be date-filtered. */
function getExportDialogData() {
  const config = getConfig();
  const names = [
    config.sheet_barang_masuk, config.sheet_barang_retur,
    config.sheet_barang_keluar, config.sheet_rekap_barang
  ];

  const sheets = [];
  names.forEach(function (raw) {
    const name = normalizeText_(raw);
    if (name === '') return;
    sheets.push({ name: name, hasDateColumn: resolveDateColumnName_(name) !== null });
  });

  const active = SpreadsheetApp.getActiveSheet().getName();
  const match = sheets.filter(function (sheet) { return sheet.name === active; })[0];
  return { sheets: sheets, activeSheet: match ? active : (sheets[0] || {}).name };
}

/** Server call for the dialog's Export button. */
function runExport(payload) {
  const request = payload || {};
  const sheetName = normalizeText_(request.sheetName);
  if (sheetName === '') throw new Error('Pilih sheet dulu.');

  const options = {
    dateRangeStart: request.dateRangeStart,
    dateRangeEnd: request.dateRangeEnd
  };

  const start = parseDateInput_(options.dateRangeStart, false);
  const end = parseDateInput_(options.dateRangeEnd, true);
  if (start !== null && end !== null && start.getTime() > end.getTime()) {
    throw new Error('Tanggal "dari" lebih akhir daripada tanggal "sampai".');
  }

  return normalizeText_(request.format).toLowerCase() === 'xlsx'
    ? exportToExcel(sheetName, options)
    : exportToPDF(sheetName, options);
}

/* ------------------------------------------------------------------ *
 * Combined export — everything in ONE file (Fase 8F)
 *
 * Reuses prepareExportSheet_ for each source, so the row filtering and the
 * "source sheets are never touched" guarantee are exactly the same ones the
 * single-sheet export already passes its tests on.
 * ------------------------------------------------------------------ */

const EXPORT_RINGKASAN_SHEET = 'RINGKASAN DASHBOARD';

/** One PDF holding every source as its own section. */
function exportAllToPDF(options) {
  const prepared = buildCombinedExportSpreadsheet_(options || {});

  try {
    // No gid= this time: Google then renders the whole spreadsheet, each
    // sheet starting on a fresh page, which is the "section terpisah" the
    // brief asks for without stitching PDFs together by hand.
    const params = [
      'format=pdf',
      'portrait=false',          // combined sheets are wide; landscape fits more
      'fitw=true', 'size=A4',
      'gridlines=false', 'printtitle=false',
      'sheetnames=true',         // prints each sheet's name as its section title
      'pagenum=CENTER',
      'top_margin=0.50', 'bottom_margin=0.50',
      'left_margin=0.50', 'right_margin=0.50'
    ].join('&');

    const name = buildExportFileName_('SEMUA DATA', 'pdf', prepared.timestamp);
    const file = saveExportBlob_(prepared.spreadsheetId, params, name);

    Logger.log('exportAllToPDF(): %s bagian, %s baris -> %s',
      prepared.sections.length, prepared.rowCount, name);
    return combinedResult_(file, name, prepared, 'PDF');
  } finally {
    discardTempSpreadsheet_(prepared.spreadsheetId);
  }
}

/** One .xlsx holding every source as its own tab. */
function exportAllToExcel(options) {
  const prepared = buildCombinedExportSpreadsheet_(options || {});

  try {
    const name = buildExportFileName_('SEMUA DATA', 'xlsx', prepared.timestamp);
    const file = saveExportBlob_(prepared.spreadsheetId, 'format=xlsx', name);

    Logger.log('exportAllToExcel(): %s sheet, %s baris -> %s',
      prepared.sections.length, prepared.rowCount, name);
    return combinedResult_(file, name, prepared, 'Excel');
  } finally {
    discardTempSpreadsheet_(prepared.spreadsheetId);
  }
}

function combinedResult_(file, name, prepared, label) {
  const dilewati = prepared.skipped.length
    ? ' Dilewati (kosong): ' + prepared.skipped.join(', ') + '.'
    : '';
  return {
    url: file.getUrl(),
    name: name,
    rowCount: prepared.rowCount,
    sections: prepared.sections,
    skipped: prepared.skipped,
    message: label + ' "' + name + '" selesai: ' + prepared.sections.length +
      ' bagian, ' + prepared.rowCount + ' baris total.' + dilewati
  };
}

/**
 * One temp spreadsheet holding every exportable source.
 *
 * A source with no rows is skipped and reported rather than throwing: an
 * empty BARANG RETUR should not stop the other four from being exported.
 * Only when nothing at all has data does this fail.
 */
function buildCombinedExportSpreadsheet_(settings) {
  const config = getConfig();
  const timestamp = new Date();

  const sumber = ['masuk', 'retur', 'keluar']
    .map(function (jenis) { return normalizeText_(config['sheet_barang_' + jenis]); })
    .concat([normalizeText_(config.sheet_rekap_barang)])
    .filter(function (nama) { return nama !== ''; });

  const temp = SpreadsheetApp.create('TEMP Export SEMUA ' + formatExportStamp_(timestamp));
  const dibuat = [];
  const sections = [];
  const skipped = [];
  let rowCount = 0;

  try {
    sumber.forEach(function (sheetName) {
      if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName)) {
        skipped.push(sheetName);
        return;
      }
      let jumlah;
      try {
        jumlah = exportRowCount_(sheetName);
      } catch (err) {
        Logger.log('buildCombinedExportSpreadsheet_(): "%s" tidak terbaca — %s', sheetName, err.message);
        skipped.push(sheetName);
        return;
      }
      if (jumlah < 1) { skipped.push(sheetName); return; }

      // Deliberately no `cari` here: "Export Semua" means everything, and
      // silently carrying the Data page's search box into the other four
      // sheets would produce a file nobody asked for.
      const prepared = prepareExportSheet_(temp, sheetName, {
        dateRangeStart: settings.dateRangeStart,
        dateRangeEnd: settings.dateRangeEnd
      }, timestamp);

      dibuat.push(prepared.sheet);
      sections.push({ nama: sheetName, baris: prepared.rowCount });
      rowCount += prepared.rowCount;
    });

    // Ringkasan tidak punya "baris data" — isinya angka olahan, bukan
    // catatan. Dilaporkan tanpa jumlah baris supaya rowCount tetap berarti
    // "berapa baris data yang ikut", bukan campuran dua hal berbeda.
    const ringkasan = buildRingkasanSheet_(temp, timestamp);
    if (ringkasan) {
      dibuat.push(ringkasan.sheet);
      sections.push({ nama: EXPORT_RINGKASAN_SHEET, baris: null, ringkasan: true });
    }

    if (dibuat.length === 0) {
      throw new Error('Tidak ada sheet yang berisi data untuk di-export.');
    }

    removeStrayTempSheets_(temp, dibuat);
    SpreadsheetApp.flush();
  } catch (err) {
    // Jangan tinggalkan file yatim di Drive kalau gagal di tengah jalan.
    discardTempSpreadsheet_(temp.getId());
    throw err;
  }

  return {
    spreadsheetId: temp.getId(),
    timestamp: timestamp,
    sections: sections,
    skipped: skipped,
    rowCount: rowCount
  };
}

/**
 * The dashboard's numbers as a flat sheet, built from getDashboardData() —
 * the same function the dashboard page renders from, so the export cannot
 * drift from what was on screen.
 *
 * Returns null when the dashboard has nothing to summarise, which keeps an
 * empty recap from adding a blank section to the file.
 */
function buildRingkasanSheet_(temp, timestamp) {
  let data;
  try {
    data = getDashboardData({ rentang: 'semua' });
  } catch (err) {
    Logger.log('buildRingkasanSheet_(): dashboard tidak terbaca — %s', err.message);
    return null;
  }
  if (data.kosong) return null;

  const rows = [];
  rows.push([EXPORT_RINGKASAN_SHEET]);
  rows.push(['Diexport: ' + formatExportDisplay_(timestamp) + '   |   Periode: ' + data.periode.label]);
  rows.push([]);

  rows.push(['POSISI STOK SAAT INI']);
  rows.push(['Total jenis barang', data.summary.totalBarang]);
  rows.push([data.label.aman, data.summary.aman]);
  rows.push([data.label.perluRestok, data.summary.perluRestok]);
  if (data.summary.lainnya > 0) rows.push([data.label.lainnya, data.summary.lainnya]);
  rows.push([]);

  rows.push(['TRANSAKSI (' + data.periode.label + ')']);
  rows.push(['', 'Baris', 'Jumlah']);
  ['masuk', 'retur', 'keluar'].forEach(function (jenis) {
    const t = data.transaksi[jenis];
    rows.push([t.sheet || jenis, t.baris, t.jumlah]);
  });
  rows.push(['TOTAL', data.transaksi.total.baris, data.transaksi.total.jumlah]);
  rows.push([]);

  if (data.omset.tersedia) {
    rows.push(['OMSET (' + data.periode.label + ')']);
    rows.push(['Total', data.omset.total]);
    rows.push([]);
    rows.push(['Per sales', 'Rupiah']);
    data.omset.perSales.forEach(function (s) { rows.push([s.nama, s.total]); });
    rows.push([]);
    rows.push(['Per kolom', 'Rupiah']);
    data.omset.perKolom.forEach(function (k) { rows.push([k.nama, k.total]); });
    rows.push([]);
  }

  if (data.kritis.length > 0) {
    rows.push(['PERLU RESTOK SEGERA']);
    rows.push(['Kode', 'Nama', 'Sisa Stok', 'Min Stok', 'Selisih']);
    data.kritis.forEach(function (item) {
      rows.push([item.kode, item.nama, item.sisaStok, item.minStok, item.selisih]);
    });
    rows.push([]);
  }

  rows.push(['STOK TERSEDIKIT']);
  rows.push(['Kode', 'Nama', 'Sisa Stok', 'Sisa Dus', 'Status']);
  data.stokTersedikit.forEach(function (item) {
    rows.push([item.kode, item.nama, item.sisaStok, item.sisaDus, item.status]);
  });

  const lebar = rows.reduce(function (max, row) { return Math.max(max, row.length); }, 1);
  const rata = rows.map(function (row) {
    const salinan = row.slice();
    while (salinan.length < lebar) salinan.push('');
    return salinan;
  });

  const sheet = temp.insertSheet(EXPORT_RINGKASAN_SHEET);
  sheet.getRange(1, 1, rata.length, lebar).setValues(rata);
  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sheet.getRange(2, 1).setFontSize(9);
  sheet.autoResizeColumns(1, lebar);

  return { sheet: sheet, rowCount: rata.length };
}
