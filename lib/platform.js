'use strict';

function getHostingPlatform(env = process.env, platform = process.platform) {
  const providers = [
    [['RENDER', 'RENDER_SERVICE_ID'], 'Render'],
    [['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID'], 'Railway'],
    [['FLY_APP_NAME', 'FLY_REGION'], 'Fly.io'],
    [['DYNO'], 'Heroku'],
    [['VERCEL'], 'Vercel'],
    [['K_SERVICE'], 'Google Cloud Run'],
    [['KOYEB_APP_NAME'], 'Koyeb'],
    [['REPL_ID'], 'Replit']
  ];
  const provider = providers.find(([keys]) => keys.some(key => Boolean(String(env[key] || '').trim())))?.[1];
  const operatingSystem = ({ win32: 'Windows', linux: 'Linux', darwin: 'macOS' })[platform] || platform;
  return `${provider || 'Self-hosted'} (${operatingSystem})`;
}

module.exports = { getHostingPlatform };
