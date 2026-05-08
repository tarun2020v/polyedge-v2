// Simple in-memory store — never expires automatically
// Data only refreshes on manual REFRESH button press

const store = {};

export function cacheGet(key) {
  return store[key] || null;
}

export function cacheSet(key, value) {
  store[key] = value;
}

export function cacheClear(key) {
  if (key) {
    delete store[key];
  } else {
    Object.keys(store).forEach(k => delete store[k]);
  }
}
