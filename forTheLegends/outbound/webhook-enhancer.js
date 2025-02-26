// webhook-enhancer.js
// Enhances webhook payloads sent to make.com with comprehensive call data

// Import required services
import axios from 'axios';
import { getQualityMetrics } from './call-quality-monitor.js';
import { getInterruptionData } from './interruption-handler.js';
import { getIntentData, hasSchedulingIntent, hasNegativeIntent } from './intent-detector.js';
import { getRetryInfo } from './retry-manager.js';

// Store webhook URL
let makeWebhookUrl = process.env.MAKE_WEBHOOK_URL || '';

/**
 * Enhance webhook payload with data from all modules
 * @param {string} callSid - The Twilio call SID
 * @param {string} leadId - The lead ID
 * @param {Object} basePayload - Base payload to enhance (optional)
 * @returns {Object} Enhanced payload
 */
function enhanceWebhookPayload(callSid, leadId, basePayload = {}) {
  // Start with the base payload
  const enhancedPayload = {
    ...basePayload,
    callSid,
    leadId,
    timestamp: new Date().toISOString(),
    enhanced: true
  };
  
  // Add call quality data
  if (callSid) {
    const qualityMetrics = getQualityMetrics(callSid);
    if (qualityMetrics) {
      enhancedPayload.qualityMetrics = qualityMetrics;
    }
    
    // Add interruption data
    const interruptionData = getInterruptionData(callSid);
    if (interruptionData) {
      enhancedPayload.interruptionData = interruptionData;
    }
    
    // Add intent data
    const intentData = getIntentData(callSid);
    if (intentData) {
      enhancedPayload.intentData = intentData;
    }
  }
  
  // Add retry data
  if (leadId) {
    const retryInfo = getRetryInfo(leadId);
    if (retryInfo) {
      enhancedPayload.retryInfo = retryInfo;
    }
  }
  
  // Generate call summary
  enhancedPayload.summary = generateCallSummary(callSid, leadId, enhancedPayload);
  
  return enhancedPayload;
}

/**
 * Generate a human-readable summary of the call
 * @param {string} callSid - The Twilio call SID
 * @param {string} leadId - The lead ID
 * @param {Object} enhancedPayload - Enhanced payload with all call data
 * @returns {Object} Call summary
 */
function generateCallSummary(callSid, leadId, enhancedPayload) {
  // Determine call outcome
  let outcome = 'completed';
  let followUpNeeded = false;
  let followUpType = null;
  let urgency = 'normal';
  
  // Check for scheduling intents
  if (callSid && hasSchedulingIntent(callSid)) {
    outcome = 'needs_callback';
    followUpNeeded = true;
    followUpType = 'scheduled_callback';
    
    // Check interruption data for preferred callback time
    if (enhancedPayload.interruptionData && enhancedPayload.interruptionData.preferredCallbackTime) {
      followUpType = 'scheduled_at_specific_time';
    }
  }
  
  // Check for negative intents
  if (callSid && hasNegativeIntent(callSid)) {
    outcome = 'not_interested';
    followUpNeeded = false;
  }
  
  // Check for urgent care needs
  if (enhancedPayload.intentData && 
      enhancedPayload.intentData.primaryIntent && 
      enhancedPayload.intentData.primaryIntent.name === 'needs_immediate_care') {
    outcome = 'urgent_care_needed';
    followUpNeeded = true;
    followUpType = 'immediate_care_coordination';
    urgency = 'high';
  }
  
  // Check for retry info
  if (enhancedPayload.retryInfo && enhancedPayload.retryInfo.retryNeeded) {
    outcome = 'needs_retry';
    followUpNeeded = true;
    followUpType = 'automatic_retry';
  }
  
  // Generate key points
  const keyPoints = [];
  
  // Add intent-related key points
  if (enhancedPayload.intentData && enhancedPayload.intentData.detectedIntents) {
    enhancedPayload.intentData.detectedIntents.forEach(intent => {
      keyPoints.push(`Intent detected: ${intent.name} (confidence: ${Math.round(intent.confidence * 100)}%)`);
    });
  }
  
  // Add interruption-related key points
  if (enhancedPayload.interruptionData) {
    if (enhancedPayload.interruptionData.interruptionCount > 0) {
      keyPoints.push(`Call had ${enhancedPayload.interruptionData.interruptionCount} interruption(s)`);
    }
    
    if (enhancedPayload.interruptionData.rescheduleCount > 0) {
      keyPoints.push(`Lead requested to reschedule ${enhancedPayload.interruptionData.rescheduleCount} time(s)`);
      
      if (enhancedPayload.interruptionData.preferredCallbackTime) {
        const timeInfo = enhancedPayload.interruptionData.preferredCallbackTime;
        let timeDescription = '';
        
        if (timeInfo.type === 'specific_time') {
          timeDescription = `at ${timeInfo.value}`;
        } else if (timeInfo.type === 'period') {
          timeDescription = `in the ${timeInfo.value}`;
        } else if (timeInfo.type === 'weekday') {
          const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          timeDescription = `on ${days[timeInfo.value]}`;
        } else if (timeInfo.type === 'day' && timeInfo.offset === 1) {
          timeDescription = 'tomorrow';
        } else if (timeInfo.type === 'week' && timeInfo.offset === 1) {
          timeDescription = 'next week';
        }
        
        if (timeDescription) {
          keyPoints.push(`Preferred callback time: ${timeDescription}`);
        }
      }
    }
  }
  
  // Add quality-related key points
  if (enhancedPayload.qualityMetrics) {
    if (enhancedPayload.qualityMetrics.silenceRunCount > 2) {
      keyPoints.push(`Call had ${enhancedPayload.qualityMetrics.silenceRunCount} periods of silence`);
    }
    
    if (enhancedPayload.qualityMetrics.lowAudioRunCount > 0) {
      keyPoints.push(`Call had audio quality issues`);
    }
  }
  
  // Add retry-related key points
  if (enhancedPayload.retryInfo) {
    if (enhancedPayload.retryInfo.retryCount > 0) {
      keyPoints.push(`Call has been retried ${enhancedPayload.retryInfo.retryCount} time(s)`);
    }
    
    if (enhancedPayload.retryInfo.retryNeeded) {
      keyPoints.push(`Call needs to be retried (reason: ${enhancedPayload.retryInfo.retryReason})`);
    }
  }
  
  return {
    outcome,
    followUpNeeded,
    followUpType,
    urgency,
    keyPoints,
    timestamp: new Date().toISOString()
  };
}

/**
 * Send enhanced webhook to Make.com
 * @param {Object} payload - Enhanced payload to send
 * @returns {Promise<Object>} Webhook response
 */
async function sendEnhancedWebhook(payload) {
  if (!makeWebhookUrl) {
    console.error('No Make.com webhook URL configured. Cannot send webhook.');
    return { success: false, error: 'No webhook URL configured' };
  }
  
  try {
    console.log(`Sending enhanced webhook for lead ${payload.leadId}, call ${payload.callSid}`);
    
    const response = await axios.post(makeWebhookUrl, payload);
    
    console.log(`Webhook sent successfully, status: ${response.status}`);
    
    return {
      success: true,
      status: response.status,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error sending webhook:', error);
    
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Set the Make.com webhook URL
 * @param {string} url - The Make.com webhook URL
 */
function setWebhookUrl(url) {
  if (url) {
    makeWebhookUrl = url;
    console.log('Webhook URL set successfully');
  }
}

export {
  enhanceWebhookPayload,
  generateCallSummary,
  sendEnhancedWebhook,
  setWebhookUrl
}; 