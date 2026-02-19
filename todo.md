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
