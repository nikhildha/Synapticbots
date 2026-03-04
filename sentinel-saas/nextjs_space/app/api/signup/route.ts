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

    // Send notification to admin
    try {
      const appUrl = process.env.NEXTAUTH_URL || '';
      const appName = appUrl ? new URL(appUrl).hostname.split('.')[0] : 'Sentinel';

      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0891B2; border-bottom: 2px solid #0891B2; padding-bottom: 10px;">
            New User Signup - Sentinel
          </h2>
          <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 10px 0;"><strong>Name:</strong> ${name}</p>
            <p style="margin: 10px 0;"><strong>Email:</strong> ${email}</p>
            <p style="margin: 10px 0;"><strong>Tier:</strong> ${isGodAccount ? 'Ultra (God Account)' : 'Free Trial'}</p>
            <p style="margin: 10px 0;"><strong>Referral:</strong> ${referralCode || 'None'}</p>
          </div>
          <p style="color: #666; font-size: 12px;">
            Signed up at: ${new Date().toLocaleString()}
          </p>
        </div>
      `;

      await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deployment_token: process.env.ABACUSAI_API_KEY,
          app_id: process.env.WEB_APP_ID,
          notification_id: process.env.NOTIF_ID_NEW_USER_SIGNUP,
          subject: `New Signup: ${name}`,
          body: htmlBody,
          is_html: true,
          recipient_email: 'nikhildha@gmail.com',
          sender_email: `noreply@${appUrl ? new URL(appUrl).hostname : 'sentinel.app'}`,
          sender_alias: appName,
        }),
      });
    } catch (emailError) {
      console.error('Failed to send signup notification:', emailError);
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