# Stock Manager Template

A reusable Google Apps Script foundation: duplicate this spreadsheet
(**File > Make a Copy**) into any Google Sheets file and it runs with zero
code edits. All sheet names and column names live in one **Config** sheet —
adapting to a different layout means editing Config values, not the script.

## Architecture

- No file ID, folder ID, or spreadsheet name is hardcoded anywhere.
- No sheet name (e.g. `"BARANG MASUK"`) is hardcoded outside the Config
  defaults — every function reads sheet names from `getConfig()`.
- No column name or column number is hardcoded — columns are looked up by
  header text via `getColumnIndex(sheetName, headerName)`, so column order
  can differ between spreadsheets.
- Every function reads the active spreadsheet via
  `SpreadsheetApp.getActiveSpreadsheet()` — never `openById()` with a fixed
  ID, so the same script works after being copied anywhere.

## Files

- `src/appsscript.json` — Apps Script manifest.
- `src/Config.gs` — `getConfig()` (cached Key/Value reader for the `Config`
  sheet), `getColumnIndex()` (header-based column lookup), `clearConfigCache()`,
  `ensureConfigSheet()`, and an `onEdit()` simple trigger that invalidates the
  cache whenever the Config sheet changes.
- `src/Main.gs` — `onOpen()` (the **Stock Manager** menu) and `runSetup()`,
  which creates the `Config` and `Panduan` sheets with defaults on first run.

## Config sheet

Column A = Key (don't change), column B = Value (edit to match your
spreadsheet). Default entries, matching the original layout this template
was extracted from:

| Key | Default value |
| --- | --- |
| `sheet_barang_masuk` | `BARANG MASUK` |
| `sheet_barang_retur` | `BARANG RETUR` |
| `sheet_barang_keluar` | `BARANG KELUAR` |
| `sheet_rekap_barang` | `REKAP BARANG` |
| `col_masuk_tgl` / `col_masuk_kode` / `col_masuk_nama` / `col_masuk_jumlah` / `col_masuk_keterangan` | `TGL` / `CODE BARANG` / `NAMA BARANG` / `JUMLAH` / `KETERANGAN` |
| `col_keluar_tgl` / `col_keluar_invoice` / `col_keluar_kode` / `col_keluar_nama` / `col_keluar_jumlah` | `TGL` / `INVOICE` / `KODE BARANG` / `NAMA BARANG` / `JUMLAH` |
| `col_rekap_kode` / `col_rekap_nama` / `col_rekap_stok_awal` / `col_rekap_min_stok` / `col_rekap_sisa_stok` / `col_rekap_status` | `KODE BARANG` / `NAMA BARANG` / `STOK AWAL` / `MIN STOK` / `SISA STOK` / `STATUS` |

`BARANG RETUR` reuses the `col_masuk_*` keys since it shares the same column
layout as `BARANG MASUK`.

The full usage guide (in Indonesian) is written to a `Panduan` sheet by
**Stock Manager > Setup**.

## Deploying with clasp

This step needs to run on your own machine (or anywhere with a browser),
since `clasp login` opens an OAuth consent screen for your Google account —
it can't be done from this session on your behalf.

```bash
npm install -g @google/clasp
clasp login
clasp create --type sheets --title "Stock Manager Template" --rootDir src
clasp push
clasp open
```

`clasp create` writes a `.clasp.json` with the new spreadsheet's `scriptId`
(gitignored here, since it's specific to your Google account).

## First run / testing

1. Reload the spreadsheet so `onOpen()` fires and the **Stock Manager** menu
   appears.
2. Run **Stock Manager > Setup** — creates the `Config` and `Panduan` sheets
   with defaults if they don't already exist.
3. In the Apps Script editor, select `getConfig` and run it; check
   **Execution log** for the full config object.
4. Change a Value in the `Config` sheet (e.g. `BARANG MASUK` → `STOK MASUK`),
   run `getConfig()` again, and confirm the new value is returned (the
   `onEdit` trigger clears the cache automatically on every Config edit).

## Next phase

Stock in/out input logic, recap calculations, and low-stock status are not
implemented yet — this phase is the Config foundation only.
