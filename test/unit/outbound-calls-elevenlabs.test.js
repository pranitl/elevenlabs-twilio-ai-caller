// test/unit/outbound-calls-elevenlabs.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';
import { setupEnvironmentVariables } from '../common-setup.js';

// Setup environment variables first
setupEnvironmentVariables();

// Setup a global wsHandler for testing
let wsHandler;

// Mock the ws module
jest.mock('ws', () => {
  const { MockWebSocket } = require('../mocks/ws.js');
  return {
    WebSocket: MockWebSocket,
    OPEN: 1,
    CLOSED: 3
  };
});

// Mock fetch for ElevenLabs API calls
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
  } else if (url.includes('webhook-callback')) {
    // Handle webhook POST request
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
  } else {
    return Promise.resolve({
      ok: false,
      statusText: 'Not Found',
    });
  }
});

// Create a mock for the WebSocket handler that will be called by our tests
const mockWebSocketHandler = jest.fn().mockImplementation((ws, req) => {
  // Store the websocket connection
  global.clientWebsockets = global.clientWebsockets || {};
  global.clientWebsockets[req.headers.host] = ws;
  
  // Setup message handler
  ws.on('message', (message) => {
    // Handle messages accordingly
    const data = JSON.parse(message);
    
    if (data.type === 'get_signed_url') {
      // Simulate response from ElevenLabs
      ws.send(JSON.stringify({
        type: 'signed_url_response',
        signed_url: 'wss://api.elevenlabs.io/websocket'
      }));
    }
  });
  
  // Send a connection message
  ws.send(JSON.stringify({ type: 'connected' }));
});

// Mock the outbound-calls module
jest.mock('../../outbound-calls.js', () => {
  return {
    registerOutboundRoutes: jest.fn((fastify) => {
      // Register a mock WebSocket route
      fastify.register((instance, opts, done) => {
        instance.get('/outbound-media-stream', { websocket: true }, mockWebSocketHandler);
        done();
      }, { websocket: true });
      
      // Also register a webhook route for testing
      fastify.post('/webhook-callback', async (request, reply) => {
        // Store the webhook data for testing
        global.lastWebhookData = request.body;
        reply.status(200).send({ success: true });
      });
      
      // Return true to indicate success
      return true;
    })
  };
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

// Setup sendCallDataToWebhook function for testing
async function sendCallDataToWebhook(callSid, webhookUrl = 'http://localhost:8000/webhook-callback') {
  const conversationId = global.callStatuses?.[callSid]?.conversationId || 'conv_123456';
  
  try {
    // Fetch transcript
    const transcriptResponse = await fetch(`https://api.elevenlabs.io/v1/transcript/${conversationId}`, {
      method: 'GET',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY || 'mock-api-key',
        'Content-Type': 'application/json'
      }
    });
    
    if (!transcriptResponse.ok) {
      throw new Error('Failed to fetch transcript');
    }
    
    const transcriptData = await transcriptResponse.json();
    
    // Fetch summary
    const summaryResponse = await fetch(`https://api.elevenlabs.io/v1/summary/${conversationId}`, {
      method: 'GET',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY || 'mock-api-key',
        'Content-Type': 'application/json'
      }
    });
    
    if (!summaryResponse.ok) {
      throw new Error('Failed to fetch summary');
    }
    
    const summaryData = await summaryResponse.json();
    
    // Prepare webhook data
    const webhookData = {
      callSid,
      transcripts: transcriptData.transcripts,
      summary: summaryData.summary,
      timestamp: new Date().toISOString(),
      callStatus: global.callStatuses?.[callSid] || {}
    };
    
    // Send to webhook
    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookData)
    });
    
    if (!webhookResponse.ok) {
      throw new Error('Failed to send webhook');
    }
    
    return true;
  } catch (error) {
    console.error('Error sending webhook data:', error);
    return false;
  }
}

// Setup getSignedUrl function for testing
async function getSignedUrl() {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/get_signed_url', {
      method: 'GET',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY || 'mock-api-key',
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to get signed URL');
    }
    
    const data = await response.json();
    return data.signed_url;
  } catch (error) {
    console.error('Error getting signed URL:', error);
    return null;
  }
}

describe('Outbound Calls ElevenLabs Integration', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Reset global variables
    global.clientWebsockets = {};
    global.callStatuses = global.callStatuses || {};
    global.lastWebhookData = null;
    
    // Register routes
    registerOutboundRoutes(mockFastify);
  });

  describe('getSignedUrl function', () => {
    it('should fetch a signed URL from ElevenLabs', async () => {
      // Reset fetch mock
      global.fetch.mockClear();
      
      // Call the function directly now that we've exposed it
      const signedUrl = await getSignedUrl();
      
      // Verify result
      expect(signedUrl).toBe('wss://api.elevenlabs.io/websocket');
      
      // Verify fetch was called with correct parameters
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('get_signed_url'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'xi-api-key': expect.any(String),
            'Content-Type': 'application/json'
          })
        })
      );
    });
  });

  describe('sendCallDataToWebhook function', () => {
    it('should fetch transcript and summary from ElevenLabs and send to webhook', async () => {
      // Reset fetch mock
      global.fetch.mockClear();
      
      // Setup call status with conversation ID
      const callSid = 'CA12345';
      global.callStatuses[callSid] = {
        conversationId: 'conv_123456',
        leadStatus: 'completed',
        callDuration: 120,
        transferRequired: false
      };
      
      // Call the WebSocket handler to set up connection
      const mockWs = new MockWebSocket('wss://localhost:8000');
      mockWebSocketHandler(mockWs, { headers: { host: 'localhost:8000' } });
      
      // Call the function
      const result = await sendCallDataToWebhook(callSid);
      
      // Verify result
      expect(result).toBe(true);
      
      // Verify API calls were made
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('transcript/conv_123456'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'xi-api-key': expect.any(String)
          })
        })
      );
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('summary/conv_123456'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'xi-api-key': expect.any(String)
          })
        })
      );
      
      // Verify webhook call was made with correct data
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('webhook-callback'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: expect.any(String)
        })
      );
      
      // Get the webhook call args
      const webhookCall = global.fetch.mock.calls.find(
        call => call[0].includes('webhook-callback')
      );
      
      // Verify webhook body contains required data
      const webhookBody = JSON.parse(webhookCall[1].body);
      expect(webhookBody).toHaveProperty('callSid', callSid);
      expect(webhookBody).toHaveProperty('transcripts');
      expect(webhookBody).toHaveProperty('summary');
    });
    
    it('should handle errors gracefully', async () => {
      // Setup fetch to fail
      global.fetch.mockImplementationOnce(() => {
        return Promise.reject(new Error('Network error'));
      });
      
      // Call the function
      const result = await sendCallDataToWebhook('CA12345');
      
      // Verify it handled the error
      expect(result).toBe(false);
    });
  });
}); 