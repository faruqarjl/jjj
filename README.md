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
- `src/Main.gs` — `onOpen()` (the **Stock Manager** menu), `runSetup()`
  (creates `Config` and `Panduan` with defaults on first run), and the menu
  handlers that call into `Transaksi.gs`.
- `src/Transaksi.gs` — generic input logic shared by all three transaction
  sheets: `appendRow()`, `batchInsert()`, `sortByDate()`, `applyBorders()`.
- `src/WebApp.gs` — the web app form's server side: `doGet()`,
  `getWebAppData()`, `submitWebAppInput()`, `submitWebAppBatch()`. Every
  submit goes through `appendRowLogged()`/`batchInsertLogged()`, so it wraps
  the existing logic instead of duplicating it.
- `src/WebAppInput.html` — the mobile input form served by `doGet()`.

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

| `header_row_masuk` / `header_row_retur` / `header_row_keluar` / `header_row_rekap` | `5` / `5` / `6` / `5` |

`BARANG RETUR` reuses the `col_masuk_*` keys since it shares the same column
layout as `BARANG MASUK`. It still gets its own `header_row_retur`, since
header position is per-sheet.

### Header rows

These sheets carry title and blank rows above the table, so the header is
not row 1. The `header_row_*` keys say which row holds the column headers;
everything below it is data. `getColumnIndex()` takes an optional third
`headerRow` argument and otherwise resolves it from Config via
`getHeaderRow(sheetName)`. A missing or invalid `header_row_*` value falls
back to row 1, so a plain single-header sheet still works.

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

## Fase 1 — Input logic (Append, Sort, Border, Batch per Invoice)

`Transaksi.gs` adds generic functions that work identically on all three
transaction sheets (`BARANG MASUK`, `BARANG RETUR`, `BARANG KELUAR`) — none
of them are hardcoded to a specific sheet:

- `appendRow(sheetName, rowDataObject)` — writes one row to the bottom of
  the sheet (`getLastRow() + 1`), matching object keys to columns by header
  text via `getColumnIndex()`. Returns the row index written.
- `batchInsert(sheetName, arrayOfRowDataObjects)` — writes several rows in
  one `setValues()` call (no per-row `appendRow` loop). For `BARANG KELUAR`,
  it verifies every row's `INVOICE` value matches before writing.
- `sortByDate(sheetName)` — sorts all data rows (header excluded) by the
  sheet's configured date column, newest first, then renumbers a column
  literally headed `NO` if one exists. Data rows must be free of merged
  cells for `Range.sort()` to work.
- `applyBorders(sheetName)` — applies a thin grid border to the whole used
  range; idempotent, safe to call repeatedly (called automatically after
  every append/batch/sort above).

These sheets (with headers matching whatever the `Config` sheet's Value
column says) must already exist in the spreadsheet — this template doesn't
create `BARANG MASUK` / `BARANG RETUR` / `BARANG KELUAR` themselves, only
`Config` and `Panduan`.

New menu items under **Stock Manager**:

- **Input Manual** — `testAppendRow()`, a dummy row appended to
  `BARANG MASUK`.
- **Input Batch (Invoice)** — `testBatchInsert()`, 3 dummy rows appended to
  `BARANG KELUAR` sharing one `INVOICE` number.
- **Urutkan Terbaru** submenu — `sortByDate()` for `BARANG MASUK`,
  `BARANG RETUR`, or `BARANG KELUAR`.

### Testing Fase 1

1. **Input Manual** → new row appears at the very bottom of `BARANG MASUK`,
   with a border.
2. **Input Batch (Invoice)** → 3 rows land in `BARANG KELUAR` at once, same
   `INVOICE` number, borders intact.
3. **Urutkan Terbaru > BARANG MASUK** → rows sorted newest-date-first, `NO`
   renumbered top to bottom, borders intact.
4. Repeat 1–3 for `BARANG RETUR` and `BARANG KELUAR` — behavior must match
   across all three sheets.

Delete/edit features are intentionally out of scope for this phase (Fase 2).

## Fase 8A — Web app input form

A phone-friendly form so warehouse staff can record stock without opening the
spreadsheet. It handles two things: one transaction at a time (Masuk / Retur /
Keluar), and one invoice with several items at once.

Everything it writes goes through `appendRowLogged()` / `batchInsertLogged()`,
the same helpers the spreadsheet menu uses, so the recap resync, borders,
`NO` handling and undo history behave identically no matter where the row
came from.

### Config keys it reads

| Key | Default | Meaning |
|---|---|---|
| `daftar_user` | `Budi, Siti, Andi` | Names in the "Pilih Nama Kamu" dropdown, comma-separated. Only these names are accepted. |
| `webapp_kode_akses` | `gudang-4712` | Shared access code. Blank disables the check entirely. **Change it** — the default ships in this source, so anyone with a copy of the script knows it. |

### ActionLog gained an `InputBy` column

`InputBy` is column 8, appended **after** `Status` so an existing 7-column log
keeps `Status` where it is. `ensureActionLogSheet()` widens an old log on the
next run. Rows entered from the spreadsheet menu leave `InputBy` blank; rows
from the web app carry the chosen name.

### Deploying it

1. **Extensions > Apps Script**, then **Deploy > New deployment**.
2. Gear icon > **Web app**.
3. Execute as: **Me**. Who has access: **Anyone**.
4. **Deploy**, authorise, and copy the web app URL. Share that URL with staff.

The manifest already sets `executeAs: USER_DEPLOYING` and
`access: ANYONE_ANONYMOUS`, so the dialog comes pre-filled.

**Every time the code changes you must deploy a new version** — *Deploy >
Manage deployments > edit (pencil) > Version: New version > Deploy*. The URL
stays the same. A plain `clasp push` updates the editor but **not** the live
web app.

### What this deployment actually means, stated plainly

"Execute as Me" + "Anyone" means **anyone holding the URL can write to your
spreadsheet, with no Google login**. That is what makes it work for staff on
personal Gmail accounts, and it is the trade-off you accepted.

The "Pilih Nama Kamu" dropdown is a self-declared label for accountability,
**not authentication** — nothing stops someone picking a colleague's name.
`webapp_kode_akses` adds a shared code as a second barrier; it is a
deterrent against a leaked link, not real access control. It ships filled in
(`gudang-4712`) so a fresh copy is not wide open on day one, but a default
that lives in the source is public by definition — set your own value in the
Config sheet. It is one shared code for everyone, so it cannot be revoked for
one person; when someone leaves, change it and tell the rest.

If you need genuine authentication, the deployment has to change to "Anyone
with a Google account", which means every member of staff signs in — the exact
thing this setup was chosen to avoid.

## Next phase

Fase 8B: dashboard. Not started — blocked until Fase 8A is approved and tested
on a live spreadsheet.
