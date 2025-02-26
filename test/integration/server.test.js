// test/integration/server.test.js
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../setup.js';
import request from 'supertest';
import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerOutboundRoutes } from '../../outbound-calls.js';

// Mock Twilio
jest.mock('twilio', () => {
  return jest.fn(() => ({
    calls: {
      create: jest.fn(() => Promise.resolve({
        sid: 'CA12345',
        status: 'queued'
      }))
    }
  }));
});

// Mock WebSocket
jest.mock('ws', () => {
  const { MockWebSocket } = require('../mocks/ws.js');
  return {
    WebSocket: MockWebSocket,
    OPEN: 1,
    CLOSED: 3
  };
});

// Mock fetch
global.fetch = jest.fn().mockImplementation(() => 
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      signed_url: 'wss://api.elevenlabs.io/websocket'
    })
  })
);

describe('Server Integration', () => {
  let fastify;
  
  beforeAll(async () => {
    // Create a fastify instance for testing
    fastify = Fastify({ logger: false });
    
    // Register plugins
    await fastify.register(fastifyFormBody);
    await fastify.register(fastifyWs);
    
    // Register static file serving
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    await fastify.register(fastifyStatic, {
      root: path.join(__dirname, '../../'),
      prefix: '/'
    });
    
    // Register routes
    registerOutboundRoutes(fastify);
    
    // Add a root route
    fastify.get('/', async (_, reply) => {
      reply.send({ message: 'Server is running' });
    });
    
    // Start server
    await fastify.listen({ port: 0, host: 'localhost' });
  });
  
  afterAll(async () => {
    // Close server
    await fastify.close();
  });
  
  describe('Server Health', () => {
    it('should respond to health check', async () => {
      const response = await request(fastify.server)
        .get('/')
        .expect(200);
      
      expect(response.body).toEqual({ message: 'Server is running' });
    });
  });
  
  describe('Outbound Calls API', () => {
    it('should return 400 if phone number is missing', async () => {
      const response = await request(fastify.server)
        .post('/outbound-call-to-sales')
        .send({})
        .expect(400);
      
      expect(response.body.error).toBe('Phone number is required');
    });
    
    it('should initiate calls when phone number is provided', async () => {
      const response = await request(fastify.server)
        .post('/outbound-call-to-sales')
        .send({
          number: '+18001234567',
          leadinfo: {
            LeadName: 'Test Lead',
            CareReason: 'Test Reason',
            CareNeededFor: 'Test Patient'
          }
        })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Calls initiated');
      expect(response.body.leadCallSid).toBeDefined();
      expect(response.body.salesCallSid).toBeDefined();
    });
  });
  
  describe('TwiML Endpoints', () => {
    it('should return valid TwiML for outbound-call-twiml', async () => {
      const response = await request(fastify.server)
        .get('/outbound-call-twiml')
        .query({
          leadName: 'Test Lead',
          careReason: 'Test Reason',
          careNeededFor: 'Test Patient'
        })
        .expect(200);
      
      // Check if response is XML
      expect(response.text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(response.text).toContain('<Response>');
      expect(response.text).toContain('<Stream url="wss://');
    });
    
    it('should return valid TwiML for sales-team-twiml', async () => {
      const response = await request(fastify.server)
        .get('/sales-team-twiml')
        .query({
          leadName: 'Test Lead',
          careReason: 'Test Reason',
          careNeededFor: 'Test Patient'
        })
        .expect(200);
      
      // Check if response is XML
      expect(response.text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(response.text).toContain('<Response>');
      expect(response.text).toContain('<Say>');
    });
  });
  
  describe('Callback Endpoints', () => {
    it('should accept lead status callbacks', async () => {
      await request(fastify.server)
        .post('/lead-status')
        .send({
          CallSid: 'CA12345',
          CallStatus: 'in-progress'
        })
        .expect(200);
    });
    
    it('should accept AMD callbacks', async () => {
      await request(fastify.server)
        .post('/amd-callback')
        .send({
          CallSid: 'CA12345',
          AnsweredBy: 'human'
        })
        .expect(200);
    });
    
    it('should accept sales status callbacks', async () => {
      await request(fastify.server)
        .post('/sales-status')
        .send({
          CallSid: 'CA67890',
          CallStatus: 'in-progress'
        })
        .expect(200);
    });
  });
}); 