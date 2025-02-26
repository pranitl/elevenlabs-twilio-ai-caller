// forTheLegends/outbound/integration.js
// Integration module for connecting enhanced features with the existing outbound-calls.js

import { 
  initializeQualityMonitoring, 
  processAudioQuality, 
  getQualityInstructions 
} from './call-quality-monitor.js';

import { 
  initializeInterruptionDetection, 
  processTranscript as processInterruptionTranscript, 
  getInterruptionInstructions 
} from './interruption-handler.js';

import { 
  initializeIntentDetection, 
  processTranscript as processIntentTranscript, 
  getIntentInstructions 
} from './intent-detector.js';

import { 
  initialize as initRetryManager, 
  trackCall, 
  updateCallStatus, 
  scheduleRetryCall 
} from './retry-manager.js';

import { 
  enhanceWebhookPayload, 
  sendEnhancedWebhook 
} from './webhook-enhancer.js';

// Store state for enhanced calls
const enhancedCallStates = {};

// Initialize all modules
let isInitialized = false;

/**
 * Initialize the enhanced features
 * @param {Object} options - Configuration options
 */
function initialize(options = {}) {
  if (isInitialized) return;
  
  console.log('Initializing enhanced outbound features');
  
  // Initialize retry manager with configuration
  initRetryManager({
    makeWebhookUrl: options.makeWebhookUrl || process.env.MAKE_WEBHOOK_URL,
    maxRetries: options.maxRetries || 2,
    retryDelayMs: options.retryDelayMs || 60000
  });
  
  isInitialized = true;
}

/**
 * Enhance the lead call creation process to track call for potential retry
 * @param {Object} leadCall - Twilio call object
 * @param {Object} leadInfo - Lead information
 */
function enhanceLeadCall(leadCall, leadInfo) {
  if (!leadCall || !leadCall.sid) return;
  
  const leadId = leadInfo?.leadId || leadInfo?.LeadId || leadInfo?.id || leadCall.sid;
  
  console.log(`Enhancing lead call ${leadCall.sid} for lead ${leadId}`);
  
  // Initialize call state
  enhancedCallStates[leadId] = {
    leadId,
    callSid: leadCall.sid,
    phoneNumber: leadCall.to,
    leadInfo,
    status: 'initiating',
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    transcripts: []
  };
  
  // Initialize feature modules for this call
  initializeQualityMonitoring(leadCall.sid);
  initializeInterruptionDetection(leadCall.sid);
  initializeIntentDetection(leadCall.sid);
  
  // Track call for potential retry
  trackCall(leadId, leadCall.sid, leadInfo);
  
  return leadId;
}

/**
 * Enhance the ElevenLabs setup function to incorporate our enhanced features
 * @param {Function} originalSetupElevenLabs - The original setup function
 * @param {string} callSid - The call SID
 * @param {string} leadId - The lead ID
 * @returns {Function} Enhanced setup function
 */
function enhanceElevenLabsSetup(originalSetupElevenLabs, callSid, leadId) {
  return async function(...args) {
    // Call the original function
    const elevenLabsWs = await originalSetupElevenLabs(...args);
    
    if (!elevenLabsWs) return null;
    
    console.log(`Enhancing ElevenLabs WebSocket for call ${callSid}`);
    
    // Store the original message handler
    const originalOnMessage = elevenLabsWs.onmessage;
    
    // Override the message handler to add our enhancements
    elevenLabsWs.onmessage = function(event) {
      try {
        const message = JSON.parse(event.data);
        
        // Process transcripts for intent and interruption detection
        if (message.type === 'transcript' && message.transcript?.text) {
          const transcript = message.transcript.text.trim();
          const speaker = message.transcript.speaker || 'user';
          
          // Store transcript for reporting
          if (leadId && enhancedCallStates[leadId]) {
            enhancedCallStates[leadId].transcripts.push({
              text: transcript,
              speaker,
              timestamp: new Date().toISOString()
            });
          }
          
          // Process for intent and interruption
          if (callSid) {
            // Process for interruptions
            const interruptionResult = processInterruptionTranscript(callSid, transcript);
            
            // Process for intents (only process lead's speech)
            if (speaker === 'user') {
              const intentResult = processIntentTranscript(callSid, transcript, 'lead');
            }
            
            // Get instructions based on intent and interruption
            const intentInstructions = getIntentInstructions(callSid);
            const interruptionInstructions = getInterruptionInstructions(callSid, interruptionResult);
            
            // Send instructions to ElevenLabs if any
            if (intentInstructions) {
              sendInstructionsToElevenLabs(elevenLabsWs, intentInstructions);
            }
            
            if (interruptionInstructions) {
              sendInstructionsToElevenLabs(elevenLabsWs, interruptionInstructions);
            }
          }
        }
        
        // Process audio quality periodically
        if (message.type === 'audio' && callSid) {
          // Check for quality issues periodically
          const qualityInstructions = getQualityInstructions(callSid);
          if (qualityInstructions) {
            sendInstructionsToElevenLabs(elevenLabsWs, qualityInstructions);
          }
        }
      } catch (error) {
        console.error(`Error in enhanced WebSocket handler for call ${callSid}:`, error);
      }
      
      // Call the original handler
      if (originalOnMessage) {
        originalOnMessage.call(elevenLabsWs, event);
      }
    };
    
    return elevenLabsWs;
  };
}

/**
 * Process incoming audio from Twilio for quality monitoring
 * @param {string} callSid - The call SID
 * @param {string} audioData - Base64-encoded audio data
 */
function processAudio(callSid, audioData) {
  if (!callSid) return;
  
  try {
    processAudioQuality(callSid, audioData);
  } catch (error) {
    console.error(`Error processing audio for call ${callSid}:`, error);
  }
}

/**
 * Send instructions to ElevenLabs
 * @param {WebSocket} elevenLabsWs - ElevenLabs WebSocket
 * @param {string} instructions - Instructions to send
 */
function sendInstructionsToElevenLabs(elevenLabsWs, instructions) {
  if (!elevenLabsWs || elevenLabsWs.readyState !== 1) return;
  
  try {
    console.log(`Sending instructions to ElevenLabs: ${instructions}`);
    
    const message = {
      type: "instruction",
      instruction: instructions
    };
    
    elevenLabsWs.send(JSON.stringify(message));
  } catch (error) {
    console.error('Error sending instructions to ElevenLabs:', error);
  }
}

/**
 * Enhance the webhook payload for a call
 * @param {Object} originalWebhookData - The original webhook data
 * @param {string} callSid - The call SID
 * @returns {Object} Enhanced webhook data
 */
function enhanceWebhook(originalWebhookData, callSid) {
  // Find the lead ID for this call
  let leadId = null;
  for (const [id, state] of Object.entries(enhancedCallStates)) {
    if (state.callSid === callSid) {
      leadId = id;
      break;
    }
  }
  
  if (!leadId) {
    console.log(`No lead ID found for call ${callSid}, returning original webhook data`);
    return originalWebhookData;
  }
  
  // Enhance the webhook payload
  return enhanceWebhookPayload(callSid, leadId, originalWebhookData);
}

/**
 * Process call status updates for retry logic
 * @param {string} callSid - The call SID
 * @param {string} status - Call status
 * @param {string} answeredBy - How the call was answered (human, machine)
 */
function processCallStatus(callSid, status, answeredBy) {
  // Find the lead ID for this call
  let leadId = null;
  for (const [id, state] of Object.entries(enhancedCallStates)) {
    if (state.callSid === callSid) {
      leadId = id;
      break;
    }
  }
  
  if (!leadId) {
    console.log(`No lead ID found for call ${callSid}, skipping status processing`);
    return;
  }
  
  // Update local state
  enhancedCallStates[leadId].status = status;
  enhancedCallStates[leadId].answeredBy = answeredBy;
  enhancedCallStates[leadId].lastUpdatedAt = new Date().toISOString();
  
  // Update retry manager
  updateCallStatus(leadId, callSid, status, answeredBy);
  
  // Check if we need to retry
  if (status === 'completed') {
    console.log(`Call ${callSid} completed, checking if retry is needed`);
    
    scheduleRetryCall(leadId)
      .then(result => {
        if (result.success) {
          console.log(`Retry scheduled for lead ${leadId}, attempt ${result.retryCount}`);
        } else {
          console.log(`No retry needed for lead ${leadId}: ${result.error || 'Already completed successfully'}`);
        }
      })
      .catch(error => {
        console.error(`Error scheduling retry for lead ${leadId}:`, error);
      });
  }
}

export {
  initialize,
  enhanceLeadCall,
  enhanceElevenLabsSetup,
  processAudio,
  enhanceWebhook,
  processCallStatus,
  enhancedCallStates
}; 