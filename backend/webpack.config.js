const nodeExternals = require('webpack-node-externals');

/**
 * Nest's default webpack build bundles everything under node_modules into
 * dist/main.js. That's fine for pure-JS dependencies, but it breaks
 * puppeteer: puppeteer locates its own downloaded Chromium binary using
 * paths resolved relative to its own install directory, and webpack
 * rewrites those at bundle time. Keeping node_modules external — the normal
 * `require()` resolution a plain `tsc` build would use — is what most
 * NestJS services actually run in production, and it's the only mode any
 * package with this kind of runtime path assumption works in.
 */
module.exports = (options) => ({
  ...options,
  externals: [nodeExternals()],
});
