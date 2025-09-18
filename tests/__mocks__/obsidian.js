// Mock Obsidian module for testing
module.exports = {
  Platform: {
    isDesktopApp: true,
    isMobileApp: false
  },
  Notice: jest.fn(),
  Setting: jest.fn(),
  Modal: jest.fn(),
  App: jest.fn(),
  TFile: jest.fn(),
  Vault: jest.fn(),
  normalizePath: (path) => path
};
