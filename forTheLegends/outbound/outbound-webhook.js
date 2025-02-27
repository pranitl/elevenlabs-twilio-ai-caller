// outbound-webhook.js
// Common outbound webhook functionality for ElevenLabs conversations

import axios from 'axios';
import {
  enhanceWebhookPayload,
  sendEnhancedWebhook
} from './webhook-enhancer.js';

// Configuration
const DEFAULT_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL || '';
let webhookConfig = {
  url: DEFAULT_WEBHOOK_URL,
  retryAttempts: 3,
  retryDelayMs: 1000,
  timeoutMs: 10000,
  enabled: true
};

/**
 * Send ElevenLabs conversation data to webhook
 * This is the main function that should be called by all modules
 * 
 * @param {string} callSid - Twilio call SID
 * @param {string} conversationId - ElevenLabs conversation ID
 * @param {Object} callStatuses - Object containing call status information
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Webhook response
 */
async function sendElevenLabsConversationData(callSid, conversationId, callStatuses, options = {}) {
  if (!webhookConfig.enabled) {
    console.log(`[Webhook] Webhooks are disabled. Not sending data for call ${callSid}`);
    return { success: false, reason: 'webhooks_disabled' };
  }

  try {
    console.log(`[Webhook] Preparing to send data for call ${callSid} with conversation ${conversationId}`);
    
    // Check if webhook should be sent
    if (!shouldSendWebhook(callSid, callStatuses)) {
      console.log(`[Webhook] No need to send data for call ${callSid} - criteria not met`);
      return { success: false, reason: 'criteria_not_met' };
    }
    
    // Get conversation data from ElevenLabs
    const { transcriptData, summaryData } = await fetchElevenLabsData(conversationId);
    
    // Prepare webhook payload
    const webhookPayload = prepareWebhookPayload(
      callSid, 
      conversationId, 
      callStatuses[callSid], 
      transcriptData, 
      summaryData,
      options
    );
    
    // Send to webhook with retries
    return await sendWebhookWithRetry(webhookPayload);
  } catch (error) {
    console.error(`[Webhook] Error sending webhook for call ${callSid}:`, error);
    return { 
      success: false, 
      error: error.message,
      callSid,
      conversationId,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Determine if webhook should be sent based on call status
 * 
 * @param {string} callSid - Twilio call SID
 * @param {Object} callStatuses - Object containing call status information
 * @returns {boolean} - Whether webhook should be sent
 */
function shouldSendWebhook(callSid, callStatuses) {
  if (!callSid || !callStatuses || !callStatuses[callSid]) {
    return false;
  }
  
  const callStatus = callStatuses[callSid];
  
  // Only send webhook if:
  // 1. This was a call where sales team was unavailable, OR
  // 2. This was a voicemail, OR
  // 3. The call used ElevenLabs and wasn't fully handled by sales team
  if (
    callStatus.salesTeamUnavailable || 
    callStatus.isVoicemail ||
    // Check if ElevenLabs was used and the call wasn't transferred/handled by sales team
    (callStatus.conversationId && !callStatus.transferComplete)
  ) {
    return true;
  }
  
  return false;
}

/**
 * Fetch conversation data from ElevenLabs API
 * 
 * @param {string} conversationId - ElevenLabs conversation ID
 * @returns {Promise<Object>} - Transcript and summary data
 */
async function fetchElevenLabsData(conversationId) {
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is required but not configured');
  }
  
  let transcriptData = null;
  let summaryData = null;
  
  // Fetch transcript
  try {
    console.log(`[ElevenLabs] Fetching transcript for conversation ${conversationId}`);
    const transcriptResponse = await axios.get(
      `https://api.elevenlabs.io/v1/convai/conversation/${conversationId}/transcript`,
      {
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
        timeout: webhookConfig.timeoutMs
      }
    );
    
    transcriptData = transcriptResponse.data;
    console.log(`[ElevenLabs] Successfully fetched transcript for conversation ${conversationId}`);
  } catch (error) {
    console.error(`[ElevenLabs] Error fetching transcript: ${error.message}`);
    // Continue execution even if transcript fetch fails
  }
  
  // Fetch summary
  try {
    console.log(`[ElevenLabs] Fetching summary for conversation ${conversationId}`);
    const summaryResponse = await axios.get(
      `https://api.elevenlabs.io/v1/convai/conversation/${conversationId}/summary`,
      {
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
        timeout: webhookConfig.timeoutMs
      }
    );
    
    summaryData = summaryResponse.data;
    console.log(`[ElevenLabs] Successfully fetched summary for conversation ${conversationId}`);
  } catch (error) {
    console.error(`[ElevenLabs] Error fetching summary: ${error.message}`);
    // Continue execution even if summary fetch fails
  }
  
  return { transcriptData, summaryData };
}

/**
 * Prepare webhook payload
 * 
 * @param {string} callSid - Twilio call SID
 * @param {string} conversationId - ElevenLabs conversation ID
 * @param {Object} callStatus - Call status information
 * @param {Object} transcriptData - Transcript data from ElevenLabs
 * @param {Object} summaryData - Summary data from ElevenLabs
 * @param {Object} options - Additional options
 * @returns {Object} - Webhook payload
 */
function prepareWebhookPayload(callSid, conversationId, callStatus, transcriptData, summaryData, options = {}) {
  // Build basic payload
  const payload = {
    call_sid: callSid,
    conversation_id: conversationId,
    is_voicemail: callStatus?.isVoicemail || false,
    sales_team_unavailable: callStatus?.salesTeamUnavailable || false,
    lead_info: callStatus?.leadInfo || {},
    timestamp: new Date().toISOString(),
    source_module: options.sourceModule || 'outbound-webhook',
    call_metadata: {
      transferInitiated: callStatus?.transferInitiated || false,
      transferComplete: callStatus?.transferComplete || false,
      callbackScheduled: callStatus?.callbackScheduled || false,
      answeredBy: callStatus?.answeredBy || 'unknown'
    }
  };
  
  // Add transcript data if available
  if (transcriptData) {
    payload.transcript = transcriptData;
  } else if (callStatus?.transcripts && callStatus.transcripts.length > 0) {
    // Use stored transcripts if ElevenLabs API call failed
    payload.transcript = {
      conversation_id: conversationId,
      transcripts: callStatus.transcripts
    };
  }
  
  // Add summary data if available
  if (summaryData) {
    payload.summary = summaryData;
    
    // Include success criteria and data collection if present in the summary
    if (summaryData.success_criteria) {
      payload.success_criteria = summaryData.success_criteria;
    }
    
    if (summaryData.data_collection) {
      payload.data_collection = summaryData.data_collection;
    }
  }
  
  // Add callback preferences if they exist
  if (callStatus?.callbackPreferences) {
    payload.callbackPreferences = callStatus.callbackPreferences;
  }
  
  // Use webhook enhancer if lead ID is available
  const leadId = callStatus?.leadInfo?.LeadId || callStatus?.leadId || options.leadId;
  if (leadId) {
    try {
      // Enhance payload with additional data from other modules
      return enhanceWebhookPayload(callSid, leadId, payload);
    } catch (error) {
      console.error(`[Webhook] Error enhancing payload: ${error.message}`);
      // Return basic payload if enhancement fails
      return payload;
    }
  }
  
  return payload;
}

/**
 * Send webhook with retry logic
 * 
 * @param {Object} payload - Webhook payload
 * @returns {Promise<Object>} - Webhook response
 */
async function sendWebhookWithRetry(payload) {
  let attempts = 0;
  let lastError = null;
  
  while (attempts < webhookConfig.retryAttempts) {
    attempts++;
    
    try {
      console.log(`[Webhook] Sending webhook attempt ${attempts}/${webhookConfig.retryAttempts}`);
      
      const response = await axios.post(webhookConfig.url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: webhookConfig.timeoutMs
      });
      
      console.log(`[Webhook] Successfully sent webhook, status: ${response.status}`);
      
      return {
        success: true,
        status: response.status,
        timestamp: new Date().toISOString(),
        attempts
      };
    } catch (error) {
      lastError = error;
      console.error(`[Webhook] Attempt ${attempts} failed: ${error.message}`);
      
      if (attempts < webhookConfig.retryAttempts) {
        const delay = webhookConfig.retryDelayMs * attempts; // Exponential backoff
        console.log(`[Webhook] Retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error(`[Webhook] All ${webhookConfig.retryAttempts} webhook attempts failed`);
  return {
    success: false,
    error: lastError?.message || 'Unknown error',
    timestamp: new Date().toISOString(),
    attempts
  };
}

/**
 * Configure webhook settings
 * 
 * @param {Object} config - Configuration object
 */
function configureWebhook(config = {}) {
  webhookConfig = {
    ...webhookConfig,
    ...config
  };
  
  console.log('[Webhook] Configuration updated:', webhookConfig);
}

// Export functions for use in other modules
export {
  sendElevenLabsConversationData,
  configureWebhook,
  shouldSendWebhook, // Exported for testing
  fetchElevenLabsData, // Exported for testing
  prepareWebhookPayload // Exported for testing
}; 