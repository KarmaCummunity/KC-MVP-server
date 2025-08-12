// server.js
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;

// Google API key from environment (do NOT hardcode secrets)
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Karma Community Server is running!',
    timestamp: new Date().toISOString()
  });
});

app.get('/autocomplete', async (req, res) => {
  console.log(`🗺️  Autocomplete request: ${req.query.input}`);
  const input = req.query.input;

  if (!input) {
    return res.status(400).json({ error: "Missing input parameter" });
  }

  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
    input
  )}&key=${GOOGLE_API_KEY}&language=he&components=country:il`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      return res.status(500).json({ error: data.status, message: data.error_message });
    }

    res.json(data.predictions);
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get('/place-details', async (req, res) => {
  console.log(`📍 Place details request: ${req.query.place_id}`);
  const placeId = req.query.place_id;

  if (!placeId) {
    return res.status(400).json({ error: "Missing place_id parameter" });
  }

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}&language=he`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      return res.status(500).json({ error: data.status, message: data.error_message });
    }

    res.json(data.result);
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post('/api/chat', async (req, res) => {
  console.log(`💬 Chat request: ${req.body.message}`);
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Missing message in request body" });
  }

  // In a real scenario, you would process the message with an AI service.
  // For now, we'll just echo it back with a prefix.
  const responseMessage = `AI says: You sent "${message}"`;

  setTimeout(() => {
    res.json({ reply: responseMessage });
  }, 1000);
});

app.listen(PORT, () => {
  console.log(`🚀 Karma Community Server is running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
  console.log(`💬 Chat API: http://localhost:${PORT}/api/chat`);
  console.log(`🗺️  Autocomplete API: http://localhost:${PORT}/autocomplete`);
  console.log(`📍 Place Details API: http://localhost:${PORT}/place-details`);
});
