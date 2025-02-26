// test/unit/voicemail-detection.test.js
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

describe('Voicemail Detection and Handling', () => {
  let wsHandler;
  let amdCallbackHandler;
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
    
    // Set up to capture AMD callback handler
    mockFastify.post.mockImplementation((path, handler) => {
      if (path === '/amd-callback') {
        amdCallbackHandler = handler;
      }
      return mockFastify;
    });
    
    // Register routes to capture the handlers
    registerOutboundRoutes(mockFastify);
    
    // Mock WebSocket and request
    mockWs = new MockWebSocket('wss://localhost:8000');
    mockReq = { headers: { host: 'localhost:8000' }, body: {} };
    
    // Global callStatuses storage for testing
    global.callStatuses = {};
  });
  
  afterEach(() => {
    // Clean up global state
    delete global.callStatuses;
  });

  describe('AMD (Answering Machine Detection) Callback', () => {
    it('should mark call as voicemail when AMD detects machine_start', async () => {
      // Set up request body for AMD callback
      mockReq.body = {
        CallSid: 'CA12345',
        AnsweredBy: 'machine_start'
      };
      
      // Set up call status
      global.callStatuses['CA12345'] = {
        leadStatus: 'in-progress',
        salesCallSid: 'CA67890'
      };
      
      // Call the AMD callback handler
      await amdCallbackHandler(mockReq, { send: jest.fn() });
      
      // Verify call is marked as voicemail
      expect(global.callStatuses['CA12345'].isVoicemail).toBe(true);
    });
    
    it('should mark call as not voicemail when AMD detects human', async () => {
      // Set up request body for AMD callback
      mockReq.body = {
        CallSid: 'CA12345',
        AnsweredBy: 'human'
      };
      
      // Set up call status
      global.callStatuses['CA12345'] = {
        leadStatus: 'in-progress',
        salesCallSid: 'CA67890'
      };
      
      // Call the AMD callback handler
      await amdCallbackHandler(mockReq, { send: jest.fn() });
      
      // Verify call is marked as not voicemail
      expect(global.callStatuses['CA12345'].isVoicemail).toBe(false);
    });
    
    it('should notify sales team when voicemail is detected and sales team is on the call', async () => {
      // Set up request body for AMD callback
      mockReq.body = {
        CallSid: 'CA12345',
        AnsweredBy: 'machine_end_beep'
      };
      
      // Set up call status where sales team is already on the call
      global.callStatuses['CA12345'] = {
        leadStatus: 'in-progress',
        salesCallSid: 'CA67890'
      };
      
      global.callStatuses['CA67890'] = {
        salesStatus: 'in-progress',
        leadCallSid: 'CA12345'
      };
      
      // Call the AMD callback handler
      await amdCallbackHandler(mockReq, { send: jest.fn() });
      
      // Verify Twilio calls update was called to notify sales team
      expect(mockTwilioClient().calls().update).toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining('The AI is now leaving a voicemail')
        })
      );
    });
  });

  describe('Transcript-based Voicemail Detection', () => {
    it('should detect voicemail from transcript text', async () => {
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Simulate start message
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
      jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
      
      // Trigger the ElevenLabs connection
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate ElevenLabs connection opening
      elevenLabsWs.emit('open');
      
      // Spy on ElevenLabs WebSocket send method
      const elevenLabsSendSpy = jest.spyOn(elevenLabsWs, 'send');
      
      // Simulate transcript event with voicemail indicator
      elevenLabsWs.emit('message', JSON.stringify({
        type: 'transcript',
        transcript_event: {
          speaker: 'user',
          text: 'Please leave a message after the tone'
        }
      }));
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Verify call is marked as voicemail
      expect(global.callStatuses['CA12345'].isVoicemail).toBe(true);
      
      // Verify custom instruction was sent to ElevenLabs
      expect(elevenLabsSendSpy).toHaveBeenCalledWith(
        expect.stringContaining('This call has reached a voicemail')
      );
    });
  });

  describe('WebSocket Handling for Voicemail', () => {
    it('should add voicemail instructions to the prompt when voicemail is detected', async () => {
      // Set up known voicemail state
      global.callStatuses['CA12345'] = {
        isVoicemail: true
      };
      
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Simulate start message
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
      const mockElevenLabsWsSend = jest.spyOn(elevenLabsWs, 'send');
      jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
      
      // Trigger the ElevenLabs connection
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate ElevenLabs connection opening
      elevenLabsWs.emit('open');
      
      // Verify that the conversation_initiation_client_data contains voicemail instructions
      const initCall = mockElevenLabsWsSend.mock.calls.find(call => 
        call[0].includes('conversation_initiation_client_data')
      );
      
      expect(initCall).toBeDefined();
      expect(initCall[0]).toContain('This call has reached a voicemail');
    });
  });
}); 