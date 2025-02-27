/**
 * Test suite for Intent Detection Integration with ElevenLabs Success Criteria
 */
import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import { setupStreamingWebSocket } from '../../setupStreamingWebSocket.js';
import { initializeIntentDetection, processTranscript, getIntentData } from '../../forTheLegends/outbound/intent-detector.js';
import { MockWebSocket } from '../mocks/websocket-mock.js';

describe('Intent Detection Integration with ElevenLabs Success Criteria', () => {
  let websocket;
  let elevenLabsWs;
  const callSid = 'CA12345';
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock websockets
    websocket = new MockWebSocket();
    elevenLabsWs = new MockWebSocket();
    
    // Initialize intent detection
    initializeIntentDetection(callSid);
  });
  
  test('should initialize success criteria format in ElevenLabs configuration', () => {
    // Setup the WebSocket connection with the mock
    const wsConnectionHandler = setupStreamingWebSocket({ send: jest.fn() });
    
    // Manually invoke the handler with simulated message
    wsConnectionHandler({
      data: JSON.stringify({
        event: 'start',
        streamSid: 'MT12345',
        callSid: callSid,
        customParameters: JSON.stringify({
          leadName: 'John',
          prompt: 'Test prompt'
        })
      })
    });
    
    // Get the conversation initialization messages
    const initMessages = global.sentMessages.filter(msg => 
      msg.event === 'elevenlabs:init' || 
      msg.event === 'elevenlabs:configuration'
    );
    
    // Verify success criteria are included in the configuration
    expect(initMessages.length).toBeGreaterThan(0);
    const configMsg = initMessages[0];
    
    expect(configMsg.data).toBeDefined();
    expect(configMsg.data.successCriteria).toBeDefined();
    expect(configMsg.data.successCriteria).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'positive_intent',
        prompt: expect.stringContaining('interest in proceeding with care services')
      }),
      expect.objectContaining({
        title: 'negative_intent',
        prompt: expect.stringContaining('declined interest in care services')
      })
    ]));
  });
  
  test('should properly map ElevenLabs success criteria results to internal intent system', () => {
    // Process some transcript to set up intent detection
    processTranscript(callSid, 'I might be interested in your services', 'lead');
    
    // Simulate receiving success criteria results from ElevenLabs
    const elevenLabsSuccessCriteriaResult = {
      type: 'success_criteria_results',
      results: [
        {
          title: 'positive_intent',
          result: true
        },
        {
          title: 'negative_intent',
          result: false
        }
      ]
    };
    
    // Use the exposed handler to process the results
    global.processElevenLabsSuccessCriteria(callSid, elevenLabsSuccessCriteriaResult);
    
    // Check if the intent data was properly updated
    const intentData = getIntentData(callSid);
    
    // Verify intent was mapped correctly
    const hasServiceInterest = intentData.detectedIntents.some(intent => 
      intent.name === 'service_interest'
    );
    expect(hasServiceInterest).toBe(true);
    
    // Check that no_interest is not present
    const hasNoInterest = intentData.detectedIntents.some(intent => 
      intent.name === 'no_interest'
    );
    expect(hasNoInterest).toBe(false);
    
    // Check primary intent
    expect(intentData.primaryIntent).toBe('service_interest');
  });
  
  test('should handle negative intent from ElevenLabs', () => {
    // Process some transcript to set up intent detection
    processTranscript(callSid, 'I might not be interested right now', 'lead');
    
    // Simulate receiving negative success criteria results from ElevenLabs
    const elevenLabsSuccessCriteriaResult = {
      type: 'success_criteria_results',
      results: [
        {
          title: 'positive_intent',
          result: false
        },
        {
          title: 'negative_intent',
          result: true
        }
      ]
    };
    
    // Process the results
    global.processElevenLabsSuccessCriteria(callSid, elevenLabsSuccessCriteriaResult);
    
    // Check if the intent data was properly updated
    const intentData = getIntentData(callSid);
    
    // Verify intent was mapped correctly
    const hasNoInterest = intentData.detectedIntents.some(intent => 
      intent.name === 'no_interest'
    );
    expect(hasNoInterest).toBe(true);
    
    // Check primary intent
    expect(intentData.primaryIntent).toBe('no_interest');
  });
}); 