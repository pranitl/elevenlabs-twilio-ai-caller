// test/setup.js
import { jest } from '@jest/globals';

// Mock environment variables
process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-api-key';
process.env.ELEVENLABS_AGENT_ID = 'test-elevenlabs-agent-id';
process.env.TWILIO_ACCOUNT_SID = 'test-twilio-account-sid';
process.env.TWILIO_AUTH_TOKEN = 'test-twilio-auth-token';
process.env.TWILIO_PHONE_NUMBER = '+18001234567';
process.env.SALES_TEAM_PHONE_NUMBER = '+18009876543';
process.env.PORT = '8001';

// Global mock for fetch to prevent actual API calls
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
};

// Clean up mocks after each test
afterEach(() => {
  jest.clearAllMocks();
}); 