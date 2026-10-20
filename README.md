# Catur Multiplayer (Render + Node.js)

## Fitur
- 2 pemain per room dengan kode 5 karakter
- Papan responsif untuk HP dan desktop
- Validasi langkah catur di server menggunakan chess.js
- Giliran putih/hitam, skak, skakmat, remis, promosi pion
- Riwayat langkah, menyerah, mulai game baru
- WebSocket realtime

## Penting
Ini prototipe. Room disimpan di RAM, jadi room hilang jika server restart/tidur atau deploy ulang. Render Free dapat tidur setelah 15 menit tanpa trafik; saat dibuka lagi butuh waktu untuk aktif. Jangan mengandalkan ini untuk pertandingan yang harus selalu online.

## Deploy ke Render
1. Upload seluruh isi folder ini ke repository GitHub.
2. Buat layanan Render: Dashboard -> New -> Web Service -> pilih repository.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Pilih instance `Free`, lalu deploy.
6. Buka URL `https://NAMA-SERVICE.onrender.com`. Halaman harus muncul.
7. Salin URL tersebut. Di `public/index.html`, ganti:
   `const SERVER_URL = "wss://GANTI-DENGAN-NAMA-SERVICE.onrender.com/ws";`
   menjadi misalnya:
   `const SERVER_URL = "wss://nama-service-kamu.onrender.com/ws";`
8. Commit perubahan ke GitHub. Render akan deploy ulang. Buka ulang URL dan uji dengan dua browser/perangkat.

## Struktur
- `server.js`: HTTP server, WebSocket, room, validasi aturan catur
- `public/index.html`: UI dan client game
- `package.json`: dependensi dan perintah start

## Tes cepat
- Buka game di dua perangkat atau dua browser berbeda.
- Perangkat pertama klik Buat room.
- Bagikan kode 5 karakter.
- Perangkat kedua masukkan kode dan klik Gabung.
- Putih bergerak dulu.
