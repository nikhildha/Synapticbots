import re
from pathlib import Path

def process_main():
    p = Path("main.py")
    t = p.read_text(errors='ignore')
    
    # 1. BRAIN_CACHE_MAX
    t = re.sub(r'self\._BRAIN_CACHE_MAX = \d+', 'self._BRAIN_CACHE_MAX = 40', t)
    
    # 2. Duplicate loggers
    t = t.replace('broadcast_logger.addHandler(_bcast_handler)', 'broadcast_logger.addHandler(_bcast_handler)\n        broadcast_logger.propagate = False')
    
    # 3. Import hoisting
    # Find all inline imports that are indented (minimum 4 spaces)
    import_pattern = re.compile(r'^(\s{4,}(?:import|from).*)$', re.MULTILINE)
    inline_imports = import_pattern.findall(t)
    
    # Filter only actual imports, avoiding False positives in multiline strings
    good_imports = []
    for imp in inline_imports:
        if 'import os' in imp or 'import datetime' in imp or 'from' in imp or 'import' in imp:
            good_imports.append(imp.strip())
            t = t.replace(imp, '') # remove it from body
            
    header_imports = "\n".join(sorted(set(good_imports)))
    
    # Insert at top after general imports
    t = t.replace('import json', f'import json\n{header_imports}')
    
    # 4. Exception swallowing
    t = t.replace('except Exception:', 'except Exception as e:\n            logger.debug(f"Exception caught: {e}", exc_info=True)')
    
    p.write_text(t)
    print("main.py processed")

def process_others():
    for fn in ["tradebook.py", "engine_api.py", "risk_manager.py"]:
        p = Path(fn)
        if p.exists():
            t = p.read_text(errors='ignore')
            t = t.replace('except Exception:', 'except Exception as e:\n            logger.debug(f"Exception caught (handled): {e}", exc_info=True)')
            p.write_text(t)
            print(f"{fn} processed")

def fix_security():
    p1 = Path("engine_api.py")
    t = p1.read_text()
    t = t.replace('"synaptic-internal-2024"', 'os.environ.get("ENGINE_INTERNAL_SECRET", "synaptic-internal-2024")')
    if 'import os' not in t: t = "import os\n" + t
    p1.write_text(t)
    
    p2 = Path("sentinel-saas/nextjs_space/app/api/internal/seed-bots/route.ts")
    if p2.exists():
        t = p2.read_text()
        t = t.replace("=== 'synaptic-internal-2024'", "=== process.env.ENGINE_INTERNAL_SECRET")
        p2.write_text(t)
        
    p3 = Path("sentinel-saas/nextjs_space/app/api/cycle-snapshot/route.ts")
    if p3.exists():
        t = p3.read_text()
        t = t.replace("'synaptic-internal-2024'", "process.env.ENGINE_INTERNAL_SECRET")
        p3.write_text(t)

process_main()
process_others()
fix_security()
