# ElevenLabs Prompts Centralization Implementation Guide

## Overview

This guide outlines the implementation of a centralized system for managing ElevenLabs prompts and Make.com webhook URLs. Currently, prompts and webhook URLs are scattered throughout the codebase, making them difficult to manage, edit, and maintain consistency. This centralization will:

1. Create a single location for all ElevenLabs prompts
2. Establish a consistent format for prompt templates
3. Move all Make.com webhook URLs to environment variables
4. Create a clean API for accessing and customizing prompts

## Requirements

- Centralize all ElevenLabs prompts in a single file/module
- Support dynamic variable interpolation for lead information
- Extract all hardcoded Make.com webhook URLs to environment variables
- Maintain backward compatibility with current implementation
- Make prompt variations easy to manage (e.g., standard call vs. voicemail)

## Environment Variables

Add the following to your `.env` file:

```
# ElevenLabs Configuration
ELEVENLABS_API_KEY=your-elevenlabs-api-key
ELEVENLABS_AGENT_ID=your-elevenlabs-agent-id

# Make.com Webhook URLs
MAKE_WEBHOOK_URL=https://hook.us2.make.com/your-webhook-endpoint
MAKE_CALLBACK_WEBHOOK_URL=https://hook.us2.make.com/your-callback-webhook
MAKE_VOICEMAIL_WEBHOOK_URL=https://hook.us2.make.com/your-voicemail-webhook
```

## Implementation Approach

### 1. Create Centralized Prompts Module

Create a new file `elevenlabs-prompts.js` in the `forTheLegends/prompts` directory with the following structure:

```javascript
// elevenlabs-prompts.js
// Centralized management of all ElevenLabs prompts

/**
 * Standard base prompt for care coordinator calls
 * This is the main prompt that defines the AI's persona and objectives
 */
const BASE_PROMPT = `You are Heather, a friendly and warm care coordinator for First Light Home Care, a home healthcare company. You're calling to follow up on care service inquiries with a calm and reassuring voice, using natural pauses to make the conversation feel more human-like. Your main goals are:
1. Verify the details submitted in the care request from the Point of Contact for the 'Care Needed For'.
2. Show empathy for the care situation.
3. Confirm interest in receiving care services for the 'Care Needed For'.
4. Set expectations for next steps, which are to discuss with a care specialist.

Use casual, friendly language, avoiding jargon and technical terms, to make the lead feel comfortable and understood. Listen carefully and address concerns with empathy, focusing on building rapport. If asked about pricing, explain that a care specialist will discuss detailed pricing options soon. If the person is not interested, thank them for their time and end the call politely.

If our care team is not available to join the call, kindly explain to the person that our care specialists are currently unavailable but will contact them soon. Verify their contact information (phone number and/or email) to make sure it matches what we have on file, and ask if there's a preferred time for follow-up. Be sure to confirm all their information is correct before ending the call.

IMPORTANT: When the call connects, wait for the person to say hello or acknowledge the call before you start speaking. If they don't say anything within 2-3 seconds, then begin with a warm greeting. Always start with a natural greeting like 'Hello' and pause briefly before continuing with your introduction.`;

/**
 * Standard voicemail instructions to append to the base prompt
 */
const VOICEMAIL_INSTRUCTIONS = `IMPORTANT: This call has reached a voicemail. Wait for the beep, then leave a personalized message like: "Hello {{leadName}}{{leadNameComma}} I'm calling from First Light Home Care regarding the care services inquiry {{forCareNeededFor}} {{whoCareReason}}. Please call us back at (555) 123-4567 at your earliest convenience to discuss how we can help. Thank you."

Ensure the message sounds natural and conversational, not like a template. Be concise as voicemails often have time limits.`;

/**
 * Generic voicemail instructions when lead information is not available
 */
const GENERIC_VOICEMAIL_INSTRUCTIONS = `IMPORTANT: This call has reached a voicemail. Wait for the beep, then leave a message: "Hello, I'm calling from First Light Home Care regarding the care services inquiry. Please call us back at (555) 123-4567 at your earliest convenience to discuss how we can help. Thank you."

Keep the message concise but warm and professional. Focus on urgency without being pushy.`;

/**
 * Standard first message template for outbound calls
 */
const FIRST_MESSAGE_TEMPLATE = `Hello, this is Heather from First Light Home Care. I'm calling about the care services inquiry for {{careNeededFor}}. Is this {{leadName}}?`;

/**
 * Generic first message when lead information is not available
 */
const GENERIC_FIRST_MESSAGE = `Hello, this is Heather from First Light Home Care. I'm calling about the care services inquiry. Am I speaking with the right person?`;

/**
 * Generate a complete prompt with appropriate customizations
 * 
 * @param {Object} leadInfo - Information about the lead
 * @param {Object} options - Additional options for customizing the prompt
 * @returns {string} - The complete formatted prompt
 */
function getFormattedPrompt(leadInfo = {}, options = {}) {
  let fullPrompt = BASE_PROMPT;
  
  // Add customizations based on lead info if available
  if (leadInfo.CareNeededFor || leadInfo.CareReason || leadInfo.PoC) {
    fullPrompt += `\n\nFor this specific call: `;
    
    if (leadInfo.PoC) {
      fullPrompt += `The Point of Contact is ${leadInfo.PoC}. `;
    }
    
    if (leadInfo.CareNeededFor) {
      fullPrompt += `Care is needed for ${leadInfo.CareNeededFor}. `;
    }
    
    if (leadInfo.CareReason) {
      fullPrompt += `The reason for care is: ${leadInfo.CareReason}.`;
    }
  }
  
  // Add voicemail instructions if needed
  if (options.isVoicemail) {
    if (leadInfo.LeadName || leadInfo.CareNeededFor || leadInfo.CareReason) {
      // Create personalized voicemail message
      let voicemailPrompt = VOICEMAIL_INSTRUCTIONS
        .replace('{{leadName}}', leadInfo.LeadName || leadInfo.PoC || '')
        .replace('{{leadNameComma}}', (leadInfo.LeadName || leadInfo.PoC) ? ', ' : '')
        .replace('{{forCareNeededFor}}', leadInfo.CareNeededFor ? 'for ' + leadInfo.CareNeededFor : '')
        .replace('{{whoCareReason}}', leadInfo.CareReason ? 'who needs ' + leadInfo.CareReason : '');
      
      fullPrompt += `\n\n${voicemailPrompt}`;
    } else {
      fullPrompt += `\n\n${GENERIC_VOICEMAIL_INSTRUCTIONS}`;
    }
  }
  
  // Add any additional custom instructions
  if (options.additionalInstructions) {
    fullPrompt += `\n\n${options.additionalInstructions}`;
  }
  
  return fullPrompt;
}

/**
 * Generate a formatted first message with lead information
 * 
 * @param {Object} leadInfo - Information about the lead
 * @returns {string} - The formatted first message
 */
function getFirstMessage(leadInfo = {}) {
  if (leadInfo.LeadName || leadInfo.CareNeededFor) {
    return FIRST_MESSAGE_TEMPLATE
      .replace('{{leadName}}', leadInfo.LeadName || leadInfo.PoC || 'there')
      .replace('{{careNeededFor}}', leadInfo.CareNeededFor || 'your loved one');
  }
  
  return GENERIC_FIRST_MESSAGE;
}

/**
 * Generate a complete initialization configuration for ElevenLabs WebSocket
 * 
 * @param {Object} leadInfo - Information about the lead
 * @param {Object} options - Additional options for customizing the prompt
 * @returns {Object} - The formatted initialization configuration
 */
function getInitConfig(leadInfo = {}, options = {}) {
  const prompt = getFormattedPrompt(leadInfo, options);
  const firstMessage = options.firstMessage || getFirstMessage(leadInfo);
  
  return {
    type: "conversation_initiation_client_data",
    conversation_config_override: {
      agent: {
        prompt: { prompt },
        first_message: firstMessage,
        wait_for_user_speech: options.waitForUserSpeech !== false, // Default to true
      },
      conversation: {
        initial_audio_silence_timeout_ms: options.silenceTimeoutMs || 3000, // Default 3 seconds
      }
    },
  };
}

// Export functions and constants
module.exports = {
  // Constants
  BASE_PROMPT,
  VOICEMAIL_INSTRUCTIONS,
  GENERIC_VOICEMAIL_INSTRUCTIONS,
  FIRST_MESSAGE_TEMPLATE,
  GENERIC_FIRST_MESSAGE,
  
  // Functions
  getFormattedPrompt,
  getFirstMessage,
  getInitConfig
};
```

### 2. Create Make.com Webhook Configuration Module

Create a new file `webhook-config.js` in the `forTheLegends/outbound` directory:

```javascript
// webhook-config.js
// Centralized configuration for Make.com webhook URLs

/**
 * Default webhook configuration
 */
const defaultWebhookConfig = {
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

// Current active configuration
let webhookConfig = { ...defaultWebhookConfig };

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
  webhookConfig = { ...defaultWebhookConfig };
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
module.exports = {
  getWebhookConfig,
  updateWebhookConfig,
  resetWebhookConfig,
  getWebhookUrlForContext
};
```

### 3. Update `outbound-calls.js` to Use Centralized Prompts

Modify the `outbound-calls.js` file to use the new centralized prompts:

```javascript
// At the top of the file, add these imports
const elevenLabsPrompts = require('./forTheLegends/prompts/elevenlabs-prompts');
const webhookConfig = require('./forTheLegends/outbound/webhook-config');

// Remove the basePrompt constant from the file

// In the setupElevenLabs function, replace the existing prompt code:
elevenLabsWs.on("open", () => {
  console.log("[ElevenLabs] Connected to Conversational AI");
  
  // Get lead info from call statuses or custom parameters
  const leadInfo = callStatuses[callSid]?.leadInfo || customParameters || {};
  
  // Create options object for the prompt
  const promptOptions = {
    isVoicemail: callStatuses[callSid]?.isVoicemail || false,
    waitForUserSpeech: true,
    silenceTimeoutMs: 3000
  };
  
  // Get the initialization config with the proper prompt and first message
  const initialConfig = elevenLabsPrompts.getInitConfig(leadInfo, promptOptions);
  
  // Send the configuration to ElevenLabs
  elevenLabsWs.send(JSON.stringify(initialConfig));
});
```

### 4. Update the Webhook Functionality to Use the New Configuration

Modify the webhook sending code to use the centralized configuration:

```javascript
// Replace any code that uses hardcoded Make.com URLs with:
const webhookUrl = webhookConfig.getWebhookUrlForContext(callStatuses[callSid]);

// Send to webhook
if (webhookUrl) {
  // Existing webhook sending code...
  const response = await axios.post(webhookUrl, payload, { ... });
} else {
  console.log(`[Webhook] No webhook URL available for call ${callSid}`);
}
```

## Integration Points

The key integration points for this centralization are:

### 1. `outbound-calls.js`

Replace the hardcoded prompt and webhook URL with references to the centralized modules:

```javascript
// Replace:
const basePrompt = `You are Heather, a friendly and warm care coordinator...`;

// With:
const elevenLabsPrompts = require('./forTheLegends/prompts/elevenlabs-prompts');
```

And use the prompt functions where prompts are constructed:

```javascript
// Replace prompt construction code with:
const initialConfig = elevenLabsPrompts.getInitConfig(leadInfo, promptOptions);
```

### 2. `setupStreamingWebSocket.js`

Update the getInitializationMessage function:

```javascript
function getInitializationMessage(customParameters) {
  return elevenLabsPrompts.getInitConfig(customParameters);
}
```

### 3. `outbound-webhook.js`

Replace webhook URL configuration with the centralized version:

```javascript
// Replace:
const DEFAULT_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL || 'https://hook.us2.make.com/your-endpoint-here';
let webhookConfig = {
  url: DEFAULT_WEBHOOK_URL,
  retryAttempts: 3,
  retryDelayMs: 1000,
  timeoutMs: 10000,
  enabled: true
};

// With:
const webhookConfig = require('./webhook-config');
```

## Testing

### Unit Tests for Prompt Management

Create a test file `test/unit/elevenlabs-prompts.test.js`:

```javascript
import { jest } from '@jest/globals';
import {
  getFormattedPrompt,
  getFirstMessage,
  getInitConfig,
  BASE_PROMPT
} from '../../forTheLegends/prompts/elevenlabs-prompts';

describe('ElevenLabs Prompts', () => {
  describe('getFormattedPrompt', () => {
    it('should return the base prompt when no customizations are provided', () => {
      const result = getFormattedPrompt();
      expect(result).toBe(BASE_PROMPT);
    });
    
    it('should add lead information when provided', () => {
      const leadInfo = {
        LeadName: 'John Doe',
        CareNeededFor: 'Mother',
        CareReason: 'Dementia'
      };
      
      const result = getFormattedPrompt(leadInfo);
      
      expect(result).toContain(BASE_PROMPT);
      expect(result).toContain('John Doe');
      expect(result).toContain('Mother');
      expect(result).toContain('Dementia');
    });
    
    it('should add voicemail instructions when isVoicemail is true', () => {
      const leadInfo = {
        LeadName: 'John Doe'
      };
      
      const result = getFormattedPrompt(leadInfo, { isVoicemail: true });
      
      expect(result).toContain(BASE_PROMPT);
      expect(result).toContain('This call has reached a voicemail');
      expect(result).toContain('John Doe');
    });
    
    it('should add generic voicemail instructions when no lead info is available', () => {
      const result = getFormattedPrompt({}, { isVoicemail: true });
      
      expect(result).toContain(BASE_PROMPT);
      expect(result).toContain('This call has reached a voicemail');
      expect(result).toContain('Keep the message concise but warm and professional');
    });
    
    it('should add additional instructions when provided', () => {
      const additionalInstructions = 'This is a test call, please do not transfer to sales.';
      
      const result = getFormattedPrompt({}, { additionalInstructions });
      
      expect(result).toContain(BASE_PROMPT);
      expect(result).toContain(additionalInstructions);
    });
  });
  
  describe('getFirstMessage', () => {
    it('should format the first message with lead information', () => {
      const leadInfo = {
        LeadName: 'John Doe',
        CareNeededFor: 'Mother'
      };
      
      const result = getFirstMessage(leadInfo);
      
      expect(result).toContain('John Doe');
      expect(result).toContain('Mother');
    });
    
    it('should use default values when lead information is missing', () => {
      const result = getFirstMessage({});
      
      expect(result).toBe('Hello, this is Heather from First Light Home Care. I'm calling about the care services inquiry. Am I speaking with the right person?');
    });
  });
  
  describe('getInitConfig', () => {
    it('should create a properly formatted initialization config', () => {
      const leadInfo = {
        LeadName: 'John Doe',
        CareNeededFor: 'Mother'
      };
      
      const result = getInitConfig(leadInfo);
      
      expect(result.type).toBe('conversation_initiation_client_data');
      expect(result.conversation_config_override.agent.prompt.prompt).toContain('John Doe');
      expect(result.conversation_config_override.agent.first_message).toContain('John Doe');
      expect(result.conversation_config_override.agent.wait_for_user_speech).toBe(true);
      expect(result.conversation_config_override.conversation.initial_audio_silence_timeout_ms).toBe(3000);
    });
    
    it('should allow customization of all options', () => {
      const options = {
        firstMessage: 'Custom first message',
        waitForUserSpeech: false,
        silenceTimeoutMs: 5000,
        isVoicemail: true
      };
      
      const result = getInitConfig({}, options);
      
      expect(result.conversation_config_override.agent.prompt.prompt).toContain('This call has reached a voicemail');
      expect(result.conversation_config_override.agent.first_message).toBe('Custom first message');
      expect(result.conversation_config_override.agent.wait_for_user_speech).toBe(false);
      expect(result.conversation_config_override.conversation.initial_audio_silence_timeout_ms).toBe(5000);
    });
  });
});
```

### Unit Tests for Webhook Configuration

Create a test file `test/unit/webhook-config.test.js`:

```javascript
import { jest } from '@jest/globals';
import {
  getWebhookConfig,
  updateWebhookConfig,
  resetWebhookConfig,
  getWebhookUrlForContext
} from '../../forTheLegends/outbound/webhook-config';

describe('Webhook Configuration', () => {
  beforeEach(() => {
    // Reset environment
    delete process.env.MAKE_WEBHOOK_URL;
    delete process.env.MAKE_CALLBACK_WEBHOOK_URL;
    delete process.env.MAKE_VOICEMAIL_WEBHOOK_URL;
    
    // Reset config to defaults
    resetWebhookConfig();
  });
  
  describe('getWebhookConfig', () => {
    it('should return the default configuration when environment variables are not set', () => {
      const config = getWebhookConfig();
      
      expect(config.url).toContain('hook.us2.make.com');
      expect(config.retryAttempts).toBe(3);
      expect(config.enabled).toBe(true);
    });
    
    it('should use environment variables when set', () => {
      process.env.MAKE_WEBHOOK_URL = 'https://test-webhook.com';
      process.env.MAKE_CALLBACK_WEBHOOK_URL = 'https://test-callback.com';
      process.env.MAKE_VOICEMAIL_WEBHOOK_URL = 'https://test-voicemail.com';
      
      // Reset to pick up new environment variables
      resetWebhookConfig();
      
      const config = getWebhookConfig();
      
      expect(config.url).toBe('https://test-webhook.com');
      expect(config.callbackUrl).toBe('https://test-callback.com');
      expect(config.voicemailUrl).toBe('https://test-voicemail.com');
    });
  });
  
  describe('updateWebhookConfig', () => {
    it('should update specific configuration values', () => {
      updateWebhookConfig({
        retryAttempts: 5,
        timeoutMs: 5000
      });
      
      const config = getWebhookConfig();
      
      expect(config.retryAttempts).toBe(5);
      expect(config.timeoutMs).toBe(5000);
      // Other values should be unchanged
      expect(config.enabled).toBe(true);
    });
    
    it('should completely disable webhooks when enabled is set to false', () => {
      updateWebhookConfig({
        enabled: false
      });
      
      expect(getWebhookUrlForContext({})).toBeNull();
    });
  });
  
  describe('getWebhookUrlForContext', () => {
    it('should return the voicemail URL for voicemail calls', () => {
      process.env.MAKE_VOICEMAIL_WEBHOOK_URL = 'https://test-voicemail.com';
      resetWebhookConfig();
      
      const url = getWebhookUrlForContext({ isVoicemail: true });
      
      expect(url).toBe('https://test-voicemail.com');
    });
    
    it('should return the callback URL for scheduled callbacks', () => {
      process.env.MAKE_CALLBACK_WEBHOOK_URL = 'https://test-callback.com';
      resetWebhookConfig();
      
      const url = getWebhookUrlForContext({ callbackScheduled: true });
      
      expect(url).toBe('https://test-callback.com');
    });
    
    it('should return the default URL for normal calls', () => {
      process.env.MAKE_WEBHOOK_URL = 'https://test-webhook.com';
      resetWebhookConfig();
      
      const url = getWebhookUrlForContext({});
      
      expect(url).toBe('https://test-webhook.com');
    });
  });
});
```

## Migration Plan

1. Create the `forTheLegends/prompts` directory
2. Create the `elevenlabs-prompts.js` module with existing prompts
3. Create the `webhook-config.js` module
4. Write unit tests for both modules (TDD approach)
5. Update `outbound-calls.js` to use the new centralized prompts
6. Update webhook functionality to use the new configuration
7. Test in development environment
8. Deploy and monitor real-world usage

## Benefits

This centralization approach provides several benefits:

1. **Easier maintenance**: All prompts are in a single location, making them easier to find and update
2. **Consistent formatting**: Standardized functions ensure prompts follow the same format
3. **Dynamic customization**: Easily personalize prompts with lead information
4. **Enhanced testing**: Isolated modules are easier to unit test
5. **Configuration flexibility**: Environment variables allow different webhook URLs per environment

## Example Usage

Here's an example of how you would use the centralized prompts in a call:

```javascript
const elevenLabsPrompts = require('./forTheLegends/prompts/elevenlabs-prompts');

// Get lead information from your data source
const leadInfo = {
  LeadName: 'John Smith',
  CareNeededFor: 'Mother',
  CareReason: 'Dementia'
};

// Configure prompt options
const options = {
  isVoicemail: false,
  waitForUserSpeech: true,
  additionalInstructions: 'The caller previously mentioned they might be interested in 24-hour care. Be sure to mention we offer around-the-clock services.'
};

// Get the initialization configuration
const config = elevenLabsPrompts.getInitConfig(leadInfo, options);

// Send to ElevenLabs
elevenLabsWs.send(JSON.stringify(config));
``` 