import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 8200),
  secretKey: process.env.SECRET_KEY ?? 'dev-only-secret-change-me',
  keysDir: process.env.KEYS_DIR ?? './keys',
  jwtIssuer: process.env.JWT_ISSUER ?? 'evoplatform',
  accessTtlSec: Number(process.env.ACCESS_TOKEN_TTL_SEC ?? 900),
  refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  smtpFallback: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    username: process.env.SMTP_USERNAME,
    password: process.env.SMTP_PASSWORD,
    fromAddress: process.env.SMTP_FROM ?? 'noreply@example.com',
  },
};
