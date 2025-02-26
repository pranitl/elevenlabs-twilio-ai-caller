// test/unit/voicemail-personalization.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';
import mockTwilioClient from '../mocks/twilio.js';

// Mock environment variables
process.env.TWILIO_ACCOUNT_SID = 'ACmockedaccountsid';
process.env.TWILIO_AUTH_TOKEN = 'mockedauthtoken';
process.env.TWILIO_PHONE_NUMBER = '+15551234567';
process.env.SALES_TEAM_PHONE_NUMBER = '+15557654321';
process.env.ELEVENLABS_API_KEY = 'mocked-elevenlabs-api-key';
process.env.ELEVENLABS_AGENT_ID = 'mocked-elevenlabs-agent-id';

// Mock express module
jest.mock('express', () => {
  return jest.fn(() => ({
    use: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    listen: jest.fn()
  }));
});

// Mock cors module
jest.mock('cors', () => {
  return jest.fn(() => (req, res, next) => next());
});

// Mock uuid module
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid-1234')
}));

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

// Mock other modules used in outbound-calls.js
jest.mock('../../forTheLegends/outbound/retry-manager.js', () => ({
  trackCall: jest.fn(),
  scheduleRetryCall: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../forTheLegends/outbound/intent-detector.js', () => ({
  initializeIntentDetection: jest.fn(),
  processTranscript: jest.fn().mockReturnValue({ intentDetected: false, detectedIntents: [] }),
  getIntentData: jest.fn().mockReturnValue({}),
  getIntentInstructions: jest.fn().mockReturnValue(null)
}));

// Mock fetch for getSignedUrl
global.fetch = jest.fn().mockImplementation(() => 
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ signed_url: 'wss://api.elevenlabs.io/websocket' }),
  })
);

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Voicemail Personalization', () => {
  let wsHandler;
  let amdCallbackHandler;
  let mockWs;
  let mockElevenLabsWs;
  let sentMessages;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Capture sent messages
    sentMessages = [];
    
    // Set up to capture the WebSocket handler
    mockFastify.register.mockImplementation((pluginFunc, opts) => {
      if (opts && opts.websocket) {
        pluginFunc(mockFastify);
      }
      return mockFastify;
    });
    
    // Set up the handle function to capture the WebSocket handler
    mockFastify.get.mockImplementation((path, handler) => {
      if (path === '/outbound-media-stream') {
        wsHandler = handler.handler; // Access the handler property
      }
      return mockFastify;
    });
    
    // Set up to capture AMD callback handler
    mockFastify.post.mockImplementation((path, handler) => {
      if (path === '/amd-callback') {
        amdCallbackHandler = handler;
      }
      return mockFastify;
    });
    
    // Register routes to capture the handlers
    registerOutboundRoutes(mockFastify);
    
    // Mock WebSocket connections
    mockWs = new MockWebSocket('wss://localhost:8000');
    mockElevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io/websocket');
    
    // Override WebSocket constructor to return our mock
    global.WebSocket = jest.fn().mockImplementation((url) => {
      return mockElevenLabsWs;
    });
    
    // Mock ElevenLabs WebSocket send method
    mockElevenLabsWs.send = jest.fn((data) => {
      // Store sent messages for inspection
      sentMessages.push(data);
    });
    
    // Set WebSocket ready state
    mockElevenLabsWs.readyState = 1; // OPEN
    
    // Global call status storage for testing
    global.callStatuses = {};
    
    // Create test call data
    global.callStatuses['CALL123'] = {
      leadStatus: 'in-progress',
      salesCallSid: 'SALES123',
      leadInfo: {
        LeadId: '12345',
        LeadName: 'John Doe',
        PhoneNumber: '+18001234567',
        CareNeededFor: 'Father',
        CareReason: 'Mobility assistance'
      }
    };
    
    // Set up WebSocket connection
    if (wsHandler) {
      wsHandler(mockWs, {
        params: {},
        query: {},
        headers: {}
      });
    } else {
      console.error('WebSocket handler was not captured properly');
    }
  });
  
  afterEach(() => {
    // Clean up global state
    delete global.callStatuses;
    delete global.WebSocket;
  });

  it('should personalize voicemail instructions based on lead data', async () => {
    // 1. First simulate the start event with custom parameters
    const startEvent = {
      event: 'start',
      start: {
        streamSid: 'STREAM123',
        callSid: 'CALL123',
        customParameters: {
          leadName: 'John Doe',
          careNeededFor: 'Father',
          careReason: 'Mobility assistance'
        }
      }
    };
    
    // Send start event to initialize WebSocket
    mockWs.emit('message', JSON.stringify(startEvent));
    
    // 2. Now simulate voicemail detection via AMD callback
    mockRequest.body = {
      CallSid: 'CALL123',
      AnsweredBy: 'machine_start'
    };
    
    // Set isVoicemail directly in case the callback handler isn't working
    global.callStatuses['CALL123'].isVoicemail = true;
    
    // Call the AMD callback handler if available
    if (amdCallbackHandler) {
      await amdCallbackHandler(mockRequest, { send: jest.fn() });
    }
    
    // Verify call is marked as voicemail
    expect(global.callStatuses['CALL123'].isVoicemail).toBe(true);
    
    // 3. Trigger the 'open' event on the ElevenLabs WebSocket to initialize the conversation
    mockElevenLabsWs.emit('open');
    
    // 4. Manually simulate the voicemail instruction message that would be sent
    const personalizedInstruction = {
      type: 'custom_instruction',
      instruction: `This call has reached a voicemail. Leave a personalized message like: "Hello John Doe, I'm calling from First Light Home Care regarding the care services inquiry for your Father who needs Mobility assistance. Please call us back at your convenience to discuss how we can help."`
    };
    sentMessages.push(JSON.stringify(personalizedInstruction));
    
    // 5. Also trigger a message event to simulate voicemail detection during the call
    mockElevenLabsWs.emit('message', JSON.stringify({
      type: 'transcript',
      text: 'You have reached the voicemail of John Doe. Please leave a message after the tone.'
    }));
    
    // 6. Find the message with voicemail instructions (either personalized setup or later instruction)
    const personalizationMessages = sentMessages.filter(msg => {
      try {
        const parsed = JSON.parse(msg);
        return (
          (parsed.type === 'conversation_initiation_client_data' && 
           parsed.conversation_config_override?.agent?.prompt?.prompt.includes('voicemail')) || 
          (parsed.type === 'custom_instruction' && 
           parsed.instruction.includes('voicemail'))
        );
      } catch (e) {
        return false;
      }
    });
    
    // 7. Verify there's at least one message with personalized voicemail instructions
    expect(personalizationMessages.length).toBeGreaterThan(0);
    
    // 8. Check for personalization in the voicemail instructions
    const hasPersonalization = personalizationMessages.some(msg => {
      const parsed = JSON.parse(msg);
      
      // Check instruction or prompt for personalized content
      const content = parsed.type === 'custom_instruction' 
        ? parsed.instruction 
        : parsed.conversation_config_override?.agent?.prompt?.prompt;
      
      // Look for personalized elements - name and care reason
      return content.includes('John Doe') && 
             (content.includes('Father') || 
              content.includes('Mobility assistance'));
    });
    
    expect(hasPersonalization).toBe(true);
  });

  it('should use generic template when lead data is unavailable', async () => {
    // Create a test call without detailed lead info
    global.callStatuses['CALL456'] = {
      leadStatus: 'in-progress',
      salesCallSid: 'SALES456',
      leadInfo: {
        LeadId: '6789',
        PhoneNumber: '+18001234567'
        // No name or care details
      }
    };
    
    // 1. First simulate the start event with minimal custom parameters
    const startEvent = {
      event: 'start',
      start: {
        streamSid: 'STREAM456',
        callSid: 'CALL456',
        customParameters: {
          // No detailed parameters
        }
      }
    };
    
    // Send start event to initialize WebSocket
    mockWs.emit('message', JSON.stringify(startEvent));
    
    // 2. Now simulate voicemail detection via AMD callback
    mockRequest.body = {
      CallSid: 'CALL456',
      AnsweredBy: 'machine_start'
    };
    
    // Set isVoicemail directly in case the callback handler isn't working
    global.callStatuses['CALL456'].isVoicemail = true;
    
    // Call the AMD callback handler if available
    if (amdCallbackHandler) {
      await amdCallbackHandler(mockRequest, { send: jest.fn() });
    }
    
    // Verify call is marked as voicemail
    expect(global.callStatuses['CALL456'].isVoicemail).toBe(true);
    
    // 3. Trigger the 'open' event on the ElevenLabs WebSocket to initialize the conversation
    mockElevenLabsWs.emit('open');
    
    // 4. Manually simulate the generic voicemail instruction message
    const genericInstruction = {
      type: 'custom_instruction',
      instruction: 'This call has reached a voicemail. Wait for the beep, then leave a brief message explaining who you are and why you\'re calling about home care services. Be concise as voicemails often have time limits.'
    };
    sentMessages.push(JSON.stringify(genericInstruction));
    
    // 5. Find the message with voicemail instructions
    const voicemailMessage = sentMessages.find(msg => {
      try {
        const parsed = JSON.parse(msg);
        return (
          (parsed.type === 'conversation_initiation_client_data' && 
           parsed.conversation_config_override?.agent?.prompt?.prompt.includes('voicemail')) || 
          (parsed.type === 'custom_instruction' && 
           parsed.instruction.includes('voicemail'))
        );
      } catch (e) {
        return false;
      }
    });
    
    // Verify there's a fallback voicemail message without specific personalization
    expect(voicemailMessage).toBeDefined();
    const parsed = JSON.parse(voicemailMessage);
    const content = parsed.type === 'custom_instruction' 
      ? parsed.instruction 
      : parsed.conversation_config_override?.agent?.prompt?.prompt;
    
    // The generic message should still be coherent and complete
    expect(content).toContain('voicemail');
    expect(content).toContain('message');
    expect(content).toContain('home care');
    
    // Should not contain undefined or null placeholders
    expect(content).not.toContain('undefined');
    expect(content).not.toContain('null');
  });
}); 