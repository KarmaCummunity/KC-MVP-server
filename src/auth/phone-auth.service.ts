import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

// For development/testing, you can use a mock SMS service
// For production, use Twilio or similar
interface SMSService {
  sendSMS(to: string, message: string): Promise<boolean>;
}

class MockSMSService implements SMSService {
  async sendSMS(to: string, message: string): Promise<boolean> {
    // In development, just log the SMS
    console.log(`📱 [MOCK SMS] To: ${to}, Message: ${message}`);
    return true;
  }
}

class TwilioSMSService implements SMSService {
  private twilioClient: any;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials not configured');
    }
    
    // Note: You'll need to install twilio package
    // this.twilioClient = require('twilio')(accountSid, authToken);
  }

  async sendSMS(to: string, message: string): Promise<boolean> {
    try {
      // Uncomment when Twilio is properly configured
      // await this.twilioClient.messages.create({
      //   body: message,
      //   from: process.env.TWILIO_PHONE_NUMBER,
      //   to: to
      // });
      console.log(`📱 [TWILIO SMS] To: ${to}, Message: ${message}`);
      return true;
    } catch (error) {
      console.error('SMS sending failed:', error);
      return false;
    }
  }
}

@Injectable()
export class PhoneAuthService {
  private readonly logger = new Logger(PhoneAuthService.name);
  private smsService: SMSService;
  private verificationCodes = new Map<string, { code: string; expiresAt: number }>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    // Use mock service for development, Twilio for production
    const useTwilio = process.env.NODE_ENV === 'production' && process.env.TWILIO_ACCOUNT_SID;
    this.smsService = useTwilio ? new TwilioSMSService() : new MockSMSService();
  }

  private normalizePhone(phone: string): string {
    // Remove all non-digit characters and ensure it starts with country code
    let normalized = phone.replace(/\D/g, '');
    
    // If it doesn't start with country code, assume Israel (+972)
    if (!normalized.startsWith('972')) {
      normalized = '972' + normalized;
    }
    
    return '+' + normalized;
  }

  private generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private async storeVerificationCode(phone: string, code: string): Promise<void> {
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    this.verificationCodes.set(phone, { code, expiresAt });
    
    // Also store in database for persistence across server restarts
    try {
      await this.pool.query(
        `INSERT INTO phone_verifications (phone, code, expires_at, created_at)
         VALUES ($1, $2, to_timestamp($3 / 1000.0), NOW())
         ON CONFLICT (phone) 
         DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
        [phone, code, expiresAt]
      );
    } catch (error) {
      this.logger.warn('Failed to store verification code in database:', error);
    }
  }

  private async getStoredVerificationCode(phone: string): Promise<string | null> {
    // First check memory
    const memoryCode = this.verificationCodes.get(phone);
    if (memoryCode && memoryCode.expiresAt > Date.now()) {
      return memoryCode.code;
    }

    // Then check database
    try {
      const { rows } = await this.pool.query(
        `SELECT code FROM phone_verifications 
         WHERE phone = $1 AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [phone]
      );
      
      if (rows.length > 0) {
        return rows[0].code;
      }
    } catch (error) {
      this.logger.warn('Failed to retrieve verification code from database:', error);
    }

    return null;
  }

  private async clearVerificationCode(phone: string): Promise<void> {
    this.verificationCodes.delete(phone);
    
    try {
      await this.pool.query(
        `DELETE FROM phone_verifications WHERE phone = $1`,
        [phone]
      );
    } catch (error) {
      this.logger.warn('Failed to clear verification code from database:', error);
    }
  }

  async sendVerificationCode(phone: string): Promise<{ success: boolean; message: string }> {
    try {
      const normalizedPhone = this.normalizePhone(phone);
      
      // Check if phone is already registered
      const { rows } = await this.pool.query(
        `SELECT 1 FROM users WHERE data->>'phone' = $1 LIMIT 1`,
        [normalizedPhone]
      );
      
      if (rows.length > 0) {
        return { success: false, message: 'Phone number already registered' };
      }

      const code = this.generateVerificationCode();
      await this.storeVerificationCode(normalizedPhone, code);

      const message = `Your Karma Community verification code is: ${code}. Valid for 10 minutes.`;
      const smsSent = await this.smsService.sendSMS(normalizedPhone, message);

      if (smsSent) {
        this.logger.log(`Verification code sent to ${normalizedPhone}`);
        return { success: true, message: 'Verification code sent successfully' };
      } else {
        return { success: false, message: 'Failed to send SMS' };
      }
    } catch (error) {
      this.logger.error('Error sending verification code:', error);
      return { success: false, message: 'Internal server error' };
    }
  }

  async verifyCode(phone: string, code: string): Promise<{ success: boolean; message: string }> {
    try {
      const normalizedPhone = this.normalizePhone(phone);
      const storedCode = await this.getStoredVerificationCode(normalizedPhone);

      if (!storedCode) {
        return { success: false, message: 'Verification code expired or not found' };
      }

      if (storedCode !== code) {
        return { success: false, message: 'Invalid verification code' };
      }

      // Clear the used code
      await this.clearVerificationCode(normalizedPhone);

      return { success: true, message: 'Phone number verified successfully' };
    } catch (error) {
      this.logger.error('Error verifying code:', error);
      return { success: false, message: 'Internal server error' };
    }
  }

  async createUserWithPhone(phone: string, name?: string): Promise<any> {
    try {
      const normalizedPhone = this.normalizePhone(phone);
      const nowIso = new Date().toISOString();
      const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const userData = {
        id: userId,
        phone: normalizedPhone,
        name: name || `User_${normalizedPhone.slice(-4)}`,
        email: `${normalizedPhone.replace('+', '')}@karma-community.local`,
        avatar: 'https://i.pravatar.cc/150?img=1',
        bio: 'משתמש חדש בקארמה קומיוניטי',
        karmaPoints: 0,
        joinDate: nowIso,
        isActive: true,
        lastActive: nowIso,
        location: { city: 'ישראל', country: 'IL' },
        interests: [],
        roles: ['user'],
        postsCount: 0,
        followersCount: 0,
        followingCount: 0,
        notifications: [
          { type: 'system', text: 'ברוך הבא!', date: nowIso },
        ],
        settings: { language: 'he', darkMode: false, notificationsEnabled: true },
        phoneVerified: true,
        emailVerified: false,
      };

      await this.pool.query(
        `INSERT INTO users (user_id, item_id, data, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, NOW(), NOW())
         ON CONFLICT (user_id, item_id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [userId, userId, userData]
      );

      this.logger.log(`Created user with phone: ${normalizedPhone}`);
      return { ok: true, user: this.toPublicUser(userData) };
    } catch (error) {
      this.logger.error('Error creating user with phone:', error);
      throw error;
    }
  }

  private toPublicUser(userData: any): any {
    const { passwordHash, ...rest } = userData;
    return rest;
  }
}
