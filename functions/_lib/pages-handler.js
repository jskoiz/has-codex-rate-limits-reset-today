const assignCloudflareEnv = (env = {}) => {
  globalThis.__CF_PAGES_ENV__ = env;

  if (!globalThis.process?.env) {
    return;
  }

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      globalThis.process.env[key] = value;
    }
  }
};

export const createPagesHandler = (handler) => {
  return async (context) => {
    assignCloudflareEnv(context.env);
    return handler(context.request);
  };
};
