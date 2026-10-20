# Panduan halaman Churn Risk (untuk tim CS)

**Apa ini?** Halaman ini menampilkan pelanggan retail yang paling mungkin **benar-benar berhenti** dalam 60 hari ke depan. Pelanggan yang hanya pindah rumah, ganti akun, atau pindah alamat tidak dihitung sebagai berhenti.

## Setiap minggu

1. Buka **Growth & churn → Churn risk**.
2. Di tabel **Who is at risk**, pilih tier **High**. Urutan default sudah benar: yang perpanjangannya paling dekat ada di atas.
3. Filter **branch** sesuai cabang kamu, lalu klik **Export filtered list (CSV)**.
4. Bagi daftar itu ke agen. Klik satu baris untuk melihat:
   - alasan risiko (3 faktor teratas)
   - tiket 90 hari terakhir dan work order
   - tanggal perpanjangan
   - **saran tindakan** dan poin bicara
5. Hubungi pelanggan sesuai saran tindakan:
   - **Technical recovery call**: selesaikan gangguan dulu, baru bicara soal perpanjangan.
   - **Billing support call**: bantu soal tagihan dan cara bayar.
   - **Relocation offer**: tawarkan pindah layanan ke alamat baru.
   - **Pre-renewal check-in**: hubungi 7–14 hari sebelum perpanjangan.
   - **Plan fit review**: cek paket yang cocok, jangan sampai pelanggan hilang.
   - **Relationship touch**: sapa lewat WhatsApp dan kenalkan MyGX.

## Aturan penting

- Akun bertanda **Control** **TIDAK BOLEH dihubungi**. Akun ini dipakai untuk mengukur apakah telepon retensi benar-benar menurunkan churn. Secara default, export sudah tidak memuat akun control.
- **Jangan menjanjikan** diskon, kredit, atau jam kunjungan di luar kebijakan. Ikuti kebijakan dan SLA yang berlaku.
- Kolom **Already requested termination** berisi pelanggan yang sudah mengajukan berhenti. Tangani lewat proses terminasi biasa.
- Angka risiko adalah **perkiraan**, bukan kepastian. Faktor risiko menunjukkan hubungan statistik, bukan penyebab pasti.
- Segmen (hotel, kafe, rumah tangga) ditebak dari nama dan email. Cek dulu sebelum dipakai untuk kampanye B2B.

## Kalau ada peringatan di halaman

- **"Scores are N days old"**: model belum dijalankan ulang. Minta admin menjalankan notebook Colab.
- **"Model rejected"**: model baru tidak lolos uji kualitas, jadi yang tampil masih skor model sebelumnya.
- **Coverage banner**: data pelanggan tidak lengkap, jadi sebagian tiket tidak bisa dicocokkan. Angka bisa lebih rendah dari kenyataan.
- **"No churn model output found"**: folder `Churn Model` di Drive belum ada atau masih kosong.
