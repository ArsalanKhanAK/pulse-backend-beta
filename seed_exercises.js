const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function seed() {
  try {
    const html = fs.readFileSync('C:/xampp/htdocs/GYM APP/Ex Gif/index.html', 'utf8');
    const startStr = 'const EXERCISES = ';
    const startIndex = html.indexOf(startStr);
    if (startIndex === -1) throw new Error('Could not find EXERCISES in html');
    let jsonStr = html.substring(startIndex + startStr.length);
    const endIndex = jsonStr.indexOf(';\n');
    jsonStr = jsonStr.substring(0, endIndex);
    
    console.log('Found EXERCISES array. Parsing...');
    const exercises = JSON.parse(jsonStr);
    console.log(`Parsed ${exercises.length} exercises.`);

    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'gym_management',
      port: parseInt(process.env.DB_PORT || '3306', 10)
    });

    console.log('Connected to DB. Seeding...');
    let inserted = 0;
    for (const ex of exercises) {
      await connection.query(
        'INSERT IGNORE INTO exercises (id, name, category, muscle_group, target, equipment, image_path, gif_path, instructions_en, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ex.id, ex.name, ex.category, ex.muscle_group, ex.target, ex.equipment, ex.image, ex.gif_url, JSON.stringify(ex.instruction_steps?.en || []), new Date(ex.created_at)]
      );
      inserted++;
      if (inserted % 100 === 0) console.log(`Inserted ${inserted} exercises...`);
    }
    
    console.log('Seeding complete!');
    await connection.end();
  } catch(e) {
    console.error(e);
  }
}
seed();
