/**
 * Twilio Webhook Validation Utility
 * 
 * This module provides middleware functions to validate incoming Twilio webhook requests
 * using Twilio's validation library.
 */

import * as twilio from 'twilio';

// Import validateRequest directly to ensure proper mocking in tests
const { validateRequest } = twilio;

/**
 * Returns a middleware function that validates Twilio webhook requests
 * @param {Object} options - Configuration options
 * @param {boolean} options.enforce - Whether to enforce validation in production (defaults to true)
 * @returns {Function} Middleware function for validating Twilio requests
 */
export function getTwilioWebhookValidationMiddleware(options = {}) {
  const { enforce = true } = options;
  
  // Get environment variables
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const isProduction = process.env.NODE_ENV === 'production';
  
  return (request, reply, done) => {
    // Skip validation in test environments unless explicitly enforced
    if (!isProduction && !enforce) {
      return done();
    }
    
    try {
      // Access raw request object from Fastify
      const req = request.raw;
      
      // Check if the request is authentic
      if (!validateRequest(
        authToken,
        req.headers['x-twilio-signature'],
        `https://${req.headers.host}${req.url}`,
        req.body
      )) {
        console.error('Invalid Twilio webhook signature');
        return reply.code(403).send({ error: 'Invalid Twilio webhook signature' });
      }
      
      done();
    } catch (error) {
      console.error('Error validating Twilio webhook:', error);
      return reply.code(403).send({ error: 'Invalid Twilio webhook request' });
    }
  };
}

/**
 * Register Twilio webhook validation middleware for specified routes
 * @param {Object} fastify - Fastify instance
 * @param {Array<string>} routes - Array of route paths to protect
 * @param {Object} options - Configuration options
 */
export function registerTwilioWebhookValidation(fastify, routes, options = {}) {
  const middleware = getTwilioWebhookValidationMiddleware(options);
  
  // Register the validation middleware for each route
  for (const route of routes) {
    // The issue is here - Fastify expects a function for the preHandler hook
    // Instead of passing configuration object with url and method,
    // register the hook directly on the specific routes
    fastify.addHook('preHandler', function(request, reply, done) {
      // Only apply this middleware to the specific route
      if (request.routerPath === route && request.method === 'POST') {
        return middleware(request, reply, done);
      }
      done();
    });
  }
}

export default {
  getTwilioWebhookValidationMiddleware,
  registerTwilioWebhookValidation
}; 