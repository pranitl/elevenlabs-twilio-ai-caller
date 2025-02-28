/**
 * Call State Management
 * 
 * This module tracks the state of all active calls in the system.
 */

// Store call statuses in memory
export const callStatuses = {};

/**
 * Get call data for a specific call
 * 
 * @param {string} callSid - The Twilio call SID
 * @returns {Object} Call data or empty object if not found
 */
export const getCallData = (callSid) => {
  return callStatuses[callSid] || {};
};

/**
 * Update call data for a specific call
 * 
 * @param {string} callSid - The Twilio call SID
 * @param {Object} data - New data to merge with existing call data
 * @returns {Object} Updated call data
 */
export const updateCallData = (callSid, data) => {
  callStatuses[callSid] = { ...(callStatuses[callSid] || {}), ...data };
  return callStatuses[callSid];
};

/**
 * Setup call tracking for a new call
 * 
 * @returns {Object} Call tracking utilities
 */
export const setupCallTracking = () => {
  return {
    getCallData,
    updateCallData,
    callStatuses
  };
};

/**
 * Clear all call data
 */
export const clearAllCallData = () => {
  Object.keys(callStatuses).forEach(key => delete callStatuses[key]);
}; 