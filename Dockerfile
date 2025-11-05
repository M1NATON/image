# Используем официальный Node.js образ
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package files
COPY package*.json ./
COPY tsconfig.json ./

# Устанавливаем зависимости
RUN npm ci --only=production && \
    npm install -g typescript ts-node

# Копируем исходный код
COPY src ./src

# Создаём директорию для логов
RUN mkdir -p logs

# Компилируем TypeScript
RUN npm run build

# Открываем порт для health check
EXPOSE 3000

# Переменные окружения (будут переопределены в docker-compose)
ENV NODE_ENV=production

# Запускаем бота
CMD ["node", "dist/index-production.js"]
