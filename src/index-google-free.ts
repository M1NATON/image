// Альтернативная версия бота с бесплатным Google AI Studio API
// Получить API ключ: https://aistudio.google.com/apikey
// Лимит: 60 запросов/минуту БЕСПЛАТНО

import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // Вместо OPENROUTER_API_KEY

if (!TELEGRAM_TOKEN || !GOOGLE_API_KEY) {
  console.error('❌ Ошибка: TELEGRAM_TOKEN и GOOGLE_API_KEY должны быть установлены в .env файле');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const GOOGLE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GOOGLE_API_KEY}`;
const SUPPORTED_FORMATS = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

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
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    
    const base64 = Buffer.from(response.data).toString('base64');
    const fileName = path.basename(filePath);
    const mimeType = getMimeType(fileName);

    return { base64, mimeType, fileName };
  } catch (error) {
    throw new Error(`Ошибка при скачивании файла: ${error}`);
  }
}

async function processImageWithGemini(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
  try {
    const response = await axios.post(
      GOOGLE_API_URL,
      {
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64
              }
            },
            {
              text: prompt
            }
          ]
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('📡 Ответ от Google AI:', {
      hasResponse: !!response.data.candidates?.[0]?.content?.parts?.[0]?.text
    });

    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      throw new Error('Пустой ответ от Google AI');
    }

    return text;
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.error?.message || error.message;

      switch (status) {
        case 429:
          throw new Error('⚠️ Превышен лимит запросов (60/минуту)');
        case 403:
          throw new Error('🔑 Неверный API ключ Google. Получите на https://aistudio.google.com/apikey');
        default:
          throw new Error(`❌ Ошибка API: ${message}`);
      }
    }
    throw error;
  }
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
🖼️ **Image Analysis Bot (FREE Google AI)**

🆓 **100% БЕСПЛАТНО** - использует Google AI Studio API
📊 Лимит: 60 запросов/минуту

📝 **Как использовать:**
1. Отправьте изображение **как документ**
2. Напишите вопрос или запрос об изображении
3. Получите текстовый ответ от AI

💡 **Примеры:**
• "Опиши что на изображении"
• "Какая дата на фото?"
• "Переведи текст с изображения"

⚠️ **Важно:** Модель анализирует изображения, но не редактирует их!
`;

  await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!userId) return;

  if (userContexts.has(userId)) {
    userContexts.delete(userId);
    await bot.sendMessage(chatId, '❌ Операция отменена.');
  } else {
    await bot.sendMessage(chatId, 'ℹ️ Нет активных операций.');
  }
});

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const document = msg.document;

  if (!userId || !document) return;

  try {
    if (!document.mime_type || !SUPPORTED_FORMATS.includes(document.mime_type)) {
      await bot.sendMessage(chatId, '❌ Неподдерживаемый формат. Поддерживаются: JPG, PNG, WEBP');
      return;
    }

    if (document.file_size && document.file_size > MAX_FILE_SIZE) {
      await bot.sendMessage(chatId, `❌ Файл слишком большой. Максимум: 20MB`);
      return;
    }

    await bot.sendMessage(chatId, '⏳ Загружаю изображение...');

    const { base64, mimeType, fileName } = await downloadAndConvertToBase64(document.file_id);

    userContexts.set(userId, {
      imageBase64: base64,
      mimeType,
      fileName,
    });

    await bot.sendMessage(
      chatId,
      '✅ Изображение получено! Напишите ваш вопрос.\n\n💡 Например: "Что изображено на фото?"'
    );
  } catch (error: any) {
    console.error('Ошибка:', error);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
});

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    '⚠️ Отправьте изображение **как документ** (не как фото)!',
    { parse_mode: 'Markdown' }
  );
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text;

  if (!userId || !text || text.startsWith('/')) return;

  const context = userContexts.get(userId);

  if (!context) {
    await bot.sendMessage(
      chatId,
      'ℹ️ Сначала отправьте изображение как документ.'
    );
    return;
  }

  let processingMessage;

  try {
    processingMessage = await bot.sendMessage(chatId, '⏳ Анализирую изображение...');

    const responseText = await processImageWithGemini(context.imageBase64, context.mimeType, text);

    await bot.deleteMessage(chatId, processingMessage.message_id);

    await bot.sendMessage(chatId, `🤖 **Ответ AI:**\n\n${responseText}`, { parse_mode: 'Markdown' });

    userContexts.delete(userId);
  } catch (error: any) {
    console.error('Ошибка:', error);

    if (processingMessage) {
      try {
        await bot.deleteMessage(chatId, processingMessage.message_id);
      } catch (e) {}
    }

    await bot.sendMessage(chatId, `❌ ${error.message}`);
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

process.on('SIGINT', () => {
  console.log('\n👋 Остановка бота...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Остановка бота...');
  bot.stopPolling();
  process.exit(0);
});

console.log('🤖 Telegram Bot запущен (Google AI Studio - FREE)!');
console.log('🆓 60 запросов/минуту бесплатно');
console.log('📝 Ожидание сообщений...');
