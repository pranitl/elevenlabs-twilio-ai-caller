// test/unit/sales-team-unavailable.test.js
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

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Sales Team Unavailable Handling', () => {
  let wsHandler;
  let salesStatusHandler;
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
    
    // Set up to capture sales status handler
    mockFastify.post.mockImplementation((path, handler) => {
      if (path === '/sales-status') {
        salesStatusHandler = handler;
      }
      return mockFastify;
    });
    
    // Register routes to capture the handlers
    registerOutboundRoutes(mockFastify);
    
    // Mock WebSocket and request
    mockWs = new MockWebSocket('wss://localhost:8000');
    mockReq = { 
      headers: { host: 'localhost:8000' }, 
      body: {} 
    };
    
    // Global callStatuses storage for testing
    global.callStatuses = {};
  });
  
  afterEach(() => {
    // Clean up global state
    delete global.callStatuses;
  });

  describe('Sales call status handling', () => {
    it('should mark sales team as unavailable when call ends without transfer', async () => {
      // Set up call statuses
      const leadCallSid = 'CA12345';
      const salesCallSid = 'CA67890';
      
      global.callStatuses[leadCallSid] = {
        leadStatus: 'in-progress',
        salesCallSid: salesCallSid
      };
      
      global.callStatuses[salesCallSid] = {
        salesStatus: 'initiated',
        leadCallSid: leadCallSid
      };
      
      // Set up request for sales call ending
      mockReq.body = {
        CallSid: salesCallSid,
        CallStatus: 'completed'
      };
      
      // Call handler
      await salesStatusHandler(mockReq, { send: jest.fn() });
      
      // Verify lead call has salesTeamUnavailable flag
      expect(global.callStatuses[leadCallSid].salesTeamUnavailable).toBe(true);
    });

    it('should mark sales team as unavailable when sales call fails', async () => {
      // Set up call statuses
      const leadCallSid = 'CA12345';
      const salesCallSid = 'CA67890';
      
      global.callStatuses[leadCallSid] = {
        leadStatus: 'in-progress',
        salesCallSid: salesCallSid
      };
      
      global.callStatuses[salesCallSid] = {
        salesStatus: 'initiated',
        leadCallSid: leadCallSid
      };
      
      // Set up request for sales call failing
      mockReq.body = {
        CallSid: salesCallSid,
        CallStatus: 'failed'
      };
      
      // Call handler
      await salesStatusHandler(mockReq, { send: jest.fn() });
      
      // Verify lead call has salesTeamUnavailable flag
      expect(global.callStatuses[leadCallSid].salesTeamUnavailable).toBe(true);
    });
  });

  describe('WebSocket handling with unavailable sales team', () => {
    it('should send custom instruction to ElevenLabs when sales team is unavailable', async () => {
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Set up call status
      const callSid = 'CA12345';
      global.callStatuses[callSid] = {
        salesTeamUnavailable: true
      };
      
      // Simulate start message
      const startMessage = {
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: callSid,
          customParameters: {}
        }
      };
      mockWs.emit('message', JSON.stringify(startMessage));
      
      // Create a mock ElevenLabs WebSocket
      const elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io');
      const elevenLabsSendSpy = jest.spyOn(elevenLabsWs, 'send');
      jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
      
      // Trigger the ElevenLabs connection
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate ElevenLabs connection opening
      elevenLabsWs.emit('open');
      
      // Simulate media message to trigger instructions check
      const mediaMessage = {
        event: 'media',
        streamSid: 'MX12345',
        callSid: callSid,
        media: {
          payload: 'SGVsbG8gV29ybGQ=' // Base64 "Hello World"
        }
      };
      
      // Send the media message
      mockWs.emit('message', JSON.stringify(mediaMessage));
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Verify custom instruction was sent to ElevenLabs
      const customInstructionCall = elevenLabsSendSpy.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('custom_instruction')
      );
      
      expect(customInstructionCall).toBeDefined();
      expect(customInstructionCall[0]).toContain('Our care specialists are currently unavailable');
      
      // Verify flag to prevent duplicate instructions
      expect(global.callStatuses[callSid].salesTeamUnavailableInstructionSent).toBe(true);
    });
    
    it('should only send the unavailable instruction once', async () => {
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Set up call status with flag already set
      const callSid = 'CA12345';
      global.callStatuses[callSid] = {
        salesTeamUnavailable: true,
        salesTeamUnavailableInstructionSent: true
      };
      
      // Simulate start message
      const startMessage = {
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: callSid,
          customParameters: {}
        }
      };
      mockWs.emit('message', JSON.stringify(startMessage));
      
      // Create a mock ElevenLabs WebSocket
      const elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io');
      const elevenLabsSendSpy = jest.spyOn(elevenLabsWs, 'send');
      jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
      
      // Trigger the ElevenLabs connection
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate ElevenLabs connection opening
      elevenLabsWs.emit('open');
      
      // Simulate media message
      const mediaMessage = {
        event: 'media',
        streamSid: 'MX12345',
        callSid: callSid,
        media: {
          payload: 'SGVsbG8gV29ybGQ=' // Base64 "Hello World"
        }
      };
      
      // Clear previous calls
      elevenLabsSendSpy.mockClear();
      
      // Send the media message
      mockWs.emit('message', JSON.stringify(mediaMessage));
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Verify no custom instruction was sent to ElevenLabs
      const customInstructionCall = elevenLabsSendSpy.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('custom_instruction')
      );
      
      expect(customInstructionCall).toBeUndefined();
    });
  });

  describe('Webhook data for unavailable sales team', () => {
    it('should include salesTeamUnavailable flag in webhook data', async () => {
      // Mock fetch for webhook calls
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('hook.us2.make.com')) {
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ signed_url: 'wss://api.elevenlabs.io/websocket' }),
        });
      });
      
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Set up call status with sales team unavailable
      const callSid = 'CA12345';
      const conversationId = 'conv_123456';
      global.callStatuses[callSid] = {
        salesTeamUnavailable: true,
        conversationId: conversationId,
        leadInfo: {
          leadName: 'Test Lead',
          careReason: 'Test Reason',
          careNeededFor: 'Test Patient'
        }
      };
      
      // Simulate start message
      const startMessage = {
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: callSid,
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
      
      // Simulate ElevenLabs connection closing
      elevenLabsWs.emit('close');
      
      // Wait for webhook to be called
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify webhook was called with sales team unavailable flag
      const webhookCalls = global.fetch.mock.calls.filter(
        call => call[0].includes('hook.us2.make.com')
      );
      
      expect(webhookCalls.length).toBeGreaterThan(0);
      
      // Get webhook data
      const webhookCall = webhookCalls[0];
      const webhookData = JSON.parse(webhookCall[1].body);
      
      // Verify sales_team_unavailable flag
      expect(webhookData.sales_team_unavailable).toBe(true);
    });
  });
}); 