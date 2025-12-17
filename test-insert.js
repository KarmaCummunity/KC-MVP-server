const { Client } = require('pg');
const client = new Client({ 
  connectionString: 'postgresql://kc:kc_password@localhost:5432/kc_db' 
});

(async () => {
  try {
    await client.connect();
    console.log('Testing with text query (no params)...');
    
    const result = await client.query(`
      INSERT INTO user_profiles (email, name, password_hash, firebase_uid)
      VALUES ('text_query@ex.com', 'Text Query', 'hashabc', 'text_uid_abc')
      RETURNING firebase_uid, email
    `);
    
    console.log('✅ SUCCESS:', result.rows[0]);
  } catch (err) {
    console.error('❌ ERROR:', err.message);
    console.error('Code:', err.code);
  } finally {
    await client.end();
  }
})();

