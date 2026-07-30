# İkimizin Puzzle'ı 💕

İki kişinin görüntülü bağlanıp birlikte puzzle çözebildiği basit bir web uygulaması (MVP).

## Nasıl çalıştırılır (kendi bilgisayarında test)

1. [Node.js](https://nodejs.org) kurulu olmalı (v18+ önerilir).
2. Proje klasöründe:
   ```
   npm install
   node server.js
   ```
3. Tarayıcıda `http://localhost:3000` aç.
4. **İki farklı sekmede/tarayıcıda** aç (biri "Oda Kur", diğeri kodu girip "Katıl") — kendi bilgisayarında test etmek için yeterli.
5. Gerçekten iki farklı cihazdan (örneğin sen ve kız arkadaşın farklı telefonlardan) denemek için bu sunucuyu internete açık bir yere **deploy etmen** lazım (aşağıya bak), çünkü `localhost` sadece kendi bilgisayarında çalışır.

## 📱 Telefon kamerası görünmüyor mu?

Mobil tarayıcılar (Safari/Chrome) kamera erişimine sadece **https://** veya **localhost** üzerinden izin verir. Bilgisayarın IP'sine `http://192.168.x.x:3000` şeklinde telefondan bağlanınca tarayıcı kamerayı otomatik engeller — hata bile vermeyebilir, sessizce reddeder.

**Hızlı yerel çözüm (kendi ağında test için):**

1. Proje klasöründe kendine imzalı bir sertifika oluştur:
   ```bash
   openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
   ```
   Bu, `cert.pem` ve `key.pem` dosyalarını oluşturur.
2. Sunucuyu tekrar başlat: `node server.js`. Artık şunu göreceksin:
   ```
   HTTP:  http://localhost:3000
   HTTPS: https://localhost:3443  (use this from your phone)
   ```
3. Bilgisayarının yerel IP'sini bul (Mac'te: **Sistem Ayarları → Ağ**'da görünür, örn. `192.168.1.24`).
4. Telefondan `https://192.168.1.24:3443` adresine git. Tarayıcı "bu bağlantı güvenli değil" uyarısı verecek (sertifika kendin imzaladığın için normal) — **"Gelişmiş" → "Yine de devam et"** diyerek geç.
5. Kamera izni istendiğinde izin ver.

⚠️ Önemli: Eğer telefon kullanıyorsan **her iki taraf da** (bilgisayar + telefon) aynı `https://...3443` linkinden girsin, biri http diğeri https'den girerse bağlantı kopabilir.

## Nasıl yayına alınır (deploy)

Ücretsiz/basit seçenekler:
- **Render.com** → "New Web Service" → bu repoyu bağla → build: `npm install`, start: `node server.js`
- **Railway.app** → benzer şekilde, otomatik algılar
- **Fly.io** → `fly launch` ile

Not: WebRTC video için bazı ev/mobil ağlarda (özellikle karşılıklı NAT engelleri olduğunda) sadece STUN sunucusu (şu an Google'ın public STUN'u kullanılıyor) yeterli olmayabilir. Bağlantı kurulmazsa bir **TURN sunucusu** eklemek gerekir (örn. ücretsiz [Twilio TURN](https://www.twilio.com/docs/stun-turn) veya [Metered.ca](https://www.metered.ca/tools/openrelay/) açık TURN servisleri). `public/app.js` içindeki `iceServers` listesine eklenebilir.

## Proje yapısı

```
puzzle-app/
  server.js          → Express + Socket.io backend (oda, sinyalleşme, puzzle state)
  public/
    index.html        → Tüm ekranlar (giriş, bekleme, seçim, oyun, kazanma)
    style.css          → Görsel tasarım
    app.js             → WebRTC + sürükle-bırak + senkronizasyon mantığı
    images/            → Örnek puzzle görselleri (kendi fotoğraflarınla değiştirebilirsin)
```

## Şu an çalışan özellikler (MVP)

- 5 haneli oda kodu ile bağlanma
- WebRTC ile karşılıklı görüntülü konuşma (peer-to-peer)
- 3 hazır görsel + **kendi cihazından fotoğraf yükleme** + 3 zorluk seviyesi (5x5 kolay / 10x10 normal / 15x15 zor, büyük modlarda alanda gezinme/pan destekli)
- Parçalar gerçek bir jigsaw puzzle gibi çıkıntılı/girintili (tab/blank) kenarlara sahip — şeklinden hangi parçanın nereye gittiği sezilebiliyor
- Parçalar rastgele dağılır, sürükle-bırak ile taşınır
- Doğru yere yakın bırakılınca otomatik kilitlenir (snap); kilitli bir parça tekrar tutulup oynatılabilir ve yeniden yerine oturtulabilir
- Parça hareketleri sürüklerken **anlık** (gerçek zamanlı) senkronize olur
- Odaya ilk giren **mavi**, ikinci giren **kırmızı** oyuncu olur; kameraların çerçevesi bu renkte
- Bir oyuncu bir parçaya dokununca, o parça karşı tarafta da o oyuncunun renginde parlar — kim neyi oynatıyor anında görülür
- Süre sayacı + tamamlanınca kutlama ekranı

## Sıradaki geliştirme fikirleri

- Parça döndürme (daha zor mod)
- En iyi süre / skor tablosu
- Emoji tepkiler / basit sohbet
- Bağlantı koptuğunda kaldığı yerden devam
- TURN sunucusu ekleyerek her ağda çalışmasını garanti etme
