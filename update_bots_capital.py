import asyncio
from prisma import Prisma

async def main():
    prisma = Prisma()
    await prisma.connect()
    updated = await prisma.bot.update_many(
        where={},
        data={"capitalPerTrade": 3000.0}
    )
    print(f"Updated {updated} bots to 3000 capitalPerTrade in the database.")
    await prisma.disconnect()

if __name__ == '__main__':
    asyncio.run(main())
