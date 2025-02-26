// test/setup.js
import { jest } from '@jest/globals';
import { 
  setupEnvironmentVariables,
  setupCommonMocks,
  setupModuleCompatibility
} from './common-setup.js';

// Set up environment variables with proper format (Twilio SID must start with 'AC')
setupEnvironmentVariables();

// Add any additional environment variables needed
process.env.PORT = '8001';

// Set up common mocks
setupCommonMocks(jest);

// Handle module compatibility between ESM and CommonJS
setupModuleCompatibility();

// Additional mock for fetch to prevent actual API calls during tests
// This overrides the one in setupCommonMocks if needed
global.fetch = jest.fn(() => 
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  })
);

// Mock console methods to reduce noise during tests
global.console = {
  ...console,
  log: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(), // Make sure warn is also mocked
};

// Clean up mocks after each test
afterEach(() => {
  jest.clearAllMocks();
}); 