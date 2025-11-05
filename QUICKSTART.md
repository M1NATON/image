# ⚡ Быстрый старт

## Локальная разработка

```bash
# 1. Установка
npm install

# 2. Настройка .env
cp .env.example .env
# Отредактируйте .env и добавьте токены

# 3. Запуск
npm start
```

## Production на VPS

### Docker (рекомендуется)

```bash
# 1. На VPS
git clone https://github.com/your-username/telegram-image-bot.git
cd telegram-image-bot

# 2. Настройка
cp .env.example .env
nano .env  # Добавьте токены

# 3. Запуск
docker-compose up -d

# 4. Проверка
docker-compose logs -f
curl http://localhost:3000/health
```

### PM2 (без Docker)

```bash
# 1. Установка
npm install
npm install -g pm2

# 2. Настройка
cp .env.example .env
nano .env

# 3. Запуск
pm2 start ecosystem.config.js
pm2 save

# 4. Проверка
pm2 logs
```

## Что добавлено для production:

✅ **Логирование** - Winston (logs/combined.log, logs/error.log)  
✅ **Retry** - автоповтор при сетевых ошибках  
✅ **Health check** - http://localhost:3000/health  
✅ **Graceful restart** - автоматический перезапуск при крашах  
✅ **Docker** - простой деплой одной командой  
✅ **PM2** - автозапуск и мониторинг  

## Файлы

- `src/index.ts` - базовая версия (для локальной разработки)
- `src/index-production.ts` - production версия (с логами, retry, health check)
- `src/logger.ts` - конфигурация логгера
- `Dockerfile` - образ Docker
- `docker-compose.yml` - оркестрация
- `ecosystem.config.js` - конфигурация PM2
- `DEPLOYMENT.md` - полная инструкция по деплою

## Команды

### Локально:
```bash
npm start              # Запуск (dev)
npm run start:prod     # Запуск (production версия)
npm run build          # Компиляция TypeScript
```

### Docker:
```bash
npm run docker:build   # Сборка образа
npm run docker:up      # Запуск
npm run docker:down    # Остановка
npm run docker:logs    # Логи
```

### PM2:
```bash
npm run pm2:start      # Запуск
npm run pm2:stop       # Остановка
npm run pm2:restart    # Перезапуск
npm run pm2:logs       # Логи
```

## Мониторинг

- **Health check:** http://your-vps:3000/health
- **Metrics:** http://your-vps:3000/metrics
- **Логи:** `./logs/combined.log` и `./logs/error.log`

Подробнее см. [DEPLOYMENT.md](DEPLOYMENT.md)
