// forTheLegends/outbound/index.js
// Main export file for enhanced outbound call features

// Import from integration module
import {
  initialize as initIntegration,
  enhanceLeadCall,
  enhanceElevenLabsSetup,
  processAudio,
  enhanceWebhook,
  processCallStatus,
  enhancedCallStates
} from './integration.js';

import { 
  initialize,
  registerEnhancedOutboundRoutes,
  enhancedCallStates as enhancedRouteStates
} from './enhanced-call-handler.js';

import { 
  initializeQualityMonitoring,
  processAudioQuality,
  getQualityInstructions,
  getQualityMetrics,
  clearQualityMetrics
} from './call-quality-monitor.js';

import {
  initializeInterruptionDetection,
  processTranscript as processInterruptionTranscript,
  getInterruptionInstructions,
  getInterruptionData,
  clearInterruptionData
} from './interruption-handler.js';

import {
  initializeIntentDetection,
  processTranscript as processIntentTranscript,
  getIntentInstructions,
  hasSchedulingIntent,
  hasNegativeIntent,
  getIntentData,
  clearIntentData
} from './intent-detector.js';

import {
  initialize as initRetryManager,
  trackCall,
  updateCallStatus,
  scheduleRetryCall,
  getRetryInfo,
  clearRetryState
} from './retry-manager.js';

import {
  enhanceWebhookPayload,
  sendEnhancedWebhook,
  setWebhookUrl
} from './webhook-enhancer.js';

// Import new outbound webhook module
import {
  sendElevenLabsConversationData,
  configureWebhook
} from './outbound-webhook.js';

export {
  // Integration with existing outbound-calls.js
  initIntegration,
  enhanceLeadCall,
  enhanceElevenLabsSetup,
  processAudio,
  enhanceWebhook,
  processCallStatus,
  enhancedCallStates,
  
  // Main enhanced call handler
  initialize,
  registerEnhancedOutboundRoutes,
  enhancedRouteStates,
  
  // Call quality monitoring
  initializeQualityMonitoring,
  processAudioQuality,
  getQualityInstructions,
  getQualityMetrics,
  clearQualityMetrics,
  
  // Interruption detection
  initializeInterruptionDetection,
  processInterruptionTranscript,
  getInterruptionInstructions,
  getInterruptionData,
  clearInterruptionData,
  
  // Intent detection
  initializeIntentDetection,
  processIntentTranscript,
  getIntentInstructions,
  hasSchedulingIntent,
  hasNegativeIntent,
  getIntentData,
  clearIntentData,
  
  // Retry management
  initRetryManager,
  trackCall,
  updateCallStatus,
  scheduleRetryCall,
  getRetryInfo,
  clearRetryState,
  
  // Webhook enhancement
  enhanceWebhookPayload,
  sendEnhancedWebhook,
  setWebhookUrl,
  
  // Outbound webhook for ElevenLabs conversations
  sendElevenLabsConversationData,
  configureWebhook
}; 