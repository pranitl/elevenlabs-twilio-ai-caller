// test/unit/inbound-calls.test.js
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../setup.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';

// Save original environment variables
let originalEnv;

// Mock the required modules
jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    send: jest.fn()
  }));
});

// Mock Twilio
jest.mock('twilio', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({})),
    validateRequest: jest.fn().mockReturnValue(true)
  };
});

describe('Inbound Calls', () => {
  // Import the module dynamically so we can set env vars first
  let registerInboundRoutes;
  let inboundCallsModule;
  
  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Clear mock calls
    jest.clearAllMocks();
    
    // Set required environment variables for tests
    process.env.ELEVENLABS_API_KEY = 'test-api-key';
    process.env.ELEVENLABS_AGENT_ID = 'test-agent-id';
    process.env.TWILIO_ACCOUNT_SID = 'AC12345678901234567890123456789012';
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    process.env.TWILIO_PHONE_NUMBER = '+12345678901'; 
    process.env.SALES_TEAM_PHONE_NUMBER = '+19876543210';
    process.env.REPL_SLUG = 'test-slug';
  });
  
  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    
    // Clear the module cache
    jest.resetModules();
  });
  
  it('should throw an error if SALES_TEAM_PHONE_NUMBER is missing', async () => {
    // Remove the environment variable for this test
    delete process.env.SALES_TEAM_PHONE_NUMBER;
    
    // Import the module here so it uses the modified env
    const { registerInboundRoutes } = await import('../../inbound-calls.js');
    
    await expect(registerInboundRoutes(mockFastify)).rejects.toThrow('Missing SALES_TEAM_PHONE_NUMBER environment variable');
  });

  it('should throw an error if ELEVENLABS_API_KEY is missing', async () => {
    // Remove the environment variable for this test
    delete process.env.ELEVENLABS_API_KEY;
    
    // Import the module here so it uses the modified env
    const { registerInboundRoutes } = await import('../../inbound-calls.js');
    
    await expect(registerInboundRoutes(mockFastify)).rejects.toThrow('Missing ElevenLabs configuration variables');
  });

  it('should register incoming-call route', async () => {
    // Import the module here so it uses the modified env
    const { registerInboundRoutes } = await import('../../inbound-calls.js');
    
    await registerInboundRoutes(mockFastify);
    
    // Check that the route was registered
    expect(mockFastify.all).toHaveBeenCalledWith('/incoming-call', expect.any(Function));
  });

  it('should register verify-caller route', async () => {
    // Import the module here so it uses the modified env
    const { registerInboundRoutes } = await import('../../inbound-calls.js');
    
    await registerInboundRoutes(mockFastify);
    
    // Check that the route was registered
    expect(mockFastify.all).toHaveBeenCalledWith('/verify-caller', expect.any(Function));
  });

  describe('/incoming-call handler', () => {
    beforeEach(async () => {
      // Import and register routes before each test
      const { registerInboundRoutes } = await import('../../inbound-calls.js');
      await registerInboundRoutes(mockFastify);
      
      // Set up default request properties
      mockRequest.body = {
        CallSid: 'test-call-sid',
        From: '+12345678901',
        To: '+19876543210'
      };
    });
    
    it('should return TwiML with Gather for caller verification', async () => {
      // Get the route handler directly from the mock
      const routeHandler = mockFastify.all.mock.calls.find(
        call => call[0] === '/incoming-call'
      )[1];
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Gather numDigits="1" action="/verify-caller" method="POST" timeout="10">'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Say>Thank you for calling. To speak with our sales team, please press 1.'));
    });
  });

  describe('/verify-caller handler', () => {
    beforeEach(async () => {
      // Import and register routes before each test
      const { registerInboundRoutes } = await import('../../inbound-calls.js');
      await registerInboundRoutes(mockFastify);
      
      // Set up default request properties
      mockRequest.body = {
        CallSid: 'test-call-sid',
        From: '+12345678901',
        To: '+19876543210'
      };
    });
    
    it('should forward to sales team when caller presses 1', async () => {
      // Get the route handler directly from the mock
      const routeHandler = mockFastify.all.mock.calls.find(
        call => call[0] === '/verify-caller'
      )[1];
      
      // Set up request with verification input
      mockRequest.body.Digits = '1';
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Say>Connecting you to our sales team. Please hold.</Say>'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining(`<Dial callerId="${process.env.TWILIO_PHONE_NUMBER}">`));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining(process.env.SALES_TEAM_PHONE_NUMBER));
    });

    it('should connect to AI assistant when caller presses 2', async () => {
      // Get the route handler directly from the mock
      const routeHandler = mockFastify.all.mock.calls.find(
        call => call[0] === '/verify-caller'
      )[1];
      
      // Set up request with verification input
      mockRequest.body.Digits = '2';
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Say>Thank you. Our AI assistant will help you leave a message.</Say>'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Connect>'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining(`<Stream url="wss://test-slug.repl.co/inbound-ai-stream">`));
    });

    it('should hangup with message on invalid input', async () => {
      // Get the route handler directly from the mock
      const routeHandler = mockFastify.all.mock.calls.find(
        call => call[0] === '/verify-caller'
      )[1];
      
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
    beforeEach(async () => {
      // Import and register routes before each test
      const { registerInboundRoutes } = await import('../../inbound-calls.js');
      await registerInboundRoutes(mockFastify);
    });
    
    it('should redirect to the main verification flow', async () => {
      // Get the route handler directly from the mock
      const routeHandler = mockFastify.all.mock.calls.find(
        call => call[0] === '/incoming-call-eleven'
      )[1];
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Redirect>/incoming-call</Redirect>'));
    });
  });
}); 