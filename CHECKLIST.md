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

11 suite, 810 pemeriksaan, semua hijau:

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
| `harness9` | Form web app (Fase 8A) | 78 |
| `harness10` | Dashboard read-only (Fase 8B) | 93 |
| `harness11` | Kolom rumus, form harga/sales, omset (Fase 8C) | 98 |

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
| Kode akses (`webapp_kode_akses`) aktif, default `gudang-4712` | Belum pernah live | Lulus simulasi — **ganti kodenya**, lihat catatan di bawah |
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
6. Cek sheet Config, key `webapp_kode_akses`. Kalau kolom Value-nya masih
   kosong (key-nya sudah terlanjur ada dari versi sebelumnya), **ketik
   kodenya sendiri di situ** — Setup tidak menimpa key yang sudah ada.
   Lalu buka ulang halaman web app dan pastikan kodenya diminta.

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

Kode bawaannya `gudang-4712`, dan nilai itu ada di dalam source code yang
Anda download — artinya siapa pun yang pegang salinan script ini tahu
kodenya. **Ganti di sheet Config jadi nilai Anda sendiri.** Kodenya juga
satu untuk semua orang: tidak bisa dicabut per orang, jadi kalau ada staf
yang keluar, ganti kodenya dan kabari yang lain.


---

## Fase 8B — Dashboard read-only

| Fitur | Status | Catatan |
|---|---|---|
| Satu URL, dua halaman (`?page=dashboard`) | Belum pernah live | Lulus simulasi |
| Cards ringkasan (total, aman, perlu restok, transaksi hari ini) | Belum pernah live | Lulus simulasi |
| Donut chart AMAN vs PERLU RESTOK | Belum pernah live | Lulus simulasi |
| Bar chart horizontal Top 10 stok tersedikit | Belum pernah live | Lulus simulasi |
| Tabel "Perlu Restok Segera" (lengkap, bukan top 10) | Belum pernah live | Lulus simulasi |
| Auto-refresh 5 menit + tombol refresh manual | Belum pernah live | Lulus simulasi |
| Kode akses sama dengan Fase 8A | Belum pernah live | Lulus simulasi |
| Link navigasi Input <-> Dashboard di kedua halaman | Belum pernah live | Lulus simulasi |

### Yang perlu Anda tes sendiri setelah deploy ulang

**Deploy ulang dulu** — halaman dashboard tidak akan muncul sebelum
Deploy > Manage deployments > pensil > Version: **New version** > Deploy.

1. Buka URL web app, lalu klik tab **Dashboard** di bagian atas.
   Atau langsung tambahkan `?page=dashboard` di belakang URL-nya.
2. Bandingkan angka di cards dengan isi sheet REKAP BARANG — harus persis sama.
3. Cek "Transaksi Hari Ini": input 1 transaksi lewat form, refresh dashboard,
   angkanya harus naik 1.
4. Cek tabel "Perlu Restok Segera": urutannya dari selisih paling negatif.
5. Biarkan halaman terbuka 5 menit, pastikan angkanya menyegarkan sendiri.
6. Buka dari HP dan dari laptop — dua-duanya harus enak dilihat.
7. Kalau kode akses aktif: buka dashboard di browser lain (atau mode incognito),
   pastikan diminta kode dulu sebelum data muncul.

### Catatan perilaku

- Dashboard **tidak menghitung ulang apa pun**. SISA STOK, SISA DUS dan STATUS
  dibaca apa adanya dari REKAP BARANG, jadi angkanya tidak mungkin beda dengan
  spreadsheet. Kalau angka di dashboard terlihat salah, yang salah ada di
  REKAP BARANG — jalankan Stock Manager > Refresh Semua Status.
- Halaman ini **read-only total**: tidak ada tombol simpan, ubah, atau hapus.
  Secara teknis pun `getDashboardData()` tidak pernah memanggil `setValues`.
- Grafik diambil dari CDN (Chart.js). Kalau koneksi ke CDN diblokir, grafiknya
  diganti keterangan dan angka di cards serta tabel tetap tampil benar.
- Biaya baca tetap: 1 kali baca per sheet, berapa pun jumlah barangnya.


---

## Fase 8C — Kolom rumus, omset & filter waktu

### Temuan yang memicu fase ini

`appendRow` dan `batchInsert` menulis string kosong ke **seluruh lebar baris**.
Jadi sejak Fase 1, setiap baris yang masuk lewat menu atau Web App membuat
PRICE, DISKON, AMOUNT KANTOR, ANZAR, SALES B, dan SALES **kosong** — dan
kalau kolom itu berisi rumus, rumusnya ikut mati untuk baris tersebut.

Kalau dashboard omset dibuat tanpa memperbaiki ini dulu, angkanya akan tampil
meyakinkan tapi salah, dan makin lama makin salah.

| Fitur | Status | Catatan |
|---|---|---|
| Rumus disalin dari baris atas ke baris baru | Belum pernah live | Lulus simulasi |
| Field PRICE / DISKON 1-3 di form Web App | Belum pernah live | Lulus simulasi |
| Dropdown SALES di form (manual & batch) | Belum pernah live | Lulus simulasi |
| Kartu Omset Keseluruhan (format Rupiah) | Belum pernah live | Lulus simulasi |
| Rincian omset per sales | Belum pernah live | Lulus simulasi |
| Filter waktu Hari Ini / Minggu Ini / Bulan Ini / Semua | Belum pernah live | Lulus simulasi |
| Line chart tren omset per minggu | Belum pernah live | Lulus simulasi |

### Cara kerja kolom rumus

Script **tidak pernah menulis angka** ke AMOUNT KANTOR / ANZAR / SALES B.
Setiap kali ada baris baru, rumus dari baris tepat di atasnya disalin pakai
`copyTo(..., PASTE_FORMULA)` — referensi barisnya ikut digeser otomatis oleh
Google Sheets. Jadi logika hitungnya tetap milik spreadsheet, apa pun bentuk
rumusnya, dan tidak ada rumus tandingan di dalam kode yang bisa berbeda.

Tiga pengaman:

- Kalau sel di baris atas berisi **angka statis, bukan rumus** → tidak disalin.
  Menyalin angka statis lebih buruk daripada mengosongkan, karena kelihatan
  seperti hasil hitungan.
- Kalau **tidak ada baris di atasnya** (sheet masih kosong) → dilewati, dicatat di log.
- Kalau kolom disebut di Config tapi **tidak ada di sheet** → dilewati, baris tetap tertulis.

### Key Config baru

| Key | Default | Isi |
|---|---|---|
| `col_keluar_price` | `PRICE` | Kolom harga satuan, diketik lewat form |
| `col_keluar_diskon` / `2` / `3` | `DISKON`, `DISKON2`, `DISKON3` | Kolom diskon, diketik lewat form |
| `col_keluar_sales` | `SALES` | Kolom nama sales (dropdown di form) |
| `col_keluar_formula` | `AMOUNT KANTOR, ANZAR, SALES B` | Kolom rumus yang disalin turun |
| `col_keluar_omset` | `AMOUNT KANTOR, ANZAR, SALES B` | Kolom rupiah yang dijumlah jadi omset |
| `daftar_sales` | `ANZAR, SALES B` | Pilihan dropdown sales |
| `dashboard_minggu_tren` | `8` | Jumlah minggu di grafik tren |

Semua kolom di atas **opsional**. Dikosongkan = field-nya hilang dari form dan
tidak ada yang disalin. Bisnis lain yang tidak pakai omset tetap jalan seperti
Fase 8B.

### Yang perlu Anda cek sendiri — PENTING

1. **Cek ejaan header persis** di sheet BARANG KELUAR, terutama kolom diskon
   ketiga. Di screenshot header-nya terpotong jadi `ISKON`, saya tebak
   `DISKON3`. Kalau salah, betulkan Value-nya di sheet Config — tidak perlu
   ubah kode.
2. **Cek isi `daftar_sales`** harus sama **persis** dengan teks yang dikenali
   rumus di kolom AMOUNT/ANZAR/SALES B. Kalau rumusnya mencocokkan `"ANZAR"`
   dan dropdown mengirim `"Anzar"`, nilainya tidak akan masuk ke kolom mana
   pun dan omsetnya jadi 0 tanpa error.
3. **Sheet BARANG KELUAR harus punya minimal satu baris lama yang rumusnya
   utuh** — itu sumber salinannya. Kalau baris terakhir kebetulan baris yang
   rumusnya sudah mati (korban bug lama), perbaiki dulu satu baris itu secara
   manual, baru input lewat form.

### Baris lama yang sudah terlanjur kosong

Fase ini **tidak memperbaiki baris yang sudah terlanjur ditulis** sejak Fase 1.
Baris-baris itu tetap kosong di kolom PRICE/AMOUNT dan akan terhitung Rp 0 di
dashboard. Kalau jumlahnya banyak, perbaikannya: seleksi satu sel rumus yang
masih utuh, copy, lalu paste ke seluruh kolom rumus di baris-baris yang kosong
— itu pekerjaan sekali jalan di spreadsheet, bukan di script.

### Definisi periode

- **Hari Ini** — tanggal hari ini, zona waktu spreadsheet
- **Minggu Ini** — minggu kalender Senin–Minggu (bukan 7 hari terakhir)
- **Bulan Ini** — tanggal 1 sampai akhir bulan berjalan
- **Semua** — seluruh isi sheet

Karena pakai batas kalender, baris bertanggal besok ikut terhitung di
"Minggu Ini" tapi tidak di "Hari Ini". Itu memang arti minggu kalender.

**Kartu stok (Total Jenis / Aman / Perlu Restok) sengaja TIDAK ikut filter
waktu** — SISA STOK adalah posisi sekarang, dan sheet tidak menyimpan riwayat
"stok per akhir minggu lalu". Angka stok historis hanya bisa dikarang. Di UI
kartu itu diberi judul terpisah "Posisi Stok Saat Ini" supaya tidak rancu.

**Grafik tren juga tidak ikut filter waktu** — gunanya justru membandingkan
antar minggu, jadi selalu menampilkan beberapa minggu terakhir.
