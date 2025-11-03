import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import pkg from 'pg';

const { Pool } = pkg;
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseKey) throw new Error('SUPABASE_KEY is required!');
const supabase = createClient(supabaseUrl, supabaseKey);

// PostgreSQL Pool
const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false } // Supabase erfordert SSL
});

// Test DB-Verbindung
pool.connect()
  .then(client => {
    console.log('🚀 DB verbunden');
    client.release();
  })
  .catch(err => console.error('❌ DB-Verbindung fehlgeschlagen:', err));

// Routes
app.get('/', (req, res) => res.send('Chat Backend läuft!'));

app.post('/messages', async (req, res) => {
  const { username, content } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO messages (username, content) VALUES ($1, $2) RETURNING *',
      [username, content]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Speichern der Nachricht' });
  }
});

app.get('/messages', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM messages ORDER BY timestamp ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Abrufen der Nachrichten' });
  }
});

// Server starten
app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
