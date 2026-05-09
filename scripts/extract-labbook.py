#!/usr/bin/env python3
"""Extract design comments from collider-data.jsonc into a labbook.

Reads the original monolithic JSONC (from git history or a local copy) and
produces labbook.md capturing:
  - Commented-out rows/blocks with their merge rationale
  - maintainerNotes fields showing pick guidance per row

Usage:
  python3 scripts/extract-labbook.py                          # from git history
  python3 scripts/extract-labbook.py collider-data.jsonc      # from a file
"""

import json
import re
import subprocess
import sys
from pathlib import Path


def get_source_text(path_arg: str | None) -> str:
    """Get the original JSONC text from a file arg or git history."""
    if path_arg:
        return Path(path_arg).read_text(encoding='utf-8')

    # Try git history — the file was deleted in the split commit
    result = subprocess.run(
        ['git', 'log', '--all', '--diff-filter=D', '--name-only',
         '--pretty=format:%H', '--', 'collider-data.jsonc'],
        capture_output=True, text=True,
    )
    for line in result.stdout.splitlines():
        line = line.strip()
        if re.match(r'^[0-9a-f]{40}$', line):
            commit = line
            break
    else:
        print("Error: can't find collider-data.jsonc in git history", file=sys.stderr)
        sys.exit(1)

    result = subprocess.run(
        ['git', 'show', f'{commit}^:collider-data.jsonc'],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        return result.stdout

    # Try parent commit
    result = subprocess.run(
        ['git', 'show', f'{commit}:collider-data.jsonc'],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        return result.stdout

    print("Error: could not retrieve collider-data.jsonc from git", file=sys.stderr)
    sys.exit(1)


def extract_commented_blocks(text: str) -> list[dict]:
    """Extract // --- COMMENTED OUT ... --- blocks with their rationale."""
    blocks = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.search(r'// --- COMMENTED OUT:\s*(.+?)\s*---', line)
        if m:
            header = m.group(1)
            block_lines = []
            i += 1
            while i < len(lines) and '// --- END COMMENTED OUT ---' not in lines[i]:
                # Strip the leading // and at most one space
                stripped = re.sub(r'^\s*//\s?', '', lines[i])
                block_lines.append(stripped)
                i += 1
            blocks.append({'header': header, 'body': block_lines})
        i += 1
    return blocks


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


def extract_maintainer_notes(text: str) -> list[dict]:
    """Extract maintainerNotes from the parsed JSON, with their row context."""
    clean = re.sub(r',(\s*[}\]])', r'\1', strip_jsonc_comments(text))
    data = json.loads(clean)

    notes = []
    for cat in data.get('categories', []):
        for group in cat.get('groups', []):
            for row in group.get('rows', []):
                if row.get('maintainerNotes'):
                    notes.append({
                        'category': cat['name'],
                        'group': group['name'],
                        'row': row['name'],
                        'note': row['maintainerNotes'],
                    })
    return notes


def main() -> None:
    path_arg = sys.argv[1] if len(sys.argv) > 1 else None
    text = get_source_text(path_arg)

    blocks = extract_commented_blocks(text)
    notes = extract_maintainer_notes(text)

    out = []
    out.append('# Collider Data — Design Labbook')
    out.append('')
    out.append('Design decisions and rationale extracted from `collider-data.jsonc` comments.')
    out.append('This records how rows were merged, cut, or restructured during framework design.')
    out.append('')

    # --- Commented-out blocks ---
    out.append('## Merged & removed rows')
    out.append('')
    out.append(f'{len(blocks)} rows were commented out during framework consolidation.')
    out.append('Each entry shows what was removed and why.')
    out.append('')

    for block in blocks:
        out.append(f'### {block["header"]}')
        out.append('')
        # The body is the original JSON structure — show as a code block
        body = '\n'.join(block['body']).strip()
        if body:
            out.append('```jsonc')
            out.append(body)
            out.append('```')
            out.append('')

    # --- Maintainer notes ---
    out.append('## Maintainer notes')
    out.append('')
    out.append('Pick guidance embedded in row definitions.')
    out.append('')

    for note in notes:
        out.append(f'- **{note["row"]}** ({note["category"]} > {note["group"]})')
        out.append(f'  {note["note"]}')
        out.append('')

    repo = Path(__file__).resolve().parent.parent
    dest = repo / 'labbook.md'
    dest.write_text('\n'.join(out), encoding='utf-8')
    print(f'Wrote {dest} ({len(blocks)} blocks, {len(notes)} maintainer notes)')


if __name__ == '__main__':
    main()
