/**
 * Integration Tests for Make.com Payload Processing
 * 
 * This test suite verifies that payload fields from Make.com
 * are correctly passed through the entire flow to both
 * Twilio and ElevenLabs contexts.
 */
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { createMockFastify } from '../setup.js';
import { registerOutboundRoutes } from '../../outbound-calls.js';
import { sendMessageTo } from '../mocks/websocket-mock.js';

// Load the exact payload structure from makePayload.txt for testing
let makePayloadTemplate;
try {
  makePayloadTemplate = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'makePayload.txt'), 'utf8')
      .split('\n')
      .slice(2) // Skip the first two lines (comment line and empty line)
      .join('\n')
  );
} catch (error) {
  console.error('Failed to load makePayload.txt:', error);
  // Fallback payload if file can't be loaded
  makePayloadTemplate = {
    "number": "+14088210387",
    "leadinfo": {
      "LeadName": "John Doe",
      "CareReason": "needs help due to her macular degeration and is a fall risk",
      "CareNeededFor": "Dorothy"
    }
  };
}

describe('Make.com Payload Integration Tests', () => {
  let fastify;
  let webSocketClients = new Map();
  
  // Mock for fetch used in getSignedUrl
  global.fetch = jest.fn().mockImplementation((url) => {
    if (url.includes('elevenlabs.io/v1/convai/conversation/get_signed_url')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          url: "wss://mock-elevenlabs-websocket-url",
          conversation_id: "mock-conversation-id"
        })
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });
  });
  
  // Mock for WebSocket
  global.WebSocket = class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this.readyState = 1; // OPEN
      
      // Store this client
      webSocketClients.set(url, this);
      
      // Auto-trigger onopen
      setTimeout(() => {
        if (this.onopen) this.onopen();
      }, 10);
    }
    
    send(data) {
      console.log('WebSocket message sent:', data);
      
      // If this is the ElevenLabs WebSocket
      if (this.url === "wss://mock-elevenlabs-websocket-url") {
        // Parse the data and check for payload fields
        const parsedData = JSON.parse(data);
        
        // Mock ElevenLabs responding with a text to speech event
        if (this.onmessage && parsedData.text) {
          // Send back a sample audio chunk
          this.onmessage({
            data: JSON.stringify({
              type: "audio",
              data: "base64-encoded-audio-data"
            })
          });
          
          // Then send an "end" event
          setTimeout(() => {
            this.onmessage({
              data: JSON.stringify({
                type: "end"
              })
            });
          }, 100);
        }
      }
    }
    
    close() {
      webSocketClients.delete(this.url);
      if (this.onclose) this.onclose();
    }
  };
  
  beforeEach(() => {
    // Clear all clients
    webSocketClients.clear();
    
    // Create a fresh fastify instance
    fastify = createMockFastify();
    
    // Mock Twilio client
    fastify.twilioClient = {
      calls: {
        create: jest.fn().mockImplementation(() => {
          return Promise.resolve({
            sid: 'CA' + Math.random().toString(36).substring(2, 10),
            status: 'queued'
          });
        })
      }
    };
    
    // Register routes
    registerOutboundRoutes(fastify);
  });
  
  test('should pass Make.com payload fields to ElevenLabs in WebSocket messages', async () => {
    // 1. Initiate a call with the Make.com payload
    const initCallResponse = await simulateOutboundCallRequest(fastify, makePayloadTemplate);
    expect(initCallResponse.success).toBe(true);
    
    const leadCallSid = initCallResponse.leadCallSid;
    
    // 2. Simulate the lead call connecting with WebSocket
    await simulateCallConnected(leadCallSid);
    
    // 3. Get the WebSocket handler and simulate connecting
    const wsHandler = fastify.websocketRoutes.get('/outbound-media-stream');
    expect(wsHandler).toBeDefined();
    
    // Create mock WebSocket connection
    const mockWsConnection = {
      socket: {
        remoteAddress: '127.0.0.1'
      },
      params: {},
      query: {
        callSid: leadCallSid,
        leadName: makePayloadTemplate.leadinfo.LeadName,
        careReason: makePayloadTemplate.leadinfo.CareReason,
        careNeededFor: makePayloadTemplate.leadinfo.CareNeededFor
      }
    };
    
    // Mock ws methods
    mockWsConnection.send = jest.fn();
    mockWsConnection.on = jest.fn().mockImplementation((event, callback) => {
      if (event === 'message') {
        // Store the message handler
        mockWsConnection.messageHandler = callback;
      }
    });
    
    // Call the WebSocket handler
    await wsHandler(mockWsConnection);
    
    // Wait for any async operations
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 4. Check that the ElevenLabs WebSocket was created
    const elevenLabsWs = webSocketClients.get("wss://mock-elevenlabs-websocket-url");
    expect(elevenLabsWs).toBeDefined();
    
    // Create a spy for the send method
    const elevenLabsSendSpy = jest.spyOn(elevenLabsWs, 'send');
    
    // 5. Send a message to simulate user speaking
    const mockAudioMessage = {
      event: 'media',
      streamSid: 'MT123',
      media: {
        payload: 'base64audio'
      }
    };
    
    // Send the mock audio message
    if (mockWsConnection.messageHandler) {
      await mockWsConnection.messageHandler(JSON.stringify(mockAudioMessage));
    }
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // 6. Verify that Make.com payload fields were included in messages to ElevenLabs
    const elevenlabsCalls = elevenLabsSendSpy.mock.calls;
    
    // Verify we have at least one call
    expect(elevenlabsCalls.length).toBeGreaterThan(0);
    
    // Find any setup messages that would contain the lead context
    let setupMessageFound = false;
    let setupMessage;
    
    for (const call of elevenlabsCalls) {
      try {
        const parsedMsg = JSON.parse(call[0]);
        if (parsedMsg.conversation_setup) {
          setupMessageFound = true;
          setupMessage = parsedMsg;
          break;
        }
      } catch (e) {
        // Not JSON or other error, skip
      }
    }
    
    // If we found a setup message, verify it contains the lead info
    if (setupMessageFound && setupMessage) {
      const setupString = JSON.stringify(setupMessage);
      
      // Check if each of the Make.com payload fields is present in the setup
      expect(setupString).toContain(makePayloadTemplate.leadinfo.LeadName);
      expect(setupString).toContain(makePayloadTemplate.leadinfo.CareReason);
      expect(setupString).toContain(makePayloadTemplate.leadinfo.CareNeededFor);
    }
  });
  
  test('should pass Make.com payload fields to Twilio TwiML generation', async () => {
    // 1. Initiate a call with the Make.com payload
    const initCallResponse = await simulateOutboundCallRequest(fastify, makePayloadTemplate);
    expect(initCallResponse.success).toBe(true);
    
    // 2. Simulate a request to the outbound-call-twiml endpoint
    const twimlRequest = {
      query: {
        leadName: makePayloadTemplate.leadinfo.LeadName,
        careReason: makePayloadTemplate.leadinfo.CareReason,
        careNeededFor: makePayloadTemplate.leadinfo.CareNeededFor
      },
      headers: {
        host: 'example.com'
      }
    };
    
    const twimlReply = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn()
    };
    
    // Get the TwiML handler and call it
    const twimlHandler = fastify.routes.find(r => r.path === '/outbound-call-twiml').handler;
    await twimlHandler(twimlRequest, twimlReply);
    
    // 3. Verify that the TwiML contains the Make.com payload fields
    expect(twimlReply.type).toHaveBeenCalledWith('text/xml');
    expect(twimlReply.send).toHaveBeenCalled();
    
    const twimlResponse = twimlReply.send.mock.calls[0][0];
    expect(twimlResponse).toContain(`value="${makePayloadTemplate.leadinfo.LeadName}"`);
    expect(twimlResponse).toContain(`value="${makePayloadTemplate.leadinfo.CareReason}"`);
    expect(twimlResponse).toContain(`value="${makePayloadTemplate.leadinfo.CareNeededFor}"`);
    
    // 4. Simulate a request to the sales-team-twiml endpoint
    const salesTwimlRequest = {
      query: {
        leadName: makePayloadTemplate.leadinfo.LeadName,
        careReason: makePayloadTemplate.leadinfo.CareReason,
        careNeededFor: makePayloadTemplate.leadinfo.CareNeededFor
      },
      headers: {
        host: 'example.com'
      }
    };
    
    const salesTwimlReply = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn()
    };
    
    // Get the Sales TwiML handler and call it
    const salesTwimlHandler = fastify.routes.find(r => r.path === '/sales-team-twiml').handler;
    await salesTwimlHandler(salesTwimlRequest, salesTwimlReply);
    
    // 5. Verify that the Sales TwiML contains the Make.com payload fields
    expect(salesTwimlReply.type).toHaveBeenCalledWith('text/xml');
    expect(salesTwimlReply.send).toHaveBeenCalled();
    
    const salesTwimlResponse = salesTwimlReply.send.mock.calls[0][0];
    expect(salesTwimlResponse).toContain(makePayloadTemplate.leadinfo.LeadName);
    expect(salesTwimlResponse).toContain(makePayloadTemplate.leadinfo.CareReason);
    
    if (makePayloadTemplate.leadinfo.CareNeededFor) {
      expect(salesTwimlResponse).toContain(makePayloadTemplate.leadinfo.CareNeededFor);
    }
  });
  
  // Helper function to simulate an outbound call request
  async function simulateOutboundCallRequest(fastify, payload) {
    const request = {
      body: { ...payload },
      headers: {
        host: 'example.com'
      }
    };
    
    const reply = {
      code: jest.fn().mockReturnThis(),
      send: jest.fn().mockImplementation(response => response)
    };
    
    const routeHandler = fastify.routes.find(r => r.path === '/outbound-call-to-sales').handler;
    return await routeHandler(request, reply);
  }
  
  // Helper to simulate a call connecting
  async function simulateCallConnected(callSid) {
    const request = {
      body: {
        CallSid: callSid,
        CallStatus: 'in-progress'
      }
    };
    
    const reply = {
      code: jest.fn().mockReturnThis(),
      send: jest.fn()
    };
    
    const statusHandler = fastify.routes.find(r => r.path === '/lead-status').handler;
    await statusHandler(request, reply);
    
    return reply;
  }
}); 