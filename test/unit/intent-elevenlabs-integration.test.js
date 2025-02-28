/**
 * Test suite for Intent Detection Integration with ElevenLabs Success Criteria
 */
import { jest } from '@jest/globals';
import { initializeIntentDetection, processTranscript, processElevenLabsSuccessCriteria, getIntentData } from '../../forTheLegends/outbound/intent-detector.js';

// Mock call state module
const callData = {};
jest.mock('../../forTheLegends/outbound/call-state.js', () => ({
  callStatuses: callData,
  getCallData: (callSid) => callData[callSid] || {},
  updateCallData: (callSid, data) => {
    callData[callSid] = { ...(callData[callSid] || {}), ...data };
    return callData[callSid];
  }
}));

describe('Intent Detection Integration with ElevenLabs Success Criteria', () => {
  const callSid = 'CA12345';
  
  beforeEach(() => {
    // Reset state
    jest.clearAllMocks();
    Object.keys(callData).forEach(key => delete callData[key]);
    
    // Setup initial call data
    callData[callSid] = {
      streamSid: 'MT12345',
      leadStatus: 'in-progress'
    };
    
    // Initialize intent detection
    initializeIntentDetection(callSid);
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
    
    // Process the success criteria results
    processElevenLabsSuccessCriteria(callSid, elevenLabsSuccessCriteriaResult);
    
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
    expect(intentData.primaryIntent.name).toBe('service_interest');
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
    processElevenLabsSuccessCriteria(callSid, elevenLabsSuccessCriteriaResult);
    
    // Check if the intent data was properly updated
    const intentData = getIntentData(callSid);
    
    // Verify intent was mapped correctly
    const hasNoInterest = intentData.detectedIntents.some(intent => 
      intent.name === 'no_interest'
    );
    expect(hasNoInterest).toBe(true);
    
    // Check primary intent
    expect(intentData.primaryIntent.name).toBe('no_interest');
  });
}); 