import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { GOD_REFERRAL_CODE } from '@/lib/subscription-limits';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, confirmPassword, name, referralCode, phone } = body;

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: 'Passwords do not match' },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'Email already exists' },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const isGodAccount = referralCode?.toLowerCase?.() === GOD_REFERRAL_CODE;

    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        referralCode: referralCode || null,
        phone: phone || null,
      },
    });

    // Create subscription based on referral code
    if (isGodAccount) {
      // God account: Ultra tier, no expiry, no payment
      await prisma.subscription.create({
        data: {
          userId: user.id,
          tier: 'ultra',
          status: 'active',
          coinScans: 50,
          currentPeriodEnd: null, // never expires
        },
      });
    } else {
      // Normal signup: Free trial, 14 days
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);

      await prisma.subscription.create({
        data: {
          userId: user.id,
          tier: 'free',
          status: 'trial',
          coinScans: 5,
          trialEndsAt,
        },
      });
    }

    return NextResponse.json(
      {
        message: 'User created successfully',
        user: { id: user.id, email: user.email, name: user.name },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}