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
  if (leadInfo.leadName || leadInfo.careNeededFor || leadInfo.careReason || 
      leadInfo.CareNeededFor || leadInfo.CareReason || leadInfo.PoC || leadInfo.LeadName) {
    fullPrompt += `\n\nFor this specific call: `;
    
    if (leadInfo.PoC) {
      fullPrompt += `The Point of Contact is ${leadInfo.PoC}. `;
    } else if (leadInfo.LeadName) {
      fullPrompt += `The Point of Contact is ${leadInfo.LeadName}. `;
    } else if (leadInfo.leadName) {
      fullPrompt += `The Point of Contact is ${leadInfo.leadName}. `;
    }
    
    if (leadInfo.CareNeededFor) {
      fullPrompt += `Care is needed for ${leadInfo.CareNeededFor}. `;
    } else if (leadInfo.careNeededFor) {
      fullPrompt += `Care is needed for ${leadInfo.careNeededFor}. `;
    }
    
    if (leadInfo.CareReason) {
      fullPrompt += `The reason for care is: ${leadInfo.CareReason}.`;
    } else if (leadInfo.careReason) {
      fullPrompt += `The reason for care is: ${leadInfo.careReason}.`;
    }
  }
  
  // Add voicemail instructions if needed
  if (options.isVoicemail) {
    if (leadInfo.LeadName || leadInfo.leadName || leadInfo.CareNeededFor || leadInfo.careNeededFor || leadInfo.CareReason || leadInfo.careReason) {
      // Create personalized voicemail message
      let voicemailPrompt = VOICEMAIL_INSTRUCTIONS
        .replace('{{leadName}}', leadInfo.LeadName || leadInfo.leadName || leadInfo.PoC || '')
        .replace('{{leadNameComma}}', (leadInfo.LeadName || leadInfo.leadName || leadInfo.PoC) ? ', ' : '')
        .replace('{{forCareNeededFor}}', (leadInfo.CareNeededFor || leadInfo.careNeededFor) ? 'for ' + (leadInfo.CareNeededFor || leadInfo.careNeededFor) : '')
        .replace('{{whoCareReason}}', (leadInfo.CareReason || leadInfo.careReason) ? 'who needs ' + (leadInfo.CareReason || leadInfo.careReason) : '');
      
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
  let systemPrompt;
  
  // If a custom prompt is provided directly, use it instead of generating one
  if (leadInfo.prompt) {
    systemPrompt = leadInfo.prompt;
  } else {
    systemPrompt = getFormattedPrompt(leadInfo, options);
  }
  
  const firstMessage = options.firstMessage || getFirstMessage(leadInfo);
  
  return {
    type: "conversation_initiation_client_data",
    conversation_config_override: {
      agent: {
        system_prompt: systemPrompt,
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
export {
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

// Support for CommonJS (for backwards compatibility)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BASE_PROMPT,
    VOICEMAIL_INSTRUCTIONS,
    GENERIC_VOICEMAIL_INSTRUCTIONS,
    FIRST_MESSAGE_TEMPLATE,
    GENERIC_FIRST_MESSAGE,
    getFormattedPrompt,
    getFirstMessage,
    getInitConfig
  };
} 