# Backend API Reference

Base URL: `http://localhost:3001`

Authenticated endpoint'ler `Authorization: Bearer <JWT>` header'ı bekler.

---

## Auth

Dynamic.xyz login sonrası otomatik SIWE + JWT oluşturur. Backend bu JWT'yi Dynamic API ile verify eder.

### POST /auth/verify

Dynamic JWT'yi doğrular, backend JWT'si döner.

```
Request:  { "dynamicToken": "eyJhbG..." }
Response: { "token": "eyJhbG...", "user": { "id": "uuid", "walletAddress": "0x5ba5..." } }
```

### Auth Flow

```
1. Kullanıcı Dynamic SDK ile giriş yapar      → authToken (Dynamic JWT)
2. POST /auth/verify { dynamicToken }          → { token, user }
3. token'ı sakla, sonraki isteklerde header'a ekle
```

- `dynamicToken`: Dynamic SDK'dan gelen JWT (`authToken`)
- `token`: Backend'in kendi JWT'si — diğer endpoint'lerde `Authorization: Bearer <token>` olarak kullan

---

## Matchmaking

### POST /match/queue/join `Auth`

```
Request:  { "characterId": "warrior-1" }
Response: { "position": 1, "entryFee": "1000000" }
```

- Entry fee sabit 1 USDC. Backend response'ta döner.

### POST /match/queue/leave `Auth`

```
Response: { "success": true }
```

---

## Drawing

### POST /match/draw/submit `Auth`

```
Request: {
  "matchId": "0xabc...",
  "pathData": [
    { "timestamp": 1775250794, "price": 66745.11 },
    { "timestamp": 1775250795, "price": 66741.93 },
    { "timestamp": 1775250796, "price": 66740.34 }
  ]
}
Response: { "success": true }
```

- `timestamp`: Unix timestamp (saniye). price_tick ile aynı format.
- `price`: Tahmin edilen BTC/USD fiyatı
- Çizim, oyun süresinin en az **%90'ını** kapsamalı (54/60 saniye). Aksi halde geçersiz sayılır ve rakip kazanır.

---

## User

### GET /user/profile `Auth`

```
Response: {
  "user": { "id": "uuid", "walletAddress": "0x...", "username": null, "characterId": null },
  "stats": { "wins": 3, "losses": 1, "draws": 0, "totalGames": 4 }
}
```

### PUT /user/profile `Auth`

Username ve/veya karakter günceller. İkisi birlikte veya tek tek gönderilebilir.

```
Request:  { "username": "satoshi", "characterId": "warrior-1" }
Response: {
  "user": { "id": "uuid", "walletAddress": "0x...", "username": "satoshi", "characterId": "warrior-1" }
}
```

---

## SSE (Server-Sent Events)

### GET /sse/connect?token=JWT

Bağlantı açıldıktan sonra backend aşağıdaki event'leri push eder:

| Event | Data | Ne Zaman |
|-------|------|----------|
| `match_created` | `{ matchId, opponent, entryFee }` | İki oyuncu eşleşti, on-chain match oluşturuldu |
| `player_entered` | `{ matchId, player }` | Bir oyuncu USDC deposit etti (enterMatch tx) |
| `match_locked` | `{ matchId }` | İki oyuncu da deposit etti |
| `game_starting` | `{ matchId, startPrice, duration }` | Oyun başlıyor, çizim süresi başladı |
| `price_tick` | `{ matchId, report }` | Gerçek zamanlı BTC/USD (Chainlink V3 schema, her ~1s) |
| `drawing_submitted` | `{ matchId, player }` | Bir oyuncu çizimini gönderdi |
| `calculating` | `{ matchId }` | Çizim süresi bitti, skor hesaplanıyor |
| `result` | `{ matchId, winner, player1Score, player2Score, payout, startPrice, endPrice }` | Kazanan belli, USDC transfer edildi |
| `result` (draw) | `{ matchId, winner: null, isDraw: true }` | Berabere, ikisine de refund |
| `match_cancelled` | `{ matchId, reason }` | Maç iptal, refund yapıldı |

---

## On-Chain (Frontend'in İmzalatması Gereken TX'ler)

Backend matchmaking ve settlement yapar. Frontend'in sorumluluğu sadece iki tx:

### 1. USDC Approve

`match_created` SSE event'i geldiğinde:

```
Contract: 0x3600000000000000000000000000000000000000 (USDC)
Function: approve(spender, amount)
Args:     spender = 0xb86a5423a4e0c2709491d51de51de655b94f2572 (Escrow)
          amount  = entryFee (match_created event'inden gelen)
```

### 2. Enter Match

Approve tx confirm olduktan sonra:

```
Contract: 0xb86a5423a4e0c2709491d51de51de655b94f2572 (Escrow)
Function: enterMatch(matchId)
Args:     matchId = bytes32 (match_created event'inden gelen)
```

Bu iki tx'den sonra backend her şeyi handle eder.

---

## Oyun Akışı Özeti

```
Frontend                          Backend                         Chain
────────                          ───────                         ─────
POST /match/queue/join ────────→  Redis queue'ya ekle
                                  2 oyuncu eşleşti ──────────→   createMatch tx
                      ←──── SSE: match_created
USDC approve tx ──────────────────────────────────────────────→  approve()
enterMatch tx ────────────────────────────────────────────────→  enterMatch()
                      ←──── SSE: player_entered
                      ←──── SSE: match_locked (iki deposit tamam)
                      ←──── SSE: game_starting { startPrice, duration: 60 }
                      ←──── SSE: price_tick (her ~1s)
POST /match/draw/submit ──────→  Çizimi DB'ye kaydet
                      ←──── SSE: drawing_submitted
                      ←──── SSE: calculating (60s doldu)
                                  CRE/fallback settle ───────→  settleMatch tx
                      ←──── SSE: result { winner, scores, payout }
```

---

## Kontrat Bilgileri

| | |
|-|-|
| **Chain** | Arc Testnet (ID: 5042002) |
| **RPC** | `https://rpc.testnet.arc.network` |
| **USDC** | `0x3600000000000000000000000000000000000000` (6 decimals) |
| **Escrow** | `0xb86a5423a4e0c2709491d51de51de655b94f2572` |
| **Explorer** | `https://testnet.arcscan.app` |
| **Faucet** | `https://faucet.circle.com` (Arc Testnet seç) |

---

## Price Report Schema (Chainlink Data Streams V3)

`price_tick` SSE event'inde gelen `report` objesi:

```json
{
  "feedID": "0x00039d9e45394f473ab1f050a1b963e6b05351e52d71e507509ada0c95ed75b8",
  "validFromTimestamp": 1775250794,
  "observationsTimestamp": 1775250794,
  "price": "66745112455374850000000",
  "bid": "66740341634272120000000",
  "ask": "66750000000000000000000"
}
```

- `price`, `bid`, `ask`: int192 string, 18 decimals. Gerçek fiyat = `Number(price) / 1e18`
- `observationsTimestamp`: Unix seconds
- Şu an Binance'ten üretiliyor, Chainlink erişimi gelince aynı schema ile geçiş yapılacak

---

## Error Format

Tüm hata response'ları:

```json
{ "error": "hata mesajı" }
```

HTTP status code'ları:
- `400` — validation hatası
- `401` — token yok/geçersiz
- `403` — yetkisiz (CRE endpoint)
- `500` — sunucu hatası
