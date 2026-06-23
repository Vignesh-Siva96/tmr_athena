/**
 * PM2 process definitions for the TMR Support Platform (production).
 *
 * Runs the three Node services. Infra (PostgreSQL, S3-compatible object storage)
 * is NOT managed here — provision it separately and point the env at it.
 *
 * Env loading:
 *   - api    reads the repo-root `.env` itself (NestJS ConfigModule:
 *            envFilePath ['../../.env', '.env'] relative to apps/api).
 *   - portal/bridge: NEXT_PUBLIC_* vars are inlined at BUILD time, so they must
 *            be set before `pnpm build` (see DEPLOY.md), not just at runtime.
 *
 * Deploy sequence lives in DEPLOY.md. Bring up with:
 *   pm2 start ecosystem.config.cjs && pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'athena-api',
      cwd: './apps/api',
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
      },
    },
    {
      name: 'athena-portal',
      cwd: './apps/portal',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'athena-bridge',
      cwd: './apps/bridge',
      script: 'node_modules/.bin/next',
      args: 'start -p 3002',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
