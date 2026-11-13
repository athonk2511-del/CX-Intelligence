# DotAI ETA API (IDS)

API ini dipakai DotAI untuk menjawab pertanyaan pelanggan "teknisi datang jam berapa?" dari data jadwal IDS di CX Intelligence. Satu panggilan GET, dicari dengan CID, User ID, atau nomor WO.

## Ringkasan

- **Sumber data:** plan IDS hari ini (WWR dan WCM). Setiap layar IDS yang terbuka (dispatch board atau arrivals TV) mengirim snapshot ETA ke Apps Script setiap kali plan berubah, dan minimal setiap 5 menit.
- **Yang dijawab:** status WO, perkiraan kedatangan dalam **rentang 2 jam**, status teknisi dalam bentuk kalimat, dan saran balasan.
- **Yang tidak pernah dijawab:** nama teknisi, nomor HP teknisi, koordinat atau jarak posisi teknisi.
- **Data basi:** kalau snapshot lebih lama dari 30 menit, API tidak memberi ETA dan meminta handoff ke dispatcher.

## Request

```
GET <URL web app Apps Script>?action=eta&key=<GX_DOTAI_KEY>&cid=<CID>
GET <URL web app Apps Script>?action=eta&key=<GX_DOTAI_KEY>&uid=<User ID>
GET <URL web app Apps Script>?action=eta&key=<GX_DOTAI_KEY>&wo=<nomor WO>
```

- URL web app sama dengan URL proxy yang sudah dipakai dashboard.
- Apps Script menjawab dengan redirect 302 ke `script.googleusercontent.com`. HTTP client DotAI **wajib follow redirect**.
- `key` adalah Script Property `GX_DOTAI_KEY`. Jangan pakai access key user dashboard.
- Pencarian tidak membedakan huruf besar dan kecil, dan harus sama persis (bukan sebagian).

## Response

```json
{
  "ok": true,
  "query": { "cid": "1001", "uid": null, "wo": null },
  "found": 1,
  "workOrders": [
    {
      "wo": "WWR-2026-012345",
      "cid": "1001",
      "uid": "GX12345",
      "type": "WWR",
      "typeName": "Wiredown",
      "branch": "Bali",
      "status": "scheduled",
      "statusText": "Terjadwal hari ini",
      "etaWindow": { "from": "13:00", "to": "15:00", "tz": "WITA" },
      "jobsAhead": 2,
      "technicianStatus": "Teknisi sedang menyelesaikan pekerjaan di lokasi pelanggan sebelumnya.",
      "updatedAt": "2026-11-10T11:05:12+08:00",
      "fresh": true,
      "handoff": false,
      "handoffReason": null,
      "reply": "Perkiraan teknisi tiba antara pukul 13:00–15:00 WITA untuk work order WWR-2026-012345. Teknisi sedang menyelesaikan pekerjaan di lokasi pelanggan sebelumnya. Perkiraan ini dapat berubah mengikuti kondisi di lapangan."
    }
  ],
  "reply": "Perkiraan teknisi tiba antara pukul 13:00–15:00 WITA ..."
}
```

Kalau pelanggan punya lebih dari satu WO hari ini (misalnya WWR dan WCM), `workOrders` berisi semuanya, diurutkan dari yang paling aktif. `reply` di level atas adalah balasan untuk WO pertama.

Error: `{ "ok": false, "error": "UNAUTHORIZED" }` (key salah) atau `{ "ok": false, "error": "Give cid, uid or wo." }`.

## Arti status

| status | Arti | etaWindow | handoff |
| --- | --- | --- | --- |
| scheduled | Terjadwal hari ini, teknisi belum berangkat ke pelanggan ini | Ada | Tidak |
| onway | Teknisi dalam perjalanan ke lokasi pelanggan | Ada | Tidak |
| onsite | Teknisi sudah check-in di lokasi pelanggan | Tidak | Tidak |
| done | Kunjungan hari ini sudah check-out | Tidak | Tidak |
| mass | Jadwal bergeser karena team menangani gangguan massal | Ada (sudah memperhitungkan gangguan) | Tidak |
| break | Team sedang istirahat | Ada | Tidak |
| late | ETA sudah lewat lebih dari 15 menit tanpa check-in | Tidak | **Ya** (late) |
| resched | Pelanggan meminta jadwal ulang | Tidak | **Ya** (reschedule) |
| next | Ditunda ke hari kerja berikutnya (H+1) | Tidak | Tidak |
| cancel | WO dibatalkan di IDS | Tidak | Tidak |

`handoffReason: "stale"` muncul untuk status apa pun (kecuali done, next, cancel) kalau `fresh` = false, yaitu tidak ada layar IDS yang mengirim snapshot dalam 30 menit terakhir.

## Aturan untuk DotAI

1. Identifikasi pelanggan seperti biasa, lalu panggil API dengan CID atau User ID.
2. `found` = 0: WO belum masuk jadwal teknisi hari ini. Tetap pakai aturan lama: jawab dengan empati tanpa jam, handoff ke dispatcher hanya kalau sudah lewat SLA 3×24 jam atau pelanggan meminta jam tertentu.
3. `handoff` = true: jangan memberi jam. Kirim `reply`, lalu teruskan chat ke dispatcher.
4. `handoff` = false: boleh kirim `reply` apa adanya, atau susun kalimat sendiri dari `etaWindow` dan `technicianStatus`.
5. Jangan menyebut jam pasti, nama teknisi, atau posisi teknisi. Jangan menjanjikan jam di luar `etaWindow`.
6. Kalau pelanggan meminta jam tertentu, tetap handoff ke dispatcher, apa pun isi API.

## Cara pasang (admin)

1. Buka project Apps Script proxy, ganti isi file **roles** dengan `apps-script/roles.gs` terbaru.
2. **Project Settings > Script Properties > Add property**: `GX_DOTAI_KEY` = teks acak panjang, misalnya 32 karakter. Simpan di tempat aman dan berikan hanya ke tim pengelola DotAI.
3. **Deploy > Manage deployments > Edit (pensil) > Version: New version > Deploy.** URL web app tidak berubah.
4. Upload `gxdispatch.js`, `gxdata.js`, `index.html` terbaru ke repo dan hosting dashboard.
5. Buka halaman IDS (atau arrivals TV) sekali, tunggu 1 menit, lalu tes di browser:
   `<URL web app>?action=eta&key=<GX_DOTAI_KEY>&cid=<CID yang ada di plan hari ini>`

## Batasan yang perlu diketahui

- Snapshot hanya terisi selama ada layar IDS yang terbuka. Arrivals TV yang menyala sepanjang jam kerja menjaga data tetap segar.
- ETA dihitung dari jam di komputer dispatcher. Zona waktu jawaban: Malang dan Jakarta WIB, cabang lain WITA.
- Rentang 2 jam dihitung dari jam ETA sampai ETA + 2 jam, dibulatkan ke atas per 5 menit, dan tidak pernah dimulai sebelum jam sekarang. Rentang ini sama dengan yang ditampilkan ke dispatcher di alert follow-up, jadi DotAI dan dispatcher menyampaikan jam yang sama ke pelanggan.
