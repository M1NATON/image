import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Загрузка переменных окружения
dotenv.config();

// Проверка наличия необходимых переменных окружения
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
  console.error(
    "❌ Ошибка: TELEGRAM_TOKEN и OPENROUTER_API_KEY должны быть установлены в .env файле",
  );
  process.exit(1);
}

// Инициализация бота
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Константы
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const GEMINI_MODEL = "google/gemini-2.5-flash-image";
const SUPPORTED_FORMATS = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// Системный промпт
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

// ============ КЛАВИАТУРЫ ============

// Главная Reply-клавиатура
const mainReplyKeyboard = {
  keyboard: [
    [{ text: "📤 Загрузить изображение" }],
    [{ text: "❌ Отменить операцию" }],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
};

// Клавиатура во время редактирования
const editingReplyKeyboard = {
  keyboard: [
    [{ text: "❌ Отменить операцию" }],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
};

// Inline клавиатура для главного меню
const mainInlineKeyboard = {
  inline_keyboard: [
    [
      { text: "📝 Примеры запросов", callback_data: "examples" },
    ],
  ],
};

// Inline клавиатура после успешного редактирования
const resultInlineKeyboard = {
  inline_keyboard: [
    [
      { text: "📤 Загрузить новое фото", callback_data: "upload_new" },
    ],
  ],
};

// Inline клавиатура примеров
const examplesInlineKeyboard = {
  inline_keyboard: [
    [{ text: "📝 Пример 1: Изменить имя", callback_data: "example_1" }],
    [{ text: "📅 Пример 2: Изменить дату", callback_data: "example_2" }],
    [{ text: "🔢 Пример 3: Изменить номер", callback_data: "example_3" }],
  ],
};


// ============ ФУНКЦИИ ============

function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes: { [key: string]: string } = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] || "image/jpeg";
}

async function downloadAndConvertToBase64(
  fileId: string,
): Promise<{ base64: string; mimeType: string; fileName: string }> {
  try {
    const file = await bot.getFile(fileId);
    const filePath = file.file_path;

    if (!filePath) {
      throw new Error("Не удалось получить путь к файлу");
    }

    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
    const response = await axios.get(fileUrl, { responseType: "arraybuffer" });

    const base64 = Buffer.from(response.data).toString("base64");
    const fileName = path.basename(filePath);
    const mimeType = getMimeType(fileName);

    return { base64, mimeType, fileName };
  } catch (error) {
    throw new Error(`Ошибка при скачивании файла: ${error}`);
  }
}

async function editImageWithAI(
  imageBase64: string,
  mimeType: string,
  prompt: string,
): Promise<{ buffer: Buffer; mediaType: string }> {
  try {
    const fullPrompt = `${SYSTEM_PROMPT}\n\n=== USER REQUEST ===\n${prompt}`;

    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model: GEMINI_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`,
                },
              },
              {
                type: "text",
                text: fullPrompt,
              },
            ],
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://github.com/your-username/telegram-image-bot",
          "X-Title": "Telegram Image Bot",
          "Content-Type": "application/json",
        },
      },
    );

    console.log("📡 Ответ от API:", {
      model: response.data.model,
      usage: response.data.usage,
      hasImages: !!response.data.choices?.[0]?.message?.images,
    });

    const message = response.data.choices?.[0]?.message;
    const images = message?.images;

    if (!images || !Array.isArray(images) || images.length === 0) {
      console.error(
        "❌ Изображения не найдены. Response:",
        JSON.stringify(response.data).substring(0, 500),
      );
      throw new Error("Изображение не найдено в ответе API");
    }

    const imageData = images[0];
    const imageUrl = imageData?.image_url?.url;

    if (!imageUrl || !imageUrl.startsWith("data:")) {
      throw new Error("Некорректный формат изображения в ответе");
    }

    console.log("✅ Изображение найдено, URL length:", imageUrl.length);

    const base64Match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) {
      throw new Error("Не удалось извлечь base64 из data URL");
    }

    const mediaType = base64Match[1];
    const base64Data = base64Match[2];

    console.log(
      "✅ Base64 размер:",
      base64Data.length,
      "Media type:",
      mediaType,
    );

    const buffer = Buffer.from(base64Data, "base64");

    return { buffer, mediaType };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.error?.message || error.message;

      switch (status) {
        case 429:
          throw new Error("⚠️ Превышен лимит запросов. Попробуйте позже.");
        case 402:
          throw new Error(
            "💳 Недостаточно средств на балансе OpenRouter. Пополните баланс на https://openrouter.ai/",
          );
        case 401:
          throw new Error(
            "🔑 Неверный API ключ OpenRouter. Проверьте настройки.",
          );
        default:
          throw new Error(`❌ Ошибка API: ${message}`);
      }
    }
    throw error;
  }
}

// ============ ОБРАБОТЧИКИ КОМАНД ============

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from?.first_name || "Пользователь";

  const welcomeMessage = `
📝 **Как использовать:**
1️⃣ Отправьте изображение **как документ** (не фото!)
2️⃣ Напишите, что нужно изменить
3️⃣ Получите отредактированное изображение
`;

  await bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: "Markdown",
    reply_markup: mainReplyKeyboard,
  });

  await bot.sendMessage(chatId, "🎯 Выберите действие или используйте кнопки ниже:", {
    reply_markup: mainInlineKeyboard,
  });
});

// Команда /help
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;

  const helpMessage = `
❓ **Справка**

📍 **Важные правила:**
• Отправляйте изображения только как документ!
• Поддерживаемые форматы: JPG, PNG, WEBP
• Максимальный размер: 20MB

🔧 **Команды:**
/start - Главное меню
/help - Эта справка
/cancel - Отмена текущей операции
/stats - Статистика использования

📝 **Как отправить документ:**
1. Нажмите на скрепку 📎
2. Выберите "Файл"
3. Найдите изображение
4. Отправьте

💬 **Поддержка:** @support_bot
`;

  await bot.sendMessage(chatId, helpMessage, {
    parse_mode: "Markdown",
  });
});

// ============ ОБРАБОТЧИКИ REPLY-КНОПОК ============

bot.onText(/📤 Загрузить изображение/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    "📎 Отправьте изображение **как документ** (не фото!):\n\n" +
      "1. Нажмите на скрепку 📎\n" +
      '2. Выберите "Файл"\n' +
      "3. Найдите и отправьте изображение",
    { parse_mode: "Markdown", reply_markup: editingReplyKeyboard },
  );
});




bot.onText(/❌ Отменить (операцию|редактирование)/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!userId) return;

  if (userContexts.has(userId)) {
    userContexts.delete(userId);
    await bot.sendMessage(chatId, "✅ Операция отменена.", {
      reply_markup: mainReplyKeyboard,
    });
  } else {
    await bot.sendMessage(chatId, "ℹ️ Нет активных операций.", {
      reply_markup: mainReplyKeyboard,
    });
  }
});


// ============ ОБРАБОТЧИК ДОКУМЕНТОВ ============

bot.on("document", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const document = msg.document;

  if (!userId || !document) return;

  try {
    if (
      !document.mime_type ||
      !SUPPORTED_FORMATS.includes(document.mime_type)
    ) {
      await bot.sendMessage(
        chatId,
        "❌ Неподдерживаемый формат файла. Поддерживаются: JPG, PNG, WEBP",
        { reply_markup: mainReplyKeyboard },
      );
      return;
    }

    if (document.file_size && document.file_size > MAX_FILE_SIZE) {
      await bot.sendMessage(
        chatId,
        `❌ Файл слишком большой. Максимальный размер: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        { reply_markup: mainReplyKeyboard },
      );
      return;
    }

    await bot.sendMessage(chatId, "⏳ Загружаю изображение...");

    const { base64, mimeType, fileName } = await downloadAndConvertToBase64(
      document.file_id,
    );

    userContexts.set(userId, {
      imageBase64: base64,
      mimeType,
      fileName,
    });

    await bot.sendMessage(
      chatId,
      "✅ **Изображение получено!**\n\n" +
        "💬 Теперь напишите, что нужно изменить.\n\n" +
        '💡 Например: "Измени пункт 1 где надпись Barav на OLGA"',
      {
        parse_mode: "Markdown",
        reply_markup: {
          ...editingReplyKeyboard,
          inline_keyboard: [
            [{ text: "📝 Показать примеры", callback_data: "examples" }],
          ],
        } as any,
      },
    );
  } catch (error: any) {
    console.error("Ошибка при обработке документа:", error);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`, {
      reply_markup: mainReplyKeyboard,
    });
  }
});

// ============ ОБРАБОТЧИК ФОТО ============

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    "⚠️ **Внимание!** Telegram сжимает фотографии.\n\n" +
      "📎 Пожалуйста, отправьте изображение **как документ**",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📖 Как отправить документ?",
              callback_data: "help_document",
            },
          ],
        ],
      },
    },
  );
});

// ============ ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ ============

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text;

  if (!userId || !text) return;
  if (text.startsWith("/")) return;
  if (text.match(/📤|❌/)) return;

  const context = userContexts.get(userId);

  if (!context) {
    await bot.sendMessage(
      chatId,
      "ℹ️ Сначала отправьте изображение как документ.",
      { reply_markup: mainReplyKeyboard },
    );
    return;
  }

  let processingMessage;

  try {
    processingMessage = await bot.sendMessage(
      chatId,
      "⏳ Обрабатываю изображение...\n\n🔄 Это может занять некоторое время...",
    );

    const { buffer: imageBuffer, mediaType } = await editImageWithAI(
      context.imageBase64,
      context.mimeType,
      text,
    );

    await bot.deleteMessage(chatId, processingMessage.message_id);

    const ext = mediaType.split("/")[1] || "png";

    await bot.sendDocument(
      chatId,
      imageBuffer,
      {
        caption: "✅ **Готово!** Изображение успешно отредактировано.",
        parse_mode: "Markdown",
        reply_markup: resultInlineKeyboard,
      },
      {
        filename: `edited_${path.basename(context.fileName, path.extname(context.fileName))}.${ext}`,
        contentType: mediaType,
      },
    );

    userContexts.delete(userId);

    await bot.sendMessage(chatId, "Что делаем дальше?", {
      reply_markup: mainReplyKeyboard,
    });
  } catch (error: any) {
    console.error("Ошибка при обработке запроса:", error);

    if (processingMessage) {
      try {
        await bot.deleteMessage(chatId, processingMessage.message_id);
      } catch (e) {}
    }

    await bot.sendMessage(chatId, `❌ ${error.message}`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔄 Попробовать снова", callback_data: "try_again" },
            { text: "❌ Отменить", callback_data: "cancel_operation" },
          ],
        ],
      },
    });
  }
});

// ============ ОБРАБОТЧИК CALLBACK КНОПОК ============

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  const userId = query.from?.id;
  const data = query.data;

  if (!chatId) return;

  try {
    await bot.answerCallbackQuery(query.id);

    switch (data) {
      case "examples":
        await bot.sendMessage(
          chatId,
          "💡 **Примеры запросов:**\n\n" +
            '1️⃣ "Измени пункт 1 где надпись Barav на OLGA"\n\n' +
            '2️⃣ "Замени пункт 4b. где надпись 07.02.2033 на 08.09.2055"\n\n' +
            '3️⃣ "Измени номер паспорта на AB1234567"\n\n' +
            '✨ **Советы:**\n' +
            '• Будьте конкретны в описании\n' +
            '• Указывайте точное расположение\n' +
            '• Пишите новое значение четко',
          {
            parse_mode: "Markdown",
          },
        );
        break;


      case "help":
      case "help_document":
        await bot.sendMessage(
          chatId,
          "❓ **Как отправить документ**\n\n" +
            "📍 **Шаги:**\n" +
            "1️⃣ Нажмите на скрепку 📎\n" +
            '2️⃣ Выберите "Файл"\n' +
            "3️⃣ Найдите изображение\n" +
            "4️⃣ Отправьте\n\n" +
            "⚠️ Не отправляйте как фото - Telegram сжимает их!",
          { parse_mode: "Markdown" },
        );
        break;


      case "upload_new":
        if (userId) userContexts.delete(userId);
        await bot.sendMessage(
          chatId,
          "📎 Отправьте новое изображение как документ",
          { reply_markup: editingReplyKeyboard },
        );
        break;


      case "try_again":
        await bot.sendMessage(
          chatId,
          "🔄 Попробуйте переформулировать запрос более четко",
          { reply_markup: editingReplyKeyboard },
        );
        break;

      case "cancel_operation":
        if (userId) userContexts.delete(userId);
        await bot.sendMessage(chatId, "✅ Операция отменена", {
          reply_markup: mainReplyKeyboard,
        });
        break;
    }
  } catch (error: any) {
    console.error("Ошибка при обработке callback:", error);
  }
});

// ============ ОБРАБОТКА ОШИБОК ============

bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

process.on("SIGINT", () => {
  console.log("\n👋 Остановка бота...");
  bot.stopPolling();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n👋 Остановка бота...");
  bot.stopPolling();
  process.exit(0);
});

console.log("🤖 Telegram Image Editor Bot запущен!");
console.log("📝 Ожидание сообщений...");
console.log("🎨 Версия с красивыми кнопками активирована!");
