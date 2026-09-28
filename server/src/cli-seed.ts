/**
 * Capture the current corpus as a committed snapshot.
 *
 *   npm run seed -w @wardline/server
 */

import { Store } from './db.js';
import { writeSeed } from './seed.js';

const path = process.argv[2] ?? 'seed/corpus.json';
const store = new Store(process.env['DB_PATH'] ?? '.data/wardline.db');

const count = writeSeed(store, path);
process.stdout.write('  wrote ' + count + ' repositories to ' + path + '\n');

store.close();
