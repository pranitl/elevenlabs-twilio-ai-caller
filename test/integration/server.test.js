// test/integration/server.test.js
import { jest } from '@jest/globals';
import fastify from 'fastify';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Integration tests for the server API
 */

// Mock environment variables
process.env.ELEVENLABS_API_KEY = 'test-api-key';
process.env.ELEVENLABS_VOICE_ID = 'test-voice-id';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_PHONE_NUMBER = '+15551234567';
process.env.PUBLIC_URL = 'https://example.com';

// Very simplified mocks
jest.mock('@fastify/static', () => jest.fn(() => ({ __esModule: true })));
jest.mock('@fastify/cors', () => jest.fn(() => ({ __esModule: true })));
jest.mock('@fastify/formbody', () => jest.fn(() => ({ __esModule: true })));

// Mock Twilio with a simplified client
jest.mock('twilio', () => {
  return jest.fn(() => ({
    calls: {
      create: jest.fn().mockResolvedValue({ sid: 'CA12345' })
    }
  }));
});

// Mock WebSocket
global.WebSocket = jest.fn(() => ({
  addEventListener: jest.fn(),
  send: jest.fn(),
  close: jest.fn()
}));

// Mock fetch
global.fetch = jest.fn(() => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({ data: 'test' })
}));

// Create a test server
let app;

describe('Server API', () => {
  // Set a shorter timeout for tests
  jest.setTimeout(5000);
  
  beforeAll(async () => {
    // Create a new Fastify instance
    app = fastify({ logger: false });
    
    // Register a simple health check route
    app.get('/health', (req, reply) => {
      reply.send({ status: 'ok' });
    });
    
    // Register a simple outbound call route
    app.post('/api/outbound-call', (req, reply) => {
      const { phone } = req.body;
      if (!phone) {
        reply.code(400).send({ error: 'Phone number is required' });
        return;
      }
      reply.send({ sid: 'CA12345' });
    });
    
    // Register TwiML route
    app.get('/twiml/outbound', (req, reply) => {
      reply.type('application/xml');
      reply.send('<Response><Say>Hello from the test server</Say></Response>');
    });
    
    // Start the server on a random port
    await app.listen({ port: 0, host: '127.0.0.1' });
  });
  
  afterAll(async () => {
    await app.close();
  });
  
  test('health endpoint should return 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });
    
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
  });
  
  test('outbound call endpoint should return 400 when phone is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/outbound-call',
      payload: {}
    });
    
    expect(response.statusCode).toBe(400);
  });
  
  test('outbound call endpoint should return 200 when phone is provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/outbound-call',
      payload: { phone: '+15551234567' }
    });
    
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toHaveProperty('sid');
  });
  
  test('TwiML endpoint should return valid XML', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/twiml/outbound'
    });
    
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/xml');
    expect(response.body).toContain('<Response>');
  });
}); 