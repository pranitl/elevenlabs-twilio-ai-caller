// test/unit/voicemail-callback-handling.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';
import MockWebSocket from '../mocks/ws.js';
import mockTwilioClient from '../mocks/twilio.js';

// Mock modules
jest.mock('twilio', () => {
  return jest.fn(() => mockTwilioClient());
});

jest.mock('../../forTheLegends/outbound/intent-detector.js', () => {
  return {
    initializeIntentDetection: jest.fn(),
    processTranscript: jest.fn(() => ({ 
      intentDetected: false, 
      detectedIntents: [] 
    })),
    getIntentInstructions: jest.fn(),
    hasSchedulingIntent: jest.fn(() => false),
    hasNegativeIntent: jest.fn(() => false),
    getIntentData: jest.fn(() => null)
  };
});

jest.mock('../../forTheLegends/outbound/retry-manager.js', () => {
  return {
    initialize: jest.fn(),
    trackCall: jest.fn(),
    scheduleRetryCall: jest.fn(() => Promise.resolve({ success: true }))
  };
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Voicemail and Callback Handling', () => {
  let amdCallbackHandler;
  let salesStatusHandler;
  let wsHandler;
  let ws;
  let elevenLabsWs;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock route handlers
    mockFastify.post.mockImplementation((path, handler) => {
      if (path === '/amd-callback') {
        amdCallbackHandler = handler;
      } else if (path === '/sales-status') {
        salesStatusHandler = handler;
      }
      return mockFastify;
    });
    
    // Mock WebSocket handling
    mockFastify.get.mockImplementation((path, options, handler) => {
      if (path === '/outbound-media-stream' && options.websocket) {
        wsHandler = handler;
      }
      return mockFastify;
    });
    
    // Register routes
    registerOutboundRoutes(mockFastify);
    
    // Create WebSocket for testing
    ws = new MockWebSocket();
    elevenLabsWs = new MockWebSocket();
    
    // Mock websocket open state
    elevenLabsWs.readyState = 1; // WebSocket.OPEN
    
    // Patch global WebSocket constructor
    global.WebSocket = function(url) {
      return elevenLabsWs;
    };
    
    // Reset global state
    global.callStatuses = {};
    
    // Initialize call status for testing
    global.callStatuses['CALL123'] = {
      leadStatus: 'in-progress',
      salesCallSid: 'SALES123',
      leadInfo: {
        LeadId: '12345',
        PhoneNumber: '+18001234567',
        LeadName: 'John Doe'
      }
    };
    
    global.callStatuses['SALES123'] = {
      salesStatus: 'in-progress',
      leadCallSid: 'CALL123'
    };
    
    // Simulate WebSocket connection
    wsHandler(ws, {
      params: {},
      query: {},
      headers: { host: 'localhost:8000' }
    });
    
    // Simulate 'start' event to initialize connection
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
    
    ws.emit('message', JSON.stringify(startEvent));
    
    // Mock sendCallDataToWebhook function
    global.sendCallDataToWebhook = jest.fn(async () => true);
    
    // Mock detectCallbackTime function
    global.detectCallbackTime = jest.fn(text => {
      if (text.includes('tomorrow') || text.includes('Friday') || text.includes('afternoon')) {
        return {
          hasTimeReference: true,
          rawText: text,
          detectedDays: text.includes('Friday') ? ['friday'] : [],
          detectedTimes: text.includes('3 pm') ? ['3 pm'] : [],
          detectedRelative: text.includes('tomorrow') ? ['tomorrow'] : [],
          detectedPeriods: text.includes('afternoon') ? ['afternoon'] : []
        };
      }
      return null;
    });
  });
  
  afterEach(() => {
    delete global.callStatuses;
    delete global.WebSocket;
    delete global.sendCallDataToWebhook;
    delete global.detectCallbackTime;
  });

  it('should detect voicemail through AMD callback', async () => {
    // Set up AMD callback request
    mockRequest.body = {
      CallSid: 'CALL123',
      AnsweredBy: 'machine_end_beep'
    };
    
    // Call AMD callback handler
    await amdCallbackHandler(mockRequest, mockReply);
    
    // Verify call status updated
    expect(global.callStatuses['CALL123'].isVoicemail).toBe(true);
    
    // Simulate media event to trigger voicemail logic
    const mediaEvent = {
      event: 'media',
      media: {
        payload: Buffer.from('Audio data').toString('base64')
      }
    };
    
    ws.emit('message', JSON.stringify(mediaEvent));
    
    // Verify instruction sent to ElevenLabs
    const sentMessages = elevenLabsWs.getSentMessages();
    const voicemailInstruction = sentMessages.find(msg => {
      const parsed = JSON.parse(msg);
      return parsed.type === 'custom_instruction' && 
             parsed.instruction.includes('voicemail') &&
             parsed.instruction.includes('beep');
    });
    
    expect(voicemailInstruction).toBeDefined();
    
    // Verify sales team was notified
    expect(mockTwilioClient().calls().update).toHaveBeenCalled();
  });

  it('should detect voicemail through transcript analysis', async () => {
    // Simulate transcript indicating voicemail
    const voicemailTranscript = {
      type: 'transcript',
      transcript_event: {
        text: 'You have reached the voicemail of John Doe. Please leave a message after the beep.',
        speaker: 'user'
      }
    };
    
    // Send transcript message
    elevenLabsWs.emit('message', JSON.stringify(voicemailTranscript));
    
    // Verify call status updated
    expect(global.callStatuses['CALL123'].isVoicemail).toBe(true);
    
    // Verify instruction sent to ElevenLabs
    const sentMessages = elevenLabsWs.getSentMessages();
    const voicemailInstruction = sentMessages.find(msg => {
      const parsed = JSON.parse(msg);
      return parsed.type === 'custom_instruction' && 
             parsed.instruction.includes('voicemail') &&
             parsed.instruction.includes('beep');
    });
    
    expect(voicemailInstruction).toBeDefined();
  });

  it('should handle sales team unavailable scenario', async () => {
    // Set up request for sales call ending
    mockRequest.body = {
      CallSid: 'SALES123',
      CallStatus: 'completed'
    };
    
    // Call sales status handler
    await salesStatusHandler(mockRequest, mockReply);
    
    // Verify call status updated
    expect(global.callStatuses['CALL123'].salesTeamUnavailable).toBe(true);
    
    // Simulate media event to trigger unavailable logic
    const mediaEvent = {
      event: 'media',
      media: {
        payload: Buffer.from('Audio data').toString('base64')
      }
    };
    
    ws.emit('message', JSON.stringify(mediaEvent));
    
    // Verify instruction sent to ElevenLabs
    const sentMessages = elevenLabsWs.getSentMessages();
    const unavailableInstruction = sentMessages.find(msg => {
      const parsed = JSON.parse(msg);
      return parsed.type === 'custom_instruction' && 
             parsed.instruction.includes('unavailable') &&
             parsed.instruction.includes('schedule');
    });
    
    expect(unavailableInstruction).toBeDefined();
    expect(global.callStatuses['CALL123'].salesTeamUnavailableInstructionSent).toBe(true);
  });

  it('should schedule callback when call ends with sales team unavailable', async () => {
    // Set sales team as unavailable
    global.callStatuses['CALL123'].salesTeamUnavailable = true;
    global.callStatuses['CALL123'].conversationId = 'CONVO123';
    
    // Add transcript with callback time
    const timeTranscript = {
      type: 'transcript',
      transcript_event: {
        text: 'I would be available tomorrow afternoon around 3 pm',
        speaker: 'user'
      }
    };
    
    // Send transcript to detect time
    elevenLabsWs.emit('message', JSON.stringify(timeTranscript));
    
    // Verify callback preferences stored
    expect(global.callStatuses['CALL123'].callbackPreferences).toBeDefined();
    
    // Now simulate call ending by closing WebSocket
    elevenLabsWs.emit('close');
    
    // Verify webhook was called
    expect(global.sendCallDataToWebhook).toHaveBeenCalledWith('CALL123', 'CONVO123');
    
    // Verify callback scheduling was attempted
    const { scheduleRetryCall } = require('../../forTheLegends/outbound/retry-manager.js');
    expect(scheduleRetryCall).toHaveBeenCalled();
  });

  it('should handle stop event and clean up connection', async () => {
    // Simulate stop event
    const stopEvent = {
      event: 'stop',
      streamSid: 'STREAM123'
    };
    
    // Send stop event
    ws.emit('message', JSON.stringify(stopEvent));
    
    // Verify ElevenLabs connection was closed
    expect(elevenLabsWs.closeWasCalled).toBe(true);
  });
}); 