const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  try {
    const adminEmail = 'admin@synaptic.ai';
    const newPassword = 'Admin@2026';
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const user = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {
        password: hashedPassword,
        name: 'System Admin',
        role: 'ADMIN',
      },
      create: {
        email: adminEmail,
        password: hashedPassword,
        name: 'System Admin',
        role: 'ADMIN',
      },
    });

    console.log(`Password reset successfully for ${user.email} to: ${newPassword}`);
  } catch (error) {
    console.error('Failed to reset password:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
