// call-quality-monitor.js
// Handles detection and response to call quality issues and technical difficulties

// Configuration for quality monitoring
const QUALITY_CONFIG = {
  silenceThresholdMs: 5000,          // 5 seconds of silence is concerning
  extendedSilenceThresholdMs: 12000, // 12 seconds of silence triggers follow-up
  lowAudioThreshold: 100,            // Threshold for detecting low audio quality
  qualityCheckIntervalMs: 10000,     // Check quality every 10 seconds
  minSilenceRuns: 2                  // Number of silence runs before taking action
};

// Store quality metrics by call SID
const qualityMetrics = {};

/**
 * Initialize quality monitoring for a call
 * @param {string} callSid - The Twilio call SID
 * @param {Object} config - Optional custom configuration
 * @returns {Object} The initialized quality metrics object
 */
function initializeQualityMonitoring(callSid, config = {}) {
  console.log(`Initializing quality monitoring for call ${callSid}`);
  
  // Merge default config with any provided custom config
  const mergedConfig = { ...QUALITY_CONFIG, ...config };
  
  qualityMetrics[callSid] = {
    // Configuration
    config: mergedConfig,
    // Call start time
    callStartTime: Date.now(),
    // Last time audio was detected
    lastAudioTime: Date.now(),
    // Whether silence is currently detected
    silenceDetected: false,
    // Count of silence incidents
    silenceRunCount: 0,
    // Total duration of silence (ms)
    totalSilenceDurationMs: 0,
    // Whether low audio is detected
    lowAudioDetected: false,
    // Count of low audio incidents
    lowAudioRunCount: 0,
    // Whether instructions were sent
    silenceInstructionsSent: false,
    extendedSilenceInstructionsSent: false,
    lowAudioInstructionsSent: false,
    // Log of quality issues
    qualityLog: []
  };
  
  return qualityMetrics[callSid];
}

/**
 * Process audio data to detect quality issues
 * @param {string} callSid - The Twilio call SID
 * @param {string} audioData - Base64 encoded audio data
 * @returns {Object} Analysis result with detected issues
 */
function processAudioQuality(callSid, audioData) {
  if (!qualityMetrics[callSid]) {
    initializeQualityMonitoring(callSid);
  }
  
  const metrics = qualityMetrics[callSid];
  const now = Date.now();
  
  // Decode base64 audio to check for silence/low audio
  // This is a simple implementation - in a real system you'd use proper audio analysis
  let audioLevel = 0;
  try {
    // Simple approach - check the length of the audio data as a rough proxy for audio level
    // In a real system, you'd analyze actual audio levels
    audioLevel = audioData.length;
  } catch (error) {
    console.error(`Error analyzing audio data for call ${callSid}:`, error);
  }
  
  // Check for silence
  const isSilent = audioLevel < 10; // Very simplistic - would be more sophisticated in production
  
  // Check for low audio
  const isLowAudio = audioLevel > 10 && audioLevel < metrics.config.lowAudioThreshold;
  
  // Update metrics based on audio analysis
  if (!isSilent) {
    // If we have audio, update the last audio time
    metrics.lastAudioTime = now;
    
    // If we were in a silence period, log it and reset
    if (metrics.silenceDetected) {
      const silenceDuration = now - metrics.lastAudioTime;
      metrics.totalSilenceDurationMs += silenceDuration;
      metrics.qualityLog.push({
        type: 'silence_ended',
        timestamp: now,
        durationMs: silenceDuration
      });
      metrics.silenceDetected = false;
    }
  } else if (!metrics.silenceDetected) {
    // Starting a new silence period
    metrics.silenceDetected = true;
    metrics.silenceRunCount += 1;
    metrics.qualityLog.push({
      type: 'silence_started',
      timestamp: now
    });
  }
  
  // Update low audio metrics
  if (isLowAudio && !metrics.lowAudioDetected) {
    metrics.lowAudioDetected = true;
    metrics.lowAudioRunCount += 1;
    metrics.qualityLog.push({
      type: 'low_audio_started',
      timestamp: now,
      audioLevel
    });
  } else if (!isLowAudio && metrics.lowAudioDetected) {
    metrics.lowAudioDetected = false;
    metrics.qualityLog.push({
      type: 'low_audio_ended',
      timestamp: now
    });
  }
  
  // Assess overall quality
  const qualityAssessment = assessAudioQuality(callSid);
  
  return {
    callSid,
    timestamp: now,
    audioLevel,
    isSilent,
    isLowAudio,
    silenceDetected: metrics.silenceDetected,
    silenceRunCount: metrics.silenceRunCount,
    lowAudioDetected: metrics.lowAudioDetected,
    lowAudioRunCount: metrics.lowAudioRunCount,
    hasQualityIssue: qualityAssessment.hasQualityIssue,
    issueType: qualityAssessment.issueType,
    issueSeverity: qualityAssessment.issueSeverity
  };
}

/**
 * Assess audio quality based on current metrics
 * @param {string} callSid - The Twilio call SID
 * @returns {Object} Quality assessment result
 */
function assessAudioQuality(callSid) {
  if (!qualityMetrics[callSid]) {
    return { hasQualityIssue: false };
  }
  
  const metrics = qualityMetrics[callSid];
  const now = Date.now();
  
  // Check for extended silence
  let extendedSilenceDetected = false;
  let silenceDetected = false;
  
  if (metrics.silenceDetected) {
    const currentSilenceDuration = now - metrics.lastAudioTime;
    
    if (currentSilenceDuration > metrics.config.extendedSilenceThresholdMs && metrics.silenceRunCount >= metrics.config.minSilenceRuns) {
      extendedSilenceDetected = true;
    } else if (currentSilenceDuration > metrics.config.silenceThresholdMs && metrics.silenceRunCount >= metrics.config.minSilenceRuns) {
      silenceDetected = true;
    }
  }
  
  // Determine issue type and severity
  let hasQualityIssue = false;
  let issueType = null;
  let issueSeverity = 'none';
  
  if (extendedSilenceDetected) {
    hasQualityIssue = true;
    issueType = 'extended_silence';
    issueSeverity = 'high';
  } else if (silenceDetected) {
    hasQualityIssue = true;
    issueType = 'silence';
    issueSeverity = 'medium';
  } else if (metrics.lowAudioDetected && metrics.lowAudioRunCount >= 3) {
    hasQualityIssue = true;
    issueType = 'persistent_low_audio';
    issueSeverity = 'medium';
  } else if (metrics.lowAudioDetected) {
    hasQualityIssue = true;
    issueType = 'low_audio';
    issueSeverity = 'low';
  }
  
  // Log the assessment if there's an issue
  if (hasQualityIssue && !metrics.qualityLog.some(log => log.type === issueType && now - log.timestamp < 30000)) {
    metrics.qualityLog.push({
      type: issueType,
      timestamp: now,
      severity: issueSeverity
    });
  }
  
  return {
    hasQualityIssue,
    issueType,
    issueSeverity
  };
}

/**
 * Get instructions for the AI agent based on detected quality issues
 * @param {string} callSid - The Twilio call SID
 * @returns {string|null} Instructions for the AI agent, or null if no instructions needed
 */
function getQualityInstructions(callSid) {
  if (!qualityMetrics[callSid]) {
    return null;
  }
  
  const metrics = qualityMetrics[callSid];
  const assessment = assessAudioQuality(callSid);
  
  if (!assessment.hasQualityIssue) {
    return null;
  }
  
  let instructions = null;
  
  switch (assessment.issueType) {
    case 'extended_silence':
      if (!metrics.extendedSilenceInstructionsSent) {
        instructions = "I notice there's been no response for some time. If you're still there, please let me know. Otherwise, I'll call back at a better time. Would you like me to call back later?";
        metrics.extendedSilenceInstructionsSent = true;
        metrics.silenceInstructionsSent = true; // Also mark regular silence as sent
        
        metrics.qualityLog.push({
          type: 'extended_silence_instructions_sent',
          timestamp: Date.now(),
          instructions
        });
      }
      break;
      
    case 'silence':
      if (!metrics.silenceInstructionsSent) {
        instructions = "I'm having trouble hearing you. If you're speaking, your audio might not be coming through clearly. Can you please speak a bit louder?";
        metrics.silenceInstructionsSent = true;
        
        metrics.qualityLog.push({
          type: 'silence_instructions_sent',
          timestamp: Date.now(),
          instructions
        });
      }
      break;
      
    case 'persistent_low_audio':
    case 'low_audio':
      if (!metrics.lowAudioInstructionsSent) {
        instructions = "I'm having a little trouble hearing you clearly. Could you please speak a bit louder or move to a quieter location if possible?";
        metrics.lowAudioInstructionsSent = true;
        
        metrics.qualityLog.push({
          type: 'low_audio_instructions_sent',
          timestamp: Date.now(),
          instructions
        });
      }
      break;
  }
  
  return instructions;
}

/**
 * Get quality metrics for a call (for reporting)
 * @param {string} callSid - The Twilio call SID
 * @returns {Object|null} Quality metrics for the call
 */
function getQualityMetrics(callSid) {
  if (!qualityMetrics[callSid]) {
    return null;
  }
  
  const metrics = qualityMetrics[callSid];
  
  return {
    callDurationMs: Date.now() - metrics.callStartTime,
    silenceRunCount: metrics.silenceRunCount,
    totalSilenceDurationMs: metrics.totalSilenceDurationMs,
    lowAudioRunCount: metrics.lowAudioRunCount,
    qualityIssuesDetected: metrics.qualityLog.length > 0,
    qualityLog: metrics.qualityLog
  };
}

/**
 * Clear quality metrics for a call
 * @param {string} callSid - The Twilio call SID
 */
function clearQualityMetrics(callSid) {
  if (qualityMetrics[callSid]) {
    console.log(`Clearing quality metrics for call ${callSid}`);
    delete qualityMetrics[callSid];
  }
}

export {
  initializeQualityMonitoring,
  processAudioQuality,
  assessAudioQuality,
  getQualityInstructions,
  getQualityMetrics,
  clearQualityMetrics
}; 