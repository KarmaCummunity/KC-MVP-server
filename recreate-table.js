const { Client } = require('pg');
const client = new Client({ 
  connectionString: 'postgresql://kc:kc_password@localhost:5432/kc_db' 
});

(async () => {
  try {
    await client.connect();
    console.log('✅ Connected to:', (await client.query('SELECT current_database()')).rows[0].current_database);
    
    // Drop table
    console.log('🗑️  Dropping user_profiles...');
    await client.query('DROP TABLE IF EXISTS user_profiles CASCADE');
    console.log('✅ Dropped');
    
    // Create table
    console.log('🏗️  Creating user_profiles...');
    await client.query(`
      CREATE TABLE user_profiles (
        firebase_uid TEXT PRIMARY KEY,
        google_id TEXT UNIQUE,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        avatar_url TEXT,
        bio TEXT,
        karma_points INTEGER DEFAULT 0,
        join_date TIMESTAMPTZ DEFAULT NOW(),
        is_active BOOLEAN DEFAULT true,
        last_active TIMESTAMPTZ DEFAULT NOW(),
        city VARCHAR(100),
        country VARCHAR(100) DEFAULT 'Israel',
        interests TEXT[],
        roles TEXT[] DEFAULT ARRAY['user'],
        posts_count INTEGER DEFAULT 0,
        followers_count INTEGER DEFAULT 0,
        following_count INTEGER DEFAULT 0,
        total_donations_amount DECIMAL(10,2) DEFAULT 0,
        total_volunteer_hours INTEGER DEFAULT 0,
        password_hash TEXT,
        email_verified BOOLEAN DEFAULT false,
        settings JSONB DEFAULT '{"language": "he", "dark_mode": false, "notifications_enabled": true, "privacy": "public"}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ Created');
    
    // Verify
    const pkRes = await client.query(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'user_profiles'::regclass AND i.indisprimary
    `);
    console.log('✅ Primary key is now:', pkRes.rows[0].attname);
    
    // Test INSERT
    console.log('🧪 Testing INSERT...');
    const res = await client.query(`
      INSERT INTO user_profiles (firebase_uid, email, name, password_hash)
      VALUES ($1, $2, $3, $4)
      RETURNING firebase_uid, email
    `, ['test_recreate_uid', 'test_recreate@ex.com', 'Test', 'hash123']);
    console.log('✅ INSERT SUCCESS:', res.rows[0]);
    
  } catch (err) {
    console.error('❌ ERROR:', err.message);
    console.error('Stack:', err.stack);
  } finally {
    await client.end();
  }
})();

