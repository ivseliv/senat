#!/bin/bash
# Ночной прогон: несколько томов подряд, с ожиданием при упоре в лимит подписки.
#
#   ocr/pipeline/overnight.sh              # тома по умолчанию (приоритетный порядок)
#   ocr/pipeline/overnight.sh 1905 1904    # только указанные годы
#
# Переменные окружения (необязательно):
#   PDFDIR   папка с PDF            (по умолчанию ~/projects/senat_downloader/senat_pdfs)
#   MODEL    sonnet | opus          (по умолчанию sonnet)
#   WAIT     пауза между пробами при лимите, с (по умолчанию 300)
#   MAXWAIT  сколько всего ждать, с (по умолчанию 86400 = 24 ч), потом остановка
#   PAGES    диапазон страниц для проб, например 60-64
#   CLAUDE   путь к claude, если он не в PATH
# Ход работы пишется в ocr/overnight.log. Готовые страницы и тома пропускаются,
# поэтому скрипт можно запускать повторно с той же командой.

if [ -z "${CAFFEINATED:-}" ] && command -v caffeinate >/dev/null 2>&1; then
  CAFFEINATED=1 exec caffeinate -dimsu "$0" "$@"   # мак не засыпает (ни экран, ни система), пока скрипт работает
fi

cd "$(dirname "$0")/../.." || exit 1
PDFDIR=${PDFDIR:-$HOME/projects/senat_downloader/senat_pdfs}
MODEL=${MODEL:-sonnet}
WAIT=${WAIT:-300}
MAXWAIT=${MAXWAIT:-86400}
PIPE=ocr/pipeline
LOG=ocr/overnight.log
CL=(); [ -n "${CLAUDE:-}" ] && CL=(--claude "$CLAUDE")
YEARS=("$@")
[ ${#YEARS[@]} -eq 0 ] && YEARS=(1905 1904 1897 1898 1899 1900 1901 1902 1903 1906 1907 1908 1909 1910 1912 1916)
waited=0

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

# выполнить команду не дольше $1 секунд; зависшую убить
with_timeout() {
  local t=$1; shift
  "$@" & local p=$!
  ( sleep "$t"; kill -TERM "$p" 2>/dev/null; sleep 3; kill -KILL "$p" 2>/dev/null ) >/dev/null 2>&1 & local w=$!
  wait "$p" 2>/dev/null; local rc=$?
  kill "$w" >/dev/null 2>&1
  return $rc
}

save() {  # коммит и пуш; любые ошибки и зависания не фатальны
  export GIT_TERMINAL_PROMPT=0
  git add ocr >/dev/null 2>&1
  git -c user.name="${GIT_USER_NAME:-$(git config user.name)}" commit -q -m "$1" >/dev/null 2>&1
  log "  git: pull..."
  with_timeout 180 git pull -q --rebase origin scans >/dev/null 2>&1 || log "  git: pull не удался или завис (>180 с), продолжаю"
  log "  git: push..."
  with_timeout 300 git push -q origin scans >/dev/null 2>&1 && log "  git: готово" || log "  git: push не удался или завис (>300 с), продолжаю; закоммитьте позже вручную"
}

recognize() {  # $1 = год; повторяет запуск, пока не распознает всё
  local y=$1 rc
  while true; do
    python3 -u $PIPE/run.py "work/$y" --out "ocr/$y" --model "$MODEL" --with-draft "${CL[@]}" 2>&1 | tee -a "$LOG" | grep -v '^p[0-9]'
    rc=${PIPESTATUS[0]}
    [ "$rc" -eq 0 ] && return 0
    if [ "$rc" -eq 2 ]; then
      local cnt; cnt=$(ls "ocr/$y" 2>/dev/null | wc -l)
      if [ "$cnt" != "${LASTSAVED:-}" ]; then save "OCR $y: partial (limit)"; LASTSAVED=$cnt; fi
      waited=$((waited + WAIT))
      if [ "$waited" -gt "$MAXWAIT" ]; then log "Ожидание дольше $((MAXWAIT/3600)) ч, останавливаюсь."; exit 3; fi
      log "Лимит. Жду $((WAIT/60)) мин (всего ждал $((waited/60)) мин)..."
      sleep "$WAIT"
    else
      log "Ошибка распознавания тома $y (код $rc), перехожу к следующему."; return 1
    fi
  done
}

for y in "${YEARS[@]}"; do
  pdf="$PDFDIR/se_a_u_k_ow_-da_e_o-u_k_ow_${y}.pdf"
  if [ ! -f "$pdf" ]; then log "$y: нет файла $pdf, пропускаю"; continue; fi
  if [ -f "ocr/$y/volume.txt" ] && [ -z "${PAGES:-}" ]; then log "$y: уже готов, пропускаю"; continue; fi
  log "=== Том $y ==="
  python3 -u $PIPE/prepare.py "$pdf" --out "work/$y" ${PAGES:+--pages "$PAGES"} 2>&1 | tee -a "$LOG" || { log "$y: prepare не удался"; continue; }
  recognize "$y" || continue
  python3 $PIPE/check.py "work/$y" "ocr/$y" --delete 2>&1 | tee -a "$LOG"
  recognize "$y" || continue
  python3 $PIPE/assemble.py "ocr/$y" --out "ocr/$y/volume.txt" 2>&1 | tee -a "$LOG"
  save "OCR $y: volume (Claude $MODEL)"
  rm -rf "work/$y"   # освободить место, картинки тяжёлые
  log "Том $y готов."
done
log "Всё."
