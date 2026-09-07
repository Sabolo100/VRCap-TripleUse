"""Merge the runtime-extracted block texts with the literals that live inline
in the source (status lines, on-screen buttons, result rows), and write one
spreadsheet the whole lot can be reviewed in."""
import json, re, csv, sys, os, glob

SCRATCH = sys.argv[1]
rows = json.load(open(os.path.join(SCRATCH, 'rows.json'), encoding='utf-8'))

# What counts as a user-facing literal, and what it is called on screen.
PATTERNS = [
    (r"setStatus\(\s*'((?:[^'\\]|\\.)*)'", 'státuszsor'),
    (r"setPrompt\(\s*'((?:[^'\\]|\\.)*)'", 'kérdéssor'),
    (r"setFeedback\(\s*'((?:[^'\\]|\\.)*)'", 'visszajelzés'),
    (r"showFeedback\(\s*'((?:[^'\\]|\\.)*)'", 'visszajelzés'),
    (r"promptText\s*=\s*'((?:[^'\\]|\\.)*)'", 'kérdéssor'),
    (r"promptSub\s*=\s*'((?:[^'\\]|\\.)*)'", 'kérdéssor alatt'),
    (r"\bhint:\s*'((?:[^'\\]|\\.)*)'", 'mobil súgósor'),
    (r"\blabel:\s*'((?:[^'\\]|\\.)*)'", 'gombfelirat'),
    (r"\bsub:\s*'((?:[^'\\]|\\.)*)'", 'gomb alsó sor'),
    (r"ui\.text\(\s*'((?:[^'\\]|\\.)*)'", 'panelszöveg'),
    (r"ui\.paragraph\(\s*'((?:[^'\\]|\\.)*)'", 'panel bekezdés'),
    (r"ui\.title\(\s*'((?:[^'\\]|\\.)*)'", 'panelcím'),
    (r"ui\.label\(\s*'((?:[^'\\]|\\.)*)'", 'panelcímke'),
]
METHOD = re.compile(r"^\s*(?:private |public |protected )?(?:async )?(\w+)\s*\(")

def user_facing(s):
    if len(s) < 2:
        return False
    if not re.search(r'[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]', s):
        return False
    # Identifiers and metric names are ascii, lower case and one word.
    if re.fullmatch(r'[a-z][a-zA-Z0-9_./:-]*', s) and ' ' not in s:
        return False
    return True

def scan(path, category, module_label):
    out = []
    src = open(path, encoding='utf-8').read().split('\n')
    method = '-'
    # Join lines that continue a concatenated string so long texts stay whole.
    i = 0
    while i < len(src):
        line = src[i]
        start = i
        while line.rstrip().endswith('+') and i + 1 < len(src):
            i += 1
            line = line.rstrip()[:-1].rstrip() + ' ' + src[i].strip()
        m = METHOD.match(src[start])
        if m and m.group(1) not in ('if', 'for', 'while', 'switch', 'catch', 'return'):
            method = m.group(1)
        stripped = src[start].strip()
        if not stripped.startswith('//') and not stripped.startswith('*'):
            for pat, field in PATTERNS:
                for mm in re.finditer(pat, line):
                    text = mm.group(1).replace("\\'", "'").replace('\\n', ' ')
                    # Concatenated pieces are glued by the join above; drop the
                    # quote-plus-quote seams the source used to wrap them.
                    text = re.sub(r"'\s*\+?\s*'", '', text)
                    if user_facing(text):
                        out.append((method, field, text, start + 1))
    i += 1
    return out

def scan_file(path, category, module_label, prefix):
    src = open(path, encoding='utf-8').read().split('\n')
    method = '-'
    found = []
    i = 0
    while i < len(src):
        raw = src[i]
        start = i
        line = raw
        while line.rstrip().endswith('+') and i + 1 < len(src):
            i += 1
            line = line.rstrip()[:-1].rstrip() + ' ' + src[i].strip()
        # The join dropped the '+' signs, so what is left between two glued
        # fragments is quote-space-quote. Close those seams before matching,
        # or every pattern captures only the first fragment of a long text.
        line = re.sub(r"'\s*\+?\s*'", '', line)
        m = METHOD.match(raw)
        if m and m.group(1) not in ('if', 'for', 'while', 'switch', 'catch', 'return', 'constructor'):
            method = m.group(1)
        s = raw.strip()
        if not s.startswith('//') and not s.startswith('*') and not s.startswith('/*'):
            for pat, field in PATTERNS:
                for mm in re.finditer(pat, line):
                    text = mm.group(1).replace("\\'", "'")
                    if user_facing(text):
                        found.append((method, field, text, start + 1))
        i += 1
    seen = set()
    n = 0
    for method, field, text, line in found:
        if method == 'finish':
            field = 'eredménysor címe' if field == 'gombfelirat' else (
                'eredménysor magyarázata' if field == 'mobil súgósor' else field)
        key = (text, field)
        if key in seen:
            continue
        seen.add(key)
        n += 1
        rows.append({
            'category': category, 'id': f'{prefix}.{method}.{n}',
            'module': module_label, 'variant': '-', 'place': method,
            'field': field, 'platform': 'mind', 'text': text,
            'file': f'{path}:{line}',
        })

# 2. in-run texts, module by module
import importlib
mod_files = sorted(glob.glob('packages/client/src/modules/*/*.ts'))
manifest = json.load(open(os.path.join(SCRATCH, 'codes.json'), encoding='utf-8'))
for f in mod_files:
    base = os.path.basename(f)
    code = None
    for c, ordinal in manifest.items():
        if base.upper().startswith(c[:5]) and c.lower() in base.lower():
            code = c
    if code is None:
        # helper files (stations.ts, figure.ts, navWorld.ts ...)
        folder = os.path.basename(os.path.dirname(f)).upper()
        code = folder if folder in manifest else folder
    ordinal = manifest.get(code, '--')
    label = f'{ordinal} {code}'
    variant = '-B' if 'Spatial' in base else ''
    scan_file(f, '2 FUTÁS KÖZBEN', f'{label}{variant}', f'{ordinal}.{code}{variant}')

def scan_dom(path, label, prefix, category='4 FELÜLET'):
    """The 2D shell builds its text as children of el(...), not through the
    canvas UI, so the targeted patterns above never see it. Here anything that
    reads like a sentence is collected instead."""
    src = open(path, encoding='utf-8').read().split('\n')
    seen = set()
    n = 0
    i = 0
    while i < len(src):
        raw = src[i]
        start = i
        line = raw
        # Long copy is concatenated across lines; glue it back together, or
        # every sentence lands in the sheet as three unreadable fragments.
        while line.rstrip().endswith('+') and i + 1 < len(src):
            i += 1
            line = line.rstrip()[:-1].rstrip() + ' ' + src[i].strip()
        line = re.sub(r"'\s*\+?\s*'", '', line)
        i += 1
        s2 = raw.strip()
        if s2.startswith('//') or s2.startswith('*') or s2.startswith('/*'):
            continue
        for mm in re.finditer(r"'((?:[^'\\]|\\.)*)'", line):
            text = mm.group(1).replace("\\'", "'")
            if len(text) < 3 or text in seen:
                continue
            has_accent = re.search(r'[ÁÉÍÓÖŐÚÜŰáéíóöőúüű]', text)
            words = text.split()
            if not has_accent and not (len(words) > 1 and text[0].isupper()):
                continue
            if re.fullmatch(r'[a-z0-9-]+', text):
                continue
            seen.add(text)
            n += 1
            rows.append({
                'category': category, 'id': f'{prefix}.{n}', 'module': label,
                'variant': '-', 'place': '-', 'field': 'felületi szöveg',
                'platform': 'mind', 'text': text, 'file': f'{path}:{start + 1}',
            })

# 3. runner and shell
for f, label, prefix in [
    ('packages/client/src/engine/task/ModuleRunner.ts', 'FUTTATÓ', 'UI.runner'),
    ('packages/client/src/engine/ui/MobileControls.ts', 'MOBIL VEZÉRLŐK', 'UI.mobile'),
    ('packages/client/src/shell/HubView.ts', 'KEZDŐTÉR', 'UI.hub'),
    ('packages/client/src/shell/mobile/MobileApp.ts', 'MOBIL APP', 'UI.app'),
]:
    if os.path.exists(f):
        scan_file(f, '4 FELÜLET', label, prefix)

for f, label, prefix in [
    ('packages/client/src/shell/HubView.ts', 'KEZDŐTÉR', 'UI.hub.dom'),
    ('packages/client/src/shell/mobile/MobileApp.ts', 'MOBIL APP', 'UI.app.dom'),
    ('packages/shared/src/domains.ts', 'TERÜLETEK', 'UI.domain'),
]:
    if os.path.exists(f):
        scan_dom(f, label, prefix)
for f in sorted(glob.glob('packages/client/src/shell/*.ts')) + sorted(glob.glob('packages/client/src/shell/mobile/*.ts')):
    if f.endswith('HubView.ts') or f.endswith('MobileApp.ts'):
        continue
    scan_dom(f, 'FELÜLET · ' + os.path.basename(f).replace('.ts', ''),
             'UI.' + os.path.basename(f).replace('.ts', ''))

# order: category, module ordinal, then original order
rows.sort(key=lambda r: (r['category'], r['module'], 0))
out = os.environ.get('OUT', 'texts/ui-szovegek.csv')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8-sig', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['SOR', 'ID', 'KATEGÓRIA', 'MODUL', 'VÁLTOZAT', 'HELY',
                'MEZŐ', 'PLATFORM', 'JELENLEGI SZÖVEG', 'JAVÍTOTT SZÖVEG', 'MEGJEGYZÉS', 'FÁJL'])
    for i, r in enumerate(rows, 1):
        w.writerow([i, r['id'], r['category'], r['module'], r['variant'], r['place'],
                    r['field'], r['platform'], r['text'], '', '', r['file']])
print(f'{len(rows)} sor -> {out}')

try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill
    from openpyxl.utils import get_column_letter
    wb = Workbook()
    ws = wb.active
    ws.title = 'Szövegek'
    head = ['SOR', 'ID', 'KATEGÓRIA', 'MODUL', 'VÁLTOZAT', 'HELY', 'MEZŐ',
            'PLATFORM', 'JELENLEGI SZÖVEG', 'JAVÍTOTT SZÖVEG', 'MEGJEGYZÉS', 'FÁJL']
    ws.append(head)
    for c in range(1, len(head) + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor='1F3B54')
        cell.alignment = Alignment(vertical='center')
    for i, r in enumerate(rows, 1):
        ws.append([i, r['id'], r['category'], r['module'], r['variant'], r['place'],
                   r['field'], r['platform'], r['text'], '', '', r['file']])
    widths = [6, 42, 16, 16, 9, 20, 22, 10, 90, 90, 30, 46]
    for c, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(c)].width = w
    for row in ws.iter_rows(min_row=2, min_col=9, max_col=11):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True, vertical='top')
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f'A1:{get_column_letter(len(head))}{len(rows) + 1}'
    xlsx = out.replace('.csv', '.xlsx')
    wb.save(xlsx)
    print(f'{len(rows)} sor -> {xlsx}')
except ImportError:
    pass
