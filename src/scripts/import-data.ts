import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

async function importData() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('❌ DATABASE_URL missing (Set this to your DEV database URL)');
        process.exit(1);
    }

    const anonymizedDir = path.join(process.cwd(), 'data-export-anonymized');
    if (!fs.existsSync(anonymizedDir)) {
        console.error('❌ Anonymized data not found. Run anonymize-data.ts first.');
        process.exit(1);
    }

    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('✅ Connected to target database for import');

        const files = fs.readdirSync(anonymizedDir).filter(f => f.endsWith('.json'));

        // Sort files to handle foreign key dependencies (rough order)
        // You might need to adjust this depending on your schema
        const order = ['users', 'organizations', 'categories', 'posts', 'chats', 'items'];
        files.sort((a, b) => {
            const nameA = a.replace('.json', '').toLowerCase();
            const nameB = b.replace('.json', '').toLowerCase();
            const indexA = order.findIndex(o => nameA.includes(o));
            const indexB = order.findIndex(o => nameB.includes(o));
            return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
        });

        for (const file of files) {
            const tableName = file.replace('.json', '');
            console.log(`Importing table: ${tableName}...`);

            const rows = JSON.parse(fs.readFileSync(path.join(anonymizedDir, file), 'utf8'));
            if (rows.length === 0) {
                console.log(`   Table ${tableName} is empty, skipping.`);
                continue;
            }

            // Clean existing data in THIS table only (be careful!)
            console.log(`   Cleaning table ${tableName}...`);
            await client.query(`TRUNCATE TABLE "${tableName}" CASCADE`);

            // Insert rows
            const columns = Object.keys(rows[0]);
            const columnNames = columns.map(c => `"${c}"`).join(', ');

            for (let i = 0; i < rows.length; i++) {
                const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
                const values = columns.map(c => rows[i][c]);

                await client.query(
                    `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`,
                    values
                );
            }
            console.log(`   Successfully imported ${rows.length} rows into ${tableName}`);
        }

        console.log('✅ Import completed successfully!');
    } catch (err) {
        console.error('❌ Import failed:', err);
    } finally {
        await client.end();
    }
}

importData();
