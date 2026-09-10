# Codex Inc Portfolio v2

Production-oriented portfolio foundation using Express + PostgreSQL. It avoids native SQLite modules, so it is suitable for Termux installation and Render/Neon deployment.

## Local Termux setup

1. Keep the project under Termux home, not `/storage/emulated/0/Download`.
2. Copy `.env.example` to `.env` and set a PostgreSQL `DATABASE_URL`.
3. Run `npm install`.
4. Run `npm run check`.
5. Run `npm start`.
6. Open `http://localhost:3000`.
7. Admin: `http://localhost:3000/admin/login`.

Neon pooled connection strings use PostgreSQL URL syntax and SSL. Render can provide `DATABASE_URL` through its environment settings.

## Security

Do not commit `.env`. Change the admin password before deployment. Uploaded images are stored locally in this starter; for production, use object storage such as Cloudinary or another persistent storage provider.
