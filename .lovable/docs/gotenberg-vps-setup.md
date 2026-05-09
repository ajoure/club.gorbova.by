# Развёртывание Gotenberg на VPS hoster.by

VPS: `178.172.173.1` (1 CPU / 1 GB RAM / 10 GB SSD).
Цель: HTTPS endpoint `https://pdf.gorbova.by` для DOCX → PDF, защищённый Basic Auth.

## 1. DNS

В админке hoster.by (или через `hosterby_dns` UI в этом проекте) создать A-запись:

```
pdf.gorbova.by  A  178.172.173.1  TTL 300
```

Дождаться распространения (`dig pdf.gorbova.by +short` → `178.172.173.1`).

## 2. Docker + Gotenberg

На VPS под root:

```bash
# Docker (если не установлен)
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Gotenberg слушает только loopback
docker run -d --restart=always --name gotenberg \
  -p 127.0.0.1:3000:3000 \
  gotenberg/gotenberg:8 \
  gotenberg --api-timeout=120s
```

Проверка локально на VPS:

```bash
curl -sI http://127.0.0.1:3000/health
# HTTP/1.1 200 OK
```

## 3. Reverse proxy (Caddy) с HTTPS + Basic Auth

```bash
apt install -y caddy
caddy hash-password   # сгенерирует $2a$14$... для пароля
```

`/etc/caddy/Caddyfile`:

```
pdf.gorbova.by {
    encode gzip

    basicauth {
        gotenberg <PASTE_BCRYPT_HASH_HERE>
    }

    reverse_proxy 127.0.0.1:3000 {
        transport http {
            response_header_timeout 120s
        }
    }
}
```

```bash
systemctl reload caddy
```

Caddy сам выпустит TLS через Let's Encrypt.

Проверка снаружи:

```bash
# 401 без auth
curl -sI https://pdf.gorbova.by/health
# 200 с auth
curl -sI -u gotenberg:PASSWORD https://pdf.gorbova.by/health
```

## 4. Подключение в Lovable

1. `/admin/integrations/other` → карточка **Gotenberg (DOCX → PDF)** → **Настроить**.
2. Указать:
   - URL: `https://pdf.gorbova.by`
   - Basic Auth — пользователь: `gotenberg`
   - Basic Auth — пароль: тот, что хешировали в шаге 3
   - Включён: ✅
3. **Health-check** → должен показать `HTTP 200`.
4. **Test DOCX→PDF** → должен показать `pdf_size > 10240`.

Только после двух зелёных проверок — переходим к шагам 5–8 плана C5-J (интеграция в `canonical-document-generate-strict`).

## 5. Защита

- Не открывать порт 3000 наружу (`-p 127.0.0.1:3000:3000` уже это делает).
- Только Basic Auth через Caddy.
- Опционально: ufw allow только 80/443/22.

## 6. Лимиты ресурсов

LibreOffice внутри Gotenberg на 1 GB RAM может тормозить на больших DOCX. Если в `Test DOCX→PDF` стабильно зелёный, текущей конфигурации достаточно. Если начнут падать с OOM — увеличить VPS до 2 GB.
