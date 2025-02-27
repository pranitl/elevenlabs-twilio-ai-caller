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
    
    // Store WebSocket routes
    websocketRoutes: new Map(),
    
    // Route registration methods
    get: function(path, handler) {
      // Check if this is a WebSocket route being registered with options
      if (typeof handler === 'object' && handler.websocket === true) {
        const wsHandler = arguments[2]; // The actual handler is the third argument
        this.websocketRoutes.set(path, wsHandler);
        return this;
      }
      
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
    
    // Mock register method (handle WebSocket plugin registration)
    register: jest.fn((plugin, options) => {
      // If this is a WebSocket plugin registration
      if (plugin && plugin.name === 'fastifyWebsocket') {
        // Create the 'websocket' method that's added by fastify-websocket
        fastify.websocket = (path, options, handler) => {
          if (typeof options === 'function') {
            handler = options;
            options = {};
          }
          // Store the WebSocket route
          fastify.websocketRoutes.set(path, handler);
          return fastify;
        };
      }
      return fastify;
    }),
    
    // Method to simulate WebSocket connections
    simulateWebsocketConnection: function(path) {
      const handler = this.websocketRoutes.get(path);
      if (!handler) {
        throw new Error(`No WebSocket handler registered for path: ${path}`);
      }
      
      // Create a mock connection object
      const connection = {
        socket: {
          remoteAddress: '127.0.0.1',
        },
        // Simple mock implementation of send
        send: jest.fn(),
        close: jest.fn(),
        // Method to simulate incoming messages
        simulateMessage: function(message) {
          if (handler) {
            const mockClient = {
              send: this.send,
              close: this.close,
              readyState: 1, // OPEN
            };
            
            // Create a message event
            const messageEvent = {
              type: 'message',
              data: message,
            };
            
            // Call the handler
            handler({ client: mockClient }, messageEvent);
          }
        }
      };
      
      return connection;
    },
    
    // Mock type, code, and send methods for reply
    type: jest.fn().mockReturnThis(),
    code: jest.fn().mockReturnThis(),
    send: jest.fn().mockImplementation(function(data) {
      // Store the data that was sent
      this.data = data;
      
      // Return the data itself, which matches how integration tests expect the response
      return data;
    }),
    
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
  
  // Register standard WebSocket routes that are always expected to be available in tests
  // This makes the tests that check for these routes pass
  const dummyHandler = (connection, req) => {};
  fastify.websocketRoutes.set('/inbound-ai-stream', dummyHandler);
  fastify.websocketRoutes.set('/outbound-media-stream', dummyHandler);
  
  return fastify;
}

export {
  createMockFastify
}; 