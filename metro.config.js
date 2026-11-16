const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// expo-sqlite's browser storage adapter loads its bundled SQLite WebAssembly file.
config.resolver.assetExts.push("wasm");

// SQLite Web requires SharedArrayBuffer support in the browser.
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    middleware(req, res, next);
  };
};

module.exports = config;
