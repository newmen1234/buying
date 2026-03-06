#!/bin/bash
# Проверяет, безопасно ли деплоить (нет активных фоновых процессов на сервере)
# Используем прямые запросы к БД (API требует auth)
# Exit 0 = safe, Exit 1 = not safe

SERVER="root@91.99.223.0"

db_query() {
  ssh "$SERVER" "source /root/apps/logistic/.env && export DATABASE_URL && psql \$DATABASE_URL -t -A -c \"$1\"" 2>/dev/null
}

# 1. Проверить sync_history — нет ли активного sync
ACTIVE_SYNC=$(db_query "SELECT count(*) FROM sync_history WHERE status = 'syncing'")
if [ "$ACTIVE_SYNC" -gt 0 ] 2>/dev/null; then
  echo "❌ CRM sync в процессе ($ACTIVE_SYNC активных)"
  exit 1
fi

# 2. Проверить расписание: sync запускается в 5:00 и 14:00 MSK (= 2:00 и 11:00 UTC)
# Не деплоить за 5 мин до запуска и 10 мин после
CURRENT_HOUR_MSK=$(TZ='Europe/Moscow' date '+%H')
CURRENT_MIN=$(TZ='Europe/Moscow' date '+%M')
CURRENT_TOTAL_MIN=$((10#$CURRENT_HOUR_MSK * 60 + 10#$CURRENT_MIN))

# 5:00 MSK = 300 мин, 14:00 MSK = 840 мин
for SYNC_MIN in 300 840; do
  DIFF=$((SYNC_MIN - CURRENT_TOTAL_MIN))
  # За 5 мин до или 10 мин после
  if [ "$DIFF" -ge -10 ] && [ "$DIFF" -le 5 ]; then
    SYNC_HOUR=$((SYNC_MIN / 60))
    echo "❌ Рядом с расписанием CRM sync (${SYNC_HOUR}:00 MSK), сейчас ${CURRENT_HOUR_MSK}:${CURRENT_MIN}"
    exit 1
  fi
done

# 3. Проверить: последний sync завершился? (не застрял)
LAST_SYNC_STATUS=$(db_query "SELECT status FROM sync_history ORDER BY id DESC LIMIT 1")
if [ "$LAST_SYNC_STATUS" = "syncing" ]; then
  echo "❌ Последний sync всё ещё в статусе 'syncing'"
  exit 1
fi

# 4. Проверить PM2 — приложение работает?
PM2_LINE=$(ssh "$SERVER" "pm2 status logistic --no-color 2>/dev/null | grep logistic" 2>/dev/null)
if ! echo "$PM2_LINE" | grep -q "online"; then
  echo "⚠️  PM2: logistic не online"
  echo "   $PM2_LINE"
  exit 1
fi

echo "✅ Безопасно деплоить"
exit 0
