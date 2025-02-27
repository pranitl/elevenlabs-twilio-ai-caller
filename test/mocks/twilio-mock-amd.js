/**
 * Enhanced Twilio mock for AMD testing
 * This mock extends the base Twilio mock to provide more control over AMD responses and SIP codes
 */
import { jest } from '@jest/globals';

/**
 * Extended MockCall class with AMD features
 */
class ExtendedMockCall {
  constructor(sid, to, from, status = 'queued') {
    this.sid = sid;
    this.to = to;
    this.from = from;
    this.status = status;
    this.options = {};
    this.update = jest.fn(() => Promise.resolve(this));
  }
}

/**
 * Extended MockCalls class with AMD features
 */
class ExtendedMockCalls {
  constructor() {
    this.calls = {};
  }
  
  async create(options) {
    const callSid = `CA${Math.random().toString(36).substring(2, 15)}`;
    const call = new ExtendedMockCall(callSid, options.to, options.from);
    this.calls[callSid] = call;
    
    // Store call options for later inspection in tests
    call.options = options;
    
    // Simulate call status callbacks if provided
    if (options.statusCallback && options.statusCallbackEvent) {
      // Convert statusCallbackEvent to array if it's a string
      const events = Array.isArray(options.statusCallbackEvent) 
        ? options.statusCallbackEvent 
        : [options.statusCallbackEvent];
      
      // Simulate each requested event
      if (events.includes('initiated')) {
        setTimeout(() => {
          this._simulateStatusCallback(callSid, 'initiated', options.statusCallback);
        }, 50);
      }
      
      // Only simulate ringing if isRinging is true
      if (events.includes('ringing') && global.testSettings?.isRinging !== false) {
        setTimeout(() => {
          this._simulateStatusCallback(callSid, 'ringing', options.statusCallback);
        }, 100);
      }
      
      if (events.includes('answered') || events.includes('in-progress')) {
        setTimeout(() => {
          // Check if the call should fail instead of being answered
          if (global.testSettings?.callOutcome === 'failed') {
            this._simulateStatusCallback(callSid, 'failed', options.statusCallback);
          } else if (global.testSettings?.callOutcome === 'busy') {
            this._simulateStatusCallback(callSid, 'busy', options.statusCallback);
          } else if (global.testSettings?.callOutcome === 'no-answer') {
            this._simulateStatusCallback(callSid, 'no-answer', options.statusCallback);
          } else {
            this._simulateStatusCallback(callSid, 'in-progress', options.statusCallback);
            
            // Simulate AMD callback if enabled
            if (options.machineDetection) {
              this._simulateAmdCallback(callSid, options.asyncAmdStatusCallback);
            }
          }
        }, 150);
      }
    }
    
    return call;
  }
  
  // Access a specific call by SID
  calls(sid) {
    if (!this.calls[sid]) {
      throw new Error(`Call ${sid} not found`);
    }
    return this.calls[sid];
  }
  
  // Helper to simulate status callbacks
  _simulateStatusCallback(callSid, status, url) {
    // Update the call status
    if (this.calls[callSid]) {
      this.calls[callSid].status = status;
    }
    
    // If there's a global callback for testing, trigger it
    if (global.testCallbacks && typeof global.testCallbacks.twilioStatusCallback === 'function') {
      global.testCallbacks.twilioStatusCallback({
        CallSid: callSid,
        CallStatus: status
      });
    }
    
    // In a real test environment, you could mock the HTTP callback here
    console.log(`[MockTwilio] Status callback for ${callSid}: ${status}`);
  }
  
  // Helper to simulate AMD callbacks with enhanced control
  _simulateAmdCallback(callSid, url) {
    // Get the configured AMD result or default to 'human'
    const answeredBy = global.testSettings?.amdResult || 'human';
    
    // Get the configured SIP response code or default to '200'
    const sipResponseCode = global.testSettings?.sipResponseCode || '200';
    
    // If there's a global callback for testing, trigger it
    if (global.testCallbacks && typeof global.testCallbacks.twilioAmdCallback === 'function') {
      global.testCallbacks.twilioAmdCallback({
        CallSid: callSid,
        AnsweredBy: answeredBy,
        SipResponseCode: sipResponseCode
      });
    }
    
    // In a real test environment, you could mock the HTTP callback here
    console.log(`[MockTwilio] AMD callback for ${callSid}: ${answeredBy} (SIP: ${sipResponseCode})`);
  }
  
  // Helper to manually trigger a mid-call AMD change
  simulateMidCallAmdChange(callSid, newAmdResult) {
    const call = this.calls[callSid];
    if (!call) {
      throw new Error(`Call ${callSid} not found`);
    }
    
    // If there's a global callback for testing, trigger it
    if (global.testCallbacks && typeof global.testCallbacks.twilioAmdCallback === 'function') {
      global.testCallbacks.twilioAmdCallback({
        CallSid: callSid,
        AnsweredBy: newAmdResult,
        SipResponseCode: global.testSettings?.sipResponseCode || '200'
      });
    }
    
    console.log(`[MockTwilio] Mid-call AMD change for ${callSid}: ${newAmdResult}`);
    return call;
  }
  
  // Helper to manually trigger call completion (for testing)
  completeCall(callSid) {
    const call = this.calls[callSid];
    if (!call) {
      throw new Error(`Call ${callSid} not found`);
    }
    
    call.status = 'completed';
    
    // Trigger status callback if configured
    if (call.options?.statusCallback && 
        call.options.statusCallbackEvent && 
        (Array.isArray(call.options.statusCallbackEvent) 
          ? call.options.statusCallbackEvent.includes('completed')
          : call.options.statusCallbackEvent === 'completed')) {
      this._simulateStatusCallback(callSid, 'completed', call.options.statusCallback);
    }
    
    return call;
  }
}

/**
 * Enhanced Twilio Mock class for AMD testing
 */
class EnhancedTwilioMock {
  constructor(accountSid, authToken) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.calls = new ExtendedMockCalls();
  }
}

/**
 * Creates an enhanced Twilio mock for AMD testing
 */
export default function createEnhancedTwilioMock() {
  return new EnhancedTwilioMock('ACmockedaccountsid', 'mockedauthtoken');
}