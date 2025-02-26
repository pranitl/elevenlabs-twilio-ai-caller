// test/unit/outbound-calls-elevenlabs.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';

// Mock the ws module
jest.mock('ws', () => {
  const { MockWebSocket } = require('../mocks/ws.js');
  return {
    WebSocket: MockWebSocket,
    OPEN: 1,
    CLOSED: 3
  };
});

// Mock fetch for ElevenLabs API calls
global.fetch = jest.fn().mockImplementation((url, options) => {
  if (url.includes('get_signed_url')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ signed_url: 'wss://api.elevenlabs.io/websocket' }),
    });
  } else if (url.includes('transcript')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        conversation_id: 'conv_123456',
        transcripts: [
          { speaker: 'agent', text: 'Hello, this is Heather from First Light Home Care.' },
          { speaker: 'user', text: 'Hi, yes this is John.' }
        ]
      }),
    });
  } else if (url.includes('summary')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        conversation_id: 'conv_123456',
        summary: 'The agent called to confirm details about home care services. The customer confirmed interest.'
      }),
    });
  } else {
    return Promise.resolve({
      ok: false,
      statusText: 'Not Found',
    });
  }
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Outbound Calls ElevenLabs Integration', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Register routes
    registerOutboundRoutes(mockFastify);
  });

  describe('getSignedUrl function', () => {
    it('should fetch a signed URL from ElevenLabs', async () => {
      // Find the getSignedUrl function in the mock calls
      // This is a bit tricky since it's not exported directly
      // We'll test it indirectly by checking the fetch call
      
      // Reset fetch mock
      global.fetch.mockClear();
      
      // Make a call to a route that uses getSignedUrl
      // This is the WebSocket route that connects to ElevenLabs
      const wsHandler = mockFastify.register.mock.calls.find(
        call => call[1] && call[1].websocket
      )[0];
      
      const mockFastifyInstance = {
        get: jest.fn()
      };
      
      // Call the WebSocket register function
      wsHandler(mockFastifyInstance, { websocket: true });
      
      // Find the WebSocket handler
      const webSocketHandler = mockFastifyInstance.get.mock.calls.find(
        call => call[0] === '/outbound-media-stream'
      )[2];
      
      // Call the WebSocket handler with a mock WebSocket
      const mockWs = new MockWebSocket('wss://localhost:8000');
      const mockReq = { headers: { host: 'localhost:8000' } };
      webSocketHandler(mockWs, mockReq);
      
      // Verify fetch was called with correct parameters
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('get_signed_url'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'xi-api-key': expect.any(String)
          })
        })
      );
    });
  });

  describe('sendCallDataToWebhook function', () => {
    it('should fetch transcript and summary from ElevenLabs and send to webhook', async () => {
      // Reset fetch mock
      global.fetch.mockClear();
      
      // Create test data
      const callSid = 'CA12345';
      const conversationId = 'conv_123456';
      
      // Mock call statuses to simulate a call that needs webhook data
      // We need to set this up to test the sendCallDataToWebhook function
      global.callStatuses = {
        [callSid]: {
          salesTeamUnavailable: true,
          leadInfo: {
            LeadName: 'Test Lead',
            CareReason: 'Test Reason',
            CareNeededFor: 'Test Patient'
          },
          transcripts: [
            { speaker: 'agent', text: 'Hello, this is a test.' },
            { speaker: 'user', text: 'Hi there.' }
          ],
          conversationId: conversationId
        }
      };
      
      // Find a way to call the sendCallDataToWebhook function
      // Since it's not exported, we'll need to trigger it indirectly
      
      // One way is to mock the WebSocket close event which triggers the webhook
      const wsHandler = mockFastify.register.mock.calls.find(
        call => call[1] && call[1].websocket
      )[0];
      
      const mockFastifyInstance = {
        get: jest.fn()
      };
      
      // Call the WebSocket register function
      wsHandler(mockFastifyInstance, { websocket: true });
      
      // Find the WebSocket handler
      const webSocketHandler = mockFastifyInstance.get.mock.calls.find(
        call => call[0] === '/outbound-media-stream'
      )[2];
      
      // Call the WebSocket handler with a mock WebSocket
      const mockWs = new MockWebSocket('wss://localhost:8000');
      const mockReq = { headers: { host: 'localhost:8000' } };
      webSocketHandler(mockWs, mockReq);
      
      // Mock ElevenLabs WebSocket
      const elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io/websocket');
      jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
      
      // Trigger async setup
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate start message
      mockWs.emit('message', JSON.stringify({
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: callSid,
          customParameters: {}
        }
      }));
      
      // Simulate ElevenLabs connection open
      elevenLabsWs.emit('open');
      
      // Simulate ElevenLabs connection close which should trigger webhook
      elevenLabsWs.emit('close');
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify fetch was called for transcript and summary
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`conversation/${conversationId}/transcript`),
        expect.any(Object)
      );
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`conversation/${conversationId}/summary`),
        expect.any(Object)
      );
      
      // Verify webhook call
      const webhookCalls = global.fetch.mock.calls.filter(call => 
        call[0].includes('hook.us2.make.com')
      );
      
      expect(webhookCalls.length).toBeGreaterThan(0);
      
      // Clean up
      delete global.callStatuses;
    });
  });
}); 