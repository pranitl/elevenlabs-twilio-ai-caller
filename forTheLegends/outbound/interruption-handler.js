// interruption-handler.js
// Handles detection and response to call interruptions and rescheduling requests

// Phrases that indicate a user may need to reschedule
const RESCHEDULE_PHRASES = [
  'call back',
  'call me back',
  'call later',
  'not a good time',
  'busy right now',
  'in a meeting',
  'driving',
  'can\'t talk',
  'bad time',
  'another time',
  'tomorrow',
  'next week',
  'later today',
  'later on',
  'in the afternoon',
  'in the morning',
  'schedule',
  'reschedule'
];

// Phrases that indicate an interruption
const INTERRUPTION_PHRASES = [
  'hold on',
  'just a minute',
  'just a moment',
  'one moment',
  'one second',
  'hold please',
  'excuse me',
  'wait a moment',
  'wait a second',
  'give me a second',
  'someone\'s at the door',
  'someone\'s calling',
  'need to answer',
  'doorbell',
  'phone\'s ringing'
];

// Store interruption state by call SID
const interruptionStates = {};

/**
 * Initialize interruption detection for a call
 * @param {string} callSid - The Twilio call SID
 * @returns {Object} The initialized interruption state
 */
function initializeInterruptionDetection(callSid) {
  console.log(`Initializing interruption detection for call ${callSid}`);
  
  interruptionStates[callSid] = {
    // Detected interruptions count
    interruptionCount: 0,
    // Detected rescheduling requests count
    rescheduleCount: 0,
    // Whether we've paused due to interruption
    hasActivePause: false,
    // Whether we've detected a reschedule request
    rescheduleDetected: false,
    // Extracted time information for rescheduling
    preferredCallbackTime: null,
    // Log of interruptions
    interruptionLog: [],
    // Whether instructions have been sent
    interruptionInstructionsSent: false,
    rescheduleInstructionsSent: false
  };
  
  return interruptionStates[callSid];
}

/**
 * Process transcript to detect interruptions and rescheduling requests
 * @param {string} callSid - The Twilio call SID
 * @param {string} transcript - The call transcript
 * @returns {Object} Analysis result with detected issues
 */
function processTranscript(callSid, transcript) {
  if (!interruptionStates[callSid]) {
    initializeInterruptionDetection(callSid);
  }
  
  const state = interruptionStates[callSid];
  const now = Date.now();
  
  // Normalize transcript for easier matching
  const normalizedTranscript = transcript.toLowerCase().trim();
  
  // Check for rescheduling phrases
  const hasReschedulePhrase = RESCHEDULE_PHRASES.some(phrase => 
    normalizedTranscript.includes(phrase.toLowerCase())
  );
  
  // Check for interruption phrases
  const hasInterruptionPhrase = INTERRUPTION_PHRASES.some(phrase => 
    normalizedTranscript.includes(phrase.toLowerCase())
  );
  
  let rescheduleDetected = false;
  let interruptionDetected = false;
  let timeInfo = null;
  
  // Process rescheduling request
  if (hasReschedulePhrase && !state.rescheduleDetected) {
    rescheduleDetected = true;
    state.rescheduleDetected = true;
    state.rescheduleCount++;
    
    // Extract time information if available
    timeInfo = extractTimeInfo(normalizedTranscript);
    if (timeInfo) {
      state.preferredCallbackTime = timeInfo;
    }
    
    state.interruptionLog.push({
      type: 'reschedule_request',
      timestamp: now,
      transcript: normalizedTranscript,
      extractedTime: timeInfo
    });
    
    console.log(`Detected reschedule request in call ${callSid}: "${normalizedTranscript}"`);
  }
  
  // Process interruption
  if (hasInterruptionPhrase && !state.hasActivePause) {
    interruptionDetected = true;
    state.hasActivePause = true;
    state.interruptionCount++;
    
    state.interruptionLog.push({
      type: 'interruption',
      timestamp: now,
      transcript: normalizedTranscript
    });
    
    console.log(`Detected interruption in call ${callSid}: "${normalizedTranscript}"`);
  }
  
  // Check if a previous interruption seems to be resolved
  // (This is simplistic - in a real system, you'd have more sophisticated detection)
  if (state.hasActivePause && normalizedTranscript.length > 20 && 
      !hasInterruptionPhrase && !hasReschedulePhrase) {
    state.hasActivePause = false;
    
    state.interruptionLog.push({
      type: 'interruption_resolved',
      timestamp: now
    });
    
    console.log(`Interruption appears resolved in call ${callSid}`);
  }
  
  return {
    callSid,
    timestamp: now,
    rescheduleDetected,
    interruptionDetected,
    hasActivePause: state.hasActivePause,
    interruptionCount: state.interruptionCount,
    rescheduleCount: state.rescheduleCount,
    preferredCallbackTime: timeInfo || state.preferredCallbackTime
  };
}

/**
 * Extract time-related information from transcript for rescheduling
 * @param {string} transcript - The call transcript
 * @returns {Object|null} Extracted time information or null
 */
function extractTimeInfo(transcript) {
  // This is a simplified approach - in a real system, you'd use NLP
  // to better extract time entities and information
  
  // Look for specific time formats (e.g., "3pm", "10:30")
  const specificTimeRegex = /(\d{1,2})(:\d{2})?\s*(am|pm)/i;
  const specificTimeMatch = transcript.match(specificTimeRegex);
  
  if (specificTimeMatch) {
    return {
      type: 'specific_time',
      value: specificTimeMatch[0],
      hour: parseInt(specificTimeMatch[1]),
      minute: specificTimeMatch[2] ? parseInt(specificTimeMatch[2].substring(1)) : 0,
      period: specificTimeMatch[3].toLowerCase()
    };
  }
  
  // Look for relative time (e.g., "tomorrow", "next week")
  const relativeTimeMap = {
    'tomorrow': { type: 'day', offset: 1 },
    'tonight': { type: 'period', value: 'evening', day: 0 },
    'this afternoon': { type: 'period', value: 'afternoon', day: 0 },
    'this evening': { type: 'period', value: 'evening', day: 0 },
    'morning': { type: 'period', value: 'morning', day: 0 },
    'afternoon': { type: 'period', value: 'afternoon', day: 0 },
    'evening': { type: 'period', value: 'evening', day: 0 },
    'next week': { type: 'week', offset: 1 },
    'next monday': { type: 'weekday', value: 1 },
    'next tuesday': { type: 'weekday', value: 2 },
    'next wednesday': { type: 'weekday', value: 3 },
    'next thursday': { type: 'weekday', value: 4 },
    'next friday': { type: 'weekday', value: 5 },
    'monday': { type: 'weekday', value: 1 },
    'tuesday': { type: 'weekday', value: 2 },
    'wednesday': { type: 'weekday', value: 3 },
    'thursday': { type: 'weekday', value: 4 },
    'friday': { type: 'weekday', value: 5 }
  };
  
  for (const [phrase, timeInfo] of Object.entries(relativeTimeMap)) {
    if (transcript.toLowerCase().includes(phrase)) {
      return {
        type: timeInfo.type,
        value: phrase,
        ...timeInfo
      };
    }
  }
  
  return null;
}

/**
 * Get instructions for the AI agent based on detected interruptions
 * @param {string} callSid - The Twilio call SID
 * @param {Object} detectionResult - The interruption detection result
 * @returns {string|null} Instructions for the AI agent, or null if no instructions needed
 */
function getInterruptionInstructions(callSid, detectionResult) {
  if (!interruptionStates[callSid]) {
    return null;
  }
  
  const state = interruptionStates[callSid];
  
  // Handle reschedule request
  if (detectionResult.rescheduleDetected && !state.rescheduleInstructionsSent) {
    state.rescheduleInstructionsSent = true;
    
    let timeContext = '';
    if (state.preferredCallbackTime) {
      if (state.preferredCallbackTime.type === 'specific_time') {
        timeContext = ` for ${state.preferredCallbackTime.value}`;
      } else if (state.preferredCallbackTime.type === 'period') {
        timeContext = ` ${state.preferredCallbackTime.value === 'evening' ? 'this evening' : 
                         state.preferredCallbackTime.value === 'afternoon' ? 'this afternoon' : 
                         'tomorrow morning'}`;
      } else if (state.preferredCallbackTime.type === 'weekday') {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        timeContext = ` on ${days[state.preferredCallbackTime.value]}`;
      }
    }
    
    const instructions = `I understand this isn't a good time to talk. I'd be happy to reschedule${timeContext}. Would that work for you?`;
    
    state.interruptionLog.push({
      type: 'reschedule_instructions_sent',
      timestamp: Date.now(),
      instructions
    });
    
    return instructions;
  }
  
  // Handle active interruption
  if (detectionResult.interruptionDetected && !state.interruptionInstructionsSent) {
    state.interruptionInstructionsSent = true;
    
    const instructions = "I understand you need a moment. Take your time, I'll wait.";
    
    state.interruptionLog.push({
      type: 'interruption_instructions_sent',
      timestamp: Date.now(),
      instructions
    });
    
    return instructions;
  }
  
  // Handle resolved interruption
  if (state.interruptionInstructionsSent && !state.hasActivePause) {
    state.interruptionInstructionsSent = false;
    
    const instructions = "Thanks for coming back. Should we continue where we left off?";
    
    state.interruptionLog.push({
      type: 'interruption_resolved_instructions_sent',
      timestamp: Date.now(),
      instructions
    });
    
    return instructions;
  }
  
  return null;
}

/**
 * Get interruption data for reporting
 * @param {string} callSid - The Twilio call SID
 * @returns {Object|null} Interruption data for the call
 */
function getInterruptionData(callSid) {
  if (!interruptionStates[callSid]) {
    return null;
  }
  
  const state = interruptionStates[callSid];
  
  return {
    interruptionCount: state.interruptionCount,
    rescheduleCount: state.rescheduleCount,
    rescheduleDetected: state.rescheduleDetected,
    preferredCallbackTime: state.preferredCallbackTime,
    interruptionLog: state.interruptionLog
  };
}

/**
 * Clear interruption data for a call
 * @param {string} callSid - The Twilio call SID
 */
function clearInterruptionData(callSid) {
  if (interruptionStates[callSid]) {
    console.log(`Clearing interruption data for call ${callSid}`);
    delete interruptionStates[callSid];
  }
}

export {
  initializeInterruptionDetection,
  processTranscript,
  extractTimeInfo,
  getInterruptionInstructions,
  getInterruptionData,
  clearInterruptionData
}; 