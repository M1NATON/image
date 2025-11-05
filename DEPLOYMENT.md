# 🚀 Деплой на VPS

Подробная инструкция по запуску бота на production сервере.

## 📋 Требования

- Ubuntu/Debian VPS (минимум 1GB RAM)
- Docker и Docker Compose (рекомендуется)
- ИЛИ Node.js 20+ и PM2
- Открытый порт 3000 для health check

## 🐳 Вариант 1: Docker (Рекомендуется)

### 1. Подключитесь к VPS

```bash
ssh user@your-vps-ip
```

### 2. Установите Docker

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Установка Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Перезайдите для применения прав
exit
ssh user@your-vps-ip
```

### 3. Клонируйте проект

```bash
git clone https://github.com/your-username/telegram-image-bot.git
cd telegram-image-bot
```

### 4. Настройте .env

```bash
cp .env.example .env
nano .env
```

Заполните:
```env
TELEGRAM_TOKEN=your_telegram_token
OPENROUTER_API_KEY=your_openrouter_key
GOOGLE_API_KEY=your_google_key  # Опционально
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
```

### 5. Запустите бота

```bash
# Сборка и запуск
docker-compose up -d

# Проверка логов
docker-compose logs -f

# Проверка статуса
docker-compose ps
```

### 6. Проверка здоровья

```bash
curl http://localhost:3000/health
curl http://localhost:3000/metrics
```

### Управление

```bash
# Остановить
docker-compose down

# Перезапустить
docker-compose restart

# Обновить
git pull
docker-compose up -d --build

# Логи
docker-compose logs -f telegram-bot
```

---

## 🔧 Вариант 2: PM2 (Без Docker)

### 1. Установите Node.js

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Проверка
node --version  # v20.x
npm --version
```

### 2. Установите PM2

```bash
sudo npm install -g pm2 typescript ts-node
```

### 3. Клонируйте и настройте

```bash
git clone https://github.com/your-username/telegram-image-bot.git
cd telegram-image-bot

# Установка зависимостей
npm install

# Настройка .env
cp .env.example .env
nano .env
```

### 4. Запуск через PM2

```bash
# Запуск
pm2 start ecosystem.config.js

# Автозапуск при перезагрузке
pm2 startup
pm2 save

# Проверка
pm2 status
pm2 logs telegram-image-bot
```

### Управление

```bash
# Остановить
pm2 stop telegram-image-bot

# Перезапустить
pm2 restart telegram-image-bot

# Обновить
git pull
npm install
pm2 restart telegram-image-bot

# Логи
pm2 logs telegram-image-bot
pm2 logs telegram-image-bot --lines 100
```

---

## 📊 Мониторинг

### Health Check

Проверка доступна по адресу: `http://your-vps-ip:3000/health`

Ответ:
```json
{
  "status": "healthy",
  "uptime": 3600,
  "timeSinceLastActivity": 120,
  "stats": {
    "startTime": 1234567890,
    "requestsProcessed": 150,
    "errorsCount": 2,
    "lastError": null
  }
}
```

### Metrics

Статистика: `http://your-vps-ip:3000/metrics`

### Логи

**Docker:**
```bash
# Все логи
docker-compose logs -f

# Последние 100 строк
docker-compose logs --tail=100

# Логи на диске
ls -lh logs/
tail -f logs/combined.log
tail -f logs/error.log
```

**PM2:**
```bash
pm2 logs telegram-image-bot
pm2 logs telegram-image-bot --lines 100
pm2 logs telegram-image-bot --err  # Только ошибки

# Логи на диске
tail -f logs/combined.log
tail -f logs/error.log
```

---

## 🔒 Безопасность

### 1. Firewall (UFW)

```bash
# Включить firewall
sudo ufw enable

# Разрешить SSH
sudo ufw allow 22/tcp

# Разрешить health check (опционально)
sudo ufw allow 3000/tcp

# Проверка
sudo ufw status
```

### 2. Обновления

```bash
# Системные обновления
sudo apt update && sudo apt upgrade -y

# Обновление проекта
cd telegram-image-bot
git pull
```

### 3. Бэкапы логов

```bash
# Создать cron job для архивации логов
crontab -e

# Добавить строку (архивация каждую неделю)
0 0 * * 0 tar -czf ~/backups/logs-$(date +\%Y\%m\%d).tar.gz ~/telegram-image-bot/logs/
```

---

## 🐛 Troubleshooting

### Бот не запускается

```bash
# Проверить логи
docker-compose logs telegram-bot
# или
pm2 logs telegram-image-bot

# Проверить .env
cat .env | grep -v "^#"

# Проверить порты
netstat -tulpn | grep 3000
```

### Polling error

Если видите ошибки `getaddrinfo ENOTFOUND api.telegram.org`:

1. **Telegram заблокирован** - используйте VPN/proxy
2. **DNS проблемы** - измените DNS на Google:

```bash
# Временно
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf

# Постоянно (Ubuntu 18+)
sudo nano /etc/systemd/resolved.conf
# Добавить: DNS=8.8.8.8 1.1.1.1
sudo systemctl restart systemd-resolved
```

### Высокое потребление памяти

```bash
# Проверка использования
docker stats
# или
pm2 monit

# Перезапуск
docker-compose restart
# или
pm2 restart telegram-image-bot
```

### Бот не отвечает

```bash
# Проверка health
curl http://localhost:3000/health

# Если unhealthy - перезапуск
docker-compose restart
```

---

## 🔄 Обновление

### Docker

```bash
cd telegram-image-bot
git pull
docker-compose down
docker-compose up -d --build
```

### PM2

```bash
cd telegram-image-bot
git pull
npm install
pm2 restart telegram-image-bot
```

---

## 📈 Оптимизация

### 1. Ограничить размер логов

Docker уже настроен (10MB × 3 файла).

Для PM2 добавьте в `ecosystem.config.js`:
```javascript
max_size: '10M',
retain: '3'
```

### 2. Настроить логротate

```bash
sudo nano /etc/logrotate.d/telegram-bot
```

```
/home/user/telegram-image-bot/logs/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    create 0644 user user
}
```

### 3. Мониторинг с Uptime Robot

Добавьте health check URL в [Uptime Robot](https://uptimerobot.com/):
- URL: `http://your-vps-ip:3000/health`
- Interval: 5 минут

---

## ✅ Проверочный список

- [ ] Docker установлен и работает
- [ ] .env файл настроен
- [ ] Бот запущен (`docker-compose ps` показывает Up)
- [ ] Health check отвечает 200 OK
- [ ] Логи не показывают ошибок
- [ ] Бот отвечает в Telegram
- [ ] Firewall настроен
- [ ] PM2/Docker автозапуск настроен
- [ ] Мониторинг настроен

---

**Готово! Ваш бот работает в production! 🎉**

Для помощи создайте issue на GitHub или проверьте логи.
