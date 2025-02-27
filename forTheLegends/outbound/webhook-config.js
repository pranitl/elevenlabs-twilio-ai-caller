// webhook-config.js
// Centralized configuration for Make.com webhook URLs

/**
 * Default webhook configuration - reread environment variables each time to support testing
 */
function getDefaultConfig() {
  return {
    // Main webhook URL for sending conversation data
    url: process.env.MAKE_WEBHOOK_URL || 'https://hook.us2.make.com/your-endpoint-here',
    
    // Callback webhook for scheduled callbacks
    callbackUrl: process.env.MAKE_CALLBACK_WEBHOOK_URL || process.env.MAKE_WEBHOOK_URL || 'https://hook.us2.make.com/your-endpoint-here',
    
    // Voicemail webhook URL
    voicemailUrl: process.env.MAKE_VOICEMAIL_WEBHOOK_URL || process.env.MAKE_WEBHOOK_URL || 'https://hook.us2.make.com/your-endpoint-here',
    
    // Retry configuration
    retryAttempts: 3,
    retryDelayMs: 1000,
    timeoutMs: 10000,
    enabled: true
  };
}

// Current active configuration
let webhookConfig = getDefaultConfig();

/**
 * Get the current webhook configuration
 * 
 * @returns {Object} - Current webhook configuration
 */
function getWebhookConfig() {
  return { ...webhookConfig };
}

/**
 * Update webhook configuration
 * 
 * @param {Object} config - New configuration values
 * @returns {Object} - Updated configuration
 */
function updateWebhookConfig(config = {}) {
  webhookConfig = {
    ...webhookConfig,
    ...config
  };
  
  console.log('[Webhook] Configuration updated:', webhookConfig);
  return { ...webhookConfig };
}

/**
 * Reset webhook configuration to defaults
 * 
 * @returns {Object} - Default configuration
 */
function resetWebhookConfig() {
  webhookConfig = getDefaultConfig();
  console.log('[Webhook] Configuration reset to defaults');
  return { ...webhookConfig };
}

/**
 * Get appropriate webhook URL based on the call context
 * 
 * @param {Object} callStatus - Call status with context information
 * @returns {string} - The appropriate webhook URL
 */
function getWebhookUrlForContext(callStatus = {}) {
  if (!webhookConfig.enabled) {
    console.log('[Webhook] Webhooks are disabled');
    return null;
  }
  
  // Use voicemail webhook if this is a voicemail
  if (callStatus.isVoicemail) {
    return webhookConfig.voicemailUrl;
  }
  
  // Use callback webhook if a callback was scheduled
  if (callStatus.callbackScheduled) {
    return webhookConfig.callbackUrl;
  }
  
  // Default to main webhook URL
  return webhookConfig.url;
}

// Export the module
export {
  getWebhookConfig,
  updateWebhookConfig,
  resetWebhookConfig,
  getWebhookUrlForContext
};

// Support for CommonJS (for backwards compatibility)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getWebhookConfig,
    updateWebhookConfig,
    resetWebhookConfig,
    getWebhookUrlForContext
  };
} 