# game-botwhatsapp — Catur & Ludo Multiplayer

Project Node.js untuk deployment di Abasthan/host Node.js, dengan room multiplayer via WebSocket dan taruhan berbentuk **poin virtual** dari balance Wibusoft.

## Isi
- `public/catur.html` — catur 1 lawan 1, room code, reconnect.
- `public/ludo.html` — Ludo multiplayer 2–4 pemain.
- `server.js` — validasi langkah catur, dadu/bidak Ludo, room, API taruhan.
- `wibusoft/` — kode Custom Script yang ditempel di dashboard Wibusoft. Command `catur` dan `ludo` masing-masing menangani buat room dan join berdasarkan argumen.

## Deploy server
1. Upload seluruh folder/repository ke host Node.js.
2. Build/install command: `npm install`
3. Start command: `npm start`
4. Atur environment variable `GAME_API_KEY` dengan string acak panjang, misalnya hasil generator password. Jangan taruh key ini di HTML.
5. Pastikan URL server publik menggunakan HTTPS dan WebSocket (WSS).
6. Cek `https://DOMAIN-KAMU/health`; harus mengembalikan `ok: true`.
7. Ganti konstanta `BASE` di seluruh file `wibusoft/*.js` dengan domain publik server kamu. Saat ini default-nya domain Abasthan lama.

**Penting:** jika domain server berubah, update `BASE` pada keenam script Wibusoft. `GAME_API_KEY` di environment server harus sama persis dengan Secret `GAME_API_KEY` yang diatur pada tiap Custom Script Wibusoft.

## Pasang Custom Script Wibusoft
Buat script terpisah di dashboard, lalu salin kode dari file yang sesuai. Set Secret/Env `GAME_API_KEY` untuk setiap script.

| Nama script | Contoh command | Kegunaan |
|---|---|---|
| `catur` | `.catur 100` atau `.catur ABCDE` | Satu command untuk membuat room atau bergabung ke room catur |
| `ludo` | `.ludo 100` atau `.ludo ABCDE` | Satu command untuk membuat room atau bergabung ke room Ludo |
| `claimgame` | `.claimgame ABCDE` | Pemenang klaim total pot |
| `refundgame` | `.refundgame ABCDE` | Refund stake setelah hasil seri |

Nama command ditentukan dari kolom `name` di dashboard. Gunakan balance Wibusoft yang ada; tidak ada database saldo terpisah.

## Alur taruhan
1. Pembuat room mengetik `.catur 100` atau `.ludo 100`.
2. Script membaca balance Wibusoft, memotong stake, lalu meminta server membuat room. Jika server mengembalikan error terkonfirmasi, script mengembalikan saldo. Jika timeout/putus koneksi, script tidak mengembalikan saldo otomatis karena server mungkin sudah memproses room; owner perlu rekonsiliasi.
3. Pemain lawan mengetik `.catur KODE` atau `.ludo KODE`. Script memeriksa jenis dan kapasitas room, memotong stake yang sama, lalu mendaftarkan JID pemain.
4. Setelah bergabung, pemain membuka link yang dikirim bot dan memasukkan nama. Link game membawa token pemain yang terdaftar.
5. Server menetapkan pemenang dari status permainan. Pemenang mengetik `.claimgame KODE`. Hadiah = stake × jumlah pemain yang berhasil masuk room.
6. Jika catur berakhir seri, setiap pemain terdaftar dapat memakai `.refundgame KODE` satu kali.

## Catatan keamanan dan keterbatasan versi ini
- Pakai hanya poin virtual, bukan uang/deposit/penarikan uang nyata.
- Room dan riwayat taruhan masih disimpan di memori; restart/redeploy dapat menghapus room. Untuk produksi, migrasikan room dan ledger ke database persisten.
- Pembaruan balance Wibusoft dan status hadiah server bukan satu transaksi database atomik. Jika koneksi gagal tepat ketika klaim/pemotongan berjalan, jangan spam command; owner perlu mengecek dan merekonsiliasi balance.
- API terlindungi `GAME_API_KEY`, tetapi jangan pernah mengekspos key di HTML atau mengirimkannya ke browser.
- Ludo adalah implementasi sederhana: aturan dasar roll, keluar rumah dengan 6, tabrak, dan finish; belum mencakup semua variasi aturan Ludo resmi.
- Room taruhan Ludo sebaiknya berisi 2–4 pemain. Game mengakhiri ronde saat seorang pemain menyelesaikan empat bidak.
- UI meminta pemain memasukkan nama; identitas taruhan tetap berasal dari JID yang didaftarkan melalui Custom Script Wibusoft, bukan nama yang diketik di halaman.
