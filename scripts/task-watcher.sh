#!/bin/bash
# Task Watcher — автономный агент для обработки задач "Доработать"
# Запуск: bash scripts/task-watcher.sh
# Или в tmux: tmux new -s watcher 'bash scripts/task-watcher.sh'

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="root@91.99.223.0"
POLL_INTERVAL=${POLL_INTERVAL:-300}  # 5 минут по умолчанию
LOG_FILE="$PROJECT_DIR/.claude/task-watcher.log"
PROCESSED_FILE="$PROJECT_DIR/.claude/processed-tasks.txt"

# Создать директории/файлы если нет
mkdir -p "$PROJECT_DIR/.claude"
touch "$PROCESSED_FILE"

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo -e "$msg" | tee -a "$LOG_FILE"
}

log_header() {
  echo "" | tee -a "$LOG_FILE"
  log "${BLUE}═══════════════════════════════════════════════════${NC}"
  log "${BLUE}$1${NC}"
  log "${BLUE}═══════════════════════════════════════════════════${NC}"
}

# Функция для SSH-запроса к БД
db_query() {
  ssh "$SERVER" "source /root/apps/logistic/.env && export DATABASE_URL && psql \$DATABASE_URL -t -A $*" 2>/dev/null
}

# Функция для SSH-запроса к БД (с форматированием)
db_query_formatted() {
  ssh "$SERVER" "source /root/apps/logistic/.env && export DATABASE_URL && psql \$DATABASE_URL -t $*" 2>/dev/null
}

# Получить релевантные знания из recipe_knowledge
get_knowledge() {
  local task_type="$1"
  local categories=""

  case "$task_type" in
    email_recipe)
      categories="'workflow','gotcha','extraction','email_type','sender_pattern','carrier'"
      ;;
    lk_setup)
      categories="'workflow','gotcha','lk_login'"
      ;;
    *)
      categories="'workflow','gotcha'"
      ;;
  esac

  db_query_formatted "-c \"SELECT E'### ' || topic || E'\\n' || content || E'\\n' FROM recipe_knowledge WHERE category IN ($categories) ORDER BY category, updated_at DESC\""
}

# Получить промпт-шаблон
get_prompt_template() {
  local task_type="$1"
  db_query "-c \"SELECT prompt_template FROM task_prompts WHERE task_type = '$task_type'\""
}

# Подставить переменные в шаблон
render_template() {
  local template="$1"
  local domain="$2"
  local note_text="$3"
  local check_method="$4"
  local sender="$5"
  local subject_pattern="$6"

  # domain_prefix: убрать TLD для поиска
  local domain_prefix="${domain%%.*}"

  echo "$template" | sed \
    -e "s|{{domain}}|$domain|g" \
    -e "s|{{domain_prefix}}|$domain_prefix|g" \
    -e "s|{{note_text}}|$note_text|g" \
    -e "s|{{check_method}}|$check_method|g" \
    -e "s|{{sender}}|$sender|g" \
    -e "s|{{subject_pattern}}|$subject_pattern|g"
}

# Определить task_type по check_method
get_task_type() {
  local check_method="$1"
  local note_text="$2"

  case "$check_method" in
    email|email_lk) echo "email_recipe" ;;
    lk)             echo "lk_setup" ;;
    *)              echo "general" ;;
  esac
}

# Обработать одну задачу
process_task() {
  local domain="$1"
  local note_text="$2"
  local check_method="$3"
  local noted_at="$4"
  local sender="$5"
  local subject_pattern="$6"

  log_header "Задача: $domain ($check_method)"
  log "📝 Заметка: $note_text"

  # Определить тип задачи
  local task_type
  task_type=$(get_task_type "$check_method" "$note_text")
  log "🏷️  Тип: $task_type"

  # Загрузить промпт-шаблон
  log "📄 Загружаю промпт-шаблон..."
  local template
  template=$(get_prompt_template "$task_type")

  if [ -z "$template" ]; then
    log "${RED}❌ Шаблон для $task_type не найден!${NC}"
    return 1
  fi

  # Загрузить знания
  log "🧠 Загружаю базу знаний..."
  local knowledge
  knowledge=$(get_knowledge "$task_type")

  # Собрать финальный промпт
  local prompt
  prompt=$(render_template "$template" "$domain" "$note_text" "$check_method" "$sender" "$subject_pattern")

  # Добавить знания
  prompt="$prompt

## База знаний (используй эти знания для ускорения работы):
$knowledge"

  # Запустить Claude CLI
  log "${GREEN}🤖 Запускаю Claude...${NC}"

  local claude_log="$PROJECT_DIR/.claude/task-${domain}-$(date '+%Y%m%d-%H%M%S').log"

  cd "$PROJECT_DIR"

  # Claude CLI с --print для неинтерактивного режима
  if claude -p "$prompt" --print \
    --allowedTools "Bash(ssh:*) Bash(npx:*) Bash(npm:*) Read Edit Write Glob Grep" \
    2>&1 | tee "$claude_log" >> "$LOG_FILE"; then
    log "${GREEN}✅ Claude завершил работу для $domain${NC}"
  else
    log "${YELLOW}⚠️  Claude завершился с ошибкой для $domain${NC}"
  fi

  # Проверить результат: note_status стал resolved?
  local new_status
  new_status=$(db_query "-c \"SELECT note_status FROM shop_profiles WHERE domain = '$domain'\"")

  if [ "$new_status" = "resolved" ]; then
    log "${GREEN}✅ Задача решена: $domain → resolved${NC}"
  else
    log "${YELLOW}⚠️  Задача не решена: $domain → $new_status${NC}"
  fi
}

# Проверить и деплоить если нужно
maybe_deploy() {
  cd "$PROJECT_DIR"

  # Есть ли изменения в коде?
  local changes
  changes=$(git diff --name-only server/ shared/ client/ 2>/dev/null || true)

  if [ -z "$changes" ]; then
    return 0
  fi

  log "📦 Обнаружены изменения кода:"
  echo "$changes" | while read -r f; do log "   $f"; done

  # Проверить безопасность деплоя
  log "🔍 Проверяю безопасность деплоя..."
  if bash "$PROJECT_DIR/scripts/check-deploy-safe.sh" 2>&1 | tee -a "$LOG_FILE"; then
    log "${GREEN}🚀 Деплою...${NC}"
    if bash "$PROJECT_DIR/deploy.sh" 2>&1 | tee -a "$LOG_FILE"; then
      log "${GREEN}✅ Деплой завершён${NC}"
    else
      log "${RED}❌ Деплой завершился с ошибкой${NC}"
    fi
  else
    log "${YELLOW}⏳ Деплой отложен — фоновые процессы активны${NC}"
  fi
}

# ============================================================
# MAIN LOOP
# ============================================================

log_header "Task Watcher запущен"
log "📂 Проект: $PROJECT_DIR"
log "🖥️  Сервер: $SERVER"
log "⏱️  Интервал: ${POLL_INTERVAL}с"
log ""

while true; do
  # Запрос новых задач
  TASKS=$(db_query "-F '|' -c \"
    SELECT p.domain, p.note_text, COALESCE(p.check_method,'other'), p.noted_at,
      COALESCE(i.sender_email,''), COALESCE(i.subject_pattern,'')
    FROM shop_profiles p
    LEFT JOIN shop_instructions i ON i.domain = p.domain
    WHERE p.note_status = 'open'
    ORDER BY p.noted_at
  \"" 2>/dev/null || true)

  TASKS_FOUND=false

  if [ -n "$TASKS" ]; then
    while IFS='|' read -r domain note_text check_method noted_at sender subject_pattern; do
      # Пропустить пустые строки
      [ -z "$domain" ] && continue

      # Убрать пробелы
      domain=$(echo "$domain" | xargs)
      note_text=$(echo "$note_text" | xargs)
      check_method=$(echo "$check_method" | xargs)
      noted_at=$(echo "$noted_at" | xargs)
      sender=$(echo "$sender" | xargs)
      subject_pattern=$(echo "$subject_pattern" | xargs)

      # Проверить не обработано ли уже
      TASK_KEY="${domain}:${noted_at}"
      if grep -qF "$TASK_KEY" "$PROCESSED_FILE" 2>/dev/null; then
        continue
      fi

      TASKS_FOUND=true

      # Обработать задачу
      process_task "$domain" "$note_text" "$check_method" "$noted_at" "$sender" "$subject_pattern"

      # Пометить как обработанное (независимо от результата)
      echo "$TASK_KEY" >> "$PROCESSED_FILE"

    done <<< "$TASKS"
  fi

  # Проверить нужен ли деплой
  if [ "$TASKS_FOUND" = true ]; then
    maybe_deploy
  fi

  # Ждать
  log "💤 Следующая проверка через $((POLL_INTERVAL / 60)) мин..."
  sleep "$POLL_INTERVAL"
done
