import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Загрузка переменных окружения
dotenv.config();

// Проверка наличия необходимых переменных окружения
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
  console.error('❌ Ошибка: TELEGRAM_TOKEN и OPENROUTER_API_KEY должны быть установлены в .env файле');
  process.exit(1);
}

// Инициализация бота
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Константы
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Модель с поддержкой изображений (стабильная версия, Nano Banana provider)
const GEMINI_MODEL = 'google/gemini-2.5-flash-image';
const SUPPORTED_FORMATS = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// Системный промпт для улучшения качества редактирования
const SYSTEM_PROMPT = `You are a professional document editor. Your task is to edit images with MAXIMUM PRECISION and ACCURACY.

IMPORTANT RULES:
1. ONLY work with DOCUMENTS (forms, certificates, ID cards, contracts, etc.)
2. If the image is NOT a document (e.g., photo of people, landscapes, etc.) - refuse to edit it
3. Make changes EXACTLY as requested - change ONLY the specified text/dates
4. Preserve ALL original formatting, fonts, colors, and layout
5. Match the font style, size, and color PERFECTLY to the surrounding text
6. Ensure edited text is aligned properly and looks natural
7. DO NOT add watermarks, signatures, or any extra elements
8. Keep the same image quality and resolution
9. Make changes look COMPLETELY NATURAL - as if they were there originally

Your goal: Create UNDETECTABLE edits that blend perfectly with the original document.`;

// Интерфейс для хранения контекста пользователя
interface UserContext {
  imageBase64: string;
  mimeType: string;
  fileName: string;
}

// Хранилище контекстов пользователей
const userContexts = new Map<number, UserContext>();

// Функция для получения MIME типа по расширению файла
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

// Функция для скачивания и конвертации изображения в base64
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

// Функция для отправки запроса в OpenRouter API
// Возвращает Buffer с изображением
async function editImageWithAI(imageBase64: string, mimeType: string, prompt: string): Promise<{ buffer: Buffer; mediaType: string }> {
  try {
    // Объединяем системный промпт с запросом пользователя
    const fullPrompt = `${SYSTEM_PROMPT}\n\n=== USER REQUEST ===\n${prompt}`;

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
                text: fullPrompt,
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
        },
      }
    );

    // Логирование основной информации
    console.log('📡 Ответ от API:', {
      model: response.data.model,
      usage: response.data.usage,
      hasImages: !!response.data.choices?.[0]?.message?.images
    });

    // Извлечение изображения из ответа
    // OpenRouter возвращает изображения в choices[0].message.images
    const message = response.data.choices?.[0]?.message;
    const images = message?.images;
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      console.error('❌ Изображения не найдены. Response:', JSON.stringify(response.data).substring(0, 500));
      throw new Error('Изображение не найдено в ответе API');
    }

    // Берём первое изображение
    const imageData = images[0];
    const imageUrl = imageData?.image_url?.url;

    if (!imageUrl || !imageUrl.startsWith('data:')) {
      throw new Error('Некорректный формат изображения в ответе');
    }

    console.log('✅ Изображение найдено, URL length:', imageUrl.length);

    // Извлекаем base64 из data URL
    const base64Match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) {
      throw new Error('Не удалось извлечь base64 из data URL');
    }

    const mediaType = base64Match[1];
    const base64Data = base64Match[2];

    console.log('✅ Base64 размер:', base64Data.length, 'Media type:', mediaType);

    // Конвертируем base64 в Buffer
    const buffer = Buffer.from(base64Data, 'base64');

    return { buffer, mediaType };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.error?.message || error.message;

      switch (status) {
        case 429:
          throw new Error('⚠️ Превышен лимит запросов. Попробуйте позже.');
        case 402:
          throw new Error('💳 Недостаточно средств на балансе OpenRouter. Пополните баланс на https://openrouter.ai/');
        case 401:
          throw new Error('🔑 Неверный API ключ OpenRouter. Проверьте настройки.');
        default:
          throw new Error(`❌ Ошибка API: ${message}`);
      }
    }
    throw error;
  }
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
📝 **Как использовать:**
1. Отправьте изображение **как документ** (не фото!)
2. Напишите, что нужно изменить
3. Получите отредактированное изображение

💡 **Примеры запросов:**
• "Измени пункт 1 где надпись Barav на OLGA"
• "Замени пункт 4b. где надпись 07.02.2033 на 08.09.2055"
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

// Команда /cancel
bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!userId) return;

  if (userContexts.has(userId)) {
    userContexts.delete(userId);
    await bot.sendMessage(chatId, '❌ Операция отменена. Отправьте новое изображение для редактирования.');
  } else {
    await bot.sendMessage(chatId, 'ℹ️ Нет активных операций.');
  }
});


// Обработка документов (изображений)
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const document = msg.document;

  if (!userId || !document) return;

  try {
    // Проверка MIME типа
    if (!document.mime_type || !SUPPORTED_FORMATS.includes(document.mime_type)) {
      await bot.sendMessage(
        chatId,
        '❌ Неподдерживаемый формат файла. Поддерживаются: JPG, PNG, WEBP'
      );
      return;
    }

    // Проверка размера файла
    if (document.file_size && document.file_size > MAX_FILE_SIZE) {
      await bot.sendMessage(
        chatId,
        `❌ Файл слишком большой. Максимальный размер: ${MAX_FILE_SIZE / 1024 / 1024}MB`
      );
      return;
    }

    // Показываем индикатор загрузки
    await bot.sendMessage(chatId, '⏳ Загружаю изображение...');

    // Скачиваем и конвертируем изображение
    const { base64, mimeType, fileName } = await downloadAndConvertToBase64(document.file_id);

    // Сохраняем контекст пользователя
    userContexts.set(userId, {
      imageBase64: base64,
      mimeType,
      fileName,
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: '📝 Примеры', callback_data: 'examples' }
        ]
      ]
    };

    await bot.sendMessage(
      chatId,
      '✅ Изображение получено! Теперь напишите, что нужно изменить.\n\n💡 Например: "Измени пункт 1 где надпись Barav на OLGA"',
      { reply_markup: keyboard }
    );
  } catch (error: any) {
    console.error('Ошибка при обработке документа:', error);
    await bot.sendMessage(chatId, `❌ Ошибка при обработке файла: ${error.message}`);
  }
});

// Обработка фото (показываем инструкцию)
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
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

// Обработка текстовых сообщений (промтов)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text;

  if (!userId || !text) return;

  // Игнорируем команды
  if (text.startsWith('/')) return;

  // Проверяем наличие контекста пользователя
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
    // Показываем индикатор обработки
    processingMessage = await bot.sendMessage(chatId, '⏳ Обрабатываю изображение...');

    // Отправляем запрос в OpenRouter API
    const { buffer: imageBuffer, mediaType } = await editImageWithAI(context.imageBase64, context.mimeType, text);

    // Удаляем индикатор обработки
    await bot.deleteMessage(chatId, processingMessage.message_id);

    // Определяем расширение файла
    const ext = mediaType.split('/')[1] || 'png';

    // Отправляем результат пользователю
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

    // Очищаем контекст пользователя
    userContexts.delete(userId);
  } catch (error: any) {
    console.error('Ошибка при обработке запроса:', error);

    // Удаляем индикатор обработки, если он существует
    if (processingMessage) {
      try {
        await bot.deleteMessage(chatId, processingMessage.message_id);
      } catch (e) {
        // Игнорируем ошибку удаления сообщения
      }
    }

    await bot.sendMessage(chatId, `❌ ${error.message}\n\nПопробуйте ещё раз или используйте /cancel для отмены.`);
  }
});

// Обработка callback кнопок
bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat.id;
  const data = query.data;

  if (!chatId) return;

  try {
    await bot.answerCallbackQuery(query.id);

    switch (data) {
      case 'examples':
        await bot.sendMessage(chatId, 
          `💡 **Примеры запросов:**\n\n` +
          `• "Измени пункт 1 где надпись Barav на OLGA"\n` +
          `• "Замени пункт 4b. где надпись 07.02.2033 на 08.09.2055"`,
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
        // Повторно отправляем сообщение /start
        const welcomeMessage = `
📝 **Как использовать:**
1. Отправьте изображение **как документ** (не фото!)
2. Напишите, что нужно изменить
3. Получите отредактированное изображение

💡 **Примеры запросов:**
• "Измени пункт 1 где надпись Barav на OLGA"
• "Замени пункт 4b. где надпись 07.02.2033 на 08.09.2055"
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
        break;
    }
  } catch (error: any) {
    console.error('Ошибка при обработке callback:', error);
  }
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

// Graceful shutdown
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

// Логирование запуска
console.log('🤖 Telegram Image Editor Bot запущен!');
console.log('📝 Ожидание сообщений...');
