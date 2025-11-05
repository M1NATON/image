# Используем официальный Node.js образ
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package files
COPY package*.json ./
COPY tsconfig.json ./

# Устанавливаем ВСЕ зависимости (включая devDependencies для сборки)
RUN npm ci && \
    npm install -g typescript ts-node

# Копируем исходный код
COPY src ./src

# Создаём директорию для логов
RUN mkdir -p logs

# Компилируем TypeScript
RUN npm run build

# Удаляем dev-зависимости после сборки для уменьшения размера образа
RUN npm prune --omit=dev

# Открываем порт для health check
EXPOSE 3000

# Переменные окружения (будут переопределены в docker-compose)
ENV NODE_ENV=production

# Запускаем бота (измените на нужный файл)
CMD ["node", "dist/index.js"]
