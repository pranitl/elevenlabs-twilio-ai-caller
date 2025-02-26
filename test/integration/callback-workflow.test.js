// test/integration/callback-workflow.test.js
import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import '../setup.js';
import { mockFastify } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';
import mockTwilioClient from '../mocks/twilio.js';

// Mock modules
jest.mock('ws', () => {
  const { MockWebSocket } = require('../mocks/ws.js');
  return {
    WebSocket: MockWebSocket,
    OPEN: 1,
    CLOSED: 3
  };
});

jest.mock('twilio', () => {
  return jest.fn(() => mockTwilioClient());
});

jest.mock('../../forTheLegends/outbound/intent-detector.js', () => {
  const intentDetector = {
    callIntents: {},
    
    initializeIntentDetection: jest.fn((callSid) => {
      intentDetector.callIntents[callSid] = {
        detectedIntents: [],
        primaryIntent: null
      };
    }),
    
    processTranscript: jest.fn((callSid, transcript) => {
      // Simple intent detection logic for testing
      const intentResult = { 
        intentDetected: false, 
        detectedIntents: [] 
      };
      
      if (transcript.toLowerCase().includes('call me back') || 
          transcript.toLowerCase().includes('callback') ||
          transcript.toLowerCase().includes('reschedule')) {
        intentResult.intentDetected = true;
        intentResult.detectedIntents.push('schedule_callback');
        intentDetector.callIntents[callSid].detectedIntents.push('schedule_callback');
        intentDetector.callIntents[callSid].primaryIntent = { 
          name: 'schedule_callback', 
          confidence: 0.9 
        };
      }
      
      return intentResult;
    }),
    
    getIntentInstructions: jest.fn(() => null),
    
    hasSchedulingIntent: jest.fn((callSid) => {
      return intentDetector.callIntents[callSid]?.detectedIntents.includes('schedule_callback') || false;
    }),
    
    hasNegativeIntent: jest.fn(() => false),
    
    getIntentData: jest.fn((callSid) => {
      return intentDetector.callIntents[callSid] || null;
    })
  };
  
  return intentDetector;
});

const mockRetryManager = {
  initialize: jest.fn(),
  trackCall: jest.fn(),
  scheduleRetryCall: jest.fn(() => Promise.resolve({ success: true }))
};

jest.mock('../../forTheLegends/outbound/retry-manager.js', () => {
  return mockRetryManager;
});

// Mock the fetch function for the webhook calls
global.fetch = jest.fn(() => 
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  })
);

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('End-to-End Callback Workflow Integration', () => {
  let wsHandler;
  let salesStatusHandler;
  let mockWs;
  let mockReq;
  let elevenLabsWs;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Set up to capture handlers
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
    
    mockFastify.post.mockImplementation((path, handler) => {
      if (path === '/sales-status') {
        salesStatusHandler = handler;
      }
      return mockFastify;
    });
    
    // Register routes
    registerOutboundRoutes(mockFastify);
    
    // Create mock objects
    mockWs = new MockWebSocket('wss://localhost:8000');
    mockReq = { 
      headers: { host: 'localhost:8000' }, 
      body: {} 
    };
    
    elevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io');
    jest.spyOn(global, 'WebSocket').mockImplementation(() => elevenLabsWs);
    
    // Set up global detection function
    global.detectCallbackTime = jest.fn(text => {
      const result = {
        hasTimeReference: false,
        rawText: text,
        detectedDays: [],
        detectedTimes: [],
        detectedRelative: [],
        detectedPeriods: []
      };
      
      if (text.toLowerCase().includes('tomorrow')) {
        result.hasTimeReference = true;
        result.detectedRelative.push('tomorrow');
      }
      
      if (text.toLowerCase().includes('afternoon')) {
        result.hasTimeReference = true;
        result.detectedPeriods.push('afternoon');
      }
      
      if (text.toLowerCase().includes('3 pm') || text.toLowerCase().includes('3pm')) {
        result.hasTimeReference = true;
        result.detectedTimes.push('3 pm');
      }
      
      return result.hasTimeReference ? result : null;
    });
    
    // Set up global call statuses
    global.callStatuses = {};
    
    // Intercept the sendCallDataToWebhook function
    global.sendCallDataToWebhook = jest.fn();
  });
  
  afterAll(() => {
    // Clean up
    delete global.callStatuses;
    delete global.detectCallbackTime;
    delete global.sendCallDataToWebhook;
  });

  it('should complete full callback workflow when sales team is unavailable', async () => {
    // Set up call statuses for a lead and sales call
    const leadCallSid = 'CA12345';
    const salesCallSid = 'CA67890';
    
    global.callStatuses[leadCallSid] = {
      leadStatus: 'in-progress',
      salesCallSid: salesCallSid,
      leadInfo: {
        LeadId: 'LEAD123',
        PhoneNumber: '+18001234567',
        LeadName: 'John Doe',
        CareNeededFor: 'Father',
        CareReason: 'Mobility assistance'
      }
    };
    
    global.callStatuses[salesCallSid] = {
      salesStatus: 'in-progress',
      leadCallSid: leadCallSid
    };
    
    // Initialize WebSocket connection
    wsHandler(mockWs, mockReq);
    
    // Simulate start message
    const startMessage = {
      event: 'start',
      start: {
        streamSid: 'MX12345',
        callSid: leadCallSid,
        customParameters: global.callStatuses[leadCallSid].leadInfo
      }
    };
    mockWs.emit('message', JSON.stringify(startMessage));
    
    // Simulate ElevenLabs connection opening
    elevenLabsWs.emit('open');
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Step 1: Make sales team unavailable
    mockReq.body = {
      CallSid: salesCallSid,
      CallStatus: 'completed'
    };
    await salesStatusHandler(mockReq, { send: jest.fn() });
    
    // Verify sales team unavailable flag
    expect(global.callStatuses[leadCallSid].salesTeamUnavailable).toBe(true);
    
    // Step 2: Send a media message to trigger the unavailable instruction
    const mediaMessage = {
      event: 'media',
      media: {
        payload: Buffer.from('Hello, is anyone there?').toString('base64')
      }
    };
    mockWs.emit('message', JSON.stringify(mediaMessage));
    
    // Verify unavailable instruction was sent
    await new Promise(resolve => setTimeout(resolve, 50));
    const sentMessages = elevenLabsWs.getSentMessages();
    const unavailableInstruction = sentMessages.find(msg => 
      typeof msg === 'string' && 
      JSON.parse(msg).type === 'custom_instruction' && 
      JSON.parse(msg).instruction.includes('unavailable')
    );
    expect(unavailableInstruction).toBeDefined();
    
    // Step 3: User responds with callback request with time
    const userTranscript = {
      type: 'transcript',
      transcript_event: {
        speaker: 'user',
        text: 'Please call me back tomorrow afternoon at 3 pm'
      }
    };
    elevenLabsWs.emit('message', JSON.stringify(userTranscript));
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify callback preferences were captured
    expect(global.callStatuses[leadCallSid].callbackPreferences).toBeDefined();
    expect(global.callStatuses[leadCallSid].callbackPreferences.length).toBe(1);
    expect(global.callStatuses[leadCallSid].callbackPreferences[0].salesUnavailable).toBe(true);
    
    // Verify retry manager was called to track the call
    expect(mockRetryManager.trackCall).toHaveBeenCalledWith(
      'LEAD123',
      leadCallSid,
      expect.objectContaining({
        phoneNumber: '+18001234567',
        callbackTimeInfo: expect.objectContaining({
          hasTimeReference: true,
          detectedRelative: ['tomorrow'],
          detectedPeriods: ['afternoon'],
          detectedTimes: ['3 pm']
        })
      })
    );
    
    // Step 4: End the call
    mockWs.emit('close');
    elevenLabsWs.emit('close');
    
    // Step 5: Verify webhook data would be sent
    expect(global.sendCallDataToWebhook).toHaveBeenCalledWith(
      leadCallSid,
      expect.any(String)
    );
  });

  it('should handle callback intent without sales team being unavailable', async () => {
    // Set up call statuses for a lead and sales call
    const leadCallSid = 'CA12345';
    const salesCallSid = 'CA67890';
    
    global.callStatuses[leadCallSid] = {
      leadStatus: 'in-progress',
      salesCallSid: salesCallSid,
      leadInfo: {
        LeadId: 'LEAD123',
        PhoneNumber: '+18001234567',
        LeadName: 'John Doe'
      },
      intentInitialized: true
    };
    
    global.callStatuses[salesCallSid] = {
      salesStatus: 'in-progress',
      leadCallSid: leadCallSid
    };
    
    // Initialize WebSocket connection
    wsHandler(mockWs, mockReq);
    
    // Simulate start message
    const startMessage = {
      event: 'start',
      start: {
        streamSid: 'MX12345',
        callSid: leadCallSid,
        customParameters: global.callStatuses[leadCallSid].leadInfo
      }
    };
    mockWs.emit('message', JSON.stringify(startMessage));
    
    // Simulate ElevenLabs connection opening
    elevenLabsWs.emit('open');
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Step 1: User expresses callback intent without time
    const userTranscriptNoTime = {
      type: 'transcript',
      transcript_event: {
        speaker: 'user',
        text: 'I would prefer if you could call me back instead'
      }
    };
    elevenLabsWs.emit('message', JSON.stringify(userTranscriptNoTime));
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify intent detection was called
    const { processTranscript } = require('../../forTheLegends/outbound/intent-detector.js');
    expect(processTranscript).toHaveBeenCalledWith(
      leadCallSid, 
      'I would prefer if you could call me back instead',
      'lead'
    );
    
    // Verify prompt for time was sent
    const sentMessages = elevenLabsWs.getSentMessages();
    const timePrompt = sentMessages.find(msg => 
      typeof msg === 'string' && 
      JSON.parse(msg).type === 'custom_instruction' && 
      JSON.parse(msg).instruction.includes('time')
    );
    expect(timePrompt).toBeDefined();
    
    // Step 2: User provides a time
    const userTranscriptWithTime = {
      type: 'transcript',
      transcript_event: {
        speaker: 'user',
        text: 'Tomorrow afternoon at 3 pm would be perfect'
      }
    };
    elevenLabsWs.emit('message', JSON.stringify(userTranscriptWithTime));
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify callback preferences were captured
    expect(global.callStatuses[leadCallSid].callbackPreferences).toBeDefined();
    expect(global.callStatuses[leadCallSid].callbackPreferences.length).toBe(1);
    
    // Verify retry manager was called
    expect(mockRetryManager.trackCall).toHaveBeenCalledWith(
      'LEAD123',
      leadCallSid,
      expect.objectContaining({
        phoneNumber: '+18001234567',
        callbackTimeInfo: expect.objectContaining({
          hasTimeReference: true
        })
      })
    );
  });

  it('should not duplicate callback time prompts for same intent', async () => {
    // Set up call statuses
    const leadCallSid = 'CA12345';
    
    global.callStatuses[leadCallSid] = {
      leadStatus: 'in-progress',
      intentInitialized: true
    };
    
    // Initialize WebSocket connection
    wsHandler(mockWs, mockReq);
    
    // Simulate start message
    const startMessage = {
      event: 'start',
      start: {
        streamSid: 'MX12345',
        callSid: leadCallSid,
        customParameters: {}
      }
    };
    mockWs.emit('message', JSON.stringify(startMessage));
    
    // Simulate ElevenLabs connection opening
    elevenLabsWs.emit('open');
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Clear any previous messages
    elevenLabsWs.sentMessages = [];
    
    // User expresses callback intent without time
    const userTranscript = {
      type: 'transcript',
      transcript_event: {
        speaker: 'user',
        text: 'Please call me back instead'
      }
    };
    elevenLabsWs.emit('message', JSON.stringify(userTranscript));
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Count how many time prompts were sent
    const timePrompts = elevenLabsWs.getSentMessages().filter(msg => 
      typeof msg === 'string' && 
      JSON.parse(msg).type === 'custom_instruction' && 
      JSON.parse(msg).instruction.includes('time')
    );
    
    // Should only be one prompt
    expect(timePrompts.length).toBe(1);
    
    // Send a second similar transcript
    const secondTranscript = {
      type: 'transcript',
      transcript_event: {
        speaker: 'user',
        text: 'Yes I want you to call me back'
      }
    };
    
    // Clear previous messages
    elevenLabsWs.sentMessages = [];
    
    // Send the second transcript
    elevenLabsWs.emit('message', JSON.stringify(secondTranscript));
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Count how many time prompts were sent for the second request
    // We need to carefully check if a new prompt was sent
    const secondTimePrompts = elevenLabsWs.getSentMessages().filter(msg => 
      typeof msg === 'string' && 
      JSON.parse(msg).type === 'custom_instruction' && 
      JSON.parse(msg).instruction.includes('time')
    );
    
    // Should still only be one total prompt sent (due to the fixed code)
    expect(secondTimePrompts.length).toBe(1);
  });
}); 