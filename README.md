# KC-MVP Server (NestJS + Postgres + Redis)

שרת NestJS לאפליקציית Karma Community עם Postgres ו-Redis, ו־REST גנרי תואם ל־`DatabaseService` בפרונט.

## 🚀 הפעלה מקומית

```bash
npm install

# הרמת בסיסי נתונים
npm run docker:up

# אתחול סכמות וטבלאות
npm run init:db

# פיתוח
npm run start:dev
```

צרו קובץ `.env` לפי `.env.example` (PORT, Postgres/Redis, CORS)

## 📡 Endpoints

- `GET /` — בריאות
- CRUD גנרי לפי קולקציה (תואם ל־collections של DatabaseService):
  - `GET /api/:collection?userId=...` — רשימת פריטים למשתמש
  - `GET /api/:collection/:userId/:itemId` — פריט בודד
  - `POST /api/:collection` — יצירה/עדכון: body `{ id, userId, data }`
  - `PUT /api/:collection/:userId/:itemId` — עדכון: body `{ data }`
  - `DELETE /api/:collection/:userId/:itemId` — מחיקה

טבלאות נוצרות עם PK מורכב `(user_id, item_id)` ועמודת JSONB בשם `data`.