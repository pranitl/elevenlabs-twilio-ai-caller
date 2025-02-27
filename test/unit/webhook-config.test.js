import { jest } from '@jest/globals';
import {
  getWebhookConfig,
  updateWebhookConfig,
  resetWebhookConfig,
  getWebhookUrlForContext
} from '../../forTheLegends/outbound/webhook-config.js';

describe('Webhook Configuration', () => {
  beforeEach(() => {
    // Reset environment
    delete process.env.MAKE_WEBHOOK_URL;
    delete process.env.MAKE_CALLBACK_WEBHOOK_URL;
    delete process.env.MAKE_VOICEMAIL_WEBHOOK_URL;
    
    // Reset config to defaults
    resetWebhookConfig();
  });
  
  describe('getWebhookConfig', () => {
    it('should return the default configuration when environment variables are not set', () => {
      const config = getWebhookConfig();
      
      expect(config.url).toContain('hook.us2.make.com');
      expect(config.retryAttempts).toBe(3);
      expect(config.enabled).toBe(true);
    });
    
    it('should use environment variables when set', () => {
      process.env.MAKE_WEBHOOK_URL = 'https://test-webhook.com';
      process.env.MAKE_CALLBACK_WEBHOOK_URL = 'https://test-callback.com';
      process.env.MAKE_VOICEMAIL_WEBHOOK_URL = 'https://test-voicemail.com';
      
      // Reset to pick up new environment variables
      resetWebhookConfig();
      
      const config = getWebhookConfig();
      
      expect(config.url).toBe('https://test-webhook.com');
      expect(config.callbackUrl).toBe('https://test-callback.com');
      expect(config.voicemailUrl).toBe('https://test-voicemail.com');
    });
  });
  
  describe('updateWebhookConfig', () => {
    it('should update specific configuration values', () => {
      updateWebhookConfig({
        retryAttempts: 5,
        timeoutMs: 5000
      });
      
      const config = getWebhookConfig();
      
      expect(config.retryAttempts).toBe(5);
      expect(config.timeoutMs).toBe(5000);
      // Other values should be unchanged
      expect(config.enabled).toBe(true);
    });
    
    it('should completely disable webhooks when enabled is set to false', () => {
      updateWebhookConfig({
        enabled: false
      });
      
      expect(getWebhookUrlForContext({})).toBeNull();
    });
  });
  
  describe('getWebhookUrlForContext', () => {
    it('should return the voicemail URL for voicemail calls', () => {
      process.env.MAKE_VOICEMAIL_WEBHOOK_URL = 'https://test-voicemail.com';
      resetWebhookConfig();
      
      const url = getWebhookUrlForContext({ isVoicemail: true });
      
      expect(url).toBe('https://test-voicemail.com');
    });
    
    it('should return the callback URL for scheduled callbacks', () => {
      process.env.MAKE_CALLBACK_WEBHOOK_URL = 'https://test-callback.com';
      resetWebhookConfig();
      
      const url = getWebhookUrlForContext({ callbackScheduled: true });
      
      expect(url).toBe('https://test-callback.com');
    });
    
    it('should return the default URL for normal calls', () => {
      process.env.MAKE_WEBHOOK_URL = 'https://test-webhook.com';
      resetWebhookConfig();
      
      const url = getWebhookUrlForContext({});
      
      expect(url).toBe('https://test-webhook.com');
    });
  });
}); 