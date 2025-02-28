// twilio-prompts.js
// Centralized management of all Twilio TwiML prompts and messages

/**
 * Messaging voice and tone guidelines for all TwiML <Say> prompts
 * These constants define the communication style for different scenarios
 */
const VOICE_TONE = {
  WARM: "warm and professional, focusing on making the caller feel valued and understood",
  HELPFUL: "helpful and informative, providing clear guidance and instructions",
  URGENT: "respectful but with a sense of urgency, encouraging immediate action",
  REASSURING: "reassuring and calm, reducing anxiety and building trust"
};

/**
 * Inbound Call Prompts
 * These are used for when customers call into the system
 */
const INBOUND = {
  // Initial greeting for inbound calls
  WELCOME: {
    DEFAULT: "Thank you for calling. To speak with our sales team, please press 1. To leave a message, press 2.",
    AFTER_HOURS: "Thank you for calling. Our office is currently closed. To leave a message, please press 2.",
    BUSY: "Thank you for calling. Our team is currently assisting other customers. To receive a callback, please press 3."
  },
  
  // Voicemail prompts
  VOICEMAIL: {
    GREETING: "Please leave your message after the tone. Press pound when you are finished.",
    NO_RECORDING: "We didn't receive a recording. Goodbye."
  },
  
  // Connect to sales team prompts
  SALES_TEAM: {
    CONNECTING: "Connecting you to our sales team. Please hold.",
    UNABLE_TO_CONNECT: "We were unable to connect you. Please try again later."
  },
  
  // Invalid input prompts
  ERROR: {
    NO_INPUT: "We didn't receive any input. Goodbye.",
    INVALID_SELECTION: "Invalid selection. Goodbye."
  }
};

/**
 * Outbound Call Prompts
 * These are used for when the system is calling customers
 */
const OUTBOUND = {
  // Sales team notification about AI call
  SALES_TEAM_NOTIFICATION: {
    TEMPLATE: "You're being connected to an AI-assisted call with {{leadName}}. The AI will speak with the lead about {{careReason}} {{careNeededFor}}. Please wait while we connect you. If the call goes to voicemail, you will be notified."
  },
  
  // Human handoff messages
  HANDOFF: {
    TO_AGENT: "I'll now connect you with a human agent who can provide more specific information. Please hold for just a moment.",
    TO_SALES_TEAM: "I'm connecting you with our sales team now. They'll be able to answer all your detailed questions. One moment please.",
    TO_CARE_SPECIALIST: "I'll transfer you to a care specialist who can discuss care options in more detail. Please stay on the line."
  },
  
  // Call ending messages
  ENDING: {
    THANK_YOU: "Thank you for your time today. A member of our team will follow up with you soon. Have a great day!",
    FOLLOW_UP: "Thank you for the conversation. Our care specialist will reach out to you within 24 hours to discuss next steps."
  }
};

/**
 * Conference Call Prompts
 * These are used for conference call scenarios
 */
const CONFERENCE = {
  // Notification messages
  NOTIFICATIONS: {
    JOINING: "You are now joining the conference.",
    WAITING: "Please wait while others join the conference.",
    LEFT: "You have left the conference."
  },
  
  // Instructions
  INSTRUCTIONS: {
    MUTE: "To mute your line, press star six. To unmute, press star six again.",
    END: "To end the call, simply hang up."
  }
};

/**
 * Function to format a template message with variables
 * 
 * @param {string} template - The template string with {{variable}} placeholders
 * @param {Object} data - Object containing values to replace placeholders
 * @returns {string} - Formatted message with placeholders replaced
 */
function formatMessage(template, data = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    // If key exists in data and has value, use it; otherwise return empty string
    const value = data[key];
    if (key === 'careNeededFor' && value) {
      return `for ${value}`;
    }
    return value || '';
  });
}

/**
 * Generate a formatted sales team notification message
 * 
 * @param {Object} leadInfo - Information about the lead
 * @returns {string} - The formatted notification message
 */
function getSalesTeamNotificationMessage(leadInfo = {}) {
  return formatMessage(OUTBOUND.SALES_TEAM_NOTIFICATION.TEMPLATE, {
    leadName: leadInfo.leadName || leadInfo.LeadName || "a potential client",
    careReason: leadInfo.careReason || leadInfo.CareReason || "home care services",
    careNeededFor: leadInfo.careNeededFor || leadInfo.CareNeededFor || ""
  });
}

/**
 * Utility function to escape special characters in TwiML text content
 * 
 * @param {string} text - Raw text to escape
 * @returns {string} - Escaped text safe for TwiML
 */
function escapeTwiMLText(text) {
  if (!text) return '';
  
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Export for ES Modules
export { 
  VOICE_TONE,
  INBOUND, 
  OUTBOUND, 
  CONFERENCE,
  formatMessage, 
  getSalesTeamNotificationMessage,
  escapeTwiMLText 
};

// Export as default for ES Modules
export default {
  VOICE_TONE,
  INBOUND,
  OUTBOUND,
  CONFERENCE,
  formatMessage,
  getSalesTeamNotificationMessage,
  escapeTwiMLText
};

// Export for CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VOICE_TONE,
    INBOUND,
    OUTBOUND, 
    CONFERENCE,
    formatMessage,
    getSalesTeamNotificationMessage,
    escapeTwiMLText
  };
} 