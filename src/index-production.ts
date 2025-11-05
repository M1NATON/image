import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import express from 'express';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import logger from './logger';

// Загрузка переменных окружения
dotenv.config();

// Создаём директорию для логов
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Проверка наличия необходимых переменных окружения
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PORT = parseInt(process.env.PORT || '3000');

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
  logger.error('❌ TELEGRAM_TOKEN и OPENROUTER_API_KEY должны быть установлены');
  process.exit(1);
}

// Настройка retry для axios
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
           error.response?.status === 429 || // Rate limit
           error.response?.status === 503;   // Service unavailable
  },
  onRetry: (retryCount, error) => {
    logger.warn(`Retry attempt ${retryCount} for ${error.config?.url}`, {
      error: error.message,
      status: error.response?.status
    });
  }
});

logger.info('🚀 Starting Telegram Image Editor Bot');
if (GOOGLE_API_KEY) {
  logger.info('✅ BYOK активирован', {
    keyPrefix: GOOGLE_API_KEY.substring(0, 10),
    keySuffix: GOOGLE_API_KEY.slice(-4)
  });
}

// Инициализация бота
const bot = new TelegramBot(TELEGRAM_TOKEN, { 
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// Health check сервер
const app = express();
let isHealthy = true;
let lastActivity = Date.now();
let stats = {
  startTime: Date.now(),
  requestsProcessed: 0,
  errorsCount: 0,
  lastError: null as string | null
};

app.get('/health', (req, res) => {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  const timeSinceLastActivity = Math.floor((Date.now() - lastActivity) / 1000);
  
  if (!isHealthy || timeSinceLastActivity > 300) { // 5 минут без активности
    return res.status(503).json({
      status: 'unhealthy',
      uptime,
      timeSinceLastActivity,
      stats
    });
  }
  
  res.json({
    status: 'healthy',
    uptime,
    timeSinceLastActivity,
    stats
  });
});

app.get('/metrics', (req, res) => {
  res.json(stats);
});

app.listen(PORT, () => {
  logger.info(`Health check server listening on port ${PORT}`);
});

// Константы
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_MODEL = 'google/gemini-2.5-flash-image';
const SUPPORTED_FORMATS = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

interface UserContext {
  imageBase64: string;
  mimeType: string;
  fileName: string;
}

const userContexts = new Map<number, UserContext>();

function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes: { [key: string]: string } = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  return mimeTypes[ext] || 'image/jpeg';
}

async function downloadAndConvertToBase64(fileId: string): Promise<{ base64: string; mimeType: string; fileName: string }> {
  try {
    const file = await bot.getFile(fileId);
    const filePath = file.file_path;
    
    if (!filePath) {
      throw new Error('Не удалось получить путь к файлу');
    }

    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
    const response = await axios.get(fileUrl, { 
      responseType: 'arraybuffer',
      timeout: 30000 // 30 секунд
    });
    
    const base64 = Buffer.from(response.data).toString('base64');
    const fileName = path.basename(filePath);
    const mimeType = getMimeType(fileName);

    logger.info('Image downloaded', { fileName, size: base64.length });
    return { base64, mimeType, fileName };
  } catch (error: any) {
    logger.error('Error downloading file', { error: error.message, fileId });
    throw new Error(`Ошибка при скачивании файла: ${error.message}`);
  }
}

async function editImageWithAI(imageBase64: string, mimeType: string, prompt: string): Promise<{ buffer: Buffer; mediaType: string }> {
  try {
    logger.info('Sending request to OpenRouter', { 
      model: GEMINI_MODEL,
      promptLength: prompt.length,
      imageSize: imageBase64.length
    });

    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model: GEMINI_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://github.com/your-username/telegram-image-bot',
          'X-Title': 'Telegram Image Bot',
          'Content-Type': 'application/json',
          ...(GOOGLE_API_KEY ? { 'X-Google-API-Key': GOOGLE_API_KEY } : {}),
        },
        timeout: 120000 // 2 минуты
      }
    );

    logger.info('OpenRouter API response', {
      model: response.data.model,
      usage: response.data.usage,
      hasImages: !!response.data.choices?.[0]?.message?.images
    });

    const message = response.data.choices?.[0]?.message;
    const images = message?.images;
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      logger.error('No images in API response', { response: JSON.stringify(response.data).substring(0, 500) });
      throw new Error('Изображение не найдено в ответе API');
    }

    const imageData = images[0];
    const imageUrl = imageData?.image_url?.url;

    if (!imageUrl || !imageUrl.startsWith('data:')) {
      throw new Error('Некорректный формат изображения в ответе');
    }

    const base64Match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) {
      throw new Error('Не удалось извлечь base64 из data URL');
    }

    const mediaType = base64Match[1];
    const base64Data = base64Match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    logger.info('Image processed successfully', { 
      bufferSize: buffer.length,
      mediaType 
    });

    return { buffer, mediaType };
  } catch (error: any) {
    stats.errorsCount++;
    stats.lastError = error.message;
    
    logger.error('Error in editImageWithAI', {
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.error?.message || error.message;

      switch (status) {
        case 429:
          throw new Error('⚠️ Превышен лимит запросов. Попробуйте позже.');
        case 402:
          throw new Error('💳 Недостаточно средств на балансе OpenRouter.');
        case 401:
          throw new Error('🔑 Неверный API ключ OpenRouter.');
        default:
          throw new Error(`❌ Ошибка API: ${message}`);
      }
    }
    throw error;
  }
}

// Обработчики команд
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  lastActivity = Date.now();
  
  logger.info('Command /start', { userId: msg.from?.id, chatId });
  
  const welcomeMessage = `
🖼️ **Добро пожаловать в Image Editor Bot!**

Этот бот редактирует изображения с помощью AI (Gemini 2.5 Flash).

📝 **Как использовать:**
1. Отправьте изображение **как документ** (не фото!)
2. Напишите, что нужно изменить
3. Получите отредактированное изображение

💡 **Примеры запросов:**
• "Измени дату на 28.10.2025"
• "Убери водяной знак"
• "Сделай фон белым"
• "Добавь текст 'Hello World'"
`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📝 Примеры', callback_data: 'examples' },
        { text: '❓ Помощь', callback_data: 'help' }
      ]
    ]
  };

  await bot.sendMessage(chatId, welcomeMessage, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
});

bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  lastActivity = Date.now();

  if (!userId) return;

  logger.info('Command /cancel', { userId, chatId });

  if (userContexts.has(userId)) {
    userContexts.delete(userId);
    await bot.sendMessage(chatId, '❌ Операция отменена. Отправьте новое изображение для редактирования.');
  } else {
    await bot.sendMessage(chatId, 'ℹ️ Нет активных операций.');
  }
});

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const document = msg.document;
  lastActivity = Date.now();

  if (!userId || !document) return;

  logger.info('Document received', { 
    userId, 
    chatId, 
    fileName: document.file_name,
    fileSize: document.file_size,
    mimeType: document.mime_type
  });

  try {
    if (!document.mime_type || !SUPPORTED_FORMATS.includes(document.mime_type)) {
      await bot.sendMessage(chatId, '❌ Неподдерживаемый формат файла. Поддерживаются: JPG, PNG, WEBP');
      return;
    }

    if (document.file_size && document.file_size > MAX_FILE_SIZE) {
      await bot.sendMessage(chatId, `❌ Файл слишком большой. Максимальный размер: 20MB`);
      return;
    }

    await bot.sendMessage(chatId, '⏳ Загружаю изображение...');

    const { base64, mimeType, fileName } = await downloadAndConvertToBase64(document.file_id);

    userContexts.set(userId, {
      imageBase64: base64,
      mimeType,
      fileName,
    });

    const keyboard = {
      inline_keyboard: [
        [{ text: '📝 Примеры', callback_data: 'examples' }]
      ]
    };

    await bot.sendMessage(
      chatId,
      '✅ Изображение получено! Теперь напишите, что нужно изменить.\n\n💡 Например: "Измени дату на 28.10.2025"',
      { reply_markup: keyboard }
    );
  } catch (error: any) {
    logger.error('Error processing document', { error: error.message, userId, chatId });
    await bot.sendMessage(chatId, `❌ Ошибка при обработке файла: ${error.message}`);
  }
});

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  lastActivity = Date.now();
  
  await bot.sendMessage(
    chatId,
    '⚠️ **Внимание!** Telegram сжимает фотографии.\n\n' +
    '📎 Пожалуйста, отправьте изображение **как документ**:\n' +
    '1. Нажмите на скрепку 📎\n' +
    '2. Выберите "Файл"\n' +
    '3. Найдите и отправьте изображение',
    { parse_mode: 'Markdown' }
  );
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text;
  lastActivity = Date.now();

  if (!userId || !text || text.startsWith('/')) return;

  const context = userContexts.get(userId);

  if (!context) {
    await bot.sendMessage(
      chatId,
      'ℹ️ Сначала отправьте изображение как документ, затем напишите, что нужно изменить.\n\n' +
      'Используйте /start для просмотра инструкций.'
    );
    return;
  }

  let processingMessage;

  try {
    logger.info('Processing image edit request', { userId, chatId, prompt: text });
    
    processingMessage = await bot.sendMessage(chatId, '⏳ Обрабатываю изображение...');

    const { buffer: imageBuffer, mediaType } = await editImageWithAI(context.imageBase64, context.mimeType, text);

    await bot.deleteMessage(chatId, processingMessage.message_id);

    const ext = mediaType.split('/')[1] || 'png';

    const resultKeyboard = {
      inline_keyboard: [
        [
          { text: '🔄 Редактировать ещё', callback_data: 'edit_more' },
          { text: '🏠 Главная', callback_data: 'main_menu' }
        ]
      ]
    };

    await bot.sendDocument(chatId, imageBuffer, {
      caption: `✅ Готово!`,
      reply_markup: resultKeyboard
    }, {
      filename: `edited_${path.basename(context.fileName, path.extname(context.fileName))}.${ext}`,
      contentType: mediaType,
    });

    stats.requestsProcessed++;
    userContexts.delete(userId);
    
    logger.info('Image processed successfully', { userId, chatId });
  } catch (error: any) {
    logger.error('Error processing message', { error: error.message, userId, chatId });

    if (processingMessage) {
      try {
        await bot.deleteMessage(chatId, processingMessage.message_id);
      } catch (e) {}
    }

    await bot.sendMessage(chatId, `❌ ${error.message}\n\nПопробуйте ещё раз или используйте /cancel для отмены.`);
  }
});

// Callback кнопки
bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat.id;
  const data = query.data;
  lastActivity = Date.now();

  if (!chatId) return;

  try {
    await bot.answerCallbackQuery(query.id);

    switch (data) {
      case 'examples':
        await bot.sendMessage(chatId, 
          `💡 **Примеры запросов:**\n\n` +
          `• "Измени дату на 28.10.2025"\n` +
          `• "Убери водяной знак"\n` +
          `• "Сделай фон белым"\n` +
          `• "Добавь текст 'Hello World'"\n` +
          `• "Увеличь яркость"\n` +
          `• "Сделай чёрно-белым"`,
          { parse_mode: 'Markdown' }
        );
        break;

      case 'help':
        await bot.sendMessage(chatId,
          `❓ **Помощь**\n\n` +
          `📍 **Важно:**\n` +
          `• Отправляйте изображения только как документ!\n` +
          `• Форматы: JPG, PNG, WEBP\n` +
          `• Максимальный размер: 20MB\n\n` +
          `🔧 **Команды:**\n` +
          `/start - Главное меню\n` +
          `/cancel - Отмена операции`,
          { parse_mode: 'Markdown' }
        );
        break;

      case 'edit_more':
        await bot.sendMessage(chatId, '📎 Отправьте новое изображение как документ.');
        break;

      case 'main_menu':
        bot.emit('message', { ...query.message, text: '/start' } as any);
        break;
    }
  } catch (error: any) {
    logger.error('Error handling callback', { error: error.message, data });
  }
});

// Обработка ошибок
bot.on('polling_error', (error) => {
  logger.error('Polling error', { error: error.message });
  isHealthy = false;
  
  // Пытаемся переподключиться через 5 секунд
  setTimeout(() => {
    logger.info('Attempting to reconnect...');
    isHealthy = true;
  }, 5000);
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down gracefully...');
  isHealthy = false;
  
  try {
    await bot.stopPolling();
    logger.info('Bot polling stopped');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Обработка необработанных ошибок
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  shutdown();
});

logger.info('🤖 Telegram Image Editor Bot started successfully!');
