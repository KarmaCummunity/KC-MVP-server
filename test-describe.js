const { Client } = require('pg');
const client = new Client({ 
  connectionString: 'postgresql://kc:kc_password@localhost:5432/kc_db' 
});

(async () => {
  try {
    await client.connect();
    
    // Check current database
    const dbRes = await client.query('SELECT current_database()');
    console.log('Connected to database:', dbRes.rows[0].current_database);
    
    // Check if table is view or table
    const typeRes = await client.query(`
      SELECT table_type 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'user_profiles'
    `);
    console.log('Table type:', typeRes.rows[0]?.table_type);
    
    // Check primary key
    const pkRes = await client.query(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'user_profiles'::regclass AND i.indisprimary
    `);
    console.log('Primary key:', pkRes.rows[0]?.attname);
    
    // Check table OID
    const oidRes = await client.query(`SELECT 'user_profiles'::regclass::oid`);
    console.log('Table OID:', oidRes.rows[0].oid);
    
  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await client.end();
  }
})();

