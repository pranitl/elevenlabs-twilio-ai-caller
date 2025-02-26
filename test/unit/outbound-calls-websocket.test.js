import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';
import mockTwilioClient from '../mocks/twilio.js';

// Mock ws module
jest.mock('ws', () => {
  const { MockWebSocket } = require('../mocks/ws.js');
  return {
    WebSocket: MockWebSocket,
    OPEN: 1,
    CLOSED: 3
  };
});

// Mock Twilio module
jest.mock('twilio', () => {
  return jest.fn(() => mockTwilioClient());
});

// Mock fetch for getSignedUrl
global.fetch = jest.fn().mockImplementation(() => 
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ signed_url: 'wss://api.elevenlabs.io/websocket' }),
  })
);

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Outbound Calls WebSocket Handling', () => {
  let wsHandler;
  let mockWs;
  let mockReq;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Set up to capture the WebSocket handler
    mockFastify.register.mockImplementation((pluginFunc, opts) => {
      if (opts && opts.websocket) {
        pluginFunc({
          get: (path, opts, handler) => {
            if (path === '/outbound-media-stream') {
              wsHandler = handler;
            }
          }
        });
      }
      return mockFastify;
    });
    
    // Register routes to capture the handler
    registerOutboundRoutes(mockFastify);
    
    // Mock WebSocket and request
    mockWs = new MockWebSocket('wss://localhost:8000');
    mockReq = { headers: { host: 'localhost:8000' } };
  });

  describe('WebSocket connection', () => {
    it('should set up ElevenLabs connection when client connects', () => {
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Verify fetch was called to get signed URL
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('get_signed_url'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'xi-api-key': expect.any(String)
          })
        })
      );
    });
    
    it('should handle start message from Twilio', async () => {
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Simulate a start message from Twilio
      const startMessage = {
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: 'CA12345',
          customParameters: {
            leadName: 'Test Lead',
            careReason: 'Test Reason',
            careNeededFor: 'Test Patient'
          }
        }
      };
      
      // Create a message handler spy
      const messageSpy = jest.spyOn(mockWs, 'send');
      
      // Send the message
      mockWs.emit('message', JSON.stringify(startMessage));
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // We can't easily verify internal state, but we can confirm no errors occurred
      expect(console.error).not.toHaveBeenCalled();
    });
    
    it('should handle media message from Twilio', async () => {
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Simulate start message first
      const startMessage = {
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: 'CA12345',
          customParameters: {}
        }
      };
      mockWs.emit('message', JSON.stringify(startMessage));
      
      // Create a mock ElevenLabs WebSocket
      const elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io');
      
      // Mock creating new WebSocket to return our mock
      const mockElevenLabsWs = jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
      
      // Trigger the ElevenLabs connection
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate ElevenLabs connection opening
      elevenLabsWs.emit('open');
      
      // Now send a media message
      const mediaMessage = {
        event: 'media',
        streamSid: 'MX12345',
        media: {
          payload: 'SGVsbG8gV29ybGQ=' // Base64 "Hello World"
        }
      };
      
      // Create a send spy for the ElevenLabs WebSocket
      const elevenLabsSendSpy = jest.spyOn(elevenLabsWs, 'send');
      
      // Send the media message
      mockWs.emit('message', JSON.stringify(mediaMessage));
      
      // Verify data was forwarded to ElevenLabs
      expect(elevenLabsSendSpy).toHaveBeenCalledWith(expect.stringContaining('user_audio_chunk'));
    });
    
    it('should handle stop message from Twilio', async () => {
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Simulate a start message
      const startMessage = {
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: 'CA12345',
          customParameters: {}
        }
      };
      mockWs.emit('message', JSON.stringify(startMessage));
      
      // Create a mock ElevenLabs WebSocket
      const elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io');
      
      // Mock creating new WebSocket to return our mock
      const mockElevenLabsWs = jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
      
      // Trigger the ElevenLabs connection
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate ElevenLabs connection opening
      elevenLabsWs.emit('open');
      
      // Now send a stop message
      const stopMessage = {
        event: 'stop',
        streamSid: 'MX12345'
      };
      
      // Create a close spy for the ElevenLabs WebSocket
      const elevenLabsCloseSpy = jest.spyOn(elevenLabsWs, 'close');
      
      // Send the stop message
      mockWs.emit('message', JSON.stringify(stopMessage));
      
      // Verify ElevenLabs connection was closed
      expect(elevenLabsCloseSpy).toHaveBeenCalled();
    });
  });
}); 