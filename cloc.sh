#!/usr/bin/env bash
#
# Count lines of *our* code only.
#
# Source of truth is `git ls-files`: it lists exactly what is under version
# control, applying every .gitignore rule (current and future) automatically.
# So .venv, __pycache__, node_modules, webapp/previews, etc. are never counted
# -- they're gitignored, so git never lists them. As .gitignore grows, this
# script adapts for free; there is nothing to maintain here.
#
# The one thing git tracking can't filter is third-party code we *committed*
# (vendored libs, generated lockfiles). Those are excluded explicitly below.
#
# Usage:
#   linux_scripts/cloc.sh [extra cloc args...]                 # count working tree
#   linux_scripts/cloc.sh -history|-m [N] [--from DATE] [args] # daily growth table
#
# Scope (works in both normal and history mode; default counts everything):
#   --test-only    count only test code (tests/, __tests__/, test_*.py, *.test|spec.js)
#   --prod-only    count only production code (everything that is not test code)
#
# History mode prints one row PER DAY over the window and reports the code total
# as of the end of that day, so you can see how the footprint grew. Days with no
# commits repeat the prior day's count and show a +0 delta. It reads each day's
# state directly from git (via `cloc <sha>`), so it never touches your working
# tree.
#
#   N          number of days in the window (default 30)
#   --from D    start date, e.g. 2026-06-19 (leading zeros optional: 2026-6-9).
#              With N     -> N days starting at D (clamped to today).
#              Without N  -> D through today.
#   Without --from -> the last N days ending today.
#   --cols L    comma-separated language columns (default: Python,JavaScript).
#              Names are cloc's own language names, e.g. --cols Python,CSS,"Bourne Shell".

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Tracked-but-not-ours: vendored libraries and generated/lock files.
# Matched as a regex against each tracked path.
NOT_OURS='(^|/)vendor/|(^|/)package-lock\.json$'

# What counts as test code: anything under a tests/__tests__ dir, plus the
# test_*.py / *.test.js / *.spec.js file-name conventions.
TESTS='(^|/)(tests?|__tests__)/|(^|/)test_[^/]*\.py$|(^|/)[^/]*\.(test|spec)\.[jt]sx?$'

# ---- pre-parse: scope flags (may appear anywhere; stripped from "$@") --------
SCOPE=all                   # all | test | prod
_args=()
for _a in "$@"; do
    case "$_a" in
        --test-only) SCOPE=test ;;
        --prod-only) SCOPE=prod ;;
        *)           _args+=("$_a") ;;
    esac
done
set -- ${_args[@]+"${_args[@]}"}

# Keep only the requested scope on stdin (a line-per-path filter). grep exits
# nonzero on no matches, which set -e would treat as fatal — hence `|| true`.
scope_filter() {
    case "$SCOPE" in
        test) grep -E  "$TESTS" || true ;;
        prod) grep -vE "$TESTS" || true ;;
        *)    cat ;;
    esac
}

# ---- arg parsing: optional history mode -------------------------------------
MODE=normal
DAYS=""                     # empty => not explicitly set
FROM=""
COLS="TypeScript"              # default language columns
case "${1:-}" in
    -m|-history|--history)
        MODE=history
        shift
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --from|--start|-s)  FROM="${2:-}"; shift 2 ;;
                --cols|--langs|-c)  COLS="${2:-}"; shift 2 ;;
                [0-9]*)             DAYS="$1"; shift ;;
                *)                  break ;;   # remaining args go to cloc
            esac
        done
        ;;
esac

# ---- normal mode: count the working tree ------------------------------------
if [[ "$MODE" == normal ]]; then
    filelist="$(mktemp)"
    trap 'rm -f "$filelist"' EXIT
    # --others --exclude-standard also counts new files not yet committed
    # (still applying .gitignore), so pre-commit work is visible.
    git ls-files --cached --others --exclude-standard | grep -vE "$NOT_OURS" | scope_filter > "$filelist"
    cloc --list-file="$filelist" "$@"
    exit 0
fi

# ---- history mode: growth over the last N days ------------------------------
EXTRA=("$@")   # any remaining args are forwarded to cloc at each sample

# Scope filtering for cloc: --prod-only folds the test regex into the
# not-match set; --test-only adds a --match-f so only test paths survive.
NOT_MATCH="$NOT_OURS"
SCOPE_ARGS=()
case "$SCOPE" in
    test) SCOPE_ARGS=(--match-f="$TESTS") ;;
    prod) NOT_MATCH="$NOT_OURS|$TESTS" ;;
esac

# Parse the requested language columns (comma-separated, spaces trimmed).
IFS=',' read -ra _rawcols <<<"$COLS"
LANGS=()
for _c in "${_rawcols[@]}"; do
    _c="${_c#"${_c%%[![:space:]]*}"}"      # ltrim
    _c="${_c%"${_c##*[![:space:]]}"}"      # rtrim
    [[ -n "$_c" ]] && LANGS+=("$_c")
done
(( ${#LANGS[@]} )) || LANGS=(TypeScript)
LANGS_CSV=$(IFS=,; echo "${LANGS[*]}")
ZEROS="$(printf '0 %.0s' "${LANGS[@]}")0"        # one 0 per lang + total

# Count a single git commit (by sha) with the same exclusions as normal mode.
# Echoes "<code for each requested lang...> <total_code>".
count_ref() {
    cloc "$1" --fullpath --not-match-f="$NOT_MATCH" \
        ${SCOPE_ARGS[@]+"${SCOPE_ARGS[@]}"} --json --quiet \
        ${EXTRA[@]+"${EXTRA[@]}"} 2>/dev/null \
        | python3 -c 'import sys, json
langs = [x for x in sys.argv[1].split(",") if x]
try:
    d = json.load(sys.stdin)
except Exception:
    print(" ".join(["0"] * (len(langs) + 1))); raise SystemExit
low = {k.lower(): v for k, v in d.items()}   # case-insensitive language lookup
vals = [str(low.get(l.lower(), {}).get("code", 0)) for l in langs]
vals.append(str(d.get("SUM", {}).get("code", 0)))
print(" ".join(vals))' "$LANGS_CSV" \
        || echo "$ZEROS"
}

# Rewrite LANGS[] to cloc's canonical casing (e.g. "javascript" -> "JavaScript")
# using a reference commit's JSON, so headers look right regardless of how the
# user typed --cols. Uses \x1f as a separator so lang names may contain spaces.
canon_langs() {
    local sha="$1" json canon sep=$'\x1f'
    json=$(cloc "$sha" --fullpath --not-match-f="$NOT_MATCH" \
        ${SCOPE_ARGS[@]+"${SCOPE_ARGS[@]}"} --json --quiet \
        ${EXTRA[@]+"${EXTRA[@]}"} 2>/dev/null) || return 0
    canon=$(printf '%s' "$json" | python3 -c '
import sys, json
sep = "\x1f"
langs = sys.argv[1].split(sep)
try:
    d = json.load(sys.stdin)
except Exception:
    print(sep.join(langs)); raise SystemExit
low = {k.lower(): k for k in d.keys()}
print(sep.join(low.get(l.lower(), l) for l in langs))' "$(IFS=$sep; echo "${LANGS[*]}")") || return 0
    IFS=$sep read -ra LANGS <<<"$canon"
}

# ---- resolve the [start_epoch .. end_epoch] window (midnight, per day) -------
DAY=86400
today_epoch=$(date -d "$(date +%F)" +%s)

if [[ -n "$FROM" ]]; then
    from_fmt=$(date -d "$FROM" +%F 2>/dev/null) || {
        echo "cloc.sh: invalid --from date: '$FROM'" >&2; exit 2; }
    start_epoch=$(date -d "$from_fmt" +%s)
    if [[ -n "$DAYS" ]]; then
        end_epoch=$(( start_epoch + (DAYS - 1) * DAY ))   # N days from start
        (( end_epoch > today_epoch )) && end_epoch=$today_epoch
    else
        end_epoch=$today_epoch                             # start .. today
    fi
    (( start_epoch > today_epoch )) && { echo "cloc.sh: --from is in the future" >&2; exit 2; }
else
    n=${DAYS:-30}
    end_epoch=$today_epoch
    start_epoch=$(( today_epoch - (n - 1) * DAY ))         # last N days
fi

ndays=$(( (end_epoch - start_epoch) / DAY + 1 ))
case "$SCOPE" in
    test) scope_note=' [test code only]' ;;
    prod) scope_note=' [production code only]' ;;
    *)    scope_note='' ;;
esac
printf 'cloc history%s — %s .. %s (%d days)\n' \
    "$scope_note" "$(date -d "@$start_epoch" +%F)" "$(date -d "@$end_epoch" +%F)" "$ndays" >&2
echo >&2

# ---- pass 1: gather every row BEFORE rendering ------------------------------
# Buffering first lets us normalize the delta color scale across the whole
# window (brightest green = the biggest single-day gain in *this* range).
declare -A seen           # sha -> "<lang codes...> total" cache (skip duplicate cloc runs)
# R_langs[i] holds the per-language code counts as a space-joined string.
R_day=(); R_short=(); R_langs=(); R_total=(); R_dnum=(); R_kind=()  # kind: base|pre|num
prev_total=""
first_total=""; first_langs=""
last_total=""; last_langs=""
max_pos=0; max_neg=0
nlang=${#LANGS[@]}
ref_sha=""                                       # newest sha seen (for canon casing)
pre_langs="$(printf '%.0s- ' "${LANGS[@]}")"     # a dash per lang for pre-repo rows

# TUI loading indicator: cycles . .. ... .... ..... while pass 1 crunches.
# Only when stderr is a terminal (stays silent when redirected/logged).
spin=0
tick() {
    [[ -t 2 ]] || return 0
    local n=$(( spin % 5 + 1 )) dots
    printf -v dots '%*s' "$n" ''; dots=${dots// /.}
    printf '\r\033[Kcomputing %-5s' "$dots" >&2
    spin=$(( spin + 1 ))
}

# Hide the cursor while the spinner runs so no block sits after the dots;
# the trap restores it even if we're interrupted (Ctrl-C) mid-crunch.
if [[ -t 2 ]]; then
    printf '\033[?25l' >&2
    trap 'printf "\033[?25h" >&2' EXIT INT TERM
fi

e=$start_epoch
while (( e <= end_epoch )); do
    tick
    day=$(date -d "@$e" +%F)
    # State as of the END of this day (23:59:59); the last-listed row is today.
    sha=$(git rev-list -1 --before="$day 23:59:59" HEAD 2>/dev/null || true)
    if [[ -z "$sha" ]]; then
        R_day+=("$day"); R_short+=("(pre-repo)"); R_langs+=("$pre_langs"); R_total+=("-")
        R_dnum+=(0); R_kind+=("pre")
        e=$(( e + DAY )); continue
    fi
    if [[ -z "${seen[$sha]:-}" ]]; then
        seen[$sha]="$(count_ref "$sha")"
    fi
    read -ra vals <<<"${seen[$sha]}"
    total="${vals[nlang]}"                       # last field is the SUM
    langvals="${vals[*]:0:nlang}"                # per-lang codes as a string

    if [[ -z "$prev_total" ]]; then
        kind=base; dnum=0
        first_total="$total"; first_langs="$langvals"
    else
        kind=num; dnum=$(( total - prev_total ))
        (( dnum > max_pos )) && max_pos=$dnum
        (( -dnum > max_neg )) && max_neg=$(( -dnum ))
    fi
    R_day+=("$day"); R_short+=("$(git rev-parse --short "$sha")")
    R_langs+=("$langvals"); R_total+=("$total"); R_dnum+=("$dnum"); R_kind+=("$kind")
    prev_total="$total"; last_total="$total"; last_langs="$langvals"; ref_sha="$sha"
    e=$(( e + DAY ))
done
[[ -n "$ref_sha" ]] && canon_langs "$ref_sha"   # header casing -> cloc's own
[[ -t 2 ]] && printf '\r\033[K\033[?25h' >&2   # erase indicator, restore cursor

# ---- pass 2: render, coloring the delta cell by normalized magnitude --------
use_color=0
[[ -t 1 && -z "${NO_COLOR:-}" ]] && use_color=1
ESC=$'\e'; RESET="${ESC}[0m"
(( max_pos < 1 )) && max_pos=1     # avoid div-by-zero
(( max_neg < 1 )) && max_neg=1

# Color for a numeric delta: bright green (largest gain) -> dark green,
# flat gray at 0, and (should code ever shrink) dark->bright red for losses.
delta_color() {   # $1 = numeric delta -> echoes an ANSI SGR prefix
    local d=$1 c
    if   (( d > 0 )); then c=$(( 80 + 175 * d / max_pos ));      echo "${ESC}[38;2;0;${c};0m"
    elif (( d < 0 )); then c=$(( 80 + 175 * -d / max_neg ));     echo "${ESC}[38;2;${c};0;0m"
    else                                                          echo "${ESC}[38;2;128;128;128m"
    fi
}

# Per-language column widths: fit the header name, min 9.
COLW=()
for name in "${LANGS[@]}"; do
    w=${#name}; (( w < 9 )) && w=9; COLW+=("$w")
done

# Header
printf '%-12s %-9s' Date Commit
for j in "${!LANGS[@]}"; do printf ' %*s' "${COLW[j]}" "${LANGS[j]}"; done
printf ' %9s %10s\n' Total ΔTotal

# Rows
for i in "${!R_day[@]}"; do
    case "${R_kind[i]}" in
        base) dstr="—" ;;
        pre)  dstr="-" ;;
        num)  printf -v dstr '%+d' "${R_dnum[i]}" ;;
    esac
    printf -v cell '%10s' "$dstr"
    if (( use_color )) && [[ "${R_kind[i]}" == num ]]; then
        cell="$(delta_color "${R_dnum[i]}")${cell}${RESET}"
    fi
    read -ra lv <<<"${R_langs[i]}"
    printf '%-12s %-9s' "${R_day[i]}" "${R_short[i]}"
    for j in "${!LANGS[@]}"; do printf ' %*s' "${COLW[j]}" "${lv[j]:-0}"; done
    printf ' %9s %s\n' "${R_total[i]}" "$cell"
done

if [[ -n "$first_total" && -n "$last_total" ]]; then
    read -ra fv <<<"$first_langs"; read -ra lvv <<<"$last_langs"
    net_langs=""
    for j in "${!LANGS[@]}"; do
        printf -v part '%s %+d' "${LANGS[j]}" "$(( ${lvv[j]:-0} - ${fv[j]:-0} ))"
        [[ -n "$net_langs" ]] && net_langs+=", "
        net_langs+="$part"
    done
    echo
    printf 'Net over window: Total %+d   (%s)\n' \
        "$(( last_total - first_total ))" "$net_langs"
fi
