# Changelog

## [1.7.6] - 2025-11-23

### Fixed
- **תיקון שגיאות TypeScript בקונטרולר Challenges:** תיקנו שגיאות קומפילציה ב-`challenges.controller.ts`
  - הוספנו ערכי ברירת מחדל למאפיינים הנדרשים ב-DTOs
  - תיקנו בעיות עם `strictPropertyInitialization` ב-TypeScript
  - השגיאות שתוקנו: `Property 'X' has no initializer and is not definitely assigned in the constructor`

### Technical Details
- שינינו את הגדרת המאפיינים ב-DTOs מ-`name!: string` ל-`name: string = ''`
- זה מאפשר ל-TypeScript בהגדרות strict לקמפל בהצלחה תוך שמירה על התנהגות זהה

### Classes Updated
- `CreateChallengeDto`
- `CreateResetLogDto`
- `CreateRecordBreakDto`

---

## [1.7.5] - 2025-11-23

### Fixed
- **שמירת נתוני ביקורים באתר:** הוספנו את `site_visits` לרשימת הסטטיסטיקות ההתחלתיות כדי למנוע איפוס בעת עדכון השרת
- **Data Persistence:** שיפרנו את מנגנון שמירת הנתונים ב-Railway עם הערות והודעות לוג מפורטות

### Added
- הוספנו הודעות לוג מפורטות (`✨ Created` / `✅ Preserved`) כדי לעקוב אחר שמירת הסטטיסטיקות
- הוספנו הערות בקוד המסבירות את מנגנון ה-`ON CONFLICT DO NOTHING`
- נוספו מסמכי תיעוד:
  - `RAILWAY_DATA_PERSISTENCE.md` - מדריך מפורט לשמירת נתונים ב-Railway
  - עדכון `RAILWAY.md` עם סעיף על Data Persistence

### Technical Details
- בקובץ `src/database/database.init.ts`:
  - הוספנו `site_visits` לרשימת `defaultStats`
  - שיפרנו את ההודעות ב-console.log כדי להבחין בין יצירת סטטיסטיקה חדשה לשמירת קיימת
  - הוספנו `RETURNING` ל-query כדי לדעת אם הנתון נוצר או נשמר

### Notes
- השינוי מבטיח ש-`site_visits` ושאר הסטטיסטיקות **לא יתאפסו** בעת עדכון השרת ב-Railway
- הנתונים נשמרים באמצעות `ON CONFLICT (stat_type, city, date_period) DO NOTHING`
- **חשוב:** יש לוודא שהשרת מחובר ל-Postgres Plugin של Railway ולא למסד נתונים זמני

---

## [1.7.4] - קודם
- גרסה קודמת


