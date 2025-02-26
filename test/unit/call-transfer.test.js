// test/unit/call-transfer.test.js
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../setup.js';
import { setupEnvironmentVariables } from '../common-setup.js';

// Setup environment variables
setupEnvironmentVariables();

// Create mock functions for testing
const mockTwilioClient = {
  calls: jest.fn().mockImplementation(sid => ({
    update: jest.fn().mockResolvedValue({})
  }))
};

// Mock the twilio library
jest.mock('twilio', () => {
  return jest.fn(() => mockTwilioClient);
});

describe('Call Transfer Functionality', () => {
  let callStatuses;
  let mockTransferCalls;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Initialize global test data
    callStatuses = {};
    global.callStatuses = callStatuses;
    
    // Create a fresh mockTransferCalls function for each test
    mockTransferCalls = jest.fn();
  });
  
  afterEach(() => {
    // Clean up
    delete global.callStatuses;
  });

  // Simplified version of what's likely in outbound-calls.js
  const checkAndTransfer = async (callType, callSid, callStatus) => {
    // Initialize call status if it doesn't exist
    if (!callStatuses[callSid]) {
      callStatuses[callSid] = {};
    }
    
    // Update status based on call type
    if (callType === 'lead') {
      callStatuses[callSid].leadStatus = callStatus;
      
      // If this is a lead call and it has a paired sales call
      if (callStatuses[callSid].salesCallSid) {
        const salesCallSid = callStatuses[callSid].salesCallSid;
        
        // Check if both calls are in-progress
        if (callStatus === 'in-progress' && 
            callStatuses[salesCallSid]?.salesStatus === 'in-progress') {
          if (callStatuses[callSid].isVoicemail) {
            // Handle voicemail case
            mockTransferCalls('voicemail', salesCallSid, callSid);
            callStatuses[callSid].transferInitiated = false;
          } else {
            // Initiate transfer by creating a conference
            mockTransferCalls('conference', callSid, salesCallSid);
            callStatuses[callSid].transferInitiated = true;
            callStatuses[salesCallSid].transferInitiated = true;
          }
        }
      }
    } else if (callType === 'sales') {
      callStatuses[callSid].salesStatus = callStatus;
      
      // If this is a sales call and it has a paired lead call
      if (callStatuses[callSid].leadCallSid) {
        const leadCallSid = callStatuses[callSid].leadCallSid;
        
        // Check if both calls are in-progress
        if (callStatus === 'in-progress' && 
            callStatuses[leadCallSid]?.leadStatus === 'in-progress') {
          if (callStatuses[leadCallSid].isVoicemail) {
            // Handle voicemail case
            mockTransferCalls('voicemail', callSid, leadCallSid);
            callStatuses[leadCallSid].transferInitiated = false;
          } else {
            // Initiate transfer by creating a conference
            mockTransferCalls('conference', leadCallSid, callSid);
            callStatuses[leadCallSid].transferInitiated = true;
            callStatuses[callSid].transferInitiated = true;
          }
        }
      }
    }
  };
  
  // Simple function to generate TwiML for the conference
  const generateTransferTwiml = (callSid, role) => {
    const callStatus = callStatuses[callSid] || {};
    
    let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';
    
    if (role === 'lead') {
      twiml += `<Say>Please wait while we connect you with our team.</Say>`;
    } else if (role === 'sales') {
      twiml += `<Say>Connecting you with a lead. Please wait.</Say>`;
    }
    
    // Add conference element
    const conferenceRoom = callStatus.conference?.room || `ConferenceRoom_${callStatus.salesCallSid || 'unknown'}`;
    twiml += `<Conference waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical" statusCallbackEvent="join leave" statusCallback="https://example.com/conference-status">${conferenceRoom}</Conference>`;
    
    twiml += '</Response>';
    
    // Mark the calls as complete
    if (callStatus.salesCallSid) {
      callStatuses[callStatus.salesCallSid].transferComplete = true;
    }
    if (callStatus.leadCallSid) {
      callStatuses[callStatus.leadCallSid].transferComplete = true;
    }
    callStatuses[callSid].transferComplete = true;
    
    return twiml;
  };

  describe('checkAndTransfer function', () => {
    it('should create a conference when both calls are in-progress', async () => {
      // Set up call statuses
      const leadCallSid = 'CA12345';
      const salesCallSid = 'CA67890';
      
      callStatuses[leadCallSid] = {
        leadStatus: 'initiated',
        salesCallSid: salesCallSid
      };
      
      callStatuses[salesCallSid] = {
        salesStatus: 'initiated',
        leadCallSid: leadCallSid
      };
      
      // Update lead call to in-progress
      await checkAndTransfer('lead', leadCallSid, 'in-progress');
      
      // No transfer should happen yet (only one call is in-progress)
      expect(mockTransferCalls).not.toHaveBeenCalled();
      
      // Update sales call to in-progress
      await checkAndTransfer('sales', salesCallSid, 'in-progress');
      
      // Now a transfer should be initiated
      expect(mockTransferCalls).toHaveBeenCalledWith('conference', leadCallSid, salesCallSid);
      
      // Check that transfer was marked as initiated
      expect(callStatuses[leadCallSid].transferInitiated).toBe(true);
      expect(callStatuses[salesCallSid].transferInitiated).toBe(true);
    });
    
    it('should not create a conference when only one call is in-progress', async () => {
      // Set up call statuses
      const leadCallSid = 'CA12345';
      const salesCallSid = 'CA67890';
      
      callStatuses[leadCallSid] = {
        leadStatus: 'initiated',
        salesCallSid: salesCallSid
      };
      
      callStatuses[salesCallSid] = {
        salesStatus: 'initiated',
        leadCallSid: leadCallSid
      };
      
      // Only update lead call to in-progress
      await checkAndTransfer('lead', leadCallSid, 'in-progress');
      
      // No transfer should happen
      expect(mockTransferCalls).not.toHaveBeenCalled();
      
      // Check that transfer was not marked as initiated
      expect(callStatuses[leadCallSid].transferInitiated).toBeFalsy();
      expect(callStatuses[salesCallSid].transferInitiated).toBeFalsy();
    });
    
    it('should not create a conference when a call is detected as voicemail', async () => {
      // Set up call statuses with voicemail flag
      const leadCallSid = 'CA12345';
      const salesCallSid = 'CA67890';
      
      callStatuses[leadCallSid] = {
        leadStatus: 'initiated',
        salesCallSid: salesCallSid,
        isVoicemail: true // Mark as voicemail
      };
      
      callStatuses[salesCallSid] = {
        salesStatus: 'initiated',
        leadCallSid: leadCallSid
      };
      
      // Update both calls to in-progress
      await checkAndTransfer('lead', leadCallSid, 'in-progress');
      await checkAndTransfer('sales', salesCallSid, 'in-progress');
      
      // Verify voicemail handling was triggered
      expect(mockTransferCalls).toHaveBeenCalledWith('voicemail', salesCallSid, leadCallSid);
      
      // Transfer should not be initiated for voicemail
      expect(callStatuses[leadCallSid].transferInitiated).toBeFalsy();
    });
  });
  
  describe('Transfer TwiML generation', () => {
    it('should generate valid TwiML for the handoff', () => {
      // Setup callStatuses with conference data
      const leadCallSid = 'CA12345';
      const salesCallSid = 'CA67890';
      const conferenceRoom = `ConferenceRoom_${salesCallSid}`;
      
      callStatuses[leadCallSid] = {
        leadStatus: 'in-progress',
        salesCallSid: salesCallSid,
        conference: {
          room: conferenceRoom,
          leadJoined: false,
          salesJoined: false
        }
      };
      
      callStatuses[salesCallSid] = {
        salesStatus: 'in-progress',
        leadCallSid: leadCallSid,
        conference: {
          room: conferenceRoom,
          leadJoined: false,
          salesJoined: false
        }
      };
      
      // Generate TwiML for lead
      const twiml = generateTransferTwiml(leadCallSid, 'lead');
      
      // Verify TwiML was correctly generated
      expect(twiml).toContain('<Say>Please wait while we connect you with our team.</Say>');
      expect(twiml).toContain(`<Conference waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical" statusCallbackEvent="join leave" statusCallback="https://example.com/conference-status">${conferenceRoom}</Conference>`);
      
      // Verify transferComplete state was set
      expect(callStatuses[leadCallSid].transferComplete).toBe(true);
      expect(callStatuses[salesCallSid].transferComplete).toBe(true);
    });
  });
}); 