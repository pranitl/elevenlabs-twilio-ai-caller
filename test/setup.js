// test/setup.js
// Main setup file for all tests

import { jest } from '@jest/globals';
import TwilioMock from './mocks/twilio-mock.js';
import { MockElevenLabsWebSocket, setupMockFetch, resetConversationStore } from './mocks/elevenlabs-mock.js';
import { mockAxios, clearWebhookStore } from './mocks/make-mock.js';
import { MockWebSocket, clearConnectionStore } from './mocks/websocket-mock.js';

import { 
  setupEnvironmentVariables,
  setupCommonMocks
} from './common-setup.js';

// Set up environment variables with proper format (Twilio SID must start with 'AC')
setupEnvironmentVariables();

// Initialize test settings container
global.testSettings = {
  // AMD (Answering Machine Detection) simulation result
  amdResult: 'human', // 'human', 'machine_start', 'machine_end_beep', etc.
  
  // User transcript simulation
  userTranscript: 'Hello, I need help with care services.',
  
  // AI response simulation
  aiResponse: 'I understand you need help with care services. Can you tell me more about what you\'re looking for?',
  
  // Sales team availability
  salesTeamAvailable: true,
  
  // Skip AI responses for more controlled tests
  skipAiResponses: false
};

// Initialize test callbacks container
global.testCallbacks = {
  // Callback for Twilio status updates
  twilioStatusCallback: null,
  
  // Callback for Twilio AMD results
  twilioAmdCallback: null
};

// Add any additional environment variables needed
process.env.PORT = '8001';

// Mock Twilio
jest.mock('twilio', () => {
  return jest.fn((accountSid, authToken) => {
    return new TwilioMock(accountSid, authToken);
  });
});

// Mock WebSocket
jest.mock('ws', () => {
  return MockWebSocket;
});

// Mock ElevenLabs WebSocket (replaces the default WebSocket when needed)
global.WebSocket = MockElevenLabsWebSocket;

// Mock axios
jest.mock('axios', () => {
  return mockAxios;
});

// Mock fetch
setupMockFetch();

// Set up common mocks
setupCommonMocks(jest);

// Mock console methods to reduce noise during tests
// But preserve the ability to see them when DEBUG=true is set
if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };
}

// Clean up mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
  
  // Reset test settings to defaults
  global.testSettings = {
    amdResult: 'human',
    userTranscript: 'Hello, I need help with care services.',
    aiResponse: 'I understand you need help with care services. Can you tell me more about what you\'re looking for?',
    salesTeamAvailable: true,
    skipAiResponses: false
  };
  
  // Reset test callbacks
  global.testCallbacks = {
    twilioStatusCallback: null,
    twilioAmdCallback: null
  };
  
  // Reset conversation store
  resetConversationStore();
  
  // Reset webhook store
  clearWebhookStore();
  
  // Reset WebSocket connections
  clearConnectionStore();
});

// Helper function to create a mock Fastify instance for testing
function createMockFastify() {
  const fastify = {
    // Store registered routes
    routes: [],
    
    // Route registration methods
    get: function(path, handler) {
      this.routes.push({ method: 'GET', path, handler });
      return this;
    },
    
    post: function(path, handler) {
      this.routes.push({ method: 'POST', path, handler });
      return this;
    },
    
    all: function(path, handler) {
      this.routes.push({ method: 'ALL', path, handler });
      return this;
    },
    
    // Mock addHook method
    addHook: jest.fn(),
    
    // Mock register method (will be overridden by mockFastifyWebsocket)
    register: jest.fn((plugin, options) => {
      return fastify;
    }),
    
    // Mock type and send methods for reply
    type: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    
    // Mock public listen method
    listen: jest.fn().mockResolvedValue({ port: 8001 })
  };
  
  // Add mock log methods
  fastify.log = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  };
  
  return fastify;
}

export {
  createMockFastify
}; 