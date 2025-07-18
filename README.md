# Karma Community MVP Server

שרת API עבור אפליקציית Karma Community.

## 🚀 הפעלה מקומית

```bash
# התקנת dependencies
npm install

# הפעלת השרת
npm start

# או עם nodemon לפיתוח
npm run dev
```

## 📡 Endpoints

### Health Check
- `GET /` - בדיקת תקינות השרת

### Chat API
- `POST /api/chat` - שליחת הודעה לצ'אט
  ```json
  {
    "message": "שלום קהילה!"
  }
  ```

### Google Places API
- `GET /autocomplete?input=ירושלים` - חיפוש מיקומים
- `GET /place-details?place_id=...` - פרטי מיקום

## 🌐 הפעלה על Railway

1. היכנס ל-[Railway](https://railway.app/)
2. התחבר עם GitHub
3. לחץ "New Project" → "Deploy from GitHub repo"
4. בחר את הרפוזיטורי שלך
5. השרת יופעל אוטומטית

## 🔧 Environment Variables

- `PORT` - פורט השרת (Railway יקבע אוטומטית)
- `GOOGLE_API_KEY` - מפתח Google Places API

## 📊 לוגים

השרת מדפיס לוגים מפורטים לכל בקשה:
- 🗺️ Autocomplete requests
- 📍 Place details requests  
- 💬 Chat requests

## 🔗 קישורים שימושיים

- [Railway Documentation](https://docs.railway.app/)
- [Google Places API](https://developers.google.com/maps/documentation/places/web-service)