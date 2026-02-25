#!/bin/bash
# ============================================================
# Avito Chatbot — Deployment Script
# ============================================================
# Запуск: bash deploy.sh
# Этот скрипт:
# 1. Проверяет наличие Docker
# 2. Проверяет наличие .env файла
# 3. Собирает и запускает контейнеры
# 4. Применяет миграции БД
# ============================================================

set -e

echo "============================================"
echo "  Avito Chatbot — Deployment"
echo "============================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker не установлен!${NC}"
    echo "Установите Docker: https://docs.docker.com/engine/install/ubuntu/"
    echo "Или выполните: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

echo -e "${GREEN}✅ Docker найден${NC}"

# Check Docker Compose
if ! docker compose version &> /dev/null; then
    echo -e "${RED}❌ Docker Compose не найден!${NC}"
    echo "Обычно устанавливается вместе с Docker."
    exit 1
fi

echo -e "${GREEN}✅ Docker Compose найден${NC}"

# Check .env file
if [ ! -f ../.env ]; then
    echo -e "${YELLOW}⚠️  Файл .env не найден!${NC}"
    echo ""
    echo "Создаю .env из шаблона..."
    cp env-template.txt ../.env
    echo -e "${YELLOW}📝 Отредактируйте файл .env перед запуском:${NC}"
    echo "   nano ../.env"
    echo ""
    echo "Обязательно заполните:"
    echo "  - MYSQL_ROOT_PASSWORD (пароль root для MySQL)"
    echo "  - MYSQL_PASSWORD (пароль пользователя БД)"
    echo "  - BUILT_IN_FORGE_API_KEY (ключ для AI модели)"
    echo "  - JWT_SECRET (случайная строка)"
    echo ""
    echo "Для генерации JWT_SECRET выполните:"
    echo "  openssl rand -hex 32"
    echo ""
    echo "После заполнения .env запустите скрипт снова."
    exit 0
fi

echo -e "${GREEN}✅ Файл .env найден${NC}"
echo ""

# Go to project root
cd ..

# Build and start
echo "🔨 Сборка Docker образа..."
docker compose build --no-cache

echo ""
echo "🚀 Запуск контейнеров..."
docker compose up -d

echo ""
echo "⏳ Ожидание запуска MySQL (30 секунд)..."
sleep 30

# Run database migrations
echo "📊 Применение миграций БД..."
docker compose exec app npx drizzle-kit generate 2>/dev/null || true
docker compose exec app npx drizzle-kit migrate 2>/dev/null || true

echo ""
echo "============================================"
echo -e "${GREEN}✅ Деплой завершён!${NC}"
echo "============================================"
echo ""
echo "Проверка статуса:"
echo "  docker compose ps"
echo ""
echo "Просмотр логов:"
echo "  docker compose logs -f app"
echo ""
echo "Перезапуск:"
echo "  docker compose restart app"
echo ""
echo "Остановка:"
echo "  docker compose down"
echo ""

# Show status
docker compose ps
