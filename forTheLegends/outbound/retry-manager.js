// forTheLegends/outbound/retry-manager.js
// Module for managing retry logic for calls that go to voicemail, etc.

import twilio from 'twilio';
import axios from 'axios';

// Configuration for retry logic
const RETRY_CONFIG = {
  // Maximum number of retries
  maxRetries: 2,
  // Delay between retries in milliseconds (1 minute)
  retryDelayMs: 60000,
  // Reasons to retry a call
  retryReasons: ['voicemail', 'no-answer', 'busy', 'failed', 'canceled']
};

// Store retry state by lead ID
const retryState = {};

// Twilio client
let twilioClient = null;

// Webhook URL for Make.com
let makeWebhookUrl = '';

/**
 * Initialize the retry manager
 * @param {Object} config - Configuration options
 */
function initialize(config = {}) {
  console.log('Initializing retry manager');
  
  // Update config with any provided options
  Object.assign(RETRY_CONFIG, config);
  
  // Initialize Twilio client if credentials are available
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  
  // Set webhook URL
  makeWebhookUrl = config.makeWebhookUrl || process.env.MAKE_WEBHOOK_URL || '';
  
  if (!makeWebhookUrl) {
    console.warn('No Make.com webhook URL provided. Retries will use direct Twilio API calls as fallback.');
  }
}

/**
 * Track a call for potential retry
 * @param {string} leadId - The lead ID
 * @param {string} callSid - The Twilio call SID
 * @param {Object} leadInfo - Information about the lead
 */
function trackCall(leadId, callSid, leadInfo = {}) {
  if (!leadId || !callSid) {
    console.error('Cannot track call: leadId and callSid are required');
    return;
  }
  
  console.log(`Tracking call ${callSid} for lead ${leadId}`);
  
  // Initialize or update retry state for this lead
  retryState[leadId] = {
    leadId,
    phoneNumber: leadInfo.phoneNumber,
    currentCallSid: callSid,
    retryCount: retryState[leadId] ? retryState[leadId].retryCount : 0,
    lastCallTime: Date.now(),
    callHistory: [],
    retryScheduled: false,
    leadInfo
  };
}

/**
 * Update the status of a call
 * @param {string} leadId - The lead ID
 * @param {string} callSid - The Twilio call SID
 * @param {string} callStatus - The call status (from Twilio)
 * @param {string} answeredBy - Who/what answered (human, machine)
 * @returns {Object} Updated retry state
 */
function updateCallStatus(leadId, callSid, callStatus, answeredBy) {
  if (!leadId || !retryState[leadId]) {
    console.error(`Cannot update call status: No state for lead ${leadId}`);
    return null;
  }
  
  const state = retryState[leadId];
  
  // Only update if this is the current call
  if (state.currentCallSid !== callSid) {
    console.warn(`Call ${callSid} is not the current call for lead ${leadId}`);
    return state;
  }
  
  console.log(`Updating call status for lead ${leadId}: ${callStatus}, answeredBy: ${answeredBy || 'N/A'}`);
  
  // Add to call history
  state.callHistory.push({
    callSid,
    status: callStatus,
    answeredBy,
    timestamp: Date.now()
  });
  
  // Update last call time
  state.lastCallTime = Date.now();
  
  // Determine if retry is needed based on call outcome
  if (callStatus === 'completed') {
    // Call was completed, no retry needed
    state.retryNeeded = false;
  } else if (determineIfRetryNeeded(callStatus, answeredBy)) {
    state.retryNeeded = true;
    state.retryReason = getRetryReason(callStatus, answeredBy);
  }
  
  return state;
}

/**
 * Determine if a retry is needed based on call status and answer type
 * @param {string} callStatus - The call status (from Twilio)
 * @param {string} answeredBy - Who/what answered (human, machine)
 * @returns {boolean} Whether a retry is needed
 */
function determineIfRetryNeeded(callStatus, answeredBy) {
  // Failed calls should be retried
  if (callStatus === 'failed' || callStatus === 'busy' || 
      callStatus === 'no-answer' || callStatus === 'canceled') {
    return true;
  }
  
  // Voicemails should be retried
  if (answeredBy === 'machine_start' || answeredBy === 'machine_end_beep' || 
      answeredBy === 'machine_end_silence' || answeredBy === 'machine_end_other') {
    return true;
  }
  
  return false;
}

/**
 * Get a human-readable reason for the retry
 * @param {string} callStatus - The call status (from Twilio)
 * @param {string} answeredBy - Who/what answered (human, machine)
 * @returns {string} The retry reason
 */
function getRetryReason(callStatus, answeredBy) {
  if (answeredBy === 'machine_start' || answeredBy === 'machine_end_beep' || 
      answeredBy === 'machine_end_silence' || answeredBy === 'machine_end_other') {
    return 'voicemail';
  }
  
  if (callStatus === 'failed') return 'failed';
  if (callStatus === 'busy') return 'busy';
  if (callStatus === 'no-answer') return 'no-answer';
  if (callStatus === 'canceled') return 'canceled';
  
  return 'other';
}

/**
 * Schedule a retry call via webhook to make.com
 * @param {string} leadId - The lead ID
 * @returns {Promise<Object>} Result of the retry attempt
 */
async function scheduleRetryCall(leadId) {
  if (!leadId || !retryState[leadId]) {
    console.error(`Cannot schedule retry: No state for lead ${leadId}`);
    return { success: false, error: 'No state for lead' };
  }
  
  const state = retryState[leadId];
  
  // Check if we've already scheduled a retry
  if (state.retryScheduled) {
    console.log(`Retry already scheduled for lead ${leadId}`);
    return { success: false, error: 'Retry already scheduled' };
  }
  
  // Check if a retry is needed
  if (!state.retryNeeded) {
    console.log(`No retry needed for lead ${leadId}`);
    return { success: false, error: 'No retry needed' };
  }
  
  // Check if we've reached the maximum retries
  if (state.retryCount >= RETRY_CONFIG.maxRetries) {
    console.log(`Maximum retries (${RETRY_CONFIG.maxRetries}) reached for lead ${leadId}`);
    return { success: false, error: 'Maximum retries reached' };
  }
  
  console.log(`Scheduling retry call for lead ${leadId} (attempt ${state.retryCount + 1})`);
  
  // Update retry state
  state.retryCount++;
  state.retryScheduled = true;
  
  try {
    // If we have a webhook URL, use it
    if (makeWebhookUrl) {
      // Send webhook to make.com to schedule the retry
      const response = await axios.post(makeWebhookUrl, {
        type: 'retry_call',
        leadId,
        phoneNumber: state.phoneNumber || state.leadInfo.phoneNumber,
        retryCount: state.retryCount,
        retryReason: state.retryReason,
        retryDelayMs: RETRY_CONFIG.retryDelayMs,
        leadInfo: state.leadInfo
      });
      
      console.log(`Webhook sent to make.com for retry of lead ${leadId}. Response: ${response.status}`);
      
      return {
        success: true,
        retryCount: state.retryCount,
        method: 'webhook',
        retryTimestamp: Date.now() + RETRY_CONFIG.retryDelayMs
      };
    } else {
      // Fallback to direct API call if no webhook URL
      return directRetryCall(leadId);
    }
  } catch (error) {
    console.error(`Error scheduling retry for lead ${leadId}:`, error);
    
    // Fallback to direct API call if webhook fails
    console.log('Falling back to direct API call for retry');
    return directRetryCall(leadId);
  }
}

/**
 * Make a direct retry call using Twilio API
 * @param {string} leadId - The lead ID
 * @returns {Promise<Object>} Result of the retry attempt
 */
async function directRetryCall(leadId) {
  const state = retryState[leadId];
  
  if (!twilioClient) {
    console.error('No Twilio client available for direct retry');
    return { success: false, error: 'No Twilio client' };
  }
  
  if (!state.phoneNumber && (!state.leadInfo || !state.leadInfo.phoneNumber)) {
    console.error(`No phone number available for lead ${leadId}`);
    return { success: false, error: 'No phone number' };
  }
  
  // Wait for the retry delay
  console.log(`Waiting ${RETRY_CONFIG.retryDelayMs}ms before retrying call for lead ${leadId}`);
  
  // Use setTimeout with Promise to handle the delay
  await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.retryDelayMs));
  
  try {
    // Make the call directly with Twilio
    const call = await twilioClient.calls.create({
      url: process.env.CALL_WEBHOOK_URL || 'http://demo.twilio.com/docs/voice.xml',
      to: state.phoneNumber || state.leadInfo.phoneNumber,
      from: process.env.TWILIO_NUMBER,
      statusCallback: process.env.STATUS_CALLBACK_URL,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      machineDetection: 'Enable'
    });
    
    console.log(`Retry call initiated for lead ${leadId}, new Call SID: ${call.sid}`);
    
    // Update retry state
    state.currentCallSid = call.sid;
    state.retryScheduled = false;
    
    return {
      success: true,
      retryCount: state.retryCount,
      method: 'direct',
      callSid: call.sid
    };
  } catch (error) {
    console.error(`Error making direct retry call for lead ${leadId}:`, error);
    
    state.retryScheduled = false;
    
    return {
      success: false,
      error: error.message,
      method: 'direct'
    };
  }
}

/**
 * Get retry information for a lead
 * @param {string} leadId - The lead ID
 * @returns {Object|null} Retry information for the lead
 */
function getRetryInfo(leadId) {
  if (!leadId || !retryState[leadId]) {
    return null;
  }
  
  const state = retryState[leadId];
  
  return {
    leadId,
    retryCount: state.retryCount,
    retryNeeded: state.retryNeeded,
    retryReason: state.retryReason,
    lastCallTime: state.lastCallTime,
    retryScheduled: state.retryScheduled,
    callHistory: state.callHistory
  };
}

/**
 * Clear retry state for a lead
 * @param {string} leadId - The lead ID
 */
function clearRetryState(leadId) {
  if (retryState[leadId]) {
    console.log(`Clearing retry state for lead ${leadId}`);
    delete retryState[leadId];
  }
}

export {
  initialize,
  trackCall,
  updateCallStatus,
  scheduleRetryCall,
  getRetryInfo,
  clearRetryState
}; 