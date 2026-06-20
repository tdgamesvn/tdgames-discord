import { initDb, cleanupExpiredSessions } from './db/schema';

const db = initDb('data/test.db');
console.log('DB initialized:', db.name);

const deleted = cleanupExpiredSessions(db, 30);
console.log('Cleaned up expired sessions:', deleted);

db.close();
