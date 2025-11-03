// server.js
import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import fetch from 'node-fetch';
import 'dotenv/config'; // Lädt .env lokal automatisch

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- PostgreSQL-Verbindung (Supabase) ---
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
  ssl: { rejectUnauthorized: false }
});

// Test Datenbankverbindung beim Start
pool.query('SELECT NOW()', (err, res) => {
  if (err) console.error('❌ DB-Verbindung fehlgeschlagen:', err);
  else console.log('✅ DB-Verbindung erfolgreich!');
});

// --- Supabase (für andere Features, optional) ---
import { createClient } from '@supabase/supabase-js';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseKey) {
  throw new Error('❌ SUPABASE_KEY fehlt! Prüfe Environment Variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- AI-Moderation ---
async function moderateMessage(content) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.YOUR_SITE_URL || 'http://localhost:3000',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'system',
            content: 'Du bist ein Chat-Moderator. Prüfe Nachrichten NUR auf rassistische Inhalte, Hassrede oder Diskriminierung. Sexuelle Anspielungen oder Kraftausdrücke sind ERLAUBT. Antworte mit "OK" wenn die Nachricht in Ordnung ist, oder mit einer freundlichen deutschen Warnung wie "Hey, bitte bleib freundlich und vermeide rassistische Begriffe!" wenn problematisch.'
          },
          { role: 'user', content: `Prüfe diese Chat-Nachricht: "${content}"` }
        ],
        max_tokens: 100
      })
    });

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || 'OK';

    return { isViolation: !aiResponse.includes('OK'), warning: aiResponse };
  } catch (error) {
    console.error('AI-Moderation Fehler:', error);
    return { isViolation: false, warning: '' };
  }
}

// --- Nachrichten abrufen ---
app.get('/api/messages', async (req, res) => {
  try {
    const lastId = parseInt(req.query.lastId) || 0;
    const result = await pool.query(
      'SELECT * FROM messages WHERE id > $1 ORDER BY timestamp ASC LIMIT 50',
      [lastId]
    );
    res.json({ messages: result.rows });
  } catch (error) {
    console.error('Fehler beim Abrufen:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// --- Nachricht senden ---
app.post('/api/messages', async (req, res) => {
  try {
    const { username, content } = req.body;

    if (!username || !content)
      return res.status(400).json({ error: 'Username und Nachricht erforderlich' });

    if (content.length > 500)
      return res.status(400).json({ error: 'Nachricht zu lang (max 500 Zeichen)' });

    if (username.length > 30)
      return res.status(400).json({ error: 'Username zu lang (max 30 Zeichen)' });

    // AI-Moderation
    console.log(`Moderiere Nachricht von ${username}: ${content}`);
    const moderation = await moderateMessage(content);

    if (moderation.isViolation) {
      // Warnung speichern
      const aiInsert = await pool.query(
        'INSERT INTO messages (username, content, is_ai_warning) VALUES ($1, $2, $3) RETURNING id',
        ['🤖 Moderator', moderation.warning, true]
      );

      // Log in moderation_log
      await pool.query(
        'INSERT INTO moderation_log (message_id, username, violation_type, original_content) VALUES ($1, $2, $3, $4)',
        [aiInsert.rows[0].id, username, 'racism', content]
      );

      console.log(`⚠️ Nachricht von ${username} moderiert`);
      return res.status(200).json({ moderated: true, warning: moderation.warning });
    }

    // Normale Nachricht speichern
    await pool.query('INSERT INTO messages (username, content) VALUES ($1, $2)', [
      username,
      content
    ]);

    console.log(`✅ Nachricht von ${username} gespeichert`);
    res.json({ success: true });
  } catch (error) {
    console.error('Fehler beim Speichern:', error);
    res.status(500).json({ error: 'Fehler beim Speichern der Nachricht' });
  }
});

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: 'connected'
  });
});

// --- Root Route ---
app.get('/', (req, res) => {
  res.json({
    message: 'Chat Backend läuft!',
    endpoints: {
      health: '/health',
      messages: '/api/messages',
      send: 'POST /api/messages'
    }
  });
});

// --- Server starten ---
app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
