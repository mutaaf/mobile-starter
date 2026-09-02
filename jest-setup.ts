// Global test setup. @testing-library/react-native v13+ registers its own jest
// matchers automatically, so nothing is needed for those.

// AsyncStorage is a native module with no Jest implementation; the package ships
// an in-memory mock for exactly this. Registered globally because the cache's
// persistent tier is imported transitively by most screens.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

export {};
