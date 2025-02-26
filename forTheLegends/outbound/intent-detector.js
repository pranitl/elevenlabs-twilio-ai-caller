// intent-detector.js
// Enhanced intent detection for ElevenLabs agent interactions

// Define intent categories and sample phrases
const INTENT_CATEGORIES = {
  CANT_TALK_NOW: {
    name: 'cant_talk_now',
    priority: 80,
    patterns: [
      'can\'t talk', 'can\'t speak', 'not a good time', 'busy', 'in a meeting',
      'driving', 'at work', 'not available', 'call later', 'call back',
      'another time', 'not now', 'bad time'
    ],
    instructions: 'The lead has indicated they cannot talk right now. Ask when would be a better time to call back and offer to schedule a call for that time.'
  },
  NO_INTEREST: {
    name: 'no_interest',
    priority: 90,
    patterns: [
      'not interested', 'don\'t need', 'don\'t want', 'no thanks', 'no thank you',
      'remove me', 'stop calling', 'take me off', 'unsubscribe', 'remove from list',
      'don\'t call again', 'won\'t work', 'waste of time'
    ],
    instructions: 'The lead has expressed they are not interested. Politely acknowledge their preference, thank them for their time, and end the call gracefully. Do not try to persuade them.'
  },
  ALREADY_HAVE_CARE: {
    name: 'already_have_care',
    priority: 70,
    patterns: [
      'already have', 'already using', 'already working with', 'have a provider',
      'have care', 'have service', 'have coverage', 'have support',
      'have assistance', 'have help', 'have a caregiver', 'have a nurse'
    ],
    instructions: 'The lead already has care arrangements. Acknowledge this and ask if they\'re satisfied with their current care. If appropriate, mention how your services might complement or improve their current situation.'
  },
  WRONG_PERSON: {
    name: 'wrong_person',
    priority: 95,
    patterns: [
      'wrong person', 'wrong number', 'not me', 'don\'t know what',
      'who\'s this', 'who is this', 'who are you', 'never requested',
      'didn\'t sign up', 'didn\'t request', 'mistake', 'don\'t know about'
    ],
    instructions: 'You\'ve reached the wrong person or they don\'t recognize why you\'re calling. Apologize for the confusion, verify their identity respectfully, and if it\'s indeed a wrong number, end the call politely.'
  },
  NEEDS_MORE_INFO: {
    name: 'needs_more_info',
    priority: 50,
    patterns: [
      'more information', 'tell me more', 'more details', 'how does it work',
      'what exactly', 'explain more', 'costs?', 'how much', 'pricing',
      'what services', 'insurance', 'coverage', 'benefits'
    ],
    instructions: 'The lead is interested but wants more information. Provide clear, concise details about the services, costs, and benefits. Answer their specific questions with patience and clarity.'
  },
  NEEDS_IMMEDIATE_CARE: {
    name: 'needs_immediate_care',
    priority: 99,
    patterns: [
      'emergency', 'urgent', 'right away', 'as soon as possible', 'immediately',
      'critical', 'crisis', 'can\'t wait', 'today', 'now', 'asap'
    ],
    instructions: 'The lead needs immediate care. Express empathy and ask for specific details about their urgent needs. Prepare to connect them with appropriate immediate resources or fast-track their case.'
  },
  SCHEDULE_CALLBACK: {
    name: 'schedule_callback',
    priority: 60,
    patterns: [
      'schedule a call', 'call me at', 'call back at', 'call tomorrow',
      'call next week', 'better tomorrow', 'better on Monday',
      'better on Tuesday', 'better on Wednesday', 'better on Thursday',
      'better on Friday', 'morning', 'afternoon', 'evening'
    ],
    instructions: 'The lead wants to schedule a specific callback time. Acknowledge their request, confirm the specific date and time they prefer, and assure them they will receive a call at that time.'
  },
  CONFUSED: {
    name: 'confused',
    priority: 40,
    patterns: [
      'what is this about', 'why are you calling', 'what\'s this regarding',
      'what company', 'who are you with', 'what organization',
      'don\'t understand', 'confused', 'not clear', 'what services',
      'what do you do', 'what do you offer'
    ],
    instructions: 'The lead is confused about the purpose of your call. Clearly reintroduce yourself and your organization, explain the reason for the call in simple terms, and ask if they would like to learn more about your services.'
  }
};

// Store intent states by call SID
const intentStates = {};

/**
 * Initialize intent detection for a call
 * @param {string} callSid - The Twilio call SID
 * @returns {Object} The initialized intent state
 */
function initializeIntentDetection(callSid) {
  console.log(`Initializing intent detection for call ${callSid}`);
  
  intentStates[callSid] = {
    // Detected intents
    detectedIntents: [],
    // Primary intent (highest priority)
    primaryIntent: null,
    // Whether instructions have been sent for the primary intent
    instructionsSent: false,
    // Log of detected intents
    intentLog: []
  };
  
  return intentStates[callSid];
}

/**
 * Process transcript to detect intents
 * @param {string} callSid - The Twilio call SID
 * @param {string} transcript - The call transcript
 * @param {string} speaker - Who is speaking ('lead' or 'ai')
 * @returns {Object} Analysis result with detected intents
 */
function processTranscript(callSid, transcript, speaker = 'lead') {
  // Only process lead's speech for intent detection
  if (speaker !== 'lead') {
    return { intentDetected: false };
  }
  
  if (!intentStates[callSid]) {
    initializeIntentDetection(callSid);
  }
  
  const state = intentStates[callSid];
  const now = Date.now();
  
  // Normalize transcript for easier matching
  const normalizedTranscript = transcript.toLowerCase().trim();
  
  let intentDetected = false;
  const detectedIntentsInThisTranscript = [];
  
  // Check each intent category for matches
  for (const [category, intent] of Object.entries(INTENT_CATEGORIES)) {
    // Check if any pattern matches
    const matchedPattern = intent.patterns.find(pattern => 
      normalizedTranscript.includes(pattern.toLowerCase())
    );
    
    if (matchedPattern) {
      intentDetected = true;
      
      // Check if we've already detected this intent
      const existingIntent = state.detectedIntents.find(i => i.name === intent.name);
      
      if (existingIntent) {
        // Update existing intent with higher confidence
        existingIntent.confidence += 0.2;
        existingIntent.confidence = Math.min(existingIntent.confidence, 1.0);
        existingIntent.lastDetectedAt = now;
        existingIntent.transcripts.push(normalizedTranscript);
        existingIntent.matchedPatterns.push(matchedPattern);
      } else {
        // Add new intent
        state.detectedIntents.push({
          name: intent.name,
          category,
          priority: intent.priority,
          confidence: 0.6, // Initial confidence
          firstDetectedAt: now,
          lastDetectedAt: now,
          transcripts: [normalizedTranscript],
          matchedPatterns: [matchedPattern],
          instructions: intent.instructions
        });
      }
      
      detectedIntentsInThisTranscript.push(intent.name);
      
      // Log the intent detection
      state.intentLog.push({
        type: 'intent_detected',
        intent: intent.name,
        timestamp: now,
        transcript: normalizedTranscript,
        matchedPattern
      });
      
      console.log(`Detected intent "${intent.name}" in call ${callSid}: "${matchedPattern}" in "${normalizedTranscript}"`);
    }
  }
  
  // Update primary intent if we detected any intents
  if (intentDetected) {
    updatePrimaryIntent(callSid);
  }
  
  return {
    callSid,
    timestamp: now,
    intentDetected,
    detectedIntents: detectedIntentsInThisTranscript,
    primaryIntent: state.primaryIntent ? state.primaryIntent.name : null
  };
}

/**
 * Update the primary intent based on priority and confidence
 * @param {string} callSid - The Twilio call SID
 */
function updatePrimaryIntent(callSid) {
  if (!intentStates[callSid]) {
    return;
  }
  
  const state = intentStates[callSid];
  
  // Sort intents by priority (high to low) and then by confidence (high to low)
  const sortedIntents = [...state.detectedIntents].sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority; // Higher priority first
    }
    return b.confidence - a.confidence; // Higher confidence first
  });
  
  // Update primary intent if we have any
  if (sortedIntents.length > 0) {
    const newPrimaryIntent = sortedIntents[0];
    
    // Only log if primary intent changed
    if (!state.primaryIntent || state.primaryIntent.name !== newPrimaryIntent.name) {
      state.primaryIntent = newPrimaryIntent;
      state.instructionsSent = false; // Reset so we can send instructions for the new primary intent
      
      state.intentLog.push({
        type: 'primary_intent_updated',
        intent: newPrimaryIntent.name,
        timestamp: Date.now(),
        priority: newPrimaryIntent.priority,
        confidence: newPrimaryIntent.confidence
      });
      
      console.log(`Primary intent updated to "${newPrimaryIntent.name}" for call ${callSid}`);
    }
  }
}

/**
 * Get instructions for the primary intent
 * @param {string} callSid - The Twilio call SID
 * @returns {string|null} Instructions for the AI agent, or null if no instructions needed
 */
function getIntentInstructions(callSid) {
  if (!intentStates[callSid] || !intentStates[callSid].primaryIntent) {
    return null;
  }
  
  const state = intentStates[callSid];
  
  // Only send instructions once per primary intent
  if (state.instructionsSent) {
    return null;
  }
  
  state.instructionsSent = true;
  
  const instructions = state.primaryIntent.instructions;
  
  state.intentLog.push({
    type: 'instructions_sent',
    intent: state.primaryIntent.name,
    timestamp: Date.now(),
    instructions
  });
  
  return instructions;
}

/**
 * Check if any scheduling intent was detected
 * @param {string} callSid - The Twilio call SID
 * @returns {boolean} Whether a scheduling intent was detected
 */
function hasSchedulingIntent(callSid) {
  if (!intentStates[callSid]) {
    return false;
  }
  
  const state = intentStates[callSid];
  
  return state.detectedIntents.some(intent => 
    intent.name === 'schedule_callback' || intent.name === 'cant_talk_now'
  );
}

/**
 * Check if any negative intent was detected
 * @param {string} callSid - The Twilio call SID
 * @returns {boolean} Whether a negative intent was detected
 */
function hasNegativeIntent(callSid) {
  if (!intentStates[callSid]) {
    return false;
  }
  
  const state = intentStates[callSid];
  
  return state.detectedIntents.some(intent => 
    intent.name === 'no_interest' || intent.name === 'wrong_person'
  );
}

/**
 * Get intent data for reporting
 * @param {string} callSid - The Twilio call SID
 * @returns {Object|null} Intent data for the call
 */
function getIntentData(callSid) {
  if (!intentStates[callSid]) {
    return null;
  }
  
  const state = intentStates[callSid];
  
  return {
    detectedIntents: state.detectedIntents.map(intent => ({
      name: intent.name,
      priority: intent.priority,
      confidence: intent.confidence,
      firstDetectedAt: intent.firstDetectedAt,
      lastDetectedAt: intent.lastDetectedAt,
      matchedPatterns: intent.matchedPatterns
    })),
    primaryIntent: state.primaryIntent ? {
      name: state.primaryIntent.name,
      priority: state.primaryIntent.priority,
      confidence: state.primaryIntent.confidence
    } : null,
    intentLog: state.intentLog
  };
}

/**
 * Clear intent data for a call
 * @param {string} callSid - The Twilio call SID
 */
function clearIntentData(callSid) {
  if (intentStates[callSid]) {
    console.log(`Clearing intent data for call ${callSid}`);
    delete intentStates[callSid];
  }
}

export {
  initializeIntentDetection,
  processTranscript,
  updatePrimaryIntent,
  getIntentInstructions,
  hasSchedulingIntent,
  hasNegativeIntent,
  getIntentData,
  clearIntentData
}; 