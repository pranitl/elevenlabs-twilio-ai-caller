import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';
import mockTwilioClient from '../mocks/twilio.js';

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

// Mock intent detection module
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

// Mock retry manager module
jest.mock('../../forTheLegends/outbound/retry-manager.js', () => {
  return {
    initialize: jest.fn(),
    trackCall: jest.fn(),
    scheduleRetryCall: jest.fn(() => Promise.resolve({ success: true }))
  };
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Callback Intent Duplicate Logic Fix', () => {
  let wsHandler;
  let mockWs;
  let mockReq;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Set up to capture the WebSocket handler
    mockFastify.register.mockImplementation((pluginFunc, opts) => {
      if (opts && opts.websocket) {
        pluginFunc({
          get: (path, opts, handler) => {
            if (path === '/outbound-media-stream') {
              wsHandler = handler;
            }
          }
        });
      }
      return mockFastify;
    });
    
    // Register routes to capture the handlers
    registerOutboundRoutes(mockFastify);
    
    // Mock WebSocket and request
    mockWs = new MockWebSocket('wss://localhost:8000');
    mockReq = { 
      headers: { host: 'localhost:8000' }, 
      body: {} 
    };
    
    // Global callStatuses storage for testing
    global.callStatuses = {};
    
    // Mock detectCallbackTime function globally
    global.detectCallbackTime = jest.fn(text => {
      if (text.includes('tomorrow') || text.includes('Friday') || text.includes('3 pm')) {
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
    // Clean up global state
    delete global.callStatuses;
    delete global.detectCallbackTime;
  });

  it('should only send one prompt for callback time when no specific time is detected', async () => {
    // Call the WebSocket handler
    wsHandler(mockWs, mockReq);
    
    // Set up call status
    const callSid = 'CA12345';
    global.callStatuses[callSid] = {
      leadStatus: 'in-progress',
      intentInitialized: true
    };
    
    // Simulate start message
    const startMessage = {
      event: 'start',
      start: {
        streamSid: 'MX12345',
        callSid: callSid,
        customParameters: {}
      }
    };
    mockWs.emit('message', JSON.stringify(startMessage));
    
    // Create a mock ElevenLabs WebSocket
    const elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io');
    const elevenLabsSendSpy = jest.spyOn(elevenLabsWs, 'send');
    jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
    
    // Trigger the ElevenLabs connection
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Simulate ElevenLabs connection opening
    elevenLabsWs.emit('open');
    
    // Simulate transcript with callback intent but no time references
    const transcriptWithCallbackNoTime = {
      type: 'transcript',
      transcript_event: {
        speaker: 'user',
        text: 'Can someone call me back please?'
      }
    };
    
    // Send the transcript
    elevenLabsWs.emit('message', JSON.stringify(transcriptWithCallbackNoTime));
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Count custom instructions about callback time
    const sentMessages = elevenLabsWs.getSentMessages().map(msg => 
      typeof msg === 'string' ? JSON.parse(msg) : msg
    );
    
    const callbackTimeInstructions = sentMessages.filter(msg => 
      msg.type === 'custom_instruction' && 
      msg.instruction && 
      msg.instruction.includes('callback') && 
      msg.instruction.includes('time')
    );
    
    // Should only have one instruction asking for callback time
    expect(callbackTimeInstructions.length).toBe(1);
  });

  it('should handle explicit callback request with time correctly', async () => {
    // Call the WebSocket handler
    wsHandler(mockWs, mockReq);
    
    // Set up call status
    const callSid = 'CA12345';
    global.callStatuses[callSid] = {
      leadStatus: 'in-progress',
      intentInitialized: true,
      leadInfo: {
        LeadId: '12345',
        PhoneNumber: '+18001234567'
      }
    };
    
    // Simulate start message
    const startMessage = {
      event: 'start',
      start: {
        streamSid: 'MX12345',
        callSid: callSid,
        customParameters: {}
      }
    };
    mockWs.emit('message', JSON.stringify(startMessage));
    
    // Create a mock ElevenLabs WebSocket
    const elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io');
    jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
    
    // Trigger the ElevenLabs connection
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Simulate ElevenLabs connection opening
    elevenLabsWs.emit('open');
    
    // Simulate transcript with callback intent and time reference
    const transcriptWithCallbackAndTime = {
      type: 'transcript',
      transcript_event: {
        speaker: 'user',
        text: 'Please call me back tomorrow at 3 pm'
      }
    };
    
    // Send the transcript
    elevenLabsWs.emit('message', JSON.stringify(transcriptWithCallbackAndTime));
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify callback preferences were saved
    expect(global.callStatuses[callSid].callbackPreferences).toBeDefined();
    expect(global.callStatuses[callSid].callbackPreferences.length).toBe(1);
    
    // Verify tracking call was invoked with correct information
    const { trackCall } = require('../../forTheLegends/outbound/retry-manager.js');
    expect(trackCall).toHaveBeenCalledWith(
      '12345',
      callSid,
      expect.objectContaining({
        phoneNumber: '+18001234567',
        callbackTimeInfo: expect.objectContaining({
          hasTimeReference: true,
          detectedRelative: ['tomorrow'],
          detectedTimes: ['3 pm']
        })
      })
    );
  });
  
  it('should not send duplicate prompts when already scheduled callback', async () => {
    // Call the WebSocket handler
    wsHandler(mockWs, mockReq);
    
    // Set up call status with callback already scheduled
    const callSid = 'CA12345';
    global.callStatuses[callSid] = {
      leadStatus: 'in-progress',
      intentInitialized: true,
      callbackScheduled: true
    };
    
    // Simulate start message
    const startMessage = {
      event: 'start',
      start: {
        streamSid: 'MX12345',
        callSid: callSid,
        customParameters: {}
      }
    };
    mockWs.emit('message', JSON.stringify(startMessage));
    
    // Create a mock ElevenLabs WebSocket
    const elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io');
    const elevenLabsSendSpy = jest.spyOn(elevenLabsWs, 'send');
    jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
    
    // Trigger the ElevenLabs connection
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Simulate ElevenLabs connection opening
    elevenLabsWs.emit('open');
    
    // Clear previous calls to send
    elevenLabsSendSpy.mockClear();
    
    // Simulate another transcript with callback intent but no time
    const transcriptWithCallbackNoTime = {
      type: 'transcript',
      transcript_event: {
        speaker: 'user',
        text: 'I want you to call me back'
      }
    };
    
    // Send the transcript
    elevenLabsWs.emit('message', JSON.stringify(transcriptWithCallbackNoTime));
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Count custom instructions about callback time
    const sentMessages = elevenLabsSendSpy.mock.calls
      .map(call => (typeof call[0] === 'string' ? JSON.parse(call[0]) : call[0]))
      .filter(msg => 
        msg.type === 'custom_instruction' && 
        msg.instruction && 
        msg.instruction.includes('callback') && 
        msg.instruction.includes('time')
      );
    
    // Should not have sent any callback time instructions since it's already scheduled
    expect(sentMessages.length).toBe(0);
  });
}); 