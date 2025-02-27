// forTheLegends/outbound/enhanced-call-handler.js
// Enhanced outbound call handler that extends the existing call flow

import WebSocket from 'ws';
import twilio from 'twilio';
import axios from 'axios';

// Import enhanced features
import { 
  initializeQualityMonitoring, 
  processAudioQuality, 
  getQualityInstructions, 
  clearQualityMetrics 
} from './call-quality-monitor.js';

import { 
  initializeInterruptionDetection, 
  processTranscript as processInterruptionTranscript, 
  getInterruptionInstructions, 
  clearInterruptionData 
} from './interruption-handler.js';

import { 
  initializeIntentDetection, 
  processTranscript as processIntentTranscript, 
  getIntentInstructions, 
  hasSchedulingIntent,
  clearIntentData 
} from './intent-detector.js';

import { 
  initialize as initRetryManager, 
  trackCall, 
  updateCallStatus, 
  scheduleRetryCall,
  clearRetryState 
} from './retry-manager.js';

import { 
  enhanceWebhookPayload, 
  sendEnhancedWebhook 
} from './webhook-enhancer.js';

// Store state for enhanced calls
const enhancedCallStates = {};

// Configuration with defaults
const config = {
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioNumber: process.env.TWILIO_PHONE_NUMBER,
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID,
  salesTeamNumber: process.env.SALES_TEAM_PHONE_NUMBER,
  retryConfig: {
    maxRetries: 2,
    retryDelayMs: 60000 // 1 minute
  }
};

/**
 * Initialize the enhanced call handler
 * @param {Object} options - Configuration options
 */
function initialize(options = {}) {
  console.log('Initializing enhanced call handler');
  
  // Update config with provided options
  Object.assign(config, options);
  
  // Initialize retry manager
  initRetryManager({
    makeWebhookUrl: options.makeWebhookUrl || process.env.MAKE_WEBHOOK_URL,
    maxRetries: config.retryConfig.maxRetries,
    retryDelayMs: config.retryConfig.retryDelayMs
  });
  
  console.log('Enhanced call handler initialized with config:', {
    retryConfig: config.retryConfig
  });
}

/**
 * Extend the original outbound call functionality with enhanced features
 * This will be called from the main outbound-calls.js file
 * @param {Object} originalSetupElevenLabs - The original setupElevenLabs function to extend
 * @param {Object} callContext - Context about the current call (callSid, leadId, etc.)
 * @returns {Function} Extended setupElevenLabs function
 */
function extendElevenLabsSetup(originalSetupElevenLabs, callContext) {
  const { callSid, leadId, leadInfo } = callContext;
  
  // Initialize enhanced call state for this call
  if (leadId && !enhancedCallStates[leadId]) {
    enhancedCallStates[leadId] = {
      leadId,
      callSid,
      leadInfo,
      status: 'initiating',
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      transcripts: [],
      enhancedActive: true
    };
    
    // Initialize feature modules for this call
    initializeQualityMonitoring(callSid);
    initializeInterruptionDetection(callSid);
    initializeIntentDetection(callSid);
    
    // Track call for potential retry
    trackCall(leadId, callSid, leadInfo);
    
    console.log(`Enhanced call handling initialized for call ${callSid}, lead ${leadId}`);
  }
  
  // Return a wrapped version of the setupElevenLabs function
  return async function enhancedSetupElevenLabs(...args) {
    // Call the original function and store its result
    const elevenLabsWs = await originalSetupElevenLabs(...args);
    
    if (elevenLabsWs) {
      // Extend the ElevenLabs WebSocket with enhanced processing
      const originalOnMessage = elevenLabsWs.onmessage;
      
      elevenLabsWs.onmessage = function(event) {
        try {
          const message = JSON.parse(event.data);
          
          // Process transcripts for intent and interruption detection
          if (message.type === 'transcript' && message.transcript?.text) {
            const transcript = message.transcript.text.trim();
            const speaker = message.transcript.speaker || 'user';
            
            // Store transcript for reporting
            if (enhancedCallStates[leadId]) {
              enhancedCallStates[leadId].transcripts.push({
                text: transcript,
                speaker,
                timestamp: new Date().toISOString()
              });
            }
            
            // Process for interruptions
            const interruptionResult = processInterruptionTranscript(callSid, transcript);
            
            // Process for intents (only process lead's speech)
            if (speaker === 'user') {
              const intentResult = processIntentTranscript(callSid, transcript, 'lead');
              
              // Check for any instructions to send based on detected intent
              const intentInstructions = getIntentInstructions(callSid);
              if (intentInstructions) {
                console.log(`Sending intent-based instructions for call ${callSid}:`, intentInstructions);
                sendInstructionsToElevenLabs(elevenLabsWs, intentInstructions);
              }
            }
            
            // Check for any instructions to send based on detected interruptions
            const interruptionInstructions = getInterruptionInstructions(callSid, interruptionResult);
            if (interruptionInstructions) {
              console.log(`Sending interruption-based instructions for call ${callSid}:`, interruptionInstructions);
              sendInstructionsToElevenLabs(elevenLabsWs, interruptionInstructions);
            }
          }
          
          // Call the original handler if it exists
          if (originalOnMessage) {
            originalOnMessage.call(elevenLabsWs, event);
          }
        } catch (error) {
          console.error(`Enhanced message processing error for call ${callSid}:`, error);
          
          // Fall back to original handler
          if (originalOnMessage) {
            originalOnMessage.call(elevenLabsWs, event);
          }
        }
      };
      
      // Set an interval to check audio quality and send instructions if needed
      const qualityCheckInterval = setInterval(() => {
        if (elevenLabsWs.readyState !== WebSocket.OPEN) {
          clearInterval(qualityCheckInterval);
          return;
        }
        
        const qualityInstructions = getQualityInstructions(callSid);
        if (qualityInstructions) {
          console.log(`Sending quality-based instructions for call ${callSid}:`, qualityInstructions);
          sendInstructionsToElevenLabs(elevenLabsWs, qualityInstructions);
        }
      }, 10000); // Check every 10 seconds
      
      // Clean up on close
      const originalOnClose = elevenLabsWs.onclose;
      elevenLabsWs.onclose = function(event) {
        clearInterval(qualityCheckInterval);
        
        // Call the original handler if it exists
        if (originalOnClose) {
          originalOnClose.call(elevenLabsWs, event);
        }
      };
    }
    
    return elevenLabsWs;
  };
}

/**
 * Send instructions to the ElevenLabs WebSocket
 * @param {WebSocket} elevenLabsWs - The ElevenLabs WebSocket
 * @param {string} instructions - Instructions to send
 */
function sendInstructionsToElevenLabs(elevenLabsWs, instructions) {
  if (elevenLabsWs.readyState === WebSocket.OPEN) {
    try {
      const message = {
        type: "instruction",
        instruction: instructions
      };
      
      elevenLabsWs.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending instructions to ElevenLabs:', error);
    }
  }
}

/**
 * Process audio data for quality monitoring
 * @param {string} callSid - The call SID
 * @param {string} audioData - Base64 encoded audio data
 */
function processAudio(callSid, audioData) {
  if (!callSid) return;
  
  try {
    // Process audio for quality issues
    const qualityResult = processAudioQuality(callSid, audioData);
    
    // Log quality issues if detected
    if (qualityResult.hasQualityIssue) {
      console.log(`Quality issue detected for call ${callSid}: ${qualityResult.issueType} (${qualityResult.issueSeverity})`);
    }
  } catch (error) {
    console.error(`Error processing audio for call ${callSid}:`, error);
  }
}

/**
 * Enhance the original sendCallDataToWebhook function
 * @param {Function} originalSendCallDataToWebhook - Original webhook function
 * @returns {Function} Enhanced webhook function
 */
function enhanceWebhookFunction(originalSendCallDataToWebhook) {
  return async function enhancedSendCallDataToWebhook(callSid, conversationId, additionalData = {}) {
    try {
      // First, call the original function to maintain backward compatibility
      await originalSendCallDataToWebhook(callSid, conversationId);
      
      // Find the leadId for this call
      let leadId = null;
      for (const [id, state] of Object.entries(enhancedCallStates)) {
        if (state.callSid === callSid) {
          leadId = id;
          break;
        }
      }
      
      if (!leadId) {
        console.log(`No leadId found for call ${callSid}, skipping enhanced webhook`);
        return;
      }
      
      // Create enhanced payload
      const enhancedData = enhanceWebhookPayload(callSid, leadId, {
        conversationId,
        ...additionalData
      });
      
      // Send enhanced webhook
      console.log(`Sending enhanced webhook for call ${callSid}, lead ${leadId}`);
      await sendEnhancedWebhook(enhancedData);
      
      // Clean up resources
      cleanupCallResources(callSid, leadId);
    } catch (error) {
      console.error(`Error in enhanced webhook for call ${callSid}:`, error);
    }
  };
}

/**
 * Process a completed call status update
 * @param {string} callSid - The call SID
 * @param {string} status - The call status
 * @param {string} answeredBy - How the call was answered (human, machine)
 */
function processCallStatusUpdate(callSid, status, answeredBy) {
  // Find the leadId for this call
  let leadId = null;
  for (const [id, state] of Object.entries(enhancedCallStates)) {
    if (state.callSid === callSid) {
      leadId = id;
      break;
    }
  }
  
  if (!leadId) {
    console.log(`No leadId found for call ${callSid}, skipping status processing`);
    return;
  }
  
  // Update call state
  enhancedCallStates[leadId].status = status;
  enhancedCallStates[leadId].answeredBy = answeredBy;
  enhancedCallStates[leadId].lastUpdatedAt = new Date().toISOString();
  
  // Update retry state
  updateCallStatus(leadId, callSid, status, answeredBy);
  
  // If call is completed, check if retry is needed
  if (status === 'completed') {
    const retryState = scheduleRetryCall(leadId)
      .then(result => {
        if (result.success) {
          console.log(`Scheduled retry for lead ${leadId}, attempt ${result.retryCount}`);
          enhancedCallStates[leadId].retryScheduled = true;
        } else {
          console.log(`No retry needed or possible for lead ${leadId}: ${result.error}`);
        }
        return result;
      })
      .catch(error => {
        console.error(`Error scheduling retry for lead ${leadId}:`, error);
        return { success: false, error: error.message };
      });
  }
}

/**
 * Clean up call resources when a call is completed
 * @param {string} callSid - The call SID
 * @param {string} leadId - The lead ID
 */
function cleanupCallResources(callSid, leadId) {
  // Clean up monitoring resources
  if (callSid) {
    clearQualityMetrics(callSid);
    clearInterruptionData(callSid);
    clearIntentData(callSid);
  }
  
  // Keep retry state for potential retries
  // Will be cleaned up after max retries or successful completion
}

/**
 * Register enhanced outbound routes with the Fastify instance
 * Adds additional routes for enhanced calling features
 * @param {Object} fastify - The Fastify instance
 * @returns {Object} The Fastify instance with routes registered
 */
function registerEnhancedOutboundRoutes(fastify) {
  console.log('Registering enhanced outbound routes');
  
  // Define enhanced routes here
  fastify.post('/enhanced-outbound-call', async (request, reply) => {
    const { number, leadinfo, prompt } = request.body;
    
    if (!number) {
      return reply.code(400).send({ error: 'Phone number is required' });
    }
    
    try {
      // Generate a unique lead ID if not provided
      const leadId = leadinfo?.LeadId || `lead-${Date.now()}`;
      
      // Initialize enhanced call state
      enhancedCallStates[leadId] = {
        leadId,
        leadInfo: leadinfo || {},
        status: 'initiating',
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        enhancedActive: true
      };
      
      // Track this call for potential retry
      trackCall(leadId, null, leadinfo || {});
      
      // Return a response acknowledging the request
      return { 
        success: true, 
        message: 'Enhanced outbound call initiated',
        leadId
      };
    } catch (error) {
      console.error('Error initiating enhanced outbound call:', error);
      return reply.code(500).send({ 
        error: 'Failed to initiate call',
        message: error.message
      });
    }
  });
  
  // Route to check call status
  fastify.get('/enhanced-call-status/:leadId', async (request, reply) => {
    const { leadId } = request.params;
    
    if (!leadId || !enhancedCallStates[leadId]) {
      return reply.code(404).send({ error: 'Call not found' });
    }
    
    return { 
      leadId,
      status: enhancedCallStates[leadId].status,
      lastUpdatedAt: enhancedCallStates[leadId].lastUpdatedAt
    };
  });
  
  return fastify;
}

export {
  initialize,
  extendElevenLabsSetup,
  enhanceWebhookFunction,
  processAudio,
  processCallStatusUpdate,
  enhancedCallStates,
  registerEnhancedOutboundRoutes
}; 