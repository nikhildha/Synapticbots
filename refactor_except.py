import re
from pathlib import Path

def fix_file(filename):
    p = Path(filename)
    if not p.exists(): return
    
    text = p.read_text(errors='ignore')
    lines = text.split('\n')
    
    changed = 0
    for i, line in enumerate(lines):
        m = re.match(r'^(\s*)except\s+(?:Exception)?\s*:\s*$', line)
        if m:
            indent = m.group(1)
            # Check if next line is already a logger or pass
            lines[i] = f"{indent}except Exception as e:\n{indent}    try:\n{indent}        logger.debug('Exception caught: %s', e, exc_info=True)\n{indent}    except NameError:\n{indent}        pass"
            changed += 1
            
    p.write_text('\n'.join(lines))
    print(f"Fixed {changed} exceptions in {filename}")

for fn in ["main.py", "tradebook.py", "engine_api.py", "risk_manager.py"]:
    fix_file(fn)
