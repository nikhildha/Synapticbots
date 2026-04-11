import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const bots = await prisma.bot.findMany({
    select: { id: true, name: true }
  })
  console.log(JSON.stringify(bots, null, 2))
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect())
