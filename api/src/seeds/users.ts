import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from '../services/db';

const users = [
  {
    name:     'Administrator',
    username: 'admin',
    email:    'admin@cowtracker.local',
    password: 'Admin@1234',
    role:     'Admin',
    status:   'Active',
  },
  {
    name:     'John Doe',
    username: 'johndoe',
    email:    'john@cowtracker.local',
    password: 'User@1234',
    role:     'User',
    status:   'Active',
  },
];

async function seed() {
  console.log('Seeding users...');

  const upsert = db.prepare(`
    INSERT INTO users (name, username, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      name          = excluded.name,
      email         = excluded.email,
      password_hash = excluded.password_hash,
      role          = excluded.role,
      status        = excluded.status
  `);

  for (const user of users) {
    const hash = await bcrypt.hash(user.password, 10);
    upsert.run(user.name, user.username, user.email, hash, user.role, user.status);
    console.log(`  ✓ ${user.role.padEnd(5)}  @${user.username}  (password: ${user.password})`);
  }

  console.log('\nDone.');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
