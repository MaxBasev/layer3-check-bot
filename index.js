import 'dotenv/config';
import { MongoClient } from 'mongodb';
import TelegramBot from 'node-telegram-bot-api';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

// Конфигурация
const MONGO_URI = process.env.MONGO_URI;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const QUESTS_URL = 'https://app.layer3.xyz/search';

// Инициализация Telegram бота
const bot = new TelegramBot(TELEGRAM_TOKEN, {
	polling: true,
	cancelable: true
});

// Подключение к MongoDB
async function connectToDB() {
	const client = new MongoClient(MONGO_URI);
	await client.connect();
	return client.db('questsDB').collection('quests');
}

// Функция для проверки новых квестов
async function checkForNewQuests() {
	let browser;
	try {
		const collection = await connectToDB();

		browser = await puppeteer.launch({
			headless: "new",
			args: ['--no-sandbox']
		});

		const page = await browser.newPage();

		// Установка User-Agent
		await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

		await page.goto(QUESTS_URL, {
			waitUntil: 'networkidle0',
			timeout: 30000
		});

		// Ждем немного, чтобы контент загрузился
		await page.waitForTimeout(5000);

		// Получаем HTML
		const html = await page.evaluate(() => document.documentElement.outerHTML);

		const $ = cheerio.load(html);

		// Ищем все ссылки, которые могут быть квестами
		const quests = [];
		$('a').each((_, element) => {
			const href = $(element).attr('href');
			if (href && href.includes('/v2/quests/')) {
				const title = $(element).find('h2').text().trim();
				const id = href.split('/').pop();
				if (title && id) {
					quests.push({ id, title, href });
				}
			}
		});

		console.log(`Найдено квестов: ${quests.length}`);

		// Проверяем новые квесты
		for (const quest of quests) {
			const exists = await collection.findOne({ id: quest.id });
			if (!exists) {
				console.log(`Найден новый квест: ${quest.title}`);
				await collection.insertOne(quest);
				await bot.sendMessage(CHAT_ID,
					`🎮 Новый квест!\n\n` +
					`📌 Название: ${quest.title}\n` +
					`🔗 Ссылка: https://app.layer3.xyz${quest.href}`
				);
			}
		}

	} catch (error) {
		console.error('Ошибка:', error);
		// Сделаем скриншот страницы в случае ошибки
		if (browser) {
			const page = (await browser.pages())[0];
			if (page) {
				await page.screenshot({ path: 'error.png', fullPage: true });
				console.log('Сделан скриншот ошибки: error.png');
			}
		}
	} finally {
		if (browser) {
			await browser.close();
		}
	}
}

// Запуск проверки каждые 10 минут
const CHECK_INTERVAL = 10 * 60 * 1000;
console.log(`Установлен интервал проверки: ${CHECK_INTERVAL / 1000} секунд`);
setInterval(checkForNewQuests, CHECK_INTERVAL);

// Обработчик сообщений бота
bot.on('message', (msg) => {
	const chatId = msg.chat.id;
	console.log('Chat ID:', chatId);
	bot.sendMessage(chatId, `Бот работает!\nВаш Chat ID: ${chatId}`);
});

// Начальная проверка
console.log('Запуск бота...');
checkForNewQuests();