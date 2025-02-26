// test/unit/inbound-calls.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { registerInboundRoutes } from '../../inbound-calls.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';

// Mock WebSocket constructor
jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn()
  }));
});

// Mock environment variables
process.env.TWILIO_PHONE_NUMBER = '+18001234567';
process.env.SALES_TEAM_PHONE_NUMBER = '+18009876543';
process.env.ELEVENLABS_API_KEY = 'test-api-key';
process.env.ELEVENLABS_AGENT_ID = 'test-agent-id';
process.env.REPL_SLUG = 'test-repl';

describe('Inbound Calls Module', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Reset request and reply objects
    mockRequest.body = {
      CallSid: 'test-call-sid',
      From: '+17001234567',
      To: '+18001234567'
    };
    mockRequest.query = {};
    mockRequest.params = {};
    mockRequest.headers = { host: 'localhost:8000' };
    
    // Register routes with mock fastify
    registerInboundRoutes(mockFastify);
  });

  describe('registerInboundRoutes', () => {
    it('should throw error if SALES_TEAM_PHONE_NUMBER is missing', () => {
      // Temporarily remove the environment variable
      const originalValue = process.env.SALES_TEAM_PHONE_NUMBER;
      delete process.env.SALES_TEAM_PHONE_NUMBER;
      
      // Expect function to throw
      expect(() => registerInboundRoutes(mockFastify)).toThrow('Missing SALES_TEAM_PHONE_NUMBER environment variable');
      
      // Restore the environment variable
      process.env.SALES_TEAM_PHONE_NUMBER = originalValue;
    });

    it('should throw error if ElevenLabs configuration is missing', () => {
      // Temporarily remove the environment variables
      const originalApiKey = process.env.ELEVENLABS_API_KEY;
      const originalAgentId = process.env.ELEVENLABS_AGENT_ID;
      delete process.env.ELEVENLABS_API_KEY;
      delete process.env.ELEVENLABS_AGENT_ID;
      
      // Expect function to throw
      expect(() => registerInboundRoutes(mockFastify)).toThrow('Missing ElevenLabs configuration variables');
      
      // Restore the environment variables
      process.env.ELEVENLABS_API_KEY = originalApiKey;
      process.env.ELEVENLABS_AGENT_ID = originalAgentId;
    });

    it('should register all required routes', () => {
      // Verify that all routes were registered
      expect(mockFastify.all).toHaveBeenCalledWith('/incoming-call', expect.any(Function));
      expect(mockFastify.all).toHaveBeenCalledWith('/verify-caller', expect.any(Function));
      expect(mockFastify.all).toHaveBeenCalledWith('/incoming-call-eleven', expect.any(Function));
      expect(mockFastify.register).toHaveBeenCalled();
    });
  });

  describe('/incoming-call handler', () => {
    it('should return TwiML with Gather for caller verification', async () => {
      // Find the route handler that was registered
      const routeHandler = mockFastify.all.mock.calls.find(call => call[0] === '/incoming-call')[1];
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Gather numDigits="1" action="/verify-caller" method="POST" timeout="10">'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Say>Thank you for calling. To speak with our sales team, please press 1.'));
    });
  });

  describe('/verify-caller handler', () => {
    it('should forward to sales team when caller presses 1', async () => {
      // Find the route handler
      const routeHandler = mockFastify.all.mock.calls.find(call => call[0] === '/verify-caller')[1];
      
      // Set up request with verification input
      mockRequest.body.Digits = '1';
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Say>Thank you. Connecting you to our sales team now.</Say>'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining(`<Dial callerId="${process.env.TWILIO_PHONE_NUMBER}">`));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining(process.env.SALES_TEAM_PHONE_NUMBER));
    });

    it('should connect to AI assistant when caller presses 2', async () => {
      // Find the route handler
      const routeHandler = mockFastify.all.mock.calls.find(call => call[0] === '/verify-caller')[1];
      
      // Set up request with verification input
      mockRequest.body.Digits = '2';
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Say>Thank you. Our AI assistant will help you leave a message.</Say>'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Connect>'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining(`<Stream url="wss://${process.env.REPL_SLUG}.repl.co/inbound-ai-stream">`));
    });

    it('should hangup with message on invalid input', async () => {
      // Find the route handler
      const routeHandler = mockFastify.all.mock.calls.find(call => call[0] === '/verify-caller')[1];
      
      // Set up request with invalid verification input
      mockRequest.body.Digits = '9';
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Say>Invalid selection. Goodbye.</Say>'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Hangup/>'));
    });
  });

  describe('/incoming-call-eleven handler', () => {
    it('should redirect to the main verification flow', async () => {
      // Find the route handler
      const routeHandler = mockFastify.all.mock.calls.find(call => call[0] === '/incoming-call-eleven')[1];
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Redirect>/incoming-call</Redirect>'));
    });
  });
}); 