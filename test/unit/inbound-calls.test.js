// test/unit/inbound-calls.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { registerInboundRoutes } from '../../inbound-calls.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';

// Mock environment variables
process.env.TWILIO_PHONE_NUMBER = '+18001234567';
process.env.SALES_TEAM_PHONE_NUMBER = '+18009876543';

describe('Inbound Calls Module', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Reset request and reply objects
    mockRequest.body = {};
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

    it('should register /incoming-call route', () => {
      // Verify that the route was registered
      expect(mockFastify.all).toHaveBeenCalledWith('/incoming-call', expect.any(Function));
    });

    it('should register /incoming-call-eleven route', () => {
      // Verify that the route was registered
      expect(mockFastify.all).toHaveBeenCalledWith('/incoming-call-eleven', expect.any(Function));
    });
  });

  describe('/incoming-call handler', () => {
    it('should return TwiML that forwards call to sales team', async () => {
      // Find the route handler that was registered
      const routeHandler = mockFastify.all.mock.calls.find(call => call[0] === '/incoming-call')[1];
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining(`<Dial callerId="${process.env.TWILIO_PHONE_NUMBER}">`));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining(process.env.SALES_TEAM_PHONE_NUMBER));
    });
  });

  describe('/incoming-call-eleven handler', () => {
    it('should return TwiML that forwards call to sales team', async () => {
      // Find the route handler that was registered
      const routeHandler = mockFastify.all.mock.calls.find(call => call[0] === '/incoming-call-eleven')[1];
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining(`<Dial callerId="${process.env.TWILIO_PHONE_NUMBER}">`));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining(process.env.SALES_TEAM_PHONE_NUMBER));
    });
  });
}); 