// server.js
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 3001;

// Your real Google API key
const GOOGLE_API_KEY = "AIzaSyAgkx8Jp2AfhhYL0wwgcOqONpaJ0-Mkcf8";

app.use(cors());

app.get('/autocomplete', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
