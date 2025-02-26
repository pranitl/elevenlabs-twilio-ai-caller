/**
 * Common setup for all test files to ensure consistent environment and mocks
 */
import { jest } from '@jest/globals';

// Mock environment variables needed by most tests
export function setupEnvironmentVariables() {
  process.env.TWILIO_ACCOUNT_SID = 'ACmockedaccountsid';
  process.env.TWILIO_AUTH_TOKEN = 'mockedauthtoken';
  process.env.TWILIO_PHONE_NUMBER = '+15551234567';
  process.env.SALES_TEAM_PHONE_NUMBER = '+15557654321';
  process.env.ELEVENLABS_API_KEY = 'mocked-elevenlabs-api-key';
  process.env.ELEVENLABS_AGENT_ID = 'mocked-elevenlabs-agent-id';
  process.env.MAKE_WEBHOOK_URL = 'https://mock-make-webhook.com/trigger';
}

// Common mocks for frequently used modules
export function setupCommonMocks(jest) {
  // Mock express module
  jest.mock('express', () => {
    return jest.fn(() => ({
      use: jest.fn(),
      get: jest.fn(),
      post: jest.fn(),
      listen: jest.fn()
    }));
  }, { virtual: true });

  // Mock cors module
  jest.mock('cors', () => {
    return jest.fn(() => (req, res, next) => next());
  }, { virtual: true });

  // Mock uuid module
  jest.mock('uuid', () => ({
    v4: jest.fn().mockReturnValue('mocked-uuid-1234')
  }), { virtual: true });

  // Mock fetch for getSignedUrl
  global.fetch = jest.fn().mockImplementation(() => 
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ signed_url: 'wss://api.elevenlabs.io/websocket' }),
    })
  );
}

// Setup mock for the ElevenLabs WebSocket with customizable sentMessages array
export function setupElevenLabsWebSocketMock(sentMessages = []) {
  const sendFn = (data) => {
    // Store sent messages for inspection
    sentMessages.push(data);
  };

  const mockElevenLabsWs = {
    send: jest.fn(sendFn),
    close: jest.fn(),
    readyState: 1, // OPEN
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
    emit: function(event, data) {
      if (this['on' + event]) {
        this['on' + event](data);
      }
    }
  };

  global.WebSocket = jest.fn().mockImplementation(() => mockElevenLabsWs);
  
  return mockElevenLabsWs;
}

// Setup for handling ESM vs CommonJS import/export compatibility issues
export function setupModuleCompatibility() {
  // If we're in a CommonJS environment, make require available
  if (typeof require === 'undefined' && typeof jest !== 'undefined') {
    global.require = jest.fn((module) => {
      if (module === '../mocks/ws.js') {
        return { MockWebSocket: setupMockWebSocket() };
      }
      // Add other module specific mock returns as needed
      return {};
    });
  }
}

// Create a standardized MockWebSocket for testing
export function setupMockWebSocket() {
  const sendFn = jest.fn();
  
  return class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 1; // OPEN
      this.send = sendFn;
      this.close = jest.fn();
      this.addEventListener = jest.fn();
      this.removeEventListener = jest.fn();
      this.dispatchEvent = jest.fn();
    }
    
    emit(event, data) {
      if (this['on' + event]) {
        this['on' + event](data);
      }
    }
  };
} 