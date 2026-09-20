# Test Reusability — Langkah Manual

Tujuan: membuktikan script ini jalan di spreadsheet yang strukturnya **sengaja
dibedakan** dari file PT SIB, **tanpa mengedit satu baris kode pun**.

Langkah di bawah harus dikerjakan manual karena saya tidak punya akses ke akun
Google Anda — saya tidak bisa membuat spreadsheet, menempel script, atau
menjalankan menu. Yang sudah saya kerjakan adalah versi simulasinya
(`harness8`, 54 pemeriksaan) memakai struktur asing yang sama seperti di bawah;
yang belum terbukti adalah perilakunya di Google Sheets yang sesungguhnya.

Sediakan waktu sekitar 30-45 menit.

---

## 1. Buat spreadsheet baru

**Spreadsheet baru dari nol — jangan "Make a Copy" dari file PT SIB.** Menyalin
file lama ikut membawa Config lama, jadi tesnya jadi tidak membuktikan apa pun.

Buat 4 sheet dengan nama dan struktur berikut. Perhatikan bahwa **setiap sheet
sengaja berbeda**: bahasa Inggris, nama kolom tidak konsisten antar sheet,
baris header berbeda-beda, dan kolom nomor urut tidak bernama "NO".

### Sheet `INCOMING STOCK` — header di **baris 3**

| | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| 1 | `WAREHOUSE REPORT` | | | | | |
| 2 | *(kosong)* | | | | | |
| 3 | `SEQ` | `DATE IN` | `SKU` | `PRODUCT` | `QTY IN` | `NOTE` |
| 4 | 1 | 10/01/2026 | X1 | Widget | 100 | |
| 5 | 2 | 10/03/2026 | X1 | Widget | 50 | |
| 6 | 3 | 10/02/2026 | Y2 | Gadget | 20 | |

### Sheet `RETURNED STOCK` — header di **baris 2**, nama kolom **beda dari INCOMING**

| | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| 1 | `RETURNS` | | | | | |
| 2 | `LINE` | `RETURN DATE` | `PRODUCT CODE` | `PRODUCT NAME` | `RETURNED QTY` | `REASON` |
| 3 | 1 | 01/04/2026 | X1 | Widget | 10 | damaged box |

### Sheet `OUTGOING STOCK` — header di **baris 4**

| | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| 1 | `SALES` | | | | | |
| 2-3 | *(kosong)* | | | | | |
| 4 | `SEQ` | `DATE OUT` | `BILL NO` | `SKU CODE` | `ITEM` | `QTY OUT` |
| 5 | 1 | 20/02/2026 | B-1 | X1 | Widget | 30 |
| 6 | 2 | 21/02/2026 | B-2 | Y2 | Gadget | 5 |

### Sheet `STOCK SUMMARY` — header di **baris 1** (tanpa baris judul sama sekali)

| | A | B | C | D | E | F | G | H | I | J | K | L | M |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `SEQ` | `SKU` | `PRODUCT` | `OPENING` | `IN` | `RETURNED` | `OUT` | `ON HAND` | `CARTONS` | `REORDER LEVEL` | `PER PACK` | `PER CARTON` | `CONDITION` |
| 2 | 1 | X1 | Widget | 200 | | | | | | 10 | 12 | 24 | |
| 3 | 2 | Y2 | Gadget | 80 | | | | | | 5000 | 6 | 12 | |

> `REORDER LEVEL` Y2 sengaja dibuat 5000 supaya statusnya jatuh ke "perlu restok"
> dan pewarnaannya ikut teruji.

**Pastikan kolom tanggal benar-benar bertipe tanggal**, bukan teks. Ketik
`10/01/2026` lalu cek rata kanan — kalau rata kiri berarti masih teks.

---

## 2. Pasang script

Extensions > Apps Script, lalu ikuti `BACA-DULU.txt`:

1. Buat 8 file `.gs` urut: `Config` → `Transaksi` → `Crud` → `Status` →
   `UndoRedo` → `Visual` → `Export` → `Main`
2. Buat 3 file HTML: `RekapForm`, `ColorPicker`, `ExportDialog`
3. Services (+) > Google Sheets API > Add
4. Save, tutup editor, reload spreadsheet

---

## 3. Setup dan isi Config

Jalankan **Stock Manager > Setup**. Sheet `Config`, `Panduan`, `ActionLog`
akan dibuat dengan nilai default PT SIB.

Sekarang ubah kolom **Value** (jangan kolom Key) di sheet `Config`:

| Key | Value |
|---|---|
| `sheet_barang_masuk` | `INCOMING STOCK` |
| `sheet_barang_retur` | `RETURNED STOCK` |
| `sheet_barang_keluar` | `OUTGOING STOCK` |
| `sheet_rekap_barang` | `STOCK SUMMARY` |
| `col_masuk_tgl` | `DATE IN` |
| `col_masuk_kode` | `SKU` |
| `col_masuk_nama` | `PRODUCT` |
| `col_masuk_jumlah` | `QTY IN` |
| `col_masuk_keterangan` | `NOTE` |
| `col_masuk_no` | `SEQ` |
| `col_retur_tgl` | `RETURN DATE` |
| `col_retur_kode` | `PRODUCT CODE` |
| `col_retur_nama` | `PRODUCT NAME` |
| `col_retur_jumlah` | `RETURNED QTY` |
| `col_retur_keterangan` | `REASON` |
| `col_retur_no` | `LINE` |
| `col_keluar_tgl` | `DATE OUT` |
| `col_keluar_invoice` | `BILL NO` |
| `col_keluar_kode` | `SKU CODE` |
| `col_keluar_nama` | `ITEM` |
| `col_keluar_jumlah` | `QTY OUT` |
| `col_keluar_no` | `SEQ` |
| `col_rekap_kode` | `SKU` |
| `col_rekap_nama` | `PRODUCT` |
| `col_rekap_stok_awal` | `OPENING` |
| `col_rekap_min_stok` | `REORDER LEVEL` |
| `col_rekap_sisa_stok` | `ON HAND` |
| `col_rekap_status` | `CONDITION` |
| `col_rekap_masuk` | `IN` |
| `col_rekap_retur` | `RETURNED` |
| `col_rekap_keluar` | `OUT` |
| `col_rekap_sisa_dus` | `CARTONS` |
| `col_rekap_isi_pack` | `PER PACK` |
| `col_rekap_isi_dus` | `PER CARTON` |
| `col_rekap_no` | `SEQ` |
| `status_teks_aman` | `SAFE` |
| `status_teks_perlu_restok` | `REORDER` |
| `status_teks_na` | `UNKNOWN` |
| `header_row_masuk` | `3` |
| `header_row_retur` | `2` |
| `header_row_keluar` | `4` |
| `header_row_rekap` | `1` |

Lalu jalankan **Setup** sekali lagi, supaya `Panduan` dibuat ulang mengikuti
Config yang baru.

---

## 4. Test yang harus lulus

Centang satu per satu. Kalau ada yang gagal, **catat pesan error persisnya** —
pesan error di script ini selalu menyebutkan nama sheet/kolom yang dicari dan
header yang benar-benar ditemukan, jadi itu petunjuk paling cepat.

### T1 — Panduan mengikuti Config baru
- [ ] Buka sheet `Panduan`. Bagian "DAFTAR KEY DI SHEET CONFIG" menampilkan
      `INCOMING STOCK`, `RETURNED QTY`, `REORDER` — **bukan** nama-nama Indonesia.

### T2 — Rekap terhitung
- [ ] **Refresh Semua Status**
- [ ] Baris X1: `IN`=150, `RETURNED`=10, `OUT`=30, `ON HAND`=**330**
- [ ] `CARTONS` X1 = `13 DUS 1PACK`
- [ ] `CONDITION` X1 = **SAFE** dengan latar hijau
- [ ] `CONDITION` Y2 = **REORDER** dengan latar merah muda

> Kalau kolom `RETURNED` tetap 0, berarti key `col_retur_*` belum terbaca —
> ini yang dulu jadi batasan #3.

### T3 — Input 1 barang
- [ ] **Input Manual**
- [ ] Baris baru muncul di **baris 7** `INCOMING STOCK` (di bawah data, bukan di atas)
- [ ] `ON HAND` di `STOCK SUMMARY` ikut berubah **tanpa klik menu lain**

### T4 — Nomor urut ikut dirapikan
- [ ] **Hapus Baris**, isi `5`
- [ ] Kolom `SEQ` jadi berurutan lagi tanpa bolong

> Kalau `SEQ` tetap bolong, berarti `col_masuk_no` belum terbaca — ini F1.

### T5 — Undo
- [ ] **Undo Terakhir**
- [ ] Baris yang dihapus kembali di posisi semula
- [ ] Kolom `DATE IN` masih **tanggal** (rata kanan), bukan teks
- [ ] Kolom `QTY IN` masih **angka**
- [ ] `ON HAND` kembali ke nilai sebelum penghapusan

### T6 — Sort
- [ ] **Urutkan Tanggal > BARANG MASUK - Terbaru ke Terlama**
- [ ] Data urut dari `DATE IN` terbaru
- [ ] Baris 1 masih `WAREHOUSE REPORT`, baris 3 masih header
- [ ] `SEQ` jadi 1, 2, 3 dari atas

> Label menunya tetap menulis "BARANG MASUK" — itu memang belum ikut Config
> (F3, disepakati hanya didokumentasikan).

### T7 — Filter
- [ ] **Filter Rekap Barang > Hanya Perlu Restok**
- [ ] Klik link di dialog; hanya baris `REORDER` yang tampil

### T8 — Export
- [ ] **Export Data** > `STOCK SUMMARY` > PDF > Export
- [ ] File muncul di folder Drive `Export`
- [ ] Isi PDF memakai nama kolom baru dan `CONDITION` berisi SAFE/REORDER

---

## 5. Kalau ada yang gagal

Laporkan tiga hal ini:

1. **Test nomor berapa** yang gagal
2. **Pesan error persisnya** (screenshot boleh, tapi teks lebih berguna — saya
   tidak selalu bisa melihat gambar)
3. Output **Stock Manager > Debug Config** — ini menampilkan isi Config apa
   adanya beserta spasi tersembunyi, yang sering jadi biang masalah

Kegagalan di sini berarti masih ada hardcode yang lolos dari audit Fase 7.
