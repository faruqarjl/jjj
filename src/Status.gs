/**
 * STATUS classification for REKAP BARANG, plus its colour coding.
 *
 * Driven from recalculateRekap() in Crud.gs — one row at a time, as part of
 * the same pass that computes SISA STOK and SISA DUS, so STATUS is never
 * recomputed by a separate scan over the sheet.
 */

// Fallbacks only — the text actually written to the sheet comes from the
// status_teks_* keys in Config, so another business can use SAFE/REORDER
// without touching code. These apply when a key is blank or missing.
const STATUS_AMAN_DEFAULT = 'AMAN';
const STATUS_PERLU_RESTOK_DEFAULT = 'PERLU RESTOCK';
const STATUS_NA_DEFAULT = 'N/A';

const WARNA_STATUS_AMAN = '#D9EAD3';        // hijau muda
const WARNA_STATUS_PERLU_RESTOK = '#F4CCCC'; // merah muda

/** The three STATUS labels as configured. */
function statusTexts_() {
  const config = getConfig();
  const pick = function (key, fallback) {
    const value = normalizeText_(config[key]);
    return value === '' ? fallback : value;
  };

  return {
    aman: pick('status_teks_aman', STATUS_AMAN_DEFAULT),
    perluRestok: pick('status_teks_perlu_restok', STATUS_PERLU_RESTOK_DEFAULT),
    tidakDiketahui: pick('status_teks_na', STATUS_NA_DEFAULT)
  };
}

/** The background for a status label, or null when it has no verdict. */
function statusColour_(status) {
  const texts = statusTexts_();
  if (status === texts.aman) return WARNA_STATUS_AMAN;
  if (status === texts.perluRestok) return WARNA_STATUS_PERLU_RESTOK;
  return null;
}

/**
 * Colour the STATUS cell only, rather than the whole row.
 *
 * recalculateRekap() runs on every onEdit, so colouring the whole row would
 * overwrite any background formatting already on these Excel-derived sheets
 * — repeatedly, and with nothing to undo it. Set this to true if the
 * at-a-glance scannability of a full-row highlight is worth that.
 */
const STATUS_WARNAI_SELURUH_BARIS = false;

/**
 * Mirrors the workbook's own STATUS formula rather than inventing a second
 * rule:
 *
 *   =IFERROR(IF(INT(SISA STOK / ISI PER PACK) <= MIN STOK,
 *               "PERLU RESTOCK", "AMAN"), "PERLU RESTOCK")
 *
 * The point that matters: MIN STOK in this business is counted in PACKS,
 * not in loose units, so the stock is divided by ISI PER PACK before the
 * comparison. Comparing SISA STOK to MIN STOK directly — which is what this
 * did before the workbook was inspected — flags far too much as safe.
 *
 * A missing or zero ISI PER PACK is a division error in the sheet, and the
 * IFERROR there resolves it to "PERLU RESTOCK": an item nobody can size is
 * better surfaced than hidden. This follows that, deliberately, instead of
 * returning the "N/A" it used to.
 */
function calculateStatus_(sisaStok, minStok, isiPack) {
  const texts = statusTexts_();
  const pack = toNumber_(isiPack);
  if (!(pack > 0)) return texts.perluRestok;

  const stokDalamPack = Math.floor(toNumber_(sisaStok) / pack);
  return stokDalamPack <= toNumber_(minStok) ? texts.perluRestok : texts.aman;
}

/**
 * Paints the row's STATUS cell to match its status. An unknown status
 * clears the background rather than inventing a colour for it.
 */
function applyStatusColor_(sheetName, rowIndex, status) {
  const config = getConfig();
  const table = getTableInfo_(sheetName);
  const statusColumn = getColumnIndex(sheetName, config.col_rekap_status, table.headerRow);
  const warna = statusColour_(status);

  const range = STATUS_WARNAI_SELURUH_BARIS
    ? table.sheet.getRange(rowIndex, 1, 1, table.width)
    : table.sheet.getRange(rowIndex, statusColumn);

  range.setBackground(warna);
}
