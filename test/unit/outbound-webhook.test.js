// test/unit/outbound-webhook.test.js
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../setup.js';
import { setupEnvironmentVariables } from '../common-setup.js';

// We need to mock axios before importing any module that uses it
jest.mock('axios');

// Import axios so we can access the mock
import axios from 'axios';

// Import modules to be tested AFTER mocking dependencies
import {
  sendElevenLabsConversationData,
  shouldSendWebhook,
  fetchElevenLabsData,
  prepareWebhookPayload,
  configureWebhook
} from '../../forTheLegends/outbound/outbound-webhook.js';

// Mock webhook-enhancer
jest.mock('../../forTheLegends/outbound/webhook-enhancer.js', () => ({
  enhanceWebhookPayload: jest.fn((callSid, leadId, payload) => {
    return {
      ...payload,
      enhanced: true,
      enhanced_at: new Date().toISOString()
    };
  }),
  sendEnhancedWebhook: jest.fn().mockResolvedValue({ success: true })
}));

// Set a global Jest timeout for all tests
jest.setTimeout(15000);

// Setup environment variables
setupEnvironmentVariables();

describe('Outbound Webhook Module', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Set up environment variables
    process.env.ELEVENLABS_API_KEY = 'test-api-key';
    process.env.MAKE_WEBHOOK_URL = 'https://test-webhook-url.com';
    
    // Create spy implementations for axios
    axios.get = jest.fn().mockImplementation((url) => {
      console.log(`[Test] Mocked axios.get call to: ${url}`);
      
      if (url.includes('/transcript')) {
        return Promise.resolve({
          data: {
            conversation_id: 'test-conv-id',
            transcripts: [
              { speaker: 'agent', text: 'Hello, how can I help you?' },
              { speaker: 'user', text: 'I need assistance with my account.' }
            ]
          }
        });
      } else if (url.includes('/summary')) {
        return Promise.resolve({
          data: {
            conversation_id: 'test-conv-id',
            summary: 'This is a test summary',
            success_criteria: [
              { title: "handled_inquiry", result: true, confidence: 0.92 }
            ],
            data_collection: [
              { title: "call_type", value: "support_issue", confidence: 0.85 }
            ]
          }
        });
      }
      
      return Promise.reject(new Error(`Unknown URL: ${url}`));
    });
    
    axios.post = jest.fn().mockImplementation((url, data) => {
      console.log(`[Test] Mocked axios.post call to: ${url}`);
      console.log(`[Test] With data:`, JSON.stringify(data).substring(0, 100) + '...');
      return Promise.resolve({ status: 200, data: { success: true } });
    });
    
    // Set up global call statuses
    global.callStatuses = {
      'test-call-sid': {
        conversationId: 'test-conv-id',
        salesTeamUnavailable: true,
        leadInfo: { LeadId: 'test-lead-id', LeadName: 'Test Lead' },
        transcripts: [
          { speaker: 'ai', text: 'Hello, how can I help you?' },
          { speaker: 'user', text: 'I need assistance with my account.' }
        ]
      },
      'sales-handled-call': {
        conversationId: 'sales-conv-id',
        salesTeamUnavailable: false,
        transferComplete: true,
        leadInfo: { LeadId: 'sales-lead-id', LeadName: 'Sales Lead' }
      },
      'voicemail-call': {
        conversationId: 'voicemail-conv-id', 
        isVoicemail: true,
        leadInfo: { LeadId: 'voicemail-lead-id', LeadName: 'Voicemail Lead' }
      }
    };

    // Reset the webhook configuration for each test
    configureWebhook({
      url: 'https://test-webhook-url.com',
      retryAttempts: 1, // Set to 1 to speed up tests
      retryDelayMs: 10, // Set low for tests
      timeoutMs: 1000,  // Set low for tests
      enabled: true
    });
    
    // Debug the state of the mocks
    console.log('[Test Setup] axios.get is a mock:', jest.isMockFunction(axios.get));
    console.log('[Test Setup] axios.post is a mock:', jest.isMockFunction(axios.post));
  });
  
  afterEach(() => {
    // Clean up
    delete global.callStatuses;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.MAKE_WEBHOOK_URL;
  });
  
  describe('shouldSendWebhook', () => {
    it('should return true for calls where sales team was unavailable', () => {
      const result = shouldSendWebhook('test-call-sid', global.callStatuses);
      expect(result).toBe(true);
    });
    
    it('should return true for voicemail calls', () => {
      const result = shouldSendWebhook('voicemail-call', global.callStatuses);
      expect(result).toBe(true);
    });
    
    it('should return false for calls fully handled by sales team', () => {
      const result = shouldSendWebhook('sales-handled-call', global.callStatuses);
      expect(result).toBe(false);
    });
    
    it('should return false for non-existent call SIDs', () => {
      const result = shouldSendWebhook('non-existent', global.callStatuses);
      expect(result).toBe(false);
    });
  });
  
  describe('fetchElevenLabsData', () => {
    it('should fetch transcript and summary data from ElevenLabs API', async () => {
      // Set up specific implementation for this test
      axios.get.mockImplementation((url, config) => {
        console.log(`[Test] Called axios.get with URL: ${url}`);
        console.log(`[Test] Headers:`, config?.headers);
        
        if (url.includes('/transcript')) {
          return Promise.resolve({
            data: {
              conversation_id: 'test-conv-id',
              transcripts: [
                { speaker: 'agent', text: 'Hello, how can I help you?' },
                { speaker: 'user', text: 'I need assistance with my account.' }
              ]
            }
          });
        } else if (url.includes('/summary')) {
          return Promise.resolve({
            data: {
              conversation_id: 'test-conv-id',
              summary: 'This is a test summary',
              success_criteria: [
                { title: "handled_inquiry", result: true, confidence: 0.92 }
              ],
              data_collection: [
                { title: "call_type", value: "support_issue", confidence: 0.85 }
              ]
            }
          });
        }
        
        return Promise.reject(new Error(`Unknown URL: ${url}`));
      });
      
      // Call the function
      const result = await fetchElevenLabsData('test-conv-id');
      
      // Debug output
      console.log('[Test] fetchElevenLabsData result:', result);
      console.log('[Test] axios.get call count:', axios.get.mock.calls.length);
      console.log('[Test] axios.get call URLs:', axios.get.mock.calls.map(call => call[0]));
      
      // Verify the correct API calls were made
      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(axios.get).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/convai/conversation/test-conv-id/transcript',
        expect.any(Object)
      );
      expect(axios.get).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/convai/conversation/test-conv-id/summary',
        expect.any(Object)
      );
      
      // Verify the result data
      expect(result.transcriptData).toBeDefined();
      expect(result.summaryData).toBeDefined();
    });
    
    it('should handle transcript fetch failure gracefully', async () => {
      axios.get.mockImplementationOnce(() => Promise.reject(new Error('API error')));
      
      const result = await fetchElevenLabsData('test-conv-id');
      
      expect(result.transcriptData).toBeNull();
      expect(result.summaryData).toBeDefined();
    });
    
    it('should handle summary fetch failure gracefully', async () => {
      axios.get.mockImplementationOnce((url) => {
        if (url.includes('/transcript')) {
          return Promise.resolve({
            data: {
              conversation_id: 'test-conv-id',
              transcripts: [{ speaker: 'agent', text: 'Hello' }]
            }
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });
      
      axios.get.mockImplementationOnce(() => Promise.reject(new Error('API error')));
      
      const result = await fetchElevenLabsData('test-conv-id');
      
      expect(result.transcriptData).toBeDefined();
      expect(result.summaryData).toBeNull();
    });
    
    it('should throw an error if API key is not configured', async () => {
      delete process.env.ELEVENLABS_API_KEY;
      
      await expect(fetchElevenLabsData('test-conv-id')).rejects.toThrow('ELEVENLABS_API_KEY is required');
    });
  });
  
  describe('prepareWebhookPayload', () => {
    it('should create a proper payload with all available data', () => {
      const callStatus = global.callStatuses['test-call-sid'];
      const transcriptData = {
        conversation_id: 'test-conv-id',
        transcripts: [
          { speaker: 'agent', text: 'Hello' },
          { speaker: 'user', text: 'Hi' }
        ]
      };
      const summaryData = {
        conversation_id: 'test-conv-id',
        summary: 'Test summary',
        success_criteria: [
          { title: "handled_inquiry", result: true, confidence: 0.92 }
        ],
        data_collection: [
          { title: "call_type", value: "support_issue", confidence: 0.85 }
        ]
      };
      
      const payload = prepareWebhookPayload(
        'test-call-sid',
        'test-conv-id',
        callStatus,
        transcriptData,
        summaryData
      );
      
      expect(payload.call_sid).toBe('test-call-sid');
      expect(payload.conversation_id).toBe('test-conv-id');
      expect(payload.transcript).toBeDefined();
      expect(payload.summary).toBeDefined();
      expect(payload.success_criteria).toBeDefined();
      expect(payload.data_collection).toBeDefined();
      expect(payload.lead_info).toBeDefined();
    });
    
    it('should use stored transcripts if ElevenLabs data is not available', () => {
      const callStatus = global.callStatuses['test-call-sid'];
      
      const payload = prepareWebhookPayload(
        'test-call-sid',
        'test-conv-id',
        callStatus,
        null,
        null
      );
      
      expect(payload.transcript).toBeDefined();
      expect(payload.transcript.transcripts).toEqual(callStatus.transcripts);
    });
    
    it('should include callback preferences if they exist', () => {
      const callStatus = {...global.callStatuses['test-call-sid']};
      callStatus.callbackPreferences = {
        hasTimeReference: true,
        detectedDays: ['monday'],
        detectedTimes: ['2pm'],
        detectedPeriods: ['afternoon']
      };
      
      const payload = prepareWebhookPayload(
        'test-call-sid',
        'test-conv-id',
        callStatus,
        null,
        null
      );
      
      expect(payload.callbackPreferences).toBeDefined();
      expect(payload.callbackPreferences.hasTimeReference).toBe(true);
    });
  });
  
  describe('sendElevenLabsConversationData', () => {
    it('should send data for eligible calls', async () => {
      // Create a fresh implementation for this test
      axios.get.mockImplementation((url) => {
        console.log(`[Test] Called axios.get with URL: ${url}`);
        
        if (url.includes('/transcript')) {
          return Promise.resolve({
            data: {
              conversation_id: 'test-conv-id',
              transcripts: [{ speaker: 'agent', text: 'Hello' }]
            }
          });
        } 
        if (url.includes('/summary')) {
          return Promise.resolve({
            data: {
              conversation_id: 'test-conv-id',
              summary: 'Test summary'
            }
          });
        }
        return Promise.reject(new Error(`Unknown URL: ${url}`));
      });
      
      axios.post.mockImplementation((url, data) => {
        console.log(`[Test] Called axios.post with URL: ${url}`);
        console.log(`[Test] Post data:`, JSON.stringify(data).substring(0, 100) + '...');
        return Promise.resolve({ status: 200, data: { success: true } });
      });
      
      // Call the function
      const result = await sendElevenLabsConversationData(
        'test-call-sid',
        'test-conv-id',
        global.callStatuses
      );
      
      // Debug output
      console.log('[Test] sendElevenLabsConversationData result:', result);
      console.log('[Test] axios.get calls:', axios.get.mock.calls.length);
      console.log('[Test] axios.post calls:', axios.post.mock.calls.length);
      
      // Verify the webhook was sent successfully
      expect(result.success).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
    
    it('should not send data for ineligible calls', async () => {
      const result = await sendElevenLabsConversationData(
        'sales-handled-call',
        'sales-conv-id',
        global.callStatuses
      );
      
      expect(result.success).toBe(false);
      expect(result.reason).toBe('criteria_not_met');
      expect(axios.post).not.toHaveBeenCalled();
    });
    
    it('should handle API errors gracefully', async () => {
      axios.get.mockImplementation(() => Promise.reject(new Error('API error')));
      axios.post.mockImplementation(() => Promise.reject(new Error('Webhook error')));
      
      const result = await sendElevenLabsConversationData(
        'test-call-sid',
        'test-conv-id',
        global.callStatuses
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
    
    it('should not send webhooks when disabled', async () => {
      // Disable webhooks
      configureWebhook({ enabled: false });
      
      const result = await sendElevenLabsConversationData(
        'test-call-sid',
        'test-conv-id',
        global.callStatuses
      );
      
      expect(result.success).toBe(false);
      expect(result.reason).toBe('webhooks_disabled');
      expect(axios.get).not.toHaveBeenCalled();
      expect(axios.post).not.toHaveBeenCalled();
      
      // Re-enable webhooks for other tests
      configureWebhook({ enabled: true });
    });
  });
  
  describe('configureWebhook', () => {
    it('should update webhook configuration', async () => {
      // Use a unique URL to verify it was used
      const testUrl = 'https://new-webhook-url.com';
      
      // Update the webhook configuration
      configureWebhook({
        url: testUrl,
        retryAttempts: 1,
        retryDelayMs: 10,
        timeoutMs: 1000
      });
      
      // Set up mocks
      axios.get.mockImplementation((url) => {
        console.log(`[Test] Called axios.get with URL: ${url}`);
        if (url.includes('/transcript')) {
          return Promise.resolve({
            data: {
              conversation_id: 'test-conv-id',
              transcripts: [{ speaker: 'agent', text: 'Hello' }]
            }
          });
        } 
        if (url.includes('/summary')) {
          return Promise.resolve({
            data: {
              conversation_id: 'test-conv-id',
              summary: 'Test summary'
            }
          });
        }
        return Promise.reject(new Error(`Unknown URL: ${url}`));
      });
      
      axios.post.mockImplementation((url, data) => {
        console.log(`[Test] Called axios.post with URL: ${url}`);
        return Promise.resolve({ status: 200, data: { success: true } });
      });
      
      // Test the function
      const result = await sendElevenLabsConversationData(
        'test-call-sid',
        'test-conv-id',
        global.callStatuses
      );
      
      // Debug output
      console.log('[Test] sendElevenLabsConversationData result in configureWebhook test:', result);
      console.log('[Test] axios.post calls:', axios.post.mock.calls);
      
      // Verify the webhook was sent with the updated URL
      expect(result.success).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post.mock.calls[0][0]).toBe(testUrl);
    });
  });
}); 