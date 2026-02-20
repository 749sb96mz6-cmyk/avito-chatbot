# Avito Chatbot - TODO

## Backend
- [x] Database schema: avito_accounts, chats, messages, bot_settings, prompt_templates
- [x] Avito API integration: token management, message sending/receiving
- [x] Webhook endpoint for incoming Avito messages
- [x] LLM integration for generating auto-replies
- [x] Polling fallback for fetching new messages
- [x] tRPC routers: avito accounts, chats, messages, settings, bot config

## Frontend - Dashboard
- [x] Design system: Inter font, blue Avito-inspired palette
- [x] Dashboard layout with sidebar navigation
- [x] Dashboard home page with statistics overview
- [x] Chats page: list of conversations with search/filter
- [x] Chat detail view: message history with bot/human indicators
- [x] Settings page: Avito API credentials configuration
- [x] Bot settings page: system prompt, response templates, toggle on/off
- [x] Prompt templates management

## Testing
- [x] Vitest tests for core backend functionality (13 tests passing)

## v2: Перенастройка по требованиям пользователя

### Фильтрация сообщений
- [x] Бот отвечает только на сообщения ПОСЛЕ момента подключения (botActivatedAt)
- [x] Не обрабатывать старые непрочитанные сообщения до подключения
- [x] Если сообщение прочитано и диалог завершён — отправить закрывающее сообщение
- [x] Если объявление неактивно — сообщить что товар продан, предложить альтернативу
- [x] Сообщения без текста (фото/файлы) — просить уточнить

### Агрегация сообщений
- [x] Если несколько сообщений за 40 секунд — объединить и ответить одним
- [x] После паузы 40с — отвечать отдельно

### Рабочие часы
- [x] 09:00-21:00 МСК — полноценные ответы
- [x] Вне рабочего времени — короткий ответ + обещание контакта в рабочее время
- [x] Настройки рабочих часов в UI

### Telegram-уведомления менеджеру
- [x] Интеграция с Telegram Bot API для уведомлений
- [x] Уведомлять при: бот не уверен, клиент просит позвонить, конфликт/негатив
- [x] Настройки Telegram бота в UI (токен, chat_id)

### Список для менеджера
- [x] Страница/раздел со списком чатов, требующих внимания менеджера
- [x] Фильтр: чаты вне рабочего времени, сложные вопросы, запросы VIN

### Системный промпт
- [x] Обновить системный промпт под бизнес-логику автозапчастей
- [x] Правила: наличие, цена, доставка только Авито, гарантия 30 дней, самовывоз через кнопку
- [x] Запреты: не обещать скидки, не предлагать доставку вне Авито, не раскрывать внутренние данные
- [x] Бот пишет как менеджер (без "я бот")
- [x] Поддержка мультиязычности (основной — русский)

### Polling
- [x] Изменить интервал polling на 30 секунд

### Тесты
- [x] Тесты на фильтрацию сообщений (botActivatedAt)
- [x] Тесты на агрегацию сообщений (40с окно)
- [x] Тесты на рабочие часы
- [x] Тесты на Telegram-уведомления
- [x] Тесты на NEEDS_MANAGER тег
- [x] Тесты на обработку ошибок LLM
- [x] Все 33 теста проходят (добавлены тесты на контекст диалога и дедупликацию приветствий)

## Bugs
- [ ] Telegram Chat ID не принимается в настройках — исправить валидацию
- [ ] CRITICAL: Бот не отвечает на сообщения клиентов
- [ ] CRITICAL: Telegram Chat ID не сохраняется в настройках
- [x] BUG: Бот повторно здоровается в продолжении диалога — не учитывает контекст переписки
