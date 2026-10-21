#!/usr/bin/env bash
# corpus/lint.sh — health check for the imbatranim-office corpus.
#   bash corpus/lint.sh          run all checks, exit non-zero on failure
#   bash corpus/lint.sh --index  regenerate index.md's catalog block from summaries
set -u
CORPUS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$CORPUS_DIR")"
FAIL=0
err() { echo "FAIL: $*"; FAIL=1; }

wiki_pages() { find "$CORPUS_DIR/wiki" -name '*.md' | sort; }

get_front() { # get_front <file> <key>
  awk -v key="$2" '
    NR==1 && $0!="---" {exit}
    NR>1 && $0=="---" {exit}
    $0 ~ "^"key":" {sub("^"key":[[:space:]]*",""); print; exit}
  ' "$1"
}

body_lines() { # lines excluding frontmatter
  awk 'NR==1 && $0=="---" {inf=1; next} inf && $0=="---" {inf=0; next} !inf {n++} END {print n+0}' "$1"
}

regen_index() {
  local tmp="$CORPUS_DIR/index.md.tmp"
  {
    echo "# imbatranim-office corpus — index"
    echo
    echo "Start here. Triage on the summary lines; open at most 2–3 pages."
    echo
    echo "- [CLAUDE.md](CLAUDE.md) — the rules and conventions for this corpus"
    echo "- [routing.md](routing.md) — intent/knowledge routing for work-intake"
    echo "- [log.md](log.md) — chronological record of meaningful changes"
    echo
    echo "## Wiki"
    echo
    while IFS= read -r f; do
      local rel name summary
      rel="wiki/$(basename "$f")"
      name="$(basename "$f" .md)"
      summary="$(get_front "$f" summary)"
      echo "- [$name]($rel) — ${summary:-MISSING SUMMARY}"
    done < <(wiki_pages)
    echo
    echo "## Work"
    echo
    echo "- Brief states live one-per-line in [wiki/status.md](wiki/status.md);"
    echo "  specs in [briefs/](briefs/), captures in [todos/](todos/)."
  } > "$tmp"
  mv "$tmp" "$CORPUS_DIR/index.md"
  echo "index.md regenerated."
}

if [[ "${1:-}" == "--index" ]]; then
  regen_index
  exit 0
fi

# 1. Frontmatter: every wiki page has summary: + updated:
while IFS= read -r f; do
  [[ -n "$(get_front "$f" summary)" ]] || err "$f missing summary: frontmatter"
  [[ -n "$(get_front "$f" updated)" ]] || err "$f missing updated: frontmatter"
done < <(wiki_pages)

# 2. Relative markdown links resolve (skip URLs and anchors)
while IFS= read -r f; do
  dir="$(dirname "$f")"
  while IFS= read -r link; do
    [[ "$link" =~ ^(https?:|mailto:|#) ]] && continue
    target="${link%%#*}"
    [[ -z "$target" ]] && continue
    [[ -e "$dir/$target" ]] || err "$f -> broken link: $link"
  done < <(grep -oE '\]\(([^)]+)\)' "$f" | sed -E 's/^\]\(//; s/\)$//')
done < <(find "$CORPUS_DIR" -name '*.md' -not -path '*/briefs/done/*' -not -path '*/briefs/superseded/*')

# 3. Page size: wiki pages <= 200 body lines
while IFS= read -r f; do
  n="$(body_lines "$f")"
  (( n <= 200 )) || err "$f has $n body lines (max 200) — split it"
done < <(wiki_pages)

# 4. Stale path roots: wiki references to top-level dirs that don't exist.
#    (Only flags ../<dir>/ style refs out of the corpus.)
while IFS= read -r f; do
  while IFS= read -r ref; do
    d="$(echo "$ref" | sed -E 's/^\.\.\/([^/)]+).*/\1/')"
    [[ -e "$REPO_ROOT/$d" ]] || err "$f references ../$d which doesn't exist in repo"
  done < <(grep -oE '\]\(\.\./\.\./[^)]+\)' "$f" | sed -E 's/^\]\(\.\.\///; s/\)$//')
done < <(wiki_pages)

if (( FAIL )); then
  echo "corpus lint: FAILED"
  exit 1
fi
echo "corpus lint: OK"
