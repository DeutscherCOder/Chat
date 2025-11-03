import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json());

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
          {
            role: 'user',
            content: `Prüfe diese Chat-Nachricht: "${content}"`
          }
        ],
        max_tokens: 100
      })
    });

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || 'OK';
    
    return {
      isViolation: !aiResponse.includes('OK'),
      warning: aiResponse
    };
  } catch (error) {
    console.error('AI-Moderation Fehler:', error);
    return { isViolation: false, warning: '' };
  }
}

// --- Nachrichten abrufen ---
app.get('/api/messages', async (req, res) => {
  try {
    const lastId = parseInt(req.query.lastId) || 0;
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .gt('id', lastId)
      .order('timestamp', { ascending: true })
      .limit(50);

    if (error) throw error;

    res.json({ messages: data });
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

    if (username.length > 30)
      return res.status(400).json({ error: 'Username zu lang (max 30 Zeichen)' });

    if (content.length > 500)
      return res.status(400).json({ error: 'Nachricht zu lang (max 500 Zeichen)' });

    const moderation = await moderateMessage(content);

    if (moderation.isViolation) {
      // AI-Warnung speichern
      const { error: warningError } = await supabase
        .from('messages')
        .insert([{ username: '🤖 Moderator', content: moderation.warning, is_ai_warning: true }]);
      if (warningError) throw warningError;

      // Loggen
      const { error: logError } = await supabase
        .from('moderation_log')
        .insert([{ username, violation_type: 'racism', original_content: content }]);
      if (logError) throw logError;

      return res.status(200).json({ moderated: true, warning: moderation.warning });
    }

    // Normale Nachricht speichern
    const { error } = await supabase
      .from('messages')
      .insert([{ username, content }]);
    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Fehler beim Speichern:', error);
    res.status(500).json({ error: 'Fehler beim Speichern der Nachricht' });
  }
});

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// --- Root ---
app.get('/', (req, res) => {
  res.json({ message: 'Chat Backend läuft!', endpoints: { health: '/health', messages: '/api/messages', send: 'POST /api/messages' } });
});

app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
