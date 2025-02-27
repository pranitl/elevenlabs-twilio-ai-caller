import { jest } from '@jest/globals';
import {
  getFormattedPrompt,
  getFirstMessage,
  getInitConfig,
  BASE_PROMPT
} from '../../forTheLegends/prompts/elevenlabs-prompts.js';

describe('ElevenLabs Prompts', () => {
  describe('getFormattedPrompt', () => {
    it('should return the base prompt when no customizations are provided', () => {
      const result = getFormattedPrompt();
      expect(result).toBe(BASE_PROMPT);
    });
    
    it('should add lead information when provided', () => {
      const leadInfo = {
        LeadName: 'John Doe',
        CareNeededFor: 'Mother',
        CareReason: 'Dementia'
      };
      
      const result = getFormattedPrompt(leadInfo);
      
      expect(result).toContain(BASE_PROMPT);
      expect(result).toContain('John Doe');
      expect(result).toContain('Mother');
      expect(result).toContain('Dementia');
    });
    
    it('should add voicemail instructions when isVoicemail is true', () => {
      const leadInfo = {
        LeadName: 'John Doe'
      };
      
      const result = getFormattedPrompt(leadInfo, { isVoicemail: true });
      
      expect(result).toContain(BASE_PROMPT);
      expect(result).toContain('This call has reached a voicemail');
      expect(result).toContain('John Doe');
    });
    
    it('should add generic voicemail instructions when no lead info is available', () => {
      const result = getFormattedPrompt({}, { isVoicemail: true });
      
      expect(result).toContain(BASE_PROMPT);
      expect(result).toContain('This call has reached a voicemail');
      expect(result).toContain('Keep the message concise but warm and professional');
    });
    
    it('should add additional instructions when provided', () => {
      const additionalInstructions = 'This is a test call, please do not transfer to sales.';
      
      const result = getFormattedPrompt({}, { additionalInstructions });
      
      expect(result).toContain(BASE_PROMPT);
      expect(result).toContain(additionalInstructions);
    });
  });
  
  describe('getFirstMessage', () => {
    it('should format the first message with lead information', () => {
      const leadInfo = {
        LeadName: 'John Doe',
        CareNeededFor: 'Mother'
      };
      
      const result = getFirstMessage(leadInfo);
      
      expect(result).toContain('John Doe');
      expect(result).toContain('Mother');
    });
    
    it('should use default values when lead information is missing', () => {
      const result = getFirstMessage({});
      
      expect(result).toBe("Hello, this is Heather from First Light Home Care. I'm calling about the care services inquiry. Am I speaking with the right person?");
    });
  });
  
  describe('getInitConfig', () => {
    it('should create a properly formatted initialization config', () => {
      const leadInfo = {
        LeadName: 'John Doe',
        CareNeededFor: 'Mother'
      };
      
      const result = getInitConfig(leadInfo);
      
      expect(result.type).toBe('conversation_initiation_client_data');
      expect(result.conversation_config_override.agent.system_prompt).toContain('John Doe');
      expect(result.conversation_config_override.agent.first_message).toContain('John Doe');
      expect(result.conversation_config_override.agent.wait_for_user_speech).toBe(true);
      expect(result.conversation_config_override.conversation.initial_audio_silence_timeout_ms).toBe(3000);
    });
    
    it('should allow customization of all options', () => {
      const options = {
        firstMessage: 'Custom first message',
        waitForUserSpeech: false,
        silenceTimeoutMs: 5000,
        isVoicemail: true
      };
      
      const result = getInitConfig({}, options);
      
      expect(result.conversation_config_override.agent.system_prompt).toContain('This call has reached a voicemail');
      expect(result.conversation_config_override.agent.first_message).toBe('Custom first message');
      expect(result.conversation_config_override.agent.wait_for_user_speech).toBe(false);
      expect(result.conversation_config_override.conversation.initial_audio_silence_timeout_ms).toBe(5000);
    });
  });
}); 