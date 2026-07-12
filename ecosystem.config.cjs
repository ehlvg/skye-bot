module.exports = {
  apps: [
    {
      name: "skye-bot",
      script: "dist/index.js",
      cwd: __dirname,
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      kill_timeout: 30000,
      env: {
        NODE_ENV: "production",
        SKYE_CONFIG: `${__dirname}/config.yaml`,
        DB_PATH: `${__dirname}/data/skye.db`,
        MONITORING_OUT_LOG: `${process.env.HOME ?? "/root"}/.pm2/logs/skye-bot-out-0.log`,
        MONITORING_ERROR_LOG: `${process.env.HOME ?? "/root"}/.pm2/logs/skye-bot-error-0.log`,
      },
    },
  ],
};
