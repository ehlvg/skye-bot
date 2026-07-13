const appName = process.env.SKYE_PM2_NAME ?? "skye-bot";
const configPath = process.env.SKYE_CONFIG ?? `${__dirname}/config.yaml`;
const dbPath = process.env.DB_PATH ?? `${__dirname}/data/skye.db`;
const logDirectory = `${process.env.HOME ?? "/root"}/.pm2/logs`;

module.exports = {
  apps: [
    {
      name: appName,
      script: "dist/index.js",
      cwd: __dirname,
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      kill_timeout: 30000,
      env: {
        NODE_ENV: "production",
        SKYE_CONFIG: configPath,
        DB_PATH: dbPath,
        MONITORING_OUT_LOG: `${logDirectory}/${appName}-out-0.log`,
        MONITORING_ERROR_LOG: `${logDirectory}/${appName}-error-0.log`,
      },
    },
  ],
};
