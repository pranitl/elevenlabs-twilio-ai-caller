/**
 * Intent constants for outbound calls
 * This module centralizes all intent categories, patterns, priorities, and instructions
 * for the intent detection system.
 */

// Intent categories

// Cannot talk now intent
export const CANT_TALK_NOW = {
  name: 'cant_talk_now',
  priority: 2,
  patterns: [
    /busy right now/i,
    /can'?t talk( right)? now/i,
    /driving( right)? now/i,
    /in a meeting/i,
    /at work/i,
    /call (me )?(back )?(later|another time)/i,
    /not a good time/i,
    /middle of something/i
  ],
  instructions: 'User cannot talk now. Apologize for the inconvenience, ask when would be a better time to call back, and prepare to end the call.'
};

// No interest intent
export const NO_INTEREST = {
  name: 'no_interest',
  priority: 4,
  patterns: [
    /not interested/i,
    /don'?t want/i,
    /no thank(s| you)/i,
    /no,? (I'?m )?not/i,
    /stop calling/i,
    /leave me alone/i,
    /do not call/i,
    /take me off/i,
    /remove (me|my number)/i,
    /remove from (call|contact) list/i
  ],
  instructions: 'User has expressed no interest. Acknowledge their preference politely, thank them for their time, and end the call.'
};

// Service interest intent (mapped from ElevenLabs success criteria)
export const SERVICE_INTEREST = {
  name: 'service_interest',
  priority: 4,
  patterns: [
    /interested/i,
    /sounds good/i,
    /tell me more/i,
    /want to (know|learn) more/i,
    /would like to/i,
    /sign( me)? up/i,
    /how (do|can|would) I/i,
    /what (is|are) the (cost|price|fee)/i,
    /how much (does it|do you|would it) cost/i
  ],
  instructions: 'User is interested in services. Provide relevant information and prepare for handoff to a human agent.'
};

// Already have care intent
export const ALREADY_HAVE_CARE = {
  name: 'already_have_care',
  priority: 3,
  patterns: [
    /already have/i,
    /already (using|with)/i,
    /already (got|getting)/i,
    /current(ly)? (have|using|with)/i,
    /have my own/i,
    /working with/i,
    /am (with|using)/i
  ],
  instructions: 'User already has care or service. Acknowledge this, briefly mention how your service might be different or complementary if appropriate, and respect their current arrangement.'
};

// Wrong person intent
export const WRONG_PERSON = {
  name: 'wrong_person',
  priority: 5,
  patterns: [
    /wrong (person|number|name)/i,
    /don'?t know what/i,
    /not (sure )?who/i,
    /who (is this|are you)/i,
    /I'?m not/i,
    /you'?ve got the wrong/i,
    /no one (here|by that name)/i,
    /there'?s no/i,
    /doesn'?t live here/i
  ],
  instructions: 'Wrong person or number. Apologize for the confusion, confirm if you have the wrong contact, and prepare to end the call.'
};

// Confused intent
export const CONFUSED = {
  name: 'confused',
  priority: 1,
  patterns: [
    /confused/i,
    /don'?t understand/i,
    /what (is this|are you) (about|regarding)/i,
    /what (is this|are you) (calling|referring) (to|about)/i,
    /why (are you|did you) call/i,
    /what'?s (this|that) (about|for)/i,
    /what (company|organization|service)/i,
    /who (is this|are you)/i,
    /where are you from/i,
    /what (exactly )?(is|are|do) you/i
  ],
  instructions: 'User is confused about the call. Clearly reintroduce yourself, explain the purpose of the call, and ask if they would like more information.'
};

// Needs more info intent
export const NEEDS_MORE_INFO = {
  name: 'needs_more_info',
  priority: 1,
  patterns: [
    /tell me more/i,
    /(would|could) you (please )?(explain|tell me)/i,
    /more (information|details|specifics)/i,
    /how (much|does it|do you)/i,
    /what (is|are) the/i,
    /send me (information|details)/i,
    /interested/i,
    /how (does it|do you) work/i,
    /what (exactly|specifically)/i
  ],
  instructions: 'User needs more information. Provide details about your services, costs, benefits, and process clearly and concisely.'
};

// Schedule callback intent
export const SCHEDULE_CALLBACK = {
  name: 'schedule_callback',
  priority: 2,
  patterns: [
    /call (me )?back/i,
    /call (me )?(on|at|tomorrow|later)/i,
    /(could|can) you call( me)?( back)?/i,
    /call another time/i,
    /reschedule/i,
    /schedule (a )?call/i,
    /contact me/i,
    /reach (me|out)/i,
    /(later|another) (time|day)/i
  ],
  instructions: 'User wants to schedule a callback. Ask about and confirm a specific date and time that works for them, and assure them you will call back at that time.'
};

// Needs immediate care intent
export const NEEDS_IMMEDIATE_CARE = {
  name: 'needs_immediate_care',
  priority: 5,
  patterns: [
    /need (help|care|assistance|service) (now|right now|immediately|asap|today)/i,
    /(right now|immediately|asap|today)/i,
    /urgent/i,
    /emergency/i,
    /as soon as/i,
    /need (it|someone|this) (now|today|asap)/i,
    /can'?t wait/i,
    /(how|when) (fast|quickly|soon) can/i
  ],
  instructions: 'User needs immediate care. Gather necessary details about their situation, express understanding of urgency, and inform them about the quickest next steps.'
};

// Collection of all intent categories for easy access
export const ALL_INTENT_CATEGORIES = [
  CANT_TALK_NOW,
  NO_INTEREST,
  SERVICE_INTEREST,
  ALREADY_HAVE_CARE,
  WRONG_PERSON,
  CONFUSED,
  NEEDS_MORE_INFO,
  SCHEDULE_CALLBACK,
  NEEDS_IMMEDIATE_CARE
];

// Helper constants for intent classification
export const POSITIVE_INTENTS = [
  SERVICE_INTEREST.name,
  NEEDS_MORE_INFO.name,
  SCHEDULE_CALLBACK.name,
  NEEDS_IMMEDIATE_CARE.name
];

export const NEGATIVE_INTENTS = [
  NO_INTEREST.name,
  WRONG_PERSON.name
];

export const NEUTRAL_INTENTS = [
  CANT_TALK_NOW.name,
  ALREADY_HAVE_CARE.name,
  CONFUSED.name
];

// Intent lookup by name for easy access
export const INTENT_BY_NAME = ALL_INTENT_CATEGORIES.reduce((acc, intent) => {
  acc[intent.name] = intent;
  return acc;
}, {});

// Default threshold values for intent detection
export const INTENT_DETECTION_CONFIG = {
  confidenceThreshold: 0.6,
  minimumMatchCount: 1,
  ambiguityThreshold: 0.2, // Difference threshold to determine if intents are too close
  maxInactivityMs: 30000, // 30 seconds of inactivity before considering intent expired
  maxIntentsToTrack: 5 // Number of most recent intents to track in history
}; 