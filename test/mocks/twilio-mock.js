/**
 * Enhanced Twilio mock implementation for testing
 * Provides simulation of calls, status callbacks, and AMD detection
 */

class MockCall {
  constructor(sid, to, from, status = 'queued') {
    this.sid = sid;
    this.to = to;
    this.from = from;
    this.status = status;
  }
  
  async update(options) {
    if (options.twiml) {
      this.twiml = options.twiml;
    }
    if (options.status) {
      this.status = options.status;
    }
    return this;
  }
}

class MockCalls {
  constructor() {
    this.calls = {};
  }
  
  async create(options) {
    const callSid = `CA${Math.random().toString(36).substring(2, 15)}`;
    const call = new MockCall(callSid, options.to, options.from);
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
        }, 100);
      }
      
      if (events.includes('ringing')) {
        setTimeout(() => {
          this._simulateStatusCallback(callSid, 'ringing', options.statusCallback);
        }, 300);
      }
      
      if (events.includes('answered') || events.includes('in-progress')) {
        setTimeout(() => {
          this._simulateStatusCallback(callSid, 'in-progress', options.statusCallback);
          
          // Simulate AMD callback if enabled
          if (options.machineDetection) {
            this._simulateAmdCallback(callSid, options.asyncAmdStatusCallback);
          }
        }, 500);
      }
      
      // Don't automatically simulate completion - this should be done by the test
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
  
  // Helper to simulate AMD callbacks
  _simulateAmdCallback(callSid, url) {
    // Get the configured AMD result or default to 'human'
    const answeredBy = global.testSettings?.amdResult || 'human';
    
    // If there's a global callback for testing, trigger it
    if (global.testCallbacks && typeof global.testCallbacks.twilioAmdCallback === 'function') {
      global.testCallbacks.twilioAmdCallback({
        CallSid: callSid,
        AnsweredBy: answeredBy
      });
    }
    
    // In a real test environment, you could mock the HTTP callback here
    console.log(`[MockTwilio] AMD callback for ${callSid}: ${answeredBy}`);
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

// Main Twilio mock class
class TwilioMock {
  constructor(accountSid, authToken) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.calls = new MockCalls();
  }
}

export default TwilioMock; 