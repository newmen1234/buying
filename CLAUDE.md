# Buying — автоматизация выкупа товаров из европейских магазинов

## Обзор проекта

Full-stack приложение для автоматизации процесса выкупа товаров: анализ почты, проверка статусов заказов через ЛК магазинов, трекинг посылок в Германии. Интеграция с RetailCRM.

**Tech stack:** TypeScript, React 18, Express 5, PostgreSQL + Drizzle ORM, Playwright, Vite

## Сервер

- **Адрес:** `root@46.224.133.100`
- **Путь:** `/var/www/buying/`
- **PM2:** `pm2 restart buying` / `pm2 logs buying`
- **БД:** PostgreSQL `postgresql://buying:buying@127.0.0.1:5432/buying`

## Deploy

```bash
# Полный деплой (с сервера):
cd /var/www/buying && npx tsx script/build.ts && pm2 restart buying

# Или: собрать локально и скопировать
npm run build
scp dist/index.cjs root@46.224.133.100:/var/www/buying/dist/index.cjs
rsync -avz --delete --exclude='.env' dist/public/ root@46.224.133.100:/var/www/buying/dist/public/
ssh root@46.224.133.100 'pm2 restart buying'
```

## Архитектура

### Серверные модули

| Модуль | Описание |
|--------|----------|
| `server/routes.ts` | Все API-маршруты (~3000 строк) |
| `server/storage.ts` | Работа с БД через Drizzle ORM |
| `server/retailcrm-service.ts` | Интеграция с RetailCRM API |
| `server/email-recipe-engine.ts` | Движок email-рецептов (regex-парсинг) |
| `server/fastmail-search.ts` | JMAP-поиск по Fastmail |
| `server/shop-agent/` | Автоматизация ЛК магазинов (Playwright + AI) |
| `server/track17-service.ts` | Трекинг посылок через 17track API |
| `server/background-sync.ts` | Фоновые задачи (синхронизация CRM, трекинг DE) |
| `server/cache-sync.ts` | Кеширование заказов RetailCRM |
| `server/cbr-rates.ts` | Курсы валют ЦБ РФ |

### Shop Agent (server/shop-agent/)

| Файл | Описание |
|------|----------|
| `agent.ts` | Оркестратор проверки заказов |
| `recipe-engine.ts` | Исполнение рецептов (шаги: click, type, extract) |
| `ai-navigator.ts` | AI-навигация по сайтам через GPT-4o |
| `browser.ts` | Управление Playwright-браузером |
| `platform-detector.ts` | Определение платформы магазина |
| `crypto.ts` | Шифрование паролей AES-256-GCM |

### Клиентские страницы

| Страница | URL | Описание |
|----------|-----|----------|
| Dashboard | `/` | Главная (заглушка) |
| Сбор треков | `/shop-agent` | Проверка заказов через email/ЛК |
| Трекинг DE | `/tracking-de` | Трекинг посылок в Германии |
| Настройки | `/settings` | Пользователи, инструменты, CRM, sync |

## Fastmail (4 аккаунта)

| Legal Entity | Домены | Токен |
|-------------|--------|-------|
| Newmen | croxl.info, newmen.me | FASTMAIL_NEWMEN_TOKEN |
| Vatebo | vatebo.info | FASTMAIL_VATEBO_TOKEN |
| Anecy | anecy.info | FASTMAIL_ANECY_TOKEN |
| Croxl | croxl.info | FASTMAIL_CROXL_TOKEN |

Определять legalEntity по email заказа (какой домен).

## Email-рецепты

### Формат рецепта (JSON)

```json
{
  "version": 1,
  "shopName": "example.de",
  "senderPatterns": ["info@example.de"],
  "emailTypes": [
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Versandbestätigung"],
        "fromExact": "versand@example.de",
        "bodyContains": ["Sendungsnummer"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer[:\\s]*(\\d+)"],
        "trackingPatterns": ["Sendungsnummer[:\\s]*(\\S+)"],
        "carrierPatterns": ["(DHL|Hermes|UPS|DPD|GLS)"],
        "deliveryDatePatterns": ["Zustellung[:\\s]*(\\d{1,2}\\.\\d{1,2}\\.\\d{4})"]
      }
    }
  ],
  "statusPriority": ["confirmed", "processing", "shipped", "delivered", "cancelled", "returned"],
  "carrierAliases": {"Spring GDS": "Hermes"}
}
```

### Правила match
- `subjectContains` — любое из значений в теме (case-insensitive)
- `fromExact` — точное совпадение from (case-insensitive)
- `bodyContains` — любое из значений в теле
- Все условия в match — AND

### Правила extraction
- Regex с capture group 1, первое совпадение
- Поиск: textBody + subject + htmlBody (без тегов)
- Если orderId извлечён и не совпадает с shopOrderId → email пропускается

### Создание рецепта для нового магазина

```bash
# Поиск образцов на сервере:
cd /var/www/buying && source .env
npx tsx scripts/search-shop-emails.ts <domain> <legalEntity> 30
```

```sql
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('<domain>', 'email_parsing', '<json>'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json;
```

## Важно

- НЕ использовать `@domain` паттерны в senderPatterns — JMAP не поддерживает, только полные email
- Письма-ответы (AW:, RE:) — игнорировать
- Маркетинговые рассылки — фильтруются по senderPatterns (только transactional sender)
- Если textBody пустой — движок автоматически ищет в htmlBody (strip тегов)
