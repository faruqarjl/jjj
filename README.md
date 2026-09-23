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
- `src/WebApp.gs` — the web app's server side: `doGet()` (routes both pages),
  `getWebAppData()`, `submitWebAppInput()`, `submitWebAppBatch()`,
  `getWebAppNav()`, and the read-only `getDashboardData()`. Every submit goes
  through `appendRowLogged()`/`batchInsertLogged()`, so it wraps the existing
  logic instead of duplicating it.
- `src/WebAppInput.html` — the mobile input form served by `doGet()`.
- `src/WebDashboard.html` — the read-only dashboard (Fase 8B), served by the
  same `doGet()` under `?page=dashboard`.

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

## Fase 8B — Read-only dashboard

`?page=dashboard` on the same web app URL. Summary cards, a status donut, a
horizontal bar chart of the ten lowest-stock items, and the full reorder
table — nothing on the page writes anything.

### One deployment, two pages

`doGet(e)` routes on `?page=`: `dashboard` serves `WebDashboard`, anything
else (including no parameter at all) serves the input form. One URL means one
deployment to redeploy, one access code, and one link to hand out. Both pages
carry a nav row linking to the other; the URLs come from `getWebAppNav()`
because HtmlService renders inside a sandboxed iframe, where a relative
`?page=dashboard` would resolve against the sandbox host instead of the web
app.

The dashboard is behind the same `webapp_kode_akses` as the form — stock
levels are no less sensitive than the ability to add a row. The page asks for
the code once and keeps it in `localStorage`.

### It reads, it does not recompute

`getDashboardData()` takes `SISA STOK`, `SISA DUS` and `STATUS` from
`REKAP BARANG` exactly as `recalculateRekap()` left them, and only aggregates
(counts, sorts, a subtraction for the reorder gap). There is no second copy
of the stock formula, so the dashboard cannot drift from the spreadsheet.
Status labels come from `status_teks_*`, so `SAFE`/`REORDER` works as well as
`AMAN`/`PERLU RESTOK`.

Today's activity is counted by formatting each transaction date to
`yyyy-MM-dd` in the spreadsheet's own time zone and comparing days, so a row
entered at 09:00 and one at 17:00 both land on today.

Cost is one `getValues()` per sheet regardless of how many items exist — 120
items read no more than 12 do.

### Degrading instead of breaking

| Situation | What the page does |
|---|---|
| `REKAP BARANG` empty or missing | Cards show zeros, a banner names the sheet and says how to add items |
| Nothing needs reordering | The alert card turns green, the table says so, the donut still renders |
| Everything needs reordering | The safe slice is simply absent from the donut |
| A transaction sheet missing | That sheet counts 0; the others still count |
| Chart.js CDN blocked | Charts are replaced with a note; cards and table stay accurate |

Charts come from `cdn.jsdelivr.net` (Chart.js 4.4.1), so the page needs
outbound internet — an offline machine gets the numbers but not the graphs.

Auto-refresh runs every 5 minutes, skipped while the tab is hidden and
triggered again when it becomes visible, so a dashboard left on an office
tablet stays current without hammering the script.


## Fase 8C — Formula columns, revenue and time filters

### The bug this fixes

`appendRow()` and `batchInsert()` build `new Array(table.width).fill('')` and
write it across the whole row. Columns the caller didn't supply weren't merely
skipped — they were actively blanked. In the original workbook AMOUNT KANTOR,
ANZAR and SALES B hold formulas that route a line's value to whichever column
matches the chosen sales name, so every row the script added from Fase 1
onward lost them and read as zero revenue.

### Copying instead of computing

`copyFormulaColumns_()` pastes the formulas named by `col_<sheet>_formula`
from the row above into each new row, with
`copyTo(..., CopyPasteType.PASTE_FORMULA)` so Sheets shifts the relative
references itself. The pricing logic stays owned by the spreadsheet — there is
no rival formula in the code to drift from it.

It refuses to copy when the source cell holds a static value rather than a
formula (a pasted number would look computed), when there is no data row
above, or when a configured column is missing from the sheet. Each refusal is
logged and the row is still written.

`restoreManualValues_()` then rewrites any cell the caller supplied that a
pasted formula landed on. The two sets don't normally overlap, so it usually
does nothing; it matters only when Config lists a column as both a form field
and a formula column, and there what the user typed wins.

### Form fields

The web app's barang-keluar form gained PRICE, up to three discounts and a
SALES dropdown. Each appears only when Config names a column for it, so a
business without those columns sees the plain Fase 8A form. The sales name is
validated against `daftar_sales`: the sheet's formulas match on that text, so
a typo would route the amount to no column and lose the sale silently.

The menu's "Input Manual" and "Input Batch" items are test stubs that write
dummy rows, not real forms — they gained no fields, but they go through
`appendRow`/`batchInsert` and so inherit the formulas too.

### Dashboard additions

A range toggle (Hari Ini / Minggu Ini / Bulan Ini / Semua) drives revenue and
transaction counts; `col_keluar_omset` names the money columns to sum, and the
breakdown groups rows by the sales column, with blank names collected under
"(Tanpa Sales)" so the parts always add up to the whole. A weekly trend line
covers the last `dashboard_minggu_tren` calendar weeks, keeping empty weeks at
zero rather than skipping them.

Weeks and months are calendar ranges, not rolling windows. Stock cards and the
trend chart deliberately ignore the range: stock is a right-now position with
no history in the sheet, and the trend exists to compare weeks.

All three transaction sheets are read once per request and the same rows feed
the counts, the revenue and the trend, so 150 rows cost what 1 row does.

## Fase 8D — Fitting the actual workbook

Written after reading the source `.xlsm` rather than inferring from
screenshots. Three of these four repair damage that was already happening.

### getLastRow() was the wrong bound

A cell holding a formula counts as non-empty even when the formula returns
`""`, and these sheets carry hundreds of pre-filled rows doing exactly that —
BARANG MASUK has 18 rows of data and 425 of waiting VLOOKUPs, and BARANG
KELUAR ends with a TOTAL row of `=SUM(...)`. Appending at `getLastRow() + 1`
therefore wrote to row 444 on masuk, and on keluar to the row *below* the
total, whose SUM range could never reach it.

`getDataBounds_()` now derives the end of the data from the item-code column:
the last row naming an item is the last row of data. Formula-only rows and
the TOTAL row name none, so they fall outside every derived range — append,
sort, borders, delete, renumber and the formula copy alike. When the target
row is genuinely occupied, `insertRowsBefore` makes space, which also lets
Sheets widen the SUM ranges.

"Occupied" means *typed*: non-empty and not the output of a formula. Judging
by displayed value alone would mark every waiting formula row as occupied —
`=IF($O10="ANZAR",...)` shows `0` — and the formulas placed there would never
be used.

### STATUS mirrors the workbook's formula

```
=IFERROR(IF(INT(SISA STOK / ISI PER PACK) <= MIN STOK,
            "PERLU RESTOCK", "AMAN"), "PERLU RESTOCK")
```

MIN STOK is counted in **packs** here, so the stock is divided by ISI PER PACK
before comparing; comparing raw units, as before, passed far too much as safe.
The label carries a C — `PERLU RESTOCK`. There is no N/A: a missing MIN STOK
means a threshold of zero, and it is a missing ISI PER PACK that resolves to
PERLU RESTOCK, following the IFERROR. SISA DUS falls back to `0 DUS 0 PACK`
for the same reason, configurable via `sisa_dus_teks_error`.

RETUR still adds to stock per the Fase 2 decision. The Excel original never
counted it — its recap RETUR column holds no formula at all — so this is a
deliberate divergence, not a mismatch to fix.

### The form no longer types over lookups

NAMA BARANG is `=IFERROR(VLOOKUP(kode,'REKAP BARANG'!B:C,2,FALSE),"")` on all
three transaction sheets, under the header `TBL_MASUK` on masuk and retur.
Listing it in `col_<sheet>_formula` makes it read-only to the form and lets
the copy-down supply the lookup, so a corrected catalogue still propagates.
`getWebAppData()` reports this as `namaOtomatis` and the form disables the
field rather than offering a box whose contents go nowhere.

### Conversion caveats this cannot fix

The workbook holds VBA macros, which Google Sheets does not run at all, and
six Excel Tables whose `Table1[[#This Row],[...]]` references have no Google
Sheets equivalent. Verify those survive the import before trusting anything
downstream of them.

## Fase 9 — Managing everything from the web app

The goal changed: the spreadsheet should no longer be the only place work can
happen. This deliberately lifts the read-only rule Fase 8B set, for the data
pages only — the dashboard stays read-only.

### Four pages, one deployment

`doGet(e)` routes on `?page=`: `data` (browse/edit/delete transactions),
`rekap` (catalogue CRUD), `dashboard`, and the input form as the default for
anything else. `WebStyles.html` and `WebShell.html` are pulled into each page
with `createTemplateFromFile` + `include()`, so the tokens, toasts, modal and
nav exist once rather than four times.

The shell is a sidebar on desktop and a bottom bar under 860px — the request
was explicitly desktop-first, and a left rail gives the data tables their full
width while staying reachable on a phone.

### What editing is allowed to touch

`describeColumns_()` marks each column editable or not, and the rules are
enforced on the server, not just hidden in the UI:

- Columns named by `col_<sheet>_formula` are shown (their numbers matter) but
  never written — the form disables them and flags them `ƒ`.
- The NO column is off-limits; renumbering owns it.
- Rows outside `getDataBounds_` are refused, so the blank formula rows and the
  TOTAL footer cannot be edited or deleted by row number.
- **Only changed cells are written**, grouped into contiguous runs. Writing a
  whole row would clear the formula columns it crosses — the exact bug Fase 8D
  existed to fix.
- Every change goes through `logAction_`, so Undo in the spreadsheet still
  reverses it and InputBy records who did it.
- The recap resyncs for both the old and the new item code when a code moves.
- Deleting a catalogue item is refused while transactions still reference it.

### Chart colours

The status donut was green vs red. Measured with the palette validator that
pair is **CVD ΔE 4.1** in deuteranopia — the one pair colour-blind viewers
cannot separate. It is now blue for safe and red for reorder, which clears the
gate on both the light and dark surfaces, with the legend carrying an icon and
the count so identity never rests on hue alone. The Top-10 bar chart dropped to
a single hue; the table beneath it already says which items need reordering.

Chart colours are read from CSS custom properties at render time, so dark mode
uses its own steps rather than an inverted copy of the light ones.
