#!/usr/bin/env python3
import json, shutil, time
from pathlib import Path

flows_path = Path('/home/pi/node-red-da/flows.json')
assets = Path('/home/pi/vav_patch_assets')
backup = Path('/home/pi/node-red-da/flows.json.bak-flsum-' + time.strftime('%Y%m%d-%H%M%S'))

NEW_FUNC = (assets / 'curve_writer.js').read_text(encoding='utf-8')
NEW_HTML = (assets / 'page.html').read_text(encoding='utf-8')

shutil.copy2(flows_path, backup)
print('backup', backup)

flows = json.loads(flows_path.read_text(encoding='utf-8'))
MAP = {
    '3d91c14fd319c6ca': ('func', NEW_FUNC),
    '080d1def5812c44f': ('template', NEW_HTML),
}
QTY_IDS = {
    'e9e974c4a06e9f47',
    '7787bb858ad8c153',
    '876611e85a375746',
    '91d15f0eac864568',
}

changed = []
found = set()
for n in flows:
    nid = n.get('id')
    if nid in MAP:
        field, val = MAP[nid]
        if n.get('z') != '9b5b8d7ad5f7564b':
            raise SystemExit('bad z for %s: %s' % (nid, n.get('z')))
        n[field] = val
        changed.append('%s:%s:%s' % (nid, n.get('name'), field))
        found.add(nid)
    if nid in QTY_IDS and n.get('type') == 'function':
        if n.get('z') != '9b5b8d7ad5f7564b':
            raise SystemExit('bad z for qty %s: %s' % (nid, n.get('z')))
        old = n.get('func', '')
        new = old.replace('quantity: 22', 'quantity: 24').replace('起 22 点', '起 24 点')
        if new != old:
            n['func'] = new
            changed.append('%s:%s:qty24' % (nid, n.get('name')))
            found.add(nid)

missing = (set(MAP) | QTY_IDS) - found
if missing:
    raise SystemExit('missing nodes: %s' % missing)

flows_path.write_text(json.dumps(flows, ensure_ascii=False) + '\n', encoding='utf-8')
print('patched', changed)
txt = flows_path.read_text(encoding='utf-8')
assert 'fl_sum_123' in txt
assert 'fl_sum_456' in txt
assert 'quantity: 24' in txt
print('verify strings ok')
