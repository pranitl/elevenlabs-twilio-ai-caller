// test/unit/intent-based-callback.test.js
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
      intentDetected: true, 
      detectedIntents: ['schedule_callback'] 
    })),
    getIntentInstructions: jest.fn(),
    hasSchedulingIntent: jest.fn(() => true),
    hasNegativeIntent: jest.fn(() => false),
    getIntentData: jest.fn(() => ({
      primaryIntent: { name: 'schedule_callback', confidence: 0.85 }
    }))
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

describe('Intent-Based Callback Scheduling', () => {
  let ws;
  let elevenLabsWs;
  let wsHandler;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock WebSocket handling
    mockFastify.get.mockImplementation((path, options, handler) => {
      if (path === '/outbound-media-stream' && options.websocket) {
        wsHandler = handler;
      }
      return mockFastify;
    });
    
    // Register routes
    registerOutboundRoutes(mockFastify);
    
    // Reset global state
    global.callStatuses = {};
    
    // Create WebSocket for testing
    ws = new MockWebSocket();
    elevenLabsWs = new MockWebSocket();
    
    // Mock websocket open state
    elevenLabsWs.readyState = 1; // WebSocket.OPEN
    
    // Patch global WebSocket constructor
    global.WebSocket = function(url) {
      return elevenLabsWs;
    };
    
    // Simulate connection
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
  });
  
  afterEach(() => {
    delete global.callStatuses;
    delete global.WebSocket;
  });

  it('should detect callback intent and prompt for time', async () => {
    // Simulate incoming transcript from user requesting callback
    const mediaEvent = {
      event: 'media',
      media: {
        payload: Buffer.from('Could you call me back later please?').toString('base64')
      }
    };
    
    // Trigger transcript processing
    const transcriptEvent = {
      type: 'transcript',
      transcript_event: {
        text: 'Could you call me back later please?',
        speaker: 'user'
      }
    };
    
    // Send media event to trigger intent processing
    ws.emit('message', JSON.stringify(mediaEvent));
    
    // Simulate ElevenLabs sending transcript event
    elevenLabsWs.emit('message', JSON.stringify(transcriptEvent));
    
    // Validate call state tracking
    expect(global.callStatuses['CALL123']).toBeDefined();
    
    // Verify a custom instruction was sent to ElevenLabs
    const sentMessages = elevenLabsWs.getSentMessages();
    const instructionMessage = sentMessages.find(msg => {
      const parsed = JSON.parse(msg);
      return parsed.type === 'custom_instruction' && 
             parsed.instruction.includes('callback') &&
             parsed.instruction.includes('time');
    });
    
    expect(instructionMessage).toBeDefined();
  });

  it('should detect callback time in transcript', async () => {
    // Set up call status
    global.callStatuses['CALL123'] = {
      leadStatus: 'in-progress',
      leadInfo: {
        LeadId: '12345',
        PhoneNumber: '+18001234567'
      },
      intentInitialized: true
    };

    // Mock detectCallbackTime function by defining it globally
    // This is a workaround since we can't directly access the function from outbound-calls.js
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

    // Simulate user transcript with callback time
    const timeTranscript = {
      type: 'transcript',
      transcript_event: {
        text: 'Could you call me back tomorrow afternoon around 3 pm?',
        speaker: 'user'
      }
    };
    
    // Simulate ElevenLabs sending transcript event
    elevenLabsWs.emit('message', JSON.stringify(timeTranscript));
    
    // Expect callback preferences to be stored
    expect(global.callStatuses['CALL123'].callbackPreferences).toBeDefined();
    expect(global.callStatuses['CALL123'].callbackPreferences.length).toBeGreaterThan(0);
    
    // Verify tracking call was invoked
    const { trackCall } = require('../../forTheLegends/outbound/retry-manager.js');
    expect(trackCall).toHaveBeenCalled();
  });

  it('should handle sales team unavailable with callback intent', async () => {
    // Set up call status with sales team unavailable
    global.callStatuses['CALL123'] = {
      leadStatus: 'in-progress',
      salesTeamUnavailable: true,
      intentInitialized: true,
      leadInfo: {
        LeadId: '12345',
        PhoneNumber: '+18001234567'
      }
    };

    // Mock global function
    global.detectCallbackTime = jest.fn(() => null);
    
    // Simulate user transcript
    const transcript = {
      type: 'transcript',
      transcript_event: {
        text: 'That sounds good, I can provide my information.',
        speaker: 'user'
      }
    };
    
    // Simulate media message first
    const mediaEvent = {
      event: 'media',
      media: {
        payload: Buffer.from('Audio data').toString('base64')
      }
    };
    
    // Send media event (this should trigger the unavailable logic)
    ws.emit('message', JSON.stringify(mediaEvent));
    
    // Then simulate transcript event
    elevenLabsWs.emit('message', JSON.stringify(transcript));
    
    // Verify an instruction about sales team unavailability was sent
    const sentMessages = elevenLabsWs.getSentMessages();
    const unavailableMessage = sentMessages.find(msg => {
      const parsed = JSON.parse(msg);
      return parsed.type === 'custom_instruction' && 
             parsed.instruction.includes('unavailable') &&
             parsed.instruction.includes('callback');
    });
    
    expect(unavailableMessage).toBeDefined();
    expect(global.callStatuses['CALL123'].salesTeamUnavailableInstructionSent).toBe(true);
  });

  it('should schedule callback when call ends and time is detected', async () => {
    // Mock global schedule function
    const { scheduleRetryCall } = require('../../forTheLegends/outbound/retry-manager.js');
    scheduleRetryCall.mockResolvedValue({ success: true, scheduledTime: '2023-03-15T15:00:00Z' });
    
    // Mock sendCallDataToWebhook function
    global.sendCallDataToWebhook = jest.fn(async () => true);
    
    // Setup call status with callback preferences
    global.callStatuses['CALL123'] = {
      leadStatus: 'in-progress',
      salesTeamUnavailable: true,
      conversationId: 'CONVO123',
      intentInitialized: true,
      leadInfo: {
        LeadId: '12345',
        PhoneNumber: '+18001234567'
      },
      callbackPreferences: [{
        hasTimeReference: true,
        detectedDays: ['friday'],
        detectedTimes: ['3 pm'],
        fromIntent: true,
        salesUnavailable: true,
        detectedAt: new Date().toISOString()
      }]
    };
    
    // Simulate closing the WebSocket connection
    elevenLabsWs.emit('close');
    
    // Verify webhook was called
    expect(global.sendCallDataToWebhook).toHaveBeenCalledWith('CALL123', 'CONVO123');
    
    // Verify scheduleRetryCall was called
    expect(scheduleRetryCall).toHaveBeenCalled();
  });
}); 