import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from engine_api import prisma

def run():
    prisma.connect()
    bots = prisma.bot.find_many(where={"status": "ACTIVE"})
    print("ACTIVE BOTS:")
    for b in bots:
        print(f" - {b.name} (mode={b.mode})")
    prisma.disconnect()

if __name__ == '__main__':
    run()
