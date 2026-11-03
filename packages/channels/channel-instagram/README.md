# @sahabat-kreator/channel-instagram

**Status: placeholder terstruktur — belum ada implementasi.**

## Batas yang penting (jangan tertukar)

Ada DUA jalur Instagram yang berbeda secara teknis, dan paket ini hanya
memegang salah satunya:

| Jalur | Login | Host Graph | Pemilik kode |
|---|---|---|---|
| **Instagram Messaging via Facebook Login** (dipakai hari ini) | Facebook Login → Page Access Token | `graph.facebook.com` | **`@sahabat-kreator/channel-messenger`** |
| **Instagram API with Instagram Login** (rencana) | Instagram Login langsung | `graph.instagram.com` | paket ini |

Jalur pertama memakai Page + Send API yang **sama persis** dengan
Messenger (`POST /{account-id}/messages`), jadi seluruh implementasinya
— klien Graph, webhook, pengiriman DM, penemuan aset OAuth — hidup di
`channel-messenger` dan sengaja TIDAK diduplikasi di sini. Logika DB-nya
ada di `@sahabat-kreator/core` (`meta.ts`).

Karena itu, tidak menemukan kode Instagram di paket ini **bukan** berarti
fitur Instagram hilang: lihat `packages/channels/channel-messenger`.

## Rencana paket ini

Adapter mandiri untuk jalur Instagram Login langsung (host
`graph.instagram.com`, scope `instagram_business_*`), termasuk DM dan
comment-to-DM. Dibutuhkan bila kita ingin melayani akun IG yang tidak
terhubung ke Page Facebook — mis. kreator tanpa Page.

Lihat `docs/RANCANGAN-v3.md` §12.7.
