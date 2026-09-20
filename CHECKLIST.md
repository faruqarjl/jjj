# Checklist Status Fitur — Stock Manager

Referensi untuk debug nanti: bagian mana yang terakhir stabil, dan mana yang
berubah sesudah terakhir kali diuji langsung.

**Arti status:**

| Status | Arti |
|---|---|
| Lulus live | Anda konfirmasi jalan di Google Sheets sungguhan |
| Perlu retest | Kodenya berubah **sesudah** konfirmasi live terakhir. Lulus simulasi, belum diuji di Sheets |
| Belum pernah live | Baru ada di simulasi saja |

Dua hal yang harus jujur disebut:

- **Saya tidak bisa menjalankan apa pun di Google Sheets.** Semua kolom
  "simulasi" berasal dari harness Node yang memalsukan `SpreadsheetApp`,
  `DriveApp`, `UrlFetchApp`, dan Sheets API. Mock bisa salah menirukan Google.
- Status "Lulus live" diambil dari konfirmasi Anda di percakapan, bukan dari
  pengamatan saya sendiri.

---

## Ringkasan

| Fase | Status keseluruhan |
|---|---|
| Fase 0 — Fondasi Config | Perlu retest (tersentuh perbaikan Fase 7) |
| Fase 1 — Input, sort, border, merge | Perlu retest (tersentuh perbaikan Fase 7) |
| Fase 2 — CRUD + auto-sync rekap | Perlu retest (tersentuh perbaikan Fase 7) |
| Fase 3 — STATUS | Perlu retest (teks STATUS jadi configurable) |
| Fase 4 — Undo/Redo | Perlu retest (lookup kolom NO berubah) |
| Fase 5 — Warna + Filter | Perlu retest (kriteria filter ikut teks STATUS) |
| Fase 6 — Export PDF/Excel | Perlu retest (kolom tanggal lewat resolver baru) |
| Fase 7 — Audit + dokumentasi | Belum pernah live |

**Kenapa hampir semuanya "perlu retest":** perbaikan F1/F2/#3 di Fase 7
menyentuh 7 file dan mengubah cara kolom NO, teks STATUS, serta kolom RETUR
diambil. Nilai default-nya identik dengan sebelumnya, jadi **kemungkinan besar
tidak ada yang berubah perilakunya** di file PT SIB — tapi "kemungkinan besar"
bukan "sudah diuji". Satu putaran regresi di file duplikat sudah cukup.

---

## Fase 0 — Fondasi Config

| Fitur | Status | Catatan |
|---|---|---|
| `getConfig()` + cache | Lulus live | Cache sempat bermasalah (entry kosong `{}` bersifat truthy) — sudah diperbaiki dan dikonfirmasi |
| `getColumnIndex()` per nama header | Lulus live | Toleran spasi dan huruf besar/kecil |
| `getHeaderRow()` | Lulus live | Header row 5/5/6/5 di PT SIB |
| Sheet Config dibuat otomatis | Lulus live | |
| Backfill key baru saat Setup | Lulus live | |
| Key `col_*_no`, `col_retur_*`, `status_teks_*` | Perlu retest | Ditambahkan di Fase 7 |
| Sheet Panduan di-generate dari Config | Belum pernah live | Dulu statis, sekarang dibuat ulang tiap Setup |

## Fase 1 — Input, Sort, Border, Merge

| Fitur | Status | Catatan |
|---|---|---|
| `appendRow()` ke baris terbawah | Lulus live | Terbukti menulis ke baris 449 |
| `batchInsert()` satu invoice | Lulus live | |
| `sortByDate()` desc | Lulus live | |
| `sortByDate()` asc | Lulus live | |
| Border otomatis | Lulus live | |
| Unmerge + isi ulang saat sort | Lulus live | Permanen, tidak bisa dibatalkan |
| Renumber kolom NO sesudah sort | Perlu retest | Sekarang lewat `col_*_no`, bukan literal "NO" |
| Insert ikut resync rekap | Lulus live | Ditambahkan sesudah Fase 4 |

## Fase 2 — CRUD + Auto-sync Rekap

| Fitur | Status | Catatan |
|---|---|---|
| `deleteRow()` + border | Lulus live | |
| Renumber NO sesudah delete | Perlu retest | Sama seperti di atas |
| `recalculateRekap()` satu barang | Lulus live | |
| Auto-sync lewat `onEdit` | Lulus live | Termasuk kasus kode barang diubah (kode lama ikut dihitung ulang) |
| SISA STOK = AWAL + MASUK + RETUR − KELUAR | Lulus live | Retur menambah stok |
| SISA DUS `"{dus} DUS {pack}PACK"` | Lulus live | |
| Sidebar Edit Rekap Barang | Lulus live | Tambah + edit, tolak kode duplikat |
| `recalculateAllRekap()` versi batch | Lulus live | 17 panggilan API, konstan berapa pun jumlah barang |

## Fase 3 — STATUS

| Fitur | Status | Catatan |
|---|---|---|
| `calculateStatus_()` (`<=` batas) | Lulus live | Sama dengan min = perlu restok |
| Pewarnaan cell STATUS | Lulus live | Hijau `#D9EAD3`, merah muda `#F4CCCC` |
| Fallback saat MIN STOK kosong | Lulus live | |
| Teks STATUS dari Config | Perlu retest | Sebelumnya hardcode "AMAN"/"PERLU RESTOK" |
| Refresh Semua Status | Lulus live | Log progres tiap 50 barang |

## Fase 4 — Undo/Redo

| Fitur | Status | Catatan |
|---|---|---|
| Sheet ActionLog | Lulus live | |
| Undo APPEND / BATCH_INSERT | Lulus live | Satu batch = satu entry |
| Undo DELETE (baris kembali) | Lulus live | Tanggal tetap Date, angka tetap angka |
| Undo EDIT_MANUAL | Lulus live | |
| Undo EDIT_FORM | Lulus live | |
| Redo + hangusnya history lama | Lulus live | |
| Batas 50 entry (FIFO) | Lulus live | |
| Penolakan saat baris sudah berubah | Perlu retest | Pengecualian kolom NO sekarang lewat Config |
| Undo COLORIZE | Lulus live | Ditambahkan di Fase 5 |

## Fase 5 — Warna + Filter

| Fitur | Status | Catatan |
|---|---|---|
| `colorizeRow()` satu baris penuh | Lulus live | Warna lama disimpan per cell |
| REKAP ditolak untuk warna manual | Lulus live | Supaya tidak bentrok dengan STATUS |
| Hapus warna | Lulus live | |
| Validasi hex | Lulus live | |
| Sidebar Color Picker | Lulus live | |
| Filter View per-user | Lulus live | Butuh Sheets Advanced Service |
| Pembersihan basic filter lama | Lulus live | |
| Kriteria filter ikut teks STATUS | Perlu retest | Sekarang membaca `status_teks_*` |

## Fase 6 — Export

| Fitur | Status | Catatan |
|---|---|---|
| Export PDF | Lulus live | Landscape bila >8 kolom |
| Export Excel satu sheet | Lulus live | Lewat spreadsheet sementara |
| Spreadsheet asli tidak berubah | Lulus live | |
| Filter tanggal | Perlu retest | Kolom tanggal sekarang lewat `columnNameFor_()` |
| Folder Drive `Export` | Lulus live | |
| Nama file berstempel detik | Lulus live | Export berulang tidak saling menimpa |
| Dialog Export + indikator loading | Lulus live | |

## Fase 7 — Audit + Dokumentasi

| Fitur | Status | Catatan |
|---|---|---|
| Audit hardcode | Selesai | Tidak ada file/folder/spreadsheet ID hardcode; tidak ada nomor kolom data hardcode |
| F1 — kolom NO configurable | Belum pernah live | Lulus simulasi |
| F2 — teks STATUS configurable | Belum pernah live | Lulus simulasi |
| #3 — kolom RETUR terpisah | Belum pernah live | Lulus simulasi |
| Panduan di-generate otomatis | Belum pernah live | Lulus simulasi |
| Test reusability bisnis asing | **Menunggu Anda** | Lihat `REUSABILITY-TEST.md` |

---

## Yang sengaja dibiarkan

Disepakati saat audit Fase 7 — didokumentasikan, tidak diperbaiki:

| Kode | Hal | Kenapa dibiarkan |
|---|---|---|
| F3 | Label submenu menulis "BARANG MASUK" dll | Kosmetik; aksinya tetap mengikuti Config |
| F4 | Pesan error menyebut "REKAP BARANG" | Kosmetik |
| F5 | Label form sidebar berbahasa Indonesia | Kosmetik; data tetap masuk kolom yang benar |
| #1 | Tabel harus mulai dari kolom A | Perubahan besar, belum ada kebutuhannya |
| #2 | Struktur 4 sheet itu tetap | Sama |
| #4 | Baris data tepat di bawah header | Sama |

---

## Cakupan simulasi

9 suite, 615 pemeriksaan, semua hijau:

| Suite | Cakupan | Jumlah |
|---|---|---|
| `harness` | Pembacaan Config, cache, lookup kolom | 18 |
| `harness2` | Header row, geometri tabel, backfill | 35 |
| `harness3` | Sort, merge, border | 53 |
| `harness4` | Rekap, STATUS, batch, pemakaian API | 158 |
| `harness5` | Undo/Redo | 81 |
| `harness6` | Warna, Filter View | 74 |
| `harness7` | Export PDF/Excel | 68 |
| `harness8` | **Bisnis asing** + Panduan otomatis | 54 |
| `harness9` | Form web app (Fase 8A) | 74 |

`harness8` yang paling relevan untuk reusability: sheet berbahasa Inggris, nama
kolom berbeda di tiap sheet, RETUR punya kolom sendiri, `SEQ`/`LINE` sebagai
nomor urut, `SAFE`/`REORDER` sebagai STATUS, dan empat baris header berbeda.


---

## Fase 8A — Form input web app

| Fitur | Status | Catatan |
|---|---|---|
| Form input 1 transaksi (Masuk/Retur/Keluar) | Belum pernah live | Lulus simulasi |
| Form input batch per invoice | Belum pernah live | Lulus simulasi |
| Dropdown "Pilih Nama Kamu" dari `daftar_user` | Belum pernah live | Lulus simulasi |
| Kode akses opsional (`webapp_kode_akses`) | Belum pernah live | Lulus simulasi |
| Nama penginput tercatat di ActionLog (`InputBy`) | Belum pernah live | Lulus simulasi |
| ActionLog lama (7 kolom) otomatis diperlebar | Belum pernah live | Lulus simulasi |
| Undo tetap jalan untuk baris dari web app | Belum pernah live | Lulus simulasi |
| Deploy web app | **Menunggu Anda** | Lihat README bagian "Fase 8A" |

### Yang perlu Anda tes sendiri setelah deploy

1. Buka URL web app dari HP, bukan dari laptop — ini yang dipakai sehari-hari.
2. Input 1 transaksi Masuk, cek barisnya muncul di sheet dan REKAP ikut berubah.
3. Input 1 invoice berisi 3 barang, cek ketiganya masuk dengan invoice yang sama.
4. Undo dari menu spreadsheet — 1 invoice harus hilang sekaligus, bukan satu-satu.
5. Cek sheet ActionLog: kolom `InputBy` terisi nama yang dipilih.
6. Isi `webapp_kode_akses` di Config, buka ulang halaman, pastikan kode diminta.

### Catatan perilaku

- Kolom `NO` sengaja dibiarkan kosong saat input, persis seperti input dari
  menu (perilaku sejak Fase 1). Nomor urut dirapikan ulang saat ada baris
  yang dihapus. Kalau Anda mau `NO` langsung terisi, itu perubahan pada
  `appendRow`/`batchInsert` yang kena ke semua jalur input — bilang saja.
- `daftar_user` disimpan sebagai satu key di Config (dipisah koma), bukan
  sheet Users tersendiri, karena tidak ada data lain per orang selain nama.

### Batasan keamanan (bukan bug, ini konsekuensi pilihan deployment)

Deployment "Execute as Me / Anyone" berarti siapa pun yang punya URL-nya bisa
menulis ke spreadsheet, tanpa login Google. Dropdown nama itu deklarasi
mandiri untuk pertanggungjawaban, **bukan autentikasi** — siapa pun bisa
memilih nama siapa pun. `webapp_kode_akses` hanya penghalang tambahan kalau
link-nya bocor, bukan kontrol akses sungguhan.
