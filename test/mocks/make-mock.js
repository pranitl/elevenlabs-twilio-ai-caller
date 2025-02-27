/**
 * Enhanced make.com webhook mock implementation for testing
 * Tracks webhook calls and provides utilities for simulating make.com interactions
 */

// Store webhook requests for later inspection in tests
const webhookStore = {
  sent: [],
  callbacks: [],
  callbackData: []
};

// Mock axios for webhook calls
const mockAxios = {
  post: async (url, data) => {
    console.log(`[MockMake] Received webhook POST to: ${url}`);
    
    // Store the request data for later inspection in tests
    webhookStore.sent.push({
      url,
      data,
      timestamp: new Date().toISOString(),
      method: 'POST'
    });
    
    // If there are registered callbacks, trigger them
    if (webhookStore.callbacks.length > 0) {
      webhookStore.callbacks.forEach(callback => callback(url, data, 'POST'));
    }
    
    // Return a successful response
    return {
      status: 200,
      statusText: 'OK',
      data: {
        success: true,
        timestamp: new Date().toISOString()
      }
    };
  },
  
  get: async (url) => {
    console.log(`[MockMake] Received webhook GET to: ${url}`);
    
    // Store the request for later inspection
    webhookStore.sent.push({
      url,
      timestamp: new Date().toISOString(),
      method: 'GET'
    });
    
    // If there are registered callbacks, trigger them
    if (webhookStore.callbacks.length > 0) {
      webhookStore.callbacks.forEach(callback => callback(url, null, 'GET'));
    }
    
    // Return data from the queue or a default response
    return {
      status: 200,
      statusText: 'OK',
      data: webhookStore.callbackData.length > 0 
        ? webhookStore.callbackData.shift() 
        : { success: true }
    };
  },
  
  put: async (url, data) => {
    console.log(`[MockMake] Received webhook PUT to: ${url}`);
    
    // Store the request data for later inspection
    webhookStore.sent.push({
      url,
      data,
      timestamp: new Date().toISOString(),
      method: 'PUT'
    });
    
    // If there are registered callbacks, trigger them
    if (webhookStore.callbacks.length > 0) {
      webhookStore.callbacks.forEach(callback => callback(url, data, 'PUT'));
    }
    
    // Return a successful response
    return {
      status: 200,
      statusText: 'OK',
      data: {
        success: true,
        timestamp: new Date().toISOString()
      }
    };
  }
};

/**
 * Register a callback to be triggered when a webhook is received
 * @param {Function} callback - Function to call with (url, data, method) when webhook is received
 */
function onWebhookReceived(callback) {
  if (typeof callback === 'function') {
    webhookStore.callbacks.push(callback);
  }
}

/**
 * Clear all stored webhook data
 */
function clearWebhookStore() {
  webhookStore.sent = [];
  webhookStore.callbacks = [];
  webhookStore.callbackData = [];
}

/**
 * Queue mock data to be returned by the next GET request
 * @param {Object} data - Data to return from the next GET request
 */
function queueCallbackData(data) {
  webhookStore.callbackData.push(data);
}

/**
 * Find webhook calls matching specific criteria
 * @param {Object} criteria - Object with properties to match in the webhook data
 * @returns {Array} Array of matching webhook calls
 */
function findWebhookCalls(criteria) {
  return webhookStore.sent.filter(call => {
    // Check all criteria properties
    for (const key in criteria) {
      // Special case for data fields (to allow partial matching of objects)
      if (key === 'data' && typeof criteria.data === 'object') {
        for (const dataKey in criteria.data) {
          if (call.data?.[dataKey] !== criteria.data[dataKey]) {
            return false;
          }
        }
      } 
      // URL partial matching
      else if (key === 'url' && typeof criteria.url === 'string') {
        if (!call.url.includes(criteria.url)) {
          return false;
        }
      }
      // Exact matching for other fields
      else if (call[key] !== criteria[key]) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Simulate an incoming webhook from make.com to a route handler
 * @param {Object} routeHandler - The route handler function
 * @param {Object} data - The data to send to the handler
 * @param {Object} options - Additional options (headers, etc)
 * @returns {Promise<Object>} The response from the handler
 */
function simulateIncomingWebhook(routeHandler, data, options = {}) {
  // Create mock request and reply objects
  const mockRequest = {
    body: data,
    headers: {
      'content-type': 'application/json',
      'host': 'localhost',
      ...(options.headers || {})
    },
    query: options.query || {}
  };
  
  const mockReply = {
    code: (statusCode) => {
      mockReply.statusCode = statusCode;
      return mockReply;
    },
    send: (response) => {
      mockReply.sent = true;
      mockReply.response = response;
      return mockReply;
    },
    type: (contentType) => {
      mockReply.contentType = contentType;
      return mockReply;
    }
  };
  
  // Call the route handler
  return routeHandler(mockRequest, mockReply);
}

// Export the mock and utilities
export {
  mockAxios,
  webhookStore,
  onWebhookReceived,
  clearWebhookStore,
  queueCallbackData,
  findWebhookCalls,
  simulateIncomingWebhook
}; 