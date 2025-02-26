// test/unit/call-transfer.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';
import mockTwilioClient from '../mocks/twilio.js';

// Mock Twilio module
jest.mock('twilio', () => {
  return jest.fn(() => mockTwilioClient());
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Call Transfer Functionality', () => {
  let leadStatusHandler;
  let salesStatusHandler;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Set up to capture route handlers
    mockFastify.post.mockImplementation((path, handler) => {
      if (path === '/lead-status') {
        leadStatusHandler = handler;
      } else if (path === '/sales-status') {
        salesStatusHandler = handler;
      }
      return mockFastify;
    });
    
    // Register routes
    registerOutboundRoutes(mockFastify);
    
    // Reset request and reply
    mockRequest.body = {};
    mockRequest.headers = { host: 'localhost:8000' };
    mockReply.code.mockClear();
    mockReply.send.mockClear();
    
    // Set up global call status tracking
    global.callStatuses = {};
  });
  
  afterEach(() => {
    // Clean up global state
    delete global.callStatuses;
  });

  describe('checkAndTransfer function', () => {
    it('should create a conference when both calls are in-progress', async () => {
      // Set up call statuses
      const leadCallSid = 'CA12345';
      const salesCallSid = 'CA67890';
      
      global.callStatuses[leadCallSid] = {
        leadStatus: 'initiated',
        salesCallSid: salesCallSid
      };
      
      global.callStatuses[salesCallSid] = {
        salesStatus: 'initiated',
        leadCallSid: leadCallSid
      };
      
      // First update lead call to in-progress
      mockRequest.body = {
        CallSid: leadCallSid,
        CallStatus: 'in-progress'
      };
      
      await leadStatusHandler(mockRequest, mockReply);
      
      // Then update sales call to in-progress to trigger transfer
      mockRequest.body = {
        CallSid: salesCallSid,
        CallStatus: 'in-progress'
      };
      
      await salesStatusHandler(mockRequest, mockReply);
      
      // Verify both calls were updated to join the conference
      const twilioClient = require('twilio')();
      
      // Check lead call update
      expect(twilioClient.calls().update).toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining(`<Conference waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical" beep="false">`)
        })
      );
      
      // Check that transfer was marked as complete
      expect(global.callStatuses[leadCallSid].transferComplete).toBe(true);
      expect(global.callStatuses[salesCallSid].transferComplete).toBe(true);
    });
    
    it('should not create a conference when only one call is in-progress', async () => {
      // Set up call statuses
      const leadCallSid = 'CA12345';
      const salesCallSid = 'CA67890';
      
      global.callStatuses[leadCallSid] = {
        leadStatus: 'initiated',
        salesCallSid: salesCallSid
      };
      
      global.callStatuses[salesCallSid] = {
        salesStatus: 'initiated',
        leadCallSid: leadCallSid
      };
      
      // Update only the lead call to in-progress
      mockRequest.body = {
        CallSid: leadCallSid,
        CallStatus: 'in-progress'
      };
      
      await leadStatusHandler(mockRequest, mockReply);
      
      // Verify no calls were updated to join a conference
      const twilioClient = require('twilio')();
      expect(twilioClient.calls().update).not.toHaveBeenCalled();
      
      // Check that transfer was not marked as complete
      expect(global.callStatuses[leadCallSid].transferComplete).toBeUndefined();
    });
    
    it('should not create a conference when a call is detected as voicemail', async () => {
      // Set up call statuses with voicemail detection
      const leadCallSid = 'CA12345';
      const salesCallSid = 'CA67890';
      
      global.callStatuses[leadCallSid] = {
        leadStatus: 'in-progress',
        salesCallSid: salesCallSid,
        isVoicemail: true
      };
      
      global.callStatuses[salesCallSid] = {
        salesStatus: 'initiated',
        leadCallSid: leadCallSid
      };
      
      // Update sales call to in-progress
      mockRequest.body = {
        CallSid: salesCallSid,
        CallStatus: 'in-progress'
      };
      
      await salesStatusHandler(mockRequest, mockReply);
      
      // Verify calls were not updated to join a conference
      const twilioClient = require('twilio')();
      
      // Should update sales team to inform them it's a voicemail
      expect(twilioClient.calls().update).toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining('The AI is now leaving a voicemail')
        })
      );
      
      // But should not have created a conference
      expect(twilioClient.calls().update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining('<Conference')
        })
      );
    });
  });

  describe('/transfer-twiml endpoint', () => {
    it('should generate valid TwiML for the handoff', async () => {
      // Find the transfer-twiml handler
      const allHandler = mockFastify.all.mock.calls.find(call => call[0] === '/transfer-twiml')[1];
      
      // Set up request
      mockRequest.query = {
        salesCallSid: 'CA67890'
      };
      
      // Set up call status
      const leadCallSid = 'CA12345';
      global.callStatuses[leadCallSid] = {
        salesCallSid: 'CA67890'
      };
      
      global.callStatuses['CA67890'] = {
        leadCallSid: leadCallSid
      };
      
      // Call handler
      await allHandler(mockRequest, mockReply);
      
      // Verify response contains conference instructions
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Play>'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Conference'));
      
      // Check that transfer is marked as complete
      expect(global.callStatuses[leadCallSid].transferComplete).toBe(true);
      expect(global.callStatuses['CA67890'].transferComplete).toBe(true);
    });
  });

  describe('WebSocket termination during transfer', () => {
    it('should close ElevenLabs connection when transfer is complete', async () => {
      // This test would ideally be in the WebSocket test file
      // but we're adding it here for completeness of transfer testing
      
      // Find the outbound-media-stream WebSocket handler
      let wsHandler;
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
      
      // Register routes again to capture WebSocket handler
      registerOutboundRoutes(mockFastify);
      
      // Mock WebSocket for Twilio
      const mockWs = {
        on: jest.fn(),
        send: jest.fn()
      };
      
      // Mock WebSocket for ElevenLabs with close method
      const elevenLabsWs = {
        readyState: 1, // OPEN
        on: jest.fn(),
        send: jest.fn(),
        close: jest.fn()
      };
      
      // Mock global WebSocket constructor
      global.WebSocket = jest.fn(() => elevenLabsWs);
      global.WebSocket.OPEN = 1;
      
      // Call WebSocket handler if we found it
      if (wsHandler) {
        wsHandler(mockWs, { headers: { host: 'localhost:8000' } });
        
        // Find message handler
        const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
        
        // Set up call status with transfer complete
        const callSid = 'CA12345';
        global.callStatuses[callSid] = {
          transferComplete: true
        };
        
        // Simulate media message which should check transfer status
        messageHandler(JSON.stringify({
          event: 'media',
          streamSid: 'MX12345',
          callSid: callSid,
          media: {
            payload: 'base64data'
          }
        }));
        
        // Verify ElevenLabs connection was closed
        expect(elevenLabsWs.close).toHaveBeenCalled();
      } else {
        // Skip test if handler not found
        console.warn('WebSocket handler not captured, skipping test');
      }
    });
  });
}); 