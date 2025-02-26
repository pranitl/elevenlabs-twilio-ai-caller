// test/unit/webhook-data.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';

// Mock ws module
jest.mock('ws', () => {
  const { MockWebSocket } = require('../mocks/ws.js');
  return {
    WebSocket: MockWebSocket,
    OPEN: 1,
    CLOSED: 3
  };
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Webhook Data Formatting and Sending', () => {
  let wsHandler;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock fetch for ElevenLabs API calls and webhook
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
      } else if (url.includes('hook.us2.make.com')) {
        return Promise.resolve({
          ok: true,
        });
      } else {
        return Promise.resolve({
          ok: false,
          statusText: 'Not Found',
        });
      }
    });
    
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
    
    // Register routes to capture the handlers
    registerOutboundRoutes(mockFastify);
    
    // Global callStatuses storage for testing
    global.callStatuses = {};
  });
  
  afterEach(() => {
    // Clean up global state
    delete global.callStatuses;
  });

  describe('sendCallDataToWebhook function', () => {
    it('should collect transcript and summary data and send to webhook', async () => {
      // Call the WebSocket handler to set up connection
      const mockWs = new MockWebSocket('wss://localhost:8000');
      wsHandler(mockWs, { headers: { host: 'localhost:8000' } });
      
      // Set up call status with required data
      const callSid = 'CA12345';
      const conversationId = 'conv_123456';
      
      global.callStatuses[callSid] = {
        salesTeamUnavailable: true,
        leadInfo: {
          leadName: 'Test Lead',
          careReason: 'Test Reason',
          careNeededFor: 'Test Patient'
        },
        transcripts: [
          { speaker: 'agent', text: 'Hello, this is Heather.' },
          { speaker: 'user', text: 'Hi there.' }
        ],
        conversationId: conversationId
      };
      
      // Create mock ElevenLabs WebSocket
      const elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io');
      jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
      
      // Trigger connection start sequence
      mockWs.emit('message', JSON.stringify({
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: callSid,
          customParameters: {
            leadName: 'Test Lead',
            careReason: 'Test Reason',
            careNeededFor: 'Test Patient'
          }
        }
      }));
      
      // Allow connection to establish
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate connection opening
      elevenLabsWs.emit('open');
      
      // Simulate connection closing to trigger webhook
      elevenLabsWs.emit('close');
      
      // Wait for webhook sending to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify webhook call
      const webhookCall = global.fetch.mock.calls.find(call => 
        call[0].includes('hook.us2.make.com')
      );
      
      expect(webhookCall).toBeDefined();
      
      // Verify webhook data format
      const webhookData = JSON.parse(webhookCall[1].body);
      
      // Check all required fields
      expect(webhookData.call_sid).toBe(callSid);
      expect(webhookData.conversation_id).toBe(conversationId);
      expect(webhookData.sales_team_unavailable).toBe(true);
      expect(webhookData.transcript).toBeDefined();
      expect(webhookData.summary).toBeDefined();
      expect(webhookData.lead_info).toBeDefined();
      expect(webhookData.timestamp).toBeDefined(); // ISO string format
    });
    
    it('should not send webhook data for calls where sales team handled the transfer', async () => {
      // Call the WebSocket handler to set up connection
      const mockWs = new MockWebSocket('wss://localhost:8000');
      wsHandler(mockWs, { headers: { host: 'localhost:8000' } });
      
      // Set up call status for a successful transfer
      const callSid = 'CA12345';
      const conversationId = 'conv_123456';
      
      global.callStatuses[callSid] = {
        leadStatus: 'in-progress',
        salesCallSid: 'CA67890',
        transferComplete: true,
        conversationId: conversationId
      };
      
      // Create mock ElevenLabs WebSocket
      const elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io');
      jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
      
      // Trigger connection start sequence
      mockWs.emit('message', JSON.stringify({
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: callSid,
          customParameters: {}
        }
      }));
      
      // Allow connection to establish
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate connection opening
      elevenLabsWs.emit('open');
      
      // Clear fetch calls to detect new ones
      global.fetch.mockClear();
      
      // Simulate connection closing 
      elevenLabsWs.emit('close');
      
      // Wait for potential webhook sending
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify webhook was NOT called
      const webhookCall = global.fetch.mock.calls.find(call => 
        call[0].includes('hook.us2.make.com')
      );
      
      expect(webhookCall).toBeUndefined();
    });
    
    it('should use stored transcripts if available', async () => {
      // Call the WebSocket handler to set up connection
      const mockWs = new MockWebSocket('wss://localhost:8000');
      wsHandler(mockWs, { headers: { host: 'localhost:8000' } });
      
      // Set up call status with transcripts
      const callSid = 'CA12345';
      const conversationId = 'conv_123456';
      const storedTranscripts = [
        { speaker: 'agent', text: 'Stored transcript 1' },
        { speaker: 'user', text: 'Stored transcript 2' }
      ];
      
      global.callStatuses[callSid] = {
        salesTeamUnavailable: true,
        transcripts: storedTranscripts,
        conversationId: conversationId
      };
      
      // Create mock ElevenLabs WebSocket
      const elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io');
      jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
      
      // Trigger connection start sequence
      mockWs.emit('message', JSON.stringify({
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: callSid,
          customParameters: {}
        }
      }));
      
      // Allow connection to establish
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate connection opening
      elevenLabsWs.emit('open');
      
      // Simulate connection closing to trigger webhook
      elevenLabsWs.emit('close');
      
      // Wait for webhook sending to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify webhook call
      const webhookCall = global.fetch.mock.calls.find(call => 
        call[0].includes('hook.us2.make.com')
      );
      
      expect(webhookCall).toBeDefined();
      
      // Verify webhook data contains stored transcripts
      const webhookData = JSON.parse(webhookCall[1].body);
      
      expect(webhookData.transcript.transcripts).toEqual(storedTranscripts);
      
      // Verify transcript API was not called since we had stored transcripts
      const transcriptCall = global.fetch.mock.calls.find(call => 
        call[0].includes(`/transcript`)
      );
      
      // This should be undefined because we used stored transcripts
      expect(transcriptCall).toBeUndefined();
    });
    
    it('should handle errors from ElevenLabs API gracefully', async () => {
      // Set up fetch to fail for transcript and summary
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('get_signed_url')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ signed_url: 'wss://api.elevenlabs.io/websocket' }),
          });
        } else if (url.includes('transcript')) {
          return Promise.resolve({
            ok: false,
            statusText: 'API Error'
          });
        } else if (url.includes('summary')) {
          throw new Error('Network error');
        } else if (url.includes('hook.us2.make.com')) {
          return Promise.resolve({
            ok: true,
          });
        }
      });
      
      // Call the WebSocket handler to set up connection
      const mockWs = new MockWebSocket('wss://localhost:8000');
      wsHandler(mockWs, { headers: { host: 'localhost:8000' } });
      
      // Set up call status
      const callSid = 'CA12345';
      const conversationId = 'conv_123456';
      
      global.callStatuses[callSid] = {
        salesTeamUnavailable: true,
        conversationId: conversationId
      };
      
      // Create mock ElevenLabs WebSocket
      const elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io');
      jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
      
      // Trigger connection start sequence
      mockWs.emit('message', JSON.stringify({
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: callSid,
          customParameters: {}
        }
      }));
      
      // Allow connection to establish
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate connection opening
      elevenLabsWs.emit('open');
      
      // Make sure console.error doesn't throw
      console.error = jest.fn();
      
      // Simulate connection closing to trigger webhook
      elevenLabsWs.emit('close');
      
      // Wait for webhook sending to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify webhook was still called despite API errors
      const webhookCall = global.fetch.mock.calls.find(call => 
        call[0].includes('hook.us2.make.com')
      );
      
      expect(webhookCall).toBeDefined();
      
      // Webhook data should contain minimal information
      const webhookData = JSON.parse(webhookCall[1].body);
      expect(webhookData.call_sid).toBe(callSid);
      expect(webhookData.conversation_id).toBe(conversationId);
      
      // Transcript and summary should be null or undefined due to errors
      expect(webhookData.transcript).toBeUndefined();
      expect(webhookData.summary).toBeUndefined();
    });
  });
}); 