# Checklist Status Fitur — Stock Manager

Referensi untuk debug nanti: bagian mana yang terakhir stabil, dan mana yang
berubah sesudah terakhir kali diuji langsung.

**Arti status:**

| Status | Arti |
|---|---|
| Lulus live | Anda konfirmasi jalan di Google Sheets sungguhan |
| Lulus live | Kodenya berubah **sesudah** konfirmasi live terakhir. Lulus simulasi, belum diuji di Sheets |
| Belum pernah live | Baru ada di simulasi saja |

Dua hal yang harus jujur disebut:

- **Saya tidak bisa menjalankan apa pun di Google Sheets.** Semua kolom
  "simulasi" berasal dari harness Node yang memalsukan `SpreadsheetApp`,
  `DriveApp`, `UrlFetchApp`, dan Sheets API. Mock bisa salah menirukan Google.
- Status "Lulus live" diambil dari konfirmasi Anda di percakapan, bukan dari
  pengamatan saya sendiri.

**Retest menyeluruh terakhir: 23 Sep 2026**, di file duplikat BARU hasil Save as dari
`.xlsm` asli (bukan duplikat lama yang datanya sudah tidak bisa dipercaya).
Anda konfirmasi 18 langkah di bagian "Testing menyeluruh" di bawah lulus
semua, termasuk gerbang SISA STOK yang tidak jadi `#NAME?`.

Yang di bawah masih bertanda "Belum pernah live" berarti **tidak termasuk
dalam 18 langkah itu** — bukan gagal, tapi memang belum pernah dijalankan.
Daftarnya dikumpulkan di bagian "Sisa yang belum diuji" di akhir berkas.

---

## Ringkasan

| Fase | Status keseluruhan |
|---|---|
| Fase 0 — Fondasi Config | Lulus live (23 Sep 2026) |
| Fase 1 — Input, sort, border, merge | Lulus live (23 Sep 2026) |
| Fase 2 — CRUD + auto-sync rekap | Lulus live (23 Sep 2026) |
| Fase 3 — STATUS | Lulus live (23 Sep 2026) |
| Fase 4 — Undo/Redo | Lulus live (23 Sep 2026) |
| Fase 5 — Warna + Filter | Lulus live (23 Sep 2026) |
| Fase 6 — Export PDF/Excel | Lulus live (23 Sep 2026) |
| Fase 7 — Audit + dokumentasi | Sebagian — lihat tabelnya |
| Fase 8A — Form input web app | Lulus live (23 Sep 2026) |
| Fase 8B — Dashboard read-only | Lulus live (23 Sep 2026) |
| Fase 8C — Omset & filter waktu | Lulus live (23 Sep 2026) |
| Fase 8D — Penyesuaian ke file asli | Lulus live (23 Sep 2026) |

Putaran retest ini menutup semua "perlu retest" yang menumpuk sejak Fase 7:
perubahan F1/F2/#3, lalu perubahan besar di Fase 8D (batas data, rumus
STATUS, kolom rumus) semuanya ikut teruji dalam 18 langkah itu.

---

## Fase 0 — Fondasi Config

| Fitur | Status | Catatan |
|---|---|---|
| `getConfig()` + cache | Lulus live | Cache sempat bermasalah (entry kosong `{}` bersifat truthy) — sudah diperbaiki dan dikonfirmasi |
| `getColumnIndex()` per nama header | Lulus live | Toleran spasi dan huruf besar/kecil |
| `getHeaderRow()` | Lulus live | Header row 5/5/6/5 di PT SIB |
| Sheet Config dibuat otomatis | Lulus live | |
| Backfill key baru saat Setup | Lulus live | |
| Key `col_*_no`, `col_retur_*`, `status_teks_*` | Lulus live | Ditambahkan di Fase 7 |
| Sheet Panduan di-generate dari Config | Belum pernah live | Dulu statis, sekarang dibuat ulang tiap Setup |

## Fase 1 — Input, Sort, Border, Merge

| Fitur | Status | Catatan |
|---|---|---|
| `appendRow()` ke baris data terakhir | Lulus live | Dulu menulis di baris 449 (bug 8D); sekarang tepat di bawah data |
| `batchInsert()` satu invoice | Lulus live | |
| `sortByDate()` desc | Lulus live | |
| `sortByDate()` asc | Lulus live | |
| Border otomatis | Lulus live | |
| Unmerge + isi ulang saat sort | Lulus live | Permanen, tidak bisa dibatalkan |
| Renumber kolom NO sesudah sort | Lulus live | Lewat `col_*_no`. **Catatan:** NO di file asli diisi per invoice, renumber tetap per baris |
| Insert ikut resync rekap | Lulus live | Ditambahkan sesudah Fase 4 |

## Fase 2 — CRUD + Auto-sync Rekap

| Fitur | Status | Catatan |
|---|---|---|
| `deleteRow()` + border | Lulus live | |
| Renumber NO sesudah delete | Lulus live | Sama seperti di atas |
| `recalculateRekap()` satu barang | Lulus live | |
| Auto-sync lewat `onEdit` | Lulus live | Termasuk kasus kode barang diubah (kode lama ikut dihitung ulang) |
| SISA STOK = AWAL + MASUK + RETUR − KELUAR | Lulus live | Retur menambah stok |
| SISA DUS `"{dus} DUS {pack}PACK"` | Lulus live | |
| Sidebar Edit Rekap Barang | Lulus live | Tambah + edit, tolak kode duplikat |
| `recalculateAllRekap()` versi batch | Lulus live | 17 panggilan API, konstan berapa pun jumlah barang |

## Fase 3 — STATUS

| Fitur | Status | Catatan |
|---|---|---|
| `calculateStatus_()` berbasis PACK | Lulus live | `INT(SISA STOK / ISI PER PACK) <= MIN STOK`, meniru rumus asli |
| Pewarnaan cell STATUS | Lulus live | Hijau `#D9EAD3`, merah muda `#F4CCCC` |
| MIN STOK kosong | Lulus live | Batas 0 -> AMAN. Yang jadi PERLU RESTOCK kalau ISI PER PACK kosong |
| Teks STATUS dari Config | Lulus live | Terpakai sebagai `PERLU RESTOCK`, cocok dengan Excel asli |
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
| Penolakan saat baris sudah berubah | Lulus live | Pengecualian kolom NO sekarang lewat Config |
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
| Kriteria filter ikut teks STATUS | Lulus live | Sekarang membaca `status_teks_*` |

## Fase 6 — Export

| Fitur | Status | Catatan |
|---|---|---|
| Export PDF | Lulus live | Landscape bila >8 kolom |
| Export Excel satu sheet | Lulus live | Lewat spreadsheet sementara |
| Spreadsheet asli tidak berubah | Lulus live | |
| Filter tanggal | Lulus live | Kolom tanggal sekarang lewat `columnNameFor_()` |
| Folder Drive `Export` | Lulus live | |
| Nama file berstempel detik | Lulus live | Export berulang tidak saling menimpa |
| Dialog Export + indikator loading | Lulus live | |

## Fase 7 — Audit + Dokumentasi

| Fitur | Status | Catatan |
|---|---|---|
| Audit hardcode | Selesai | Tidak ada file/folder/spreadsheet ID hardcode; tidak ada nomor kolom data hardcode |
| F1 — kolom NO configurable  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
| F2 — teks STATUS configurable  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
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

12 suite, 870 pemeriksaan, semua hijau:

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
| `harness12` | **Bentuk file asli PT SIB** (baris rumus kosong, baris TOTAL) | 52 |

`harness8` yang paling relevan untuk reusability: sheet berbahasa Inggris, nama
kolom berbeda di tiap sheet, RETUR punya kolom sendiri, `SEQ`/`LINE` sebagai
nomor urut, `SAFE`/`REORDER` sebagai STATUS, dan empat baris header berbeda.


---

## Fase 8A — Form input web app

| Fitur | Status | Catatan |
|---|---|---|
| Form input 1 transaksi (Masuk/Retur/Keluar)  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
| Form input batch per invoice  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
| Dropdown "Pilih Nama Kamu" dari `daftar_user`  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
| Kode akses (`webapp_kode_akses`) aktif, default `gudang-4712` | Belum pernah live | Lulus simulasi — **ganti kodenya**, lihat catatan di bawah |
| Nama penginput tercatat di ActionLog (`InputBy`)  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
| ActionLog lama (7 kolom) otomatis diperlebar | Belum pernah live | Lulus simulasi |
| Undo tetap jalan untuk baris dari web app  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
| Deploy web app | Lulus live | Sudah di-deploy dan dipakai dari HP |

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
| Satu URL, dua halaman (`?page=dashboard`)  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
| Cards ringkasan (total, aman, perlu restok, transaksi hari ini)  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
| Donut chart AMAN vs PERLU RESTOK | Belum pernah live | Lulus simulasi |
| Bar chart horizontal Top 10 stok tersedikit | Belum pernah live | Lulus simulasi |
| Tabel "Perlu Restok Segera" (lengkap, bukan top 10)  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
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
| Rumus disalin dari baris atas ke baris baru  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
| Field PRICE / DISKON 1-3 di form Web App  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
| Dropdown SALES di form (manual & batch)  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
| Kartu Omset Keseluruhan (format Rupiah)  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
| Rincian omset per sales | Belum pernah live | Lulus simulasi |
| Filter waktu Hari Ini / Minggu Ini / Bulan Ini / Semua  Lulus live | Lulus simulasi + dikonfirmasi 23 Sep 2026 |
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


---

## Fase 8D — Penyesuaian ke struktur file asli

Berdasarkan audit isi `.xlsm` PT SIB. Keempat hal ini bukan penyempurnaan —
tiga di antaranya memperbaiki kerusakan yang sudah aktif terjadi.

### 1. Baris baru sempat mendarat di tempat yang salah (PALING PARAH)

`getLastRow()` menghitung sel berisi rumus sebagai "ada isinya", walaupun
hasilnya `""`. File asli punya ratusan baris kosong yang sudah diisi rumus:

| Sheet | Baris data asli | `getLastRow()` | Dulu ditulis di | Sekarang |
|---|---|---|---|---|
| BARANG MASUK | 18 | 443 | **444** | 19 |
| BARANG RETUR | 1 | 443 | **444** | 7 |
| BARANG KELUAR | 121 | 279 (baris TOTAL) | **280**, di bawah TOTAL | 128 |

Sekarang batas data ditentukan **kolom kode**: baris terakhir yang menyebut
kode barang adalah baris data terakhir. Baris rumus kosong dan baris TOTAL
tidak punya kode, jadi otomatis di luar semua rentang — insert, sort, border,
hapus, renumber, dan copy-formula.

Kalau baris tujuan ternyata memang terisi (baris TOTAL), barisnya
**disisipkan** dengan `insertRowsBefore`, sehingga TOTAL terdorong ke bawah
dan Google Sheets melebarkan sendiri rentang `=SUM(...)`-nya.

Yang dianggap "terisi" bukan sekadar sel tidak kosong, tapi **sel yang
diketik** — non-kosong dan bukan hasil rumus. Kalau tidak begitu, baris rumus
kosong (yang menampilkan `0`) akan dikira terisi dan rumus yang sudah siap di
situ tidak akan pernah terpakai.

### 2. STATUS sekarang meniru rumus asli

```
Rumus asli : IFERROR(IF(INT(SISA STOK / ISI PER PACK) <= MIN STOK,
                        "PERLU RESTOCK", "AMAN"), "PERLU RESTOCK")
```

Yang berubah:

- **MIN STOK dihitung dalam PACK.** Stok dibagi ISI PER PACK dulu. Versi lama
  membandingkan SISA STOK langsung ke MIN STOK — terlalu banyak yang lolos
  sebagai aman.
- **Teksnya `PERLU RESTOCK`** (pakai C). Default `status_teks_perlu_restok`
  ikut berubah.
- **Tidak ada N/A lagi.** MIN STOK kosong berarti batasnya 0, jadi AMAN
  selama stoknya ada. Yang jatuh ke PERLU RESTOCK justru kalau ISI PER PACK
  kosong — itu pembagian gagal, dan `IFERROR` di rumus asli memang
  mengarahkannya ke PERLU RESTOCK.
- **SISA DUS** kalau gagal dihitung sekarang `0 DUS 0 PACK`, mengikuti
  `IFERROR` rumus aslinya, bukan `N/A`. Bisa diubah lewat key
  `sisa_dus_teks_error`.

**RETUR tetap menambah stok**, sesuai keputusan Fase 2. Ini memang **beda
dari file Excel asli** — di sana kolom RETUR di REKAP kosong tanpa rumus, jadi
retur tidak pernah masuk hitungan. Perbedaan ini disengaja.

### 3. `daftar_sales` jadi tiga

Dropdown SALES di file asli sumbernya `$L$6:$N$6`, yaitu header ketiga kolom
uangnya: **AMOUNT KANTOR, ANZAR, SALES B**.

### 4. NAMA BARANG tidak lagi ditulis form

Di ketiga sheet transaksi, kolom nama berisi
`=IFERROR(VLOOKUP(kode,'REKAP BARANG'!B:C,2,FALSE),"")`. Di BARANG MASUK dan
RETUR header-nya **`TBL_MASUK`**, bukan `NAMA BARANG`.

Kolom itu sekarang didaftarkan di `col_<sheet>_formula`, jadi form tidak
menulisinya dan rumusnya ikut tersalin ke baris baru. Di form, kotak Nama
Barang jadi non-aktif dengan keterangan bahwa isinya datang dari rumus.

### Status

| Fitur | Status | Catatan |
|---|---|---|
| Batas data dari kolom kode (bukan `getLastRow()`) | Lulus live | Baris baru mendarat tepat di bawah data |
| Baris TOTAL dikecualikan dari insert/sort/border/hapus | Lulus live | TOTAL tidak keganggu, nilainya ikut bertambah |
| Sisip baris kalau tujuan terisi | Lulus live | |
| Rumus kolom uang disalin ke baris baru | Lulus live | PRICE/DISKON/AMOUNT KANTOR/ANZAR/SALES B benar |
| NAMA BARANG otomatis dari VLOOKUP | Lulus live | Form tidak lagi menulisinya |
| STATUS berbasis PACK, teks `PERLU RESTOCK` | Lulus live | Cocok dengan Excel asli |
| Gerbang konversi: SISA STOK bukan `#NAME?` | Lulus live | `Table1[[#This Row]...]` selamat saat Save as |

### Key Config yang berubah / baru

| Key | Nilai untuk file PT SIB |
|---|---|
| `status_teks_perlu_restok` | `PERLU RESTOCK` |
| `sisa_dus_teks_error` | `0 DUS 0 PACK` |
| `daftar_sales` | `AMOUNT KANTOR, ANZAR, SALES B` |
| `col_masuk_nama` | `TBL_MASUK` |
| `col_retur_nama` | `TBL_MASUK` |
| `col_masuk_formula` | `TBL_MASUK` |
| `col_retur_formula` | `TBL_MASUK` |
| `col_keluar_formula` | `NAMA BARANG, AMOUNT KANTOR, ANZAR, SALES B` |

---

## TESTING MENYELURUH DI FILE DUPLIKAT BARU — SUDAH DIJALANKAN (23 Sep 2026, lulus semua)

Sudah dijalankan dan **lulus 18 dari 18**. Bagian ini disimpan sebagai
prosedur regresi: jalankan ulang urutan yang sama setiap kali ada perubahan
besar berikutnya.

File duplikat yang lama sudah tidak bisa dipercaya: baris uji coba ada di
sekitar baris 444 BARANG MASUK, dan rumus REKAP kemungkinan sudah tertimpa
angka. **Buang, jangan diperbaiki.**

### Persiapan

1. Dari `.xlsm` asli: **File > Save as > Google Sheets** (bukan dari duplikat lama).
2. **Sebelum menyentuh apa pun**, cek dulu hasil konversinya:
   - Buka REKAP BARANG, klik sel di kolom SISA STOK. Rumusnya memakai
     `Table1[[#This Row],[...]]` — sintaks Excel yang tidak ada di Google
     Sheets. Pastikan tidak jadi `#NAME?` atau `#REF!`. **Kalau rusak, berhenti
     dan kabari saya** — sisa pengujian tidak ada gunanya.
   - Cek satu sel di kolom ANZAR BARANG KELUAR, pastikan rumusnya utuh.
   - Makro VBA **pasti hilang** — Google Sheets tidak menjalankan VBA.
3. Pasang script, jalankan **Setup**, lalu isi sheet Config sesuai tabel key
   di atas.
4. Catat dulu angka pembanding: SISA STOK dan STATUS untuk 3 barang, serta
   isi baris TOTAL di BARANG KELUAR.

### Urutan tes

| # | Fase | Yang dites | Yang harus terjadi |
|---|---|---|---|
| 1 | 8D | Input 1 baris lewat form | Mendarat **tepat di bawah data**, bukan baris 444 |
| 2 | 8D | Lihat kolom ANZAR baris baru | Berisi **rumus**, bukan angka; hasilnya benar |
| 3 | 8D | Lihat kolom NAMA BARANG baris baru | Terisi VLOOKUP, bukan ketikan |
| 4 | 8D | Cek baris TOTAL | Masih di bawah, nilainya **termasuk** baris baru |
| 5 | 1 | Urutkan Tanggal | Baris TOTAL tidak ikut tersortir |
| 6 | 1 | Border | Tidak membingkai ratusan baris kosong |
| 7 | 2 | Hapus baris data | Berhasil; NO dirapikan |
| 8 | 2 | Hapus nomor baris TOTAL | **Ditolak** dengan pesan jelas |
| 9 | 3 | Refresh Semua Status | STATUS = `PERLU RESTOCK`/`AMAN`, dihitung per PACK |
| 10 | 3 | Bandingkan dengan catatan langkah 4 | Selisih hanya dari RETUR (disengaja) |
| 11 | 4 | Undo input tadi | Baris hilang, REKAP ikut mundur |
| 12 | 5 | Warnai baris + Filter | Jalan seperti biasa |
| 13 | 6 | Export PDF & Excel | File jadi, sheet asli tidak berubah |
| 14 | 8A | Form dari HP: input manual & batch | Masuk, InputBy terisi |
| 15 | 8C | Isi PRICE + DISKON + SALES | Kolom uang terisi sendiri oleh rumus |
| 16 | 8C | Pilih sales berbeda-beda | Nilainya pindah kolom sesuai pilihan |
| 17 | 8B | Dashboard | Angka cocok dengan REKAP |
| 18 | 8C | Toggle Hari Ini/Minggu/Bulan/Semua | Omset berubah; kartu stok tidak |

### Yang belum diputuskan dan belum saya ubah

- **Kolom NO diisi per invoice**, bukan per baris (B7=1 menutupi baris 7–8,
  B9=2). `renumberNoColumn_` saat hapus baris menomori ulang 1,2,3… per baris,
  jadi penomoran per invoice itu akan berubah. Belum saya sentuh karena tidak
  ada instruksinya.
- **88 merge vertikal** di kolom NO BARANG KELUAR akan di-unmerge permanen
  pada input pertama. Ini sesuai persetujuan Fase 1, tapi jumlahnya banyak.
- **Baris lama yang rumusnya sudah mati** (korban bug sejak Fase 1) tidak
  diperbaiki otomatis.


---

## Sisa yang belum diuji

Retest 23 Sep 2026 menutup 18 langkah, tapi tidak semuanya. Yang berikut ini
**belum pernah dijalankan di Google Sheets sungguhan** — bukan gagal, cuma
belum kesentuh. Kebanyakan cuma butuh beberapa detik untuk dicek.

| Belum diuji | Cara cek cepat |
|---|---|
| Grafik donat & bar chart di dashboard | Buka dashboard, pastikan dua grafik atas tergambar (bukan kotak kosong) |
| Line chart tren omset per minggu | Di dashboard yang sama, lihat grafik garis paling bawah |
| Rincian omset per sales | Kartu di bawah kartu Omset — cek jumlah tiap sales = total |
| Auto-refresh 5 menit | Biarkan dashboard terbuka 5 menit, lihat jam "Diperbarui" berubah |
| Link navigasi Input <-> Dashboard | Klik tab di atas, bolak-balik dua halaman |
| Kode akses web app | Buka dashboard di mode incognito, pastikan diminta kode |
| Migrasi ActionLog 7 -> 8 kolom | Hanya relevan kalau ActionLog sudah ada sebelum Fase 8A |
| Sheet Panduan di-generate ulang | Jalankan Setup, lihat sheet Panduan terisi sesuai Config |
| `col_retur_*` terpisah dari `col_masuk_*` | Tidak relevan untuk PT SIB — RETUR pakai kolom yang sama |
| Reusability bisnis asing | Lihat `REUSABILITY-TEST.md`, butuh spreadsheet terpisah |

Grafik-grafik itu satu kelompok risikonya sama: **Chart.js diambil dari CDN**.
Kalau jaringan kantor memblokir `cdn.jsdelivr.net`, ketiganya diganti
keterangan sementara angka di kartu dan tabel tetap benar. Sekali lihat
dashboard sudah cukup membuktikan ketiganya.

---

## Yang masih terbuka, di luar pengujian

1. **Kolom NO diisi per invoice**, bukan per baris (B7=1 menutupi baris 7-8,
   B9=2). `renumberNoColumn_` saat hapus baris menomori ulang per baris, jadi
   pola per-invoice itu akan berubah. Belum ada instruksi untuk mengubahnya.
2. **88 merge vertikal** di kolom NO BARANG KELUAR akan di-unmerge permanen
   pada input pertama.
3. **Baris lama korban bug Fase 1** (rumusnya terlanjur kosong) tidak
   diperbaiki otomatis. Perbaikannya sekali jalan di spreadsheet: copy satu
   sel rumus yang utuh, paste ke kolom rumus di baris-baris yang kosong.
4. **Apakah file produksi asli ikut kena bug baris 444 / rumus tertimpa,
   atau cuma file duplikat testing** — belum terjawab. Kalau file asli pernah
   dipakai dengan script versi lama, perlu dicek.
