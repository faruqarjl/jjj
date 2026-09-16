# Stock Manager Template

A Google Apps Script–bound Google Sheets template for simple inventory
management: an `Inventory` sheet, a `Transactions` log, stock in/out prompts,
and a low-stock check, all wired to a custom **Stock Manager** menu.

## Files

- `src/appsscript.json` — Apps Script manifest.
- `src/Setup.gs` — creates the `Inventory` and `Transactions` sheets and the
  `Stock Manager` menu (`onOpen`).
- `src/Inventory.gs` — `upsertItem`, `adjustStock`, and sheet lookup helpers.
- `src/Alerts.gs` — low-stock check and the Stock In / Stock Out menu prompts.

## Deploying with clasp

This step needs to run on your own machine (or anywhere with a browser),
since `clasp login` opens an OAuth consent screen for your Google account —
it can't be done from this session on your behalf.

```bash
npm install -g @google/clasp
clasp login
clasp create --type sheets --title "Stock Manager Template" --rootDir src
```

`clasp create` writes a `.clasp.json` with the new spreadsheet's `scriptId`
(gitignored here, since it's specific to your Google account). Then push
this template's code into it:

```bash
clasp push
clasp open
```

Once open, reload the spreadsheet so the `onOpen` trigger runs and the
**Stock Manager** menu appears, then run **Stock Manager > Initialize
sheets** to create the `Inventory` and `Transactions` tabs.

## Usage

- **Stock Manager > Initialize sheets** — creates/repairs the sheet headers.
- **Stock Manager > Stock In... / Stock Out...** — prompts for an item ID and
  quantity, adjusts `Inventory`, and logs the movement to `Transactions`.
- **Stock Manager > Check low stock** — lists items at or below their
  reorder level.
- `upsertItem(itemId, name, category, quantity, unit, unitPrice, reorderLevel)`
  — add or update an item from the Apps Script editor or another script.
