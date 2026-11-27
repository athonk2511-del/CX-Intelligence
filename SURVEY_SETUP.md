# Surveys: setup

Menu **Surveys** memakai proxy Apps Script yang sama dengan dashboard. Access key, role, dan Role management tetap seperti sekarang; tidak ada admin key baru.

Bagian yang terlibat:

- `gxsurvey.js`: builder di menu Surveys (buat survei, respons, Unduh Excel/CSV).
- `survey.html`: halaman yang dibuka responden (gaya Typeform). Tidak butuh login.
- `apps-script/survey.gs`: penyimpanan survei dan jawaban di spreadsheet **CX Intelligence · Survey DB**.
- `gxdata.js`: respons survei yang dihubungkan ke CSAT ikut dihitung di halaman CSAT, Executive overview, dan perbandingan week/month/year.

Sampai langkah 1–4 selesai, dashboard tetap jalan seperti biasa. Menu Surveys menampilkan pesan bahwa proxy belum punya modul survei, dan halaman CSAT tidak berubah.

## 1. Tambahkan survey.gs ke proxy

Apps Script editor proxy → **+** di sebelah Files → **Script** → beri nama `survey` → tempel seluruh isi `apps-script/survey.gs` → Save.

## 2. Update roles.gs

Ganti isi file `roles` di Apps Script dengan `apps-script/roles.gs` terbaru dari repo ini. Perubahannya hanya dua:

- menu `surveys` ditambahkan ke daftar menu, supaya bisa diberikan di Role management;
- `doPost` meneruskan `action: 'survey'` ke survey.gs sebelum cek key, karena responden tidak punya key. survey.gs sendiri yang mengecek key untuk semua aksi selain membuka form dan mengirim jawaban.

## 3. Buat Survey DB

Di editor, pilih fungsi **gxSurveySetup** → **Run**. Apps Script akan meminta izin baru untuk membuat dan mengedit spreadsheet: **Review permissions** → pilih akun pemilik proxy → **Advanced** → **Go to … (unsafe)** → **Allow**.

Lihat **Execution log**: URL spreadsheet Survey DB ada di sana. Id-nya tersimpan otomatis di Script property `GX_SURVEY_SHEET`. Kalau ingin memakai spreadsheet yang sudah ada, isi property itu dengan id spreadsheet tersebut sebelum menjalankan gxSurveySetup.

Spreadsheet ini berisi data pelanggan, jadi jangan dibagikan ke publik.

## 4. Deploy versi baru

Deploy → **Manage deployments** → edit deployment yang sekarang → Version: **New version** → Deploy. URL tetap sama, "Who has access" tetap **Anyone**.

## 5. Publikasikan survey.html

`survey.html` ikut ter-publish bersama dashboard (GitHub Pages dan cx.dps.globalxtreme.net). Link responden otomatis memakai alamat dashboard yang sedang dibuka, misalnya `https://cx.dps.globalxtreme.net/survey.html?f=ab12cd34`.

**Pastikan alamat itu bisa dibuka pelanggan dari internet.** Kalau cx.dps.globalxtreme.net hanya bisa diakses dari jaringan kantor, isi konstanta `SURVEY_PAGE` di bagian atas `gxsurvey.js` dengan alamat publik, misalnya `https://athonk2511-del.github.io/CX-Intelligence/survey.html`.

## 6. Beri akses menu

Role management → edit user → centang **Surveys**:

- **Admin**: semua.
- **Dispatcher** dengan menu Surveys: membuat, mengubah, menghapus survei dan respons.
- **Viewer** dengan menu Surveys: melihat respons dan mengunduh Excel/CSV saja.

## Menghubungkan survei ke laporan CSAT

Di survei → **Pengaturan** → **Hubungkan ke laporan CSAT CX Intelligence**:

1. Aktifkan "Masukkan respons ke laporan CSAT".
2. **Pertanyaan skor CSAT (1–5)**: rating 5 bintang atau skala linear 1–5. Pertanyaan lain tidak bisa dipilih, karena CSAT dashboard memakai skala 1–5.
3. **Komentar pelanggan** (opsional): pertanyaan paragraf atau jawaban singkat. Muncul di "Verbatim customer feedback".
4. **Identitas** (opsional): biasanya hidden field CID dari link.

Yang ikut dihitung: jumlah respons, skor rata-rata, distribusi rating, top-2-box/bottom-2-box, komentar, dan tren harian, sesuai filter Period. Filter Branch tidak berlaku karena data CSAT memang tidak punya cabang. Panel device/browser tetap hanya dari data CSAT lama.

Jangan aktifkan untuk survei yang pelanggannya juga mengisi CSAT dari sistem lama pada periode yang sama, supaya satu pengalaman tidak terhitung dua kali.

## Hidden fields (CID, WO, agent)

Pengaturan → **Data dari link**: tulis kunci yang dipisah koma, misalnya `cid, wo, agent`. Link-nya menjadi:

```
https://<alamat>/survey.html?f=ab12cd34&cid=12345&wo=WWR-001&agent=Putri
```

Nilai ini tidak ditanyakan ke pelanggan, tersimpan di setiap respons, ikut di Excel/CSV, dan bisa dipakai sebagai identitas di laporan CSAT. Kunci yang tidak didaftarkan diabaikan oleh server. Isi link per pelanggan bisa dibuat dari template pesan WhatsApp, DotAI, atau mail merge.

## Catatan

- Siapa pun yang memegang link bisa mengisi survei, sama seperti Google Form publik. Daftar survei, respons, dan unduhan hanya bisa dibuka dengan access key yang punya menu Surveys.
- "Batasi 1 respons per perangkat" berbasis browser, bukan verifikasi identitas.
- Belum ada captcha. Untuk link yang dikirim langsung ke pelanggan biasanya cukup; untuk link yang dipasang publik di website, pertimbangkan pembatasan tambahan.
- Menghapus survei di dashboard menghapus form dan baris di tab Responses. Tab "Jawaban - <judul> [id]" tetap ada di Survey DB sebagai arsip.
- Unduh Excel memuat library SheetJS dari cdnjs saat tombol ditekan. Kalau jaringan memblokirnya, Unduh CSV tetap bisa dipakai dan dibuka di Excel.
- Kapasitas wajar: puluhan ribu respons. Setiap daftar respons dibaca langsung dari Survey DB, jadi survei yang sangat besar akan terasa lebih lambat saat dibuka.
