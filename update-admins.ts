
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Pool } from 'pg';
import { PG_POOL } from './src/database/database.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const pool = app.get<Pool>(PG_POOL);

    const adminEmails = [
        'mahalalel100@gmail.com',
        'matan7491@gmail.com',
        'ichai1306@gmail.com',
        'lianbh2004@gmail.com',
        'navesarussi@gmail.com',
        'karmacommunity2.0@gmail.com'
    ];

    console.log('Granting admin permissions to:', adminEmails);

    for (const email of adminEmails) {
        try {
            const normalizedEmail = email.toLowerCase().trim();

            // Check if user exists
            const checkRes = await pool.query(
                `SELECT id, roles FROM user_profiles WHERE LOWER(email) = $1`,
                [normalizedEmail]
            );

            if (checkRes.rows.length === 0) {
                console.warn(`⚠️ User not found: ${email}`);
                continue;
            }

            const user = checkRes.rows[0];
            const currentRoles = user.roles || [];

            if (currentRoles.includes('admin')) {
                console.log(`✅ ${email} is already an admin.`);
                continue;
            }

            // Update roles
            await pool.query(
                `UPDATE user_profiles 
                 SET roles = array_append(roles, 'admin') 
                 WHERE id = $1`,
                [user.id]
            );

            console.log(`🎉 Granted admin permissions to ${email}`);

        } catch (err) {
            console.error(`❌ Failed to update ${email}:`, err);
        }
    }

    await app.close();
}

bootstrap();
