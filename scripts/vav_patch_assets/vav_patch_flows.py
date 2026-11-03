#!/usr/bin/env python3
import json, shutil, time
from pathlib import Path

flows_path = Path('/home/pi/node-red-da/flows.json')
assets = Path('/home/pi/vav_patch_assets')
backup = Path('/home/pi/node-red-da/flows.json.bak-mode-ramp-' + time.strftime('%Y%m%d-%H%M%S'))

NEW_FUNC = (assets / 'curve_writer.js').read_text(encoding='utf-8')

shutil.copy2(flows_path, backup)
print('backup', backup)

flows = json.loads(flows_path.read_text(encoding='utf-8'))
TARGET_TAB = '9b5b8d7ad5f7564b'
KNOWN_IDS = {'3d91c14fd319c6ca'}

changed = []
for n in flows:
    if n.get('type') != 'function':
        continue
    nid = n.get('id')
    name = n.get('name') or ''
    hit = nid in KNOWN_IDS or name == '命令字+曲线并回写' or ('曲线' in name and '回写' in name)
    if not hit:
        continue
    z = n.get('z')
    if z and z != TARGET_TAB:
        print('warn z', nid, z)
    n['func'] = NEW_FUNC
    changed.append('%s:%s' % (nid, name))

if not changed:
    raise SystemExit('curve writer node not found')

flows_path.write_text(json.dumps(flows, ensure_ascii=False) + '\n', encoding='utf-8')
print('patched', changed)
txt = flows_path.read_text(encoding='utf-8')
assert 'RAMP_MS' in txt and 'easeOut' in txt and 'transitioning' in txt
print('verify strings ok')
