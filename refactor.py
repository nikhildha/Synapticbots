import re
import sys
from pathlib import Path

def refactor_main():
    p = Path("main.py")
    t = p.read_text(errors='ignore')
    
    import_pattern = re.compile(r'^(\s{4,})(import\s+.*|from\s+.*\s+import\s+.*)$', re.MULTILINE)
    
    extracted = []
    
    def replacer(match):
        imp = match.group(2)
        extracted.append(imp)
        return ""  # Remove the matched line
    
    new_t = import_pattern.sub(replacer, t)
    
    # Filter and format extracted imports
    good = []
    for e in extracted:
        if 'import' in e and not e.startswith('#'):
            good.append(e.strip())
            
    header_block = "\n".join(sorted(set(good)))
    
    # Insert header block into top section of file, around line 45
    target = "from feature_engine import compute_all_features, compute_hmm_features, compute_trend, compute_ema"
    replacement = f"{target}\n\n# ── Hoisted Local Imports ──\n{header_block}\n"
    
    if target in new_t:
        new_t = new_t.replace(target, replacement, 1)
        p.write_text(new_t)
        print("Success! Processed", len(good), "local imports.")
    else:
        print("Error: Target anchor not found in main.py")
        sys.exit(1)

if __name__ == "__main__":
    refactor_main()
