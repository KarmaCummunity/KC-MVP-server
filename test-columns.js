const { Client } = require('pg');
const client = new Client({ 
  connectionString: 'postgresql://kc:kc_password@localhost:5432/kc_db' 
});

(async () => {
  try {
    await client.connect();
    console.log('Connected to database');
    
    // Check table columns
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'user_profiles' 
      ORDER BY ordinal_position
    `);
    
    console.log('\nColumns in user_profiles:');
    res.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    // Try INSERT
    console.log('\nTrying INSERT...');
    const insertRes = await client.query(`
      INSERT INTO user_profiles (email, name, password_hash, firebase_uid)
      VALUES ('test_col@ex.com', 'Test', 'hash', 'test_col_uid')
      RETURNING firebase_uid
    `);
    console.log('✅ SUCCESS:', insertRes.rows[0]);
    
  } catch (err) {
    console.error('❌ ERROR:', err.message);
    console.error('Code:', err.code);
  } finally {
    await client.end();
  }
})();

