#!/usr/bin/env python3
"""One-shot script to split collider-data.jsonc into individual files.

Reads the monolithic collider-data.jsonc, strips JSONC comments, and writes:
  data/framework.jsonc   — categories, principles
  data/comparisons.jsonc — all comparisons
  data/stances/_index.json — ordered array of stance IDs
  data/stances/<id>.jsonc  — one file per stance
"""

import json
import re
import sys
from pathlib import Path


def strip_jsonc_comments(text: str) -> str:
    """Remove // and /* */ comments from JSONC, preserving strings."""
    result = []
    in_string = False
    escaped = False
    i = 0
    while i < len(text):
        c = text[i]
        if in_string:
            result.append(c)
            if escaped:
                escaped = False
            elif c == '\\':
                escaped = True
            elif c == '"':
                in_string = False
            i += 1
            continue
        if c == '"':
            in_string = True
            result.append(c)
            i += 1
            continue
        if c == '/' and i + 1 < len(text) and text[i + 1] == '/':
            while i < len(text) and text[i] != '\n':
                i += 1
            result.append('\n')
            continue
        if c == '/' and i + 1 < len(text) and text[i + 1] == '*':
            i += 2
            while i < len(text) and not (text[i] == '*' and i + 1 < len(text) and text[i + 1] == '/'):
                if text[i] == '\n':
                    result.append('\n')
                i += 1
            i += 2
            continue
        result.append(c)
        i += 1
    return ''.join(result)


def remove_trailing_commas(text: str) -> str:
    """Remove trailing commas before } or ] (common in hand-edited JSON)."""
    return re.sub(r',(\s*[}\]])', r'\1', text)


def to_jsonc(obj: object) -> str:
    """Serialize to pretty-printed JSON (valid JSONC) with 2-space indent."""
    return json.dumps(obj, indent=2, ensure_ascii=False) + '\n'


def main() -> None:
    repo = Path(__file__).resolve().parent.parent
    source = repo / 'collider-data.jsonc'

    if not source.exists():
        print(f"Error: {source} not found", file=sys.stderr)
        sys.exit(1)

    raw = source.read_text(encoding='utf-8')
    clean = remove_trailing_commas(strip_jsonc_comments(raw))
    data = json.loads(clean)

    # Validate expected keys
    for key in ('categories', 'principles', 'stances', 'comparisons'):
        if key not in data:
            print(f"Warning: missing expected key '{key}'", file=sys.stderr)

    # --- framework.jsonc: everything except stances and comparisons ---
    framework = {k: v for k, v in data.items() if k not in ('stances', 'comparisons')}
    data_dir = repo / 'data'
    data_dir.mkdir(exist_ok=True)
    (data_dir / 'framework.jsonc').write_text(to_jsonc(framework), encoding='utf-8')
    print(f"Wrote data/framework.jsonc ({len(framework)} keys)")

    # --- comparisons.jsonc ---
    comparisons = data.get('comparisons', [])
    (data_dir / 'comparisons.jsonc').write_text(to_jsonc(comparisons), encoding='utf-8')
    print(f"Wrote data/comparisons.jsonc ({len(comparisons)} comparisons)")

    # --- stances ---
    stances = data.get('stances', [])
    stances_dir = data_dir / 'stances'
    stances_dir.mkdir(exist_ok=True)

    stance_ids = []
    for stance in stances:
        sid = stance.get('id')
        if not sid:
            print(f"Warning: stance missing 'id', skipping: {stance.get('name', '?')}", file=sys.stderr)
            continue
        stance_ids.append(sid)
        (stances_dir / f'{sid}.jsonc').write_text(to_jsonc(stance), encoding='utf-8')

    # --- _index.json: ordered list of stance IDs ---
    (stances_dir / '_index.json').write_text(to_jsonc(stance_ids), encoding='utf-8')

    print(f"Wrote data/stances/_index.json ({len(stance_ids)} IDs)")
    print(f"Wrote {len(stance_ids)} stance files to data/stances/")
    print("Done.")


if __name__ == '__main__':
    main()
